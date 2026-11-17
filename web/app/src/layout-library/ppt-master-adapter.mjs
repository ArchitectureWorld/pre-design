import {spawn} from 'node:child_process'
import {mkdir,readFile,readdir,realpath,rm,stat} from 'node:fs/promises'
import {resolve,join,relative,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'

const vendor=resolve(fileURLToPath(new URL('./vendor/ppt_master/upstream',import.meta.url)))
const importer=join(vendor,'scripts/pptx_template_import.py')
const guard=join(vendor,'scripts/attribution_guard.py')
const MAX_STDOUT=4*1024*1024,MAX_STDERR=96*1024,MAX_FILES=12000,MAX_ARTIFACT_BYTES=768*1024*1024
const hash=b=>createHash('sha256').update(b).digest('hex')
const fail=(message,code='PPT_MASTER_IMPORT_FAILED',statusCode=422)=>Object.assign(new Error(message),{code,statusCode})
const within=(root,path)=>{const rel=relative(root,path);return rel!==''&&!rel.startsWith('..'+sep)&&rel!=='..'&&!resolve(path).startsWith('\\\\')}

/** Spawn fixed, vendored tools without a shell; cancellation kills the process group. */
function run(command,args,{signal,deadline,label,python}) {
 signal?.throwIfAborted()
 const timeout=deadline-Date.now();if(timeout<=0)throw fail(label+' 超时。','PPT_MASTER_TIMEOUT',408)
 return new Promise((resolvePromise,reject)=>{
  let child,timer,problem,stdoutBytes=0,stderrBytes=0;const stdout=[],stderr=[]
  const stop=error=>{problem??=error;if(child?.pid){try{process.kill(process.platform==='win32'?child.pid:-child.pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')child.kill('SIGKILL')}}}
  try{child=spawn(command,args,{shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],env:{...process.env,LC_ALL:'C.UTF-8',PYTHONUTF8:'1'}})}catch(e){reject(fail(label+' 无法启动：'+e.message,'PPT_MASTER_TOOL_UNAVAILABLE',503));return}
  const abort=()=>stop(signal.reason??new DOMException('Aborted','AbortError'))
  signal?.addEventListener('abort',abort,{once:true})
  timer=setTimeout(()=>stop(fail(label+' 超时。','PPT_MASTER_TIMEOUT',408)),timeout);timer.unref?.()
  child.stdout.on('data',chunk=>{stdoutBytes+=chunk.length;if(stdoutBytes>MAX_STDOUT)stop(fail(label+' 标准输出超过限制。','PPT_MASTER_OUTPUT_LIMIT',413));else stdout.push(chunk)})
  child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes<=MAX_STDERR)stderr.push(chunk)})
  child.on('error',e=>{problem??=fail(label+' 无法启动：'+e.message,e.code==='ENOENT'?'PPT_MASTER_TOOL_UNAVAILABLE':'PPT_MASTER_TOOL_ERROR',503)})
  child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(problem){reject(problem);return}if(code!==0){const detail=Buffer.concat(stderr).toString('utf8').slice(-4000);reject(fail(label+' 执行失败（退出码 '+code+'）。'+(detail?'\n'+detail:''),'PPT_MASTER_TOOL_FAILED',422));return}resolvePromise(Buffer.concat(stdout))})
  if(signal?.aborted)abort()
 })
}
async function readJson(path,label){try{return JSON.parse(await readFile(path,'utf8'))}catch{throw fail('PPT Master '+label+' 缺失或无效。','PPT_MASTER_ARTIFACT_INVALID',422)}}
async function inventory(root,signal){
 const files=[],stack=[root];let total=0
 while(stack.length){
  signal?.throwIfAborted()
  const dir=stack.pop()
  for(const entry of await readdir(dir,{withFileTypes:true})){
   const path=join(dir,entry.name),info=await stat(path)
   if(entry.isSymbolicLink?.())throw fail('PPT Master 工作区包含符号链接。','PPT_MASTER_UNSAFE_ARTIFACT',422)
   if(entry.isDirectory()){stack.push(path);continue}
   if(!entry.isFile())continue
   const rel=relative(root,path).split(sep).join('/')
   if(!within(root,path))throw fail('PPT Master 产物路径越界。','PPT_MASTER_UNSAFE_ARTIFACT',422)
   total+=info.size;if(files.length>=MAX_FILES||total>MAX_ARTIFACT_BYTES)throw fail('PPT Master 产物超过资源上限。','PPT_MASTER_ARTIFACT_LIMIT',413)
   const bytes=await readFile(path)
   files.push({path:rel,bytes:info.size,sha256:hash(bytes)})
  }
 }
 return {files,totalBytes:total}
}

