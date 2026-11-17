import {spawn} from 'node:child_process'
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {sanitizePrototypeSvg} from './svg-prototype.mjs'
const checker=fileURLToPath(new URL('./vendor/ppt_master/upstream/scripts/svg_quality_checker.py',import.meta.url))
const REVISION='3af3e8ef774c4d67ee57e1306d9256d08c9ee1bf'
const LIMIT=4*1024*1024
const fail=(message,code='PPT_MASTER_QUALITY_FAILED')=>Object.assign(new Error(message),{statusCode:422,code})
function run(directory,signal){
 signal?.throwIfAborted()
 return new Promise((resolve,reject)=>{
  let problem,bytes=0
  const child=spawn('/usr/bin/python3',[checker,directory,'--json'],{shell:false,detached:process.platform!=='win32',windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'}})
  const stop=error=>{problem??=error;if(child.pid){try{process.kill(process.platform==='win32'?child.pid:-child.pid,'SIGKILL')}catch{child.kill('SIGKILL')}}}
  const abort=()=>stop(signal.reason??new DOMException('Aborted','AbortError'))
  const timer=setTimeout(()=>stop(fail('上游 SVG 检查超时。','PPT_MASTER_QUALITY_TIMEOUT')),30000)
  signal?.addEventListener('abort',abort,{once:true})
  const output=chunk=>{bytes+=chunk.length;if(bytes>LIMIT)stop(fail('上游 SVG 检查输出超过上限。','PPT_MASTER_QUALITY_OUTPUT_LIMIT'))}
  child.stdout.on('data',output);child.stderr.on('data',output)
  child.on('error',()=>{problem??=fail('上游 SVG 检查器无法启动。','PPT_MASTER_QUALITY_UNAVAILABLE')})
  child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(problem)reject(problem);else if(code!==0)reject(fail('上游 SVG 检查未通过，退出码 '+code+'。'));else resolve()})
  if(signal?.aborted)abort()
 })
}
/** Structural SVG validation only. Neither visual fidelity nor human approval. */
export async function runPptMasterQualityCheck({prototypes,canvas,signal}){
 signal?.throwIfAborted()
 if(!Array.isArray(prototypes)||!prototypes.length||prototypes.length>24)throw fail('上游检查需要 1–24 个 SVG 原型。')
 // Complete preflight before creating a workspace or starting the pinned CLI.
 const svgs=prototypes.map(p=>sanitizePrototypeSvg(p.prototypeSvg,{canvas}))
 const inputHash=createHash('sha256').update(JSON.stringify({revision:REVISION,canvas:{width:canvas.width,height:canvas.height},svgs})).digest('hex')
 const directory=await mkdtemp(join(tmpdir(),'pre-design-svg-quality-'))
 try{
  for(let i=0;i<svgs.length;i++){signal?.throwIfAborted();await writeFile(join(directory,`slide_${String(i+1).padStart(2,'0')}.svg`),svgs[i],{mode:0o600})}
  await run(directory,signal);signal?.throwIfAborted()
  const reportPath=join(directory,'svg_quality_report.json')
  if((await stat(reportPath)).size>LIMIT)throw fail('上游 SVG 检查报告超过上限。')
  let report;try{report=JSON.parse(await readFile(reportPath,'utf8'))}catch{throw fail('上游 SVG 检查报告无效。')}
  if(report.schema!=='ppt-master.svg-quality-report.v1'||report.summary?.errors!==0||report.summary?.total!==svgs.length||report.categories?.blocking?.count!==0)throw fail('上游 SVG 检查报告未通过或未覆盖全部原型。')
  const warnings=(report.categories?.introduced?.issues??[]).map(issue=>String(issue.message??'').split(directory).join('[private-workspace]').slice(0,1000)).filter(Boolean).slice(0,100)
  return {status:'passed',errors:[],warnings,receipt:{checker:'ppt-master-svg-quality',revision:REVISION,status:'passed',inputHash}}
 }finally{await rm(directory,{recursive:true,force:true})}
}
