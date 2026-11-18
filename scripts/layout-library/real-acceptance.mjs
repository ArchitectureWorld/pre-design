import {runComponentObservationTrial} from './component-observation-trial.mjs'
import {acceptanceErrorRecord,timedAcceptanceModel} from './real-acceptance-diagnostics.mjs'
// Opt-in, private, project-free acceptance. Never reads or writes production DB.
import {readFile,writeFile,mkdir,stat,realpath} from 'node:fs/promises'
import {createHash,randomUUID} from 'node:crypto'
import {basename,resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {privateCheckpointStore} from './private-checkpoints.mjs'
import {validateStageOutputLimits} from '../../web/app/src/layout-library/reference-stage-policy.mjs'
export function assertProfileOnlyStage(stage){
 if(stage!=='profile')throw Object.assign(Error('ACCEPTANCE_PROFILE_SCOPE_STOP'),{code:'ACCEPTANCE_PROFILE_SCOPE_STOP'})
}
export function acceptanceWorkflowOptions(c){
 validateStageOutputLimits(c.stageOutputTokenLimits)
 if(c.referenceComponentVersion!==undefined&&![1,2,3].includes(c.referenceComponentVersion))throw Error('REFERENCE_COMPONENT_VERSION_INVALID')
 return {payload:{...(c.referenceComponentVersion!==undefined?{referenceComponentVersion:c.referenceComponentVersion}:{}),...(c.referenceWorkflowVersion!==undefined?{referenceWorkflowVersion:c.referenceWorkflowVersion}:{}),...(c.prototypeContractVersions!==undefined?{prototypeContractVersions:c.prototypeContractVersions}:{})},stageOutputTokenLimits:c.stageOutputTokenLimits}
}
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
export async function extractAcceptanceDocument({extract,bytes,filename,signal,fullDocument=false}){
 const parsed=await extract({bytes,filename,signal})
 if(!fullDocument)return parsed
 if(!['pdf','pptx'].includes(parsed.kind)||!Number.isSafeInteger(parsed.pageCount)||parsed.pageCount<1||parsed.pageCount>300)throw Error('FULL_REFERENCE_LIMIT')
 const images=new Map(parsed.images.map(image=>[image.page,image])),pages=new Map((parsed.pages??[]).map(page=>[page.page??page.pageNumber,page]))
 const checkBudget=()=>{if([...images.values()].reduce((n,image)=>n+image.data.length,0)>200*1024*1024)throw Error('FULL_REFERENCE_IMAGE_BYTES_LIMIT')}
 checkBudget()
 for(let start=1;start<=parsed.pageCount;start+=30){
  signal?.throwIfAborted()
  const expected=Array.from({length:Math.min(30,parsed.pageCount-start+1)},(_,i)=>start+i)
  if(expected.every(page=>images.has(page)))continue
  const batch=await extract({bytes,filename,signal,...(parsed.kind==='pdf'?{pdfStartPage:start}:{pptxStartPage:start})})
  if(batch.kind!==parsed.kind||batch.pageCount!==parsed.pageCount||JSON.stringify(batch.readPages)!==JSON.stringify(expected)||batch.sourceSha256&&batch.sourceSha256!==digest(bytes))throw Error('FULL_REFERENCE_RANGE_CHANGED')
  for(const image of batch.images){if(!expected.includes(image.page))throw Error('FULL_REFERENCE_RANGE_CHANGED');images.set(image.page,image)}
  for(const page of batch.pages??[])pages.set(page.page??page.pageNumber,page)
  if(!expected.every(page=>images.has(page)&&pages.has(page)))throw Error('FULL_REFERENCE_PAGE_MISSING')
  checkBudget()
 }
 return {...parsed,text:'',images:[...images.values()].sort((a,b)=>a.page-b.page),pages:[...pages.values()].sort((a,b)=>(a.page??a.pageNumber)-(b.page??b.pageNumber)),readPages:[...images.keys()].sort((a,b)=>a-b),summary:`完整参考共 ${parsed.pageCount} 页，原页预览已全部提取；模型观察和设计综合独立核验。`,limitations:[...(parsed.limitations??[]),'原先批次/抽样说明为提取历史；当前已提取全部原页，不等于已完成模型综合或视觉验收。']}
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
 if(m.profileOnly===true&&(m.cases.length!==1||maxCalls!==1||timeoutMs>180000||policy.routes.parent.fallbacks.length>1))throw Error('PROFILE_ONLY_BUDGET_INVALID')
 if(m.componentObservationOnly===true&&(m.profileOnly===true||m.cases.length!==1||maxCalls!==1||timeoutMs>180000||policy.routes.vision.fallbacks.length>1||m.cases[0].selectedPages?.length!==1||m.cases[0].fullDocument))throw Error('COMPONENT_TRIAL_SCOPE_INVALID')
 const workers=new ProjectWorkers({settings:m.settings,credentials:m.credentials,privateRoot:join(out,'private-worker')})
 const configuration=workers.configuration.bind(workers)
 workers.configuration=async(...args)=>boundedModelRuntime(await configuration(...args))
 await workers.validateTaskConfiguration(policy,['parent','vision'])
 const skill=await readFile(new URL('../../web/app/src/skills/layout-reference/SKILL.md',import.meta.url),'utf8'),results=[]
 const stageCheckpoints=m.checkpointDirectory?await privateCheckpointStore(m.checkpointDirectory):undefined
 let modelCalls=0
 for(const [i,c]of m.cases.entries()){
  const record={case:i+1,passed:false,realModelVerified:false,sourceKind:null,sourceSha256:null,modelCalls:0,actualRequests:0,modelTimings:[],stages:[],humanVisualAcceptance:'pending'}
  const startedAt=Date.now();record.startedAt=new Date(startedAt).toISOString();
  const folder=join(out,'case-'+(i+1));await mkdir(folder,{mode:0o700});const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error('ACCEPTANCE_TIMEOUT')),timeoutMs)
  try{
   if(typeof c.file!=='string'||!c.file.startsWith('/'))throw Error('ABSOLUTE_REFERENCE_REQUIRED')
   const info=await stat(c.file);if(!info.isFile()||info.size>100*1024*1024)throw Error('REFERENCE_LIMIT')
   if(c.fullDocument&&c.selectedPages)throw Error('CONFLICTING_REFERENCE_SCOPE')
   const bytes=await readFile(c.file),filename=basename(c.file),parsed=await extractAcceptanceDocument({extract:extractReferenceDocument,bytes,filename,signal:controller.signal,fullDocument:c.fullDocument===true})
   const options=acceptanceWorkflowOptions(c);record.workflowOptions=structuredClone(options);
   const source=referenceInput({filename,bytes,parsed,selectedPages:c.selectedPages});record.selectedPages=c.selectedPages??null;record.sourceKind=parsed.kind;record.sourceSha256=source.file.sha256;record.extractionCoverage={totalPages:source.file.pageCount??null,readPages:source.file.readPages??[]}
   const runTrial=m.componentObservationOnly===true?runComponentObservationTrial:runReferenceWorkflow
   const result=await runTrial({source,jobId:randomUUID(),stopAfterProfile:m.profileOnly===true,payload:{...options.payload,name:'真实参考验收候选',text:c.request??'提炼参考设计，保留真实设计关系并用于实际内容试排。',referenceIntent:c.intent??'style',referenceScope:c.scope??'deck',referenceFidelity:c.fidelity??'standard',referencePipeline:'native-v3',referenceFiles:[source.file]},images:source.images,policy,skill,signal:controller.signal,stageCheckpoints,stageOutputTokenLimits:m.profileOnly===true?{...options.stageOutputTokenLimits,profile:8192}:options.stageOutputTokenLimits,
    loadArtifact:async ref=>{if(ref.sourceId!==source.file.id)throw Error('ARTIFACT_OWNER_MISMATCH');const a=source.artifacts.get(ref.path);if(!a||a.sha256!==ref.sha256)throw Error('ARTIFACT_HASH_MISMATCH');return a},
    runModel:async input=>{if(m.profileOnly===true)assertProfileOnlyStage(input.stage);if(modelCalls>=maxCalls)throw Object.assign(Error('ACCEPTANCE_CALL_BUDGET'),{code:'ACCEPTANCE_CALL_BUDGET'});modelCalls++;record.modelCalls++;console.log(JSON.stringify({case:i+1,stage:input.stage,modelCalls}));try{const value=await timedAcceptanceModel(input,value=>workers.runLayoutReference(value),record.modelTimings);record.actualRequests+=(value.execution?.parent?.requests??[]).length;return value}catch(error){record.actualRequests+=(error.execution?.parent?.requests??[]).length;throw error}}})
   record.stages=result.execution.stages.map(s=>({stage:s.stage,status:s.status,actualRoute:s.execution?.actualRoute??null,modelInvoked:s.modelInvoked!==false,reused:s.reused===true}))
   record.reusedStages=record.stages.filter(s=>s.reused).length
   record.realModelVerified=record.stages.filter(s=>s.modelInvoked||s.reused).every(s=>!!s.actualRoute)&&record.stages.some(s=>s.actualRoute)
   if(m.componentObservationOnly===true){record.componentObservationAccepted=true;record.componentObservation=result.analysis.componentObservation;record.scope='component-observation-only';record.visualFidelityEvaluated=false}
   else if(m.profileOnly===true){record.profileAccepted=true;record.profile=result.analysis.profile;record.scope='profile-only';record.visualFidelityEvaluated=false}
   else {
   const pkg=result.response.package;await writeFile(join(folder,'package.json'),JSON.stringify(pkg,null,2),{mode:0o600})
   await writeFile(join(folder,'sample-preview.html'),renderNativeDocument(samplePages(pkg),{title:'真实模型设计候选，合成内容试排，非人工验收'}),{mode:0o600})
   record.geometry=await validatePublication(pkg,{signal:controller.signal});record.passed=record.realModelVerified&&record.geometry.status==='passed'
   }
  }catch(error){record.error=acceptanceErrorRecord(error,controller.signal);if(error.execution?.stages)record.stages=error.execution.stages.map(s=>({stage:s.stage,status:s.status,actualRoute:s.execution?.actualRoute??null}));console.log(JSON.stringify({case:i+1,error:record.error}))}
  finally{clearTimeout(timer);record.finishedAt=new Date().toISOString();record.elapsedMs=Date.now()-startedAt}
  results.push(record);await writeFile(join(out,'receipt.json'),JSON.stringify({schema:'pre-design.real-reference-acceptance.v1',productionDeployed:false,budget:{maxStages:maxCalls,timeoutMs,providerRetries:0,existingPolicyFallbacksRetained:true,hardCurrencyLimit:false},policyRevision:policy.revision,modelCalls,results,summary:acceptanceSummary(results)},null,2),{mode:0o600})
 }
 return {output:out,summary:acceptanceSummary(results)}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const result=await runAcceptance(process.argv[2]);console.log(JSON.stringify(result));if(result.summary.failed)process.exitCode=1}catch(error){console.error(JSON.stringify({error:error.code??error.name,message:error.message==='EXPLICIT_REAL_ACCEPTANCE_MANIFEST_REQUIRED'?error.message:'Acceptance setup failed; inspect private configuration locally.'}));process.exitCode=1}
}