/**
 * Internal Pre-design adapter for the pinned PPT Master importer.
 * Workspace must be a private, empty directory owned by the calling job.
 * This does not create a PPT Master project, user, task, or template library.
 */
export async function runPptMasterImport({sourcePath,workspace,signal,timeoutMs=180000,python=process.env.PRE_LAYOUT_PYTHON_BINARY||'/usr/bin/python3'}={}){
 if(typeof sourcePath!=='string'||!resolve(sourcePath).toLowerCase().endsWith('.pptx'))throw fail('PPT Master 仅接受已由 Pre-design 校验的 PPTX 文件。','PPT_MASTER_SOURCE_INVALID',415)
 if(typeof workspace!=='string'||!resolve(workspace).startsWith(resolve(process.env.PRE_LAYOUT_PRIVATE_ROOT||'/tmp')+sep))throw fail('PPT Master 工作区必须位于 Pre-design 私有临时根目录。','PPT_MASTER_WORKSPACE_INVALID',400)
 const root=resolve(workspace),deadline=Date.now()+timeoutMs
 await mkdir(root,{recursive:true,mode:0o700})
 const entries=await readdir(root)
 if(entries.length)throw fail('PPT Master 工作区必须为空。','PPT_MASTER_WORKSPACE_NOT_EMPTY',409)
 try{
  await run(python,[guard],{signal,deadline,label:'PPT Master Attribution Guard'})
  await run(python,[importer,resolve(sourcePath),'-o',root,'--inheritance-mode','both'],{signal,deadline,label:'PPT Master PPTX Importer'})
  signal?.throwIfAborted()
  const [manifest,nativeStructure,inheritance,authoringSummary,conversionReport]=await Promise.all([
   readJson(join(root,'analysis','manifest.json'),'Manifest'),
   readJson(join(root,'analysis','native_structure.json'),'Native Structure'),
   readJson(join(root,'svg','inheritance.json'),'SVG inheritance'),
   readJson(join(root,'authoring-svg','authoring_summary.json'),'Authoring Summary'),
   readJson(join(root,'validation','conversion-report.json'),'Conversion Report'),
  ])
  const files=await inventory(root,signal),svg=files.files.filter(f=>f.path.endsWith('.svg'))
  const slides=manifest.slides??manifest.slideRecords??[]
  if(!slides.length||!inheritance||typeof inheritance!=='object'||!Object.keys(inheritance).length)throw fail('PPT Master 导入没有形成完整页面和继承清单。','PPT_MASTER_ARTIFACT_INVALID',422)
  if(!svg.some(f=>f.path.startsWith('svg/master_'))||!svg.some(f=>f.path.startsWith('svg/layout_'))||!svg.some(f=>f.path.startsWith('svg/slide_'))||!svg.some(f=>f.path.startsWith('svg-flat/slide_')))throw fail('PPT Master 缺少分层或平面 SVG 产物。','PPT_MASTER_ARTIFACT_INVALID',422)
  const sourceHash=manifest.sourceSha256??manifest.source_hash??manifest.source?.sha256??null
  return {schemaVersion:'pre-design.ppt-master-import-receipt.v1',upstream:{repository:'https://github.com/hugohe3/ppt-master',revision:'3af3e8ef774c4d67ee57e1306d9256d08c9ee1bf',license:'MIT'},workspace:root,source:{name:manifest.source?.name??manifest.sourceFile??manifest.source_file??null,sha256:sourceHash,pageCount:slides.length},manifest,nativeStructure,inheritance,authoringSummary,conversionReport,artifacts:files,svgCount:svg.length,receiptHash:hash(Buffer.from(JSON.stringify(files)))}
 }catch(error){await rm(root,{recursive:true,force:true});throw error}
}
