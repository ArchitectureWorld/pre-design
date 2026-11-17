// Opt-in, private, project-free acceptance. Never reads or writes production DB.
import {readFile,writeFile,mkdir,stat,realpath} from 'node:fs/promises'
import {createHash,randomUUID} from 'node:crypto'
import {basename,resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
const digest=x=>createHash('sha256').update(x).digest('hex')
export function acceptanceSummary(results){
 const attempts=results.length,passed=results.filter(r=>r.passed===true).length,p=attempts?passed/attempts:null,z=1.959963984540054
 let wilson95=null
 if(attempts){const d=1+z*z/attempts,c=(p+z*z/(2*attempts))/d,h=z*Math.sqrt(p*(1-p)/attempts+z*z/(4*attempts*attempts))/d;wilson95={lower:Math.max(0,c-h),upper:Math.min(1,c+h)}}
 return {attempts,passed,failed:attempts-passed,successRate:p,wilson95,populationReliabilityEstablished:false,scope:'Observed selected-case technical outcomes only; not a representative sample or human visual acceptance.'}
}
export function boundedModelRuntime(runtime){
 const value=structuredClone(runtime)
 for(const provider of Object.values(value.model.providers))provider.retryPolicy={mode:'normal',maxRetries:0}
 return value
}
export function referenceInput({filename,bytes,parsed,selectedPages}){
 if(selectedPages!==undefined){
  if(parsed.kind!=='pdf'||!Array.isArray(selectedPages)||!selectedPages.length||selectedPages.length>6||new Set(selectedPages).size!==selectedPages.length||selectedPages.some(n=>!Number.isSafeInteger(n)||n<1||n>parsed.pageCount||!parsed.images?.some(image=>image.page===n)))throw Error('INVALID_SELECTED_PDF_PAGES')
  const selected=new Set(selectedPages),readPages=[...selectedPages].sort((a,b)=>a-b)
  parsed={...parsed,text:'',images:parsed.images.filter(image=>selected.has(image.page)),pages:(parsed.pages??[]).filter(page=>selected.has(page.page??page.pageNumber)),readPages,privateArtifacts:[],summary:`PDF 共 ${parsed.pageCount} 页；本次仅分析原页 ${readPages.join(', ')}。`,limitations:[...(parsed.limitations??[]),`本次只选取原页 ${readPages.join(', ')}；其他页面未送入模型，不代表整份文档版式覆盖。`]}
 }
 const id=randomUUID(),artifacts=new Map((parsed.privateArtifacts??[]).map(a=>[a.path,a]))
 const {images:raw=[],privateArtifacts=[],...document}=parsed
 const file={...document,id,name:filename,sha256:digest(bytes),bytes:bytes.length,hasImages:raw.length>0,imageCount:raw.length,privateArtifacts:privateArtifacts.map(({data,...a})=>a)}
 const images=raw.map(image=>({...image,fileId:id,name:filename,data:image.data.toString('base64'),sha256:digest(image.data)}))
 return {file,images,artifacts}
}
export async function runAcceptance(manifestPath){
 const m=JSON.parse(await readFile(manifestPath,'utf8'))
 if(m.allowRealModelCalls!==true||!Array.isArray(m.cases)||!m.cases.length||m.cases.length>12)throw Error('EXPLICIT_REAL_ACCEPTANCE_MANIFEST_REQUIRED')
 const maxCalls=m.maxModelCalls??8,timeoutMs=m.timeoutMs??900000
 if(!Number.isSafeInteger(maxCalls)||maxCalls<1||maxCalls>60||!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>3600000)throw Error('INVALID_ACCEPTANCE_BUDGET')
 for(const key of ['settings','credentials','policy','output'])if(typeof m[key]!=='string'||!m[key].startsWith('/'))throw Error('ABSOLUTE_PRIVATE_PATH_REQUIRED')
 const out=resolve(m.output);await mkdir(out,{mode:0o700});if(await realpath(out)!==out)throw Error('PRIVATE_OUTPUT_SYMLINK')
 const [{ProjectWorkers},{extractReferenceDocument},{runReferenceWorkflow},{validatePublication,samplePages},{renderNativeDocument},{validateSnapshot}]=await Promise.all([
  import('../../web/worker/runtime.mjs'),import('../../web/app/src/layout-library/reference-document.mjs'),import('../../web/app/src/layout-library/reference-workflow.mjs'),import('../../web/app/src/layout-library/validation.mjs'),import('../../web/app/src/layout-library/render.mjs'),import('../../web/app/src/model-policy.mjs')])
 const policy=validateSnapshot(JSON.parse(await readFile(m.policy,'utf8')),['parent','vision'])
 const workers=new ProjectWorkers({settings:m.settings,credentials:m.credentials,privateRoot:join(out,'private-worker')})
 const configuration=workers.configuration.bind(workers)
 workers.configuration=async(...args)=>boundedModelRuntime(await configuration(...args))
 await workers.validateTaskConfiguration(policy,['parent','vision'])
 const skill=await readFile(new URL('../../web/app/src/skills/layout-reference/SKILL.md',import.meta.url),'utf8'),results=[]
 let modelCalls=0
 for(const [i,c]of m.cases.entries()){
  const record={case:i+1,passed:false,realModelVerified:false,sourceKind:null,sourceSha256:null,modelCalls:0,actualRequests:0,stages:[],humanVisualAcceptance:'pending'}
  const folder=join(out,'case-'+(i+1));await mkdir(folder,{mode:0o700});const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error('ACCEPTANCE_TIMEOUT')),timeoutMs)
  try{
   if(typeof c.file!=='string'||!c.file.startsWith('/'))throw Error('ABSOLUTE_REFERENCE_REQUIRED')
   const info=await stat(c.file);if(!info.isFile()||info.size>100*1024*1024)throw Error('REFERENCE_LIMIT')
   const bytes=await readFile(c.file),filename=basename(c.file),parsed=await extractReferenceDocument({bytes,filename,signal:controller.signal})
   const source=referenceInput({filename,bytes,parsed,selectedPages:c.selectedPages});record.selectedPages=c.selectedPages??null;record.sourceKind=parsed.kind;record.sourceSha256=source.file.sha256
   const result=await runReferenceWorkflow({jobId:randomUUID(),payload:{name:'真实参考验收候选',text:c.request??'提炼参考设计，保留真实设计关系并用于实际内容试排。',referenceIntent:c.intent??'style',referenceScope:c.scope??'deck',referenceFidelity:c.fidelity??'standard',referencePipeline:'native-v3',referenceFiles:[source.file]},images:source.images,policy,skill,signal:controller.signal,
    loadArtifact:async ref=>{if(ref.sourceId!==source.file.id)throw Error('ARTIFACT_OWNER_MISMATCH');const a=source.artifacts.get(ref.path);if(!a||a.sha256!==ref.sha256)throw Error('ARTIFACT_HASH_MISMATCH');return a},
    runModel:async input=>{if(modelCalls>=maxCalls)throw Object.assign(Error('ACCEPTANCE_CALL_BUDGET'),{code:'ACCEPTANCE_CALL_BUDGET'});modelCalls++;record.modelCalls++;console.log(JSON.stringify({case:i+1,stage:input.stage,modelCalls}));try{const value=await workers.runLayoutReference(input);record.actualRequests+=(value.execution?.parent?.requests??[]).length;return value}catch(error){record.actualRequests+=(error.execution?.parent?.requests??[]).length;throw error}}})
   record.stages=result.execution.stages.map(s=>({stage:s.stage,status:s.status,actualRoute:s.execution?.actualRoute??null,modelInvoked:s.modelInvoked!==false}))
   record.realModelVerified=record.stages.filter(s=>s.actualRoute).length===record.modelCalls
   const pkg=result.response.package;await writeFile(join(folder,'package.json'),JSON.stringify(pkg,null,2),{mode:0o600})
   await writeFile(join(folder,'sample-preview.html'),renderNativeDocument(samplePages(pkg),{title:'真实模型设计候选，合成内容试排，非人工验收'}),{mode:0o600})
   record.geometry=await validatePublication(pkg,{signal:controller.signal});record.passed=record.realModelVerified&&record.geometry.status==='passed'
  }catch(error){record.error={code:error.code??error.name,issues:error.issues?.map(x=>({code:x.code,path:x.path,expected:x.expected})),failedStage:error.execution?.failedStage??null};if(error.execution)record.stages=error.execution.stages.map(s=>({stage:s.stage,status:s.status,actualRoute:s.execution?.actualRoute??null}));console.log(JSON.stringify({case:i+1,error:record.error}))}
  finally{clearTimeout(timer)}
  results.push(record);await writeFile(join(out,'receipt.json'),JSON.stringify({schema:'pre-design.real-reference-acceptance.v1',productionDeployed:false,budget:{maxStages:maxCalls,providerRetries:0,existingPolicyFallbacksRetained:true,hardCurrencyLimit:false},policyRevision:policy.revision,modelCalls,results,summary:acceptanceSummary(results)},null,2),{mode:0o600})
 }
 return {output:out,summary:acceptanceSummary(results)}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const result=await runAcceptance(process.argv[2]);console.log(JSON.stringify(result));if(result.summary.failed)process.exitCode=1}catch(error){console.error(JSON.stringify({error:error.code??error.name,message:error.message==='EXPLICIT_REAL_ACCEPTANCE_MANIFEST_REQUIRED'?error.message:'Acceptance setup failed; inspect private configuration locally.'}));process.exitCode=1}
}
