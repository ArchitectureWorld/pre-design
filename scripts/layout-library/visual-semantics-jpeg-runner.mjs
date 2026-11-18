import {readFile,writeFile,mkdir,open} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {runVisualSemanticsTrial} from './visual-semantics-trial.mjs'
import {prepareReferenceImageTransport} from './reference-image-transport.mjs'
import {boundedModelRuntime} from './real-acceptance.mjs'
import {timedAcceptanceModel,acceptanceErrorRecord} from './real-acceptance-diagnostics.mjs'
const [repo,manifest,mode]=process.argv.slice(2);if(!['preflight','execute'].includes(mode))throw Error('MODE')
const m=JSON.parse(await readFile(manifest)),sha=x=>createHash('sha256').update(x).digest('hex')
const source={fileSha256:'54c097e5a9f706259824cd42dc8a6a76d2fe25312f2d4e3b649231de5dd4926d',pageNumber:15},imageSha='6e3406fbc4b2bfed3123ed89ab11541475ae1e1beba45e159baa8aef8fe58d28'
if(m.timeoutMs!==180000||m.maxRequests!==1||m.outputTokens!==4096||!/^([a-f0-9]{64})$/.test(m.observationSha256))throw Error('BUDGET')
const bytes=await readFile(m.image);if(sha(bytes)!==imageSha||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('AUTHORIZED_IMAGE_MISMATCH')
const analysis=JSON.parse(await readFile(m.analysis)),saved=analysis.componentObservations?.find(o=>o.source.fileSha256===source.fileSha256&&o.source.pageNumber===15)
if(!saved||saved.evidenceKind!=='image')throw Error('AUTHORIZED_OBSERVATION_MISSING')
const observation={source:saved.source,components:saved.components};if(sha(JSON.stringify(observation))!==m.observationSha256)throw Error('OBSERVATION_CHANGED')
const policy=JSON.parse(await readFile(m.policy)),route=policy.routes?.vision
if(route?.primary?.provider!=='yaoguang-codex'||route.primary.model!=='yaoguang02-gpt-6-astra'||route.fallbacks?.length!==1||route.fallbacks[0].provider!=='SenseNova'||route.fallbacks[0].model!=='sensenova-6.8-flash-lite')throw Error('AUTHORIZED_ROUTE_CHANGED')
const {validateComponentObservation}=await import(pathToFileURL(repo+'/web/app/src/layout-library/reference-components.mjs'));validateComponentObservation(observation,[source])
const transport=await prepareReferenceImageTransport(bytes)
const derivedSha='f861be49d3243241ad7b4b4abd9c0bd7d2d4c3d3a3076f6c0e9b56842700f954'
if(transport.derived.sha256!==derivedSha||transport.derived.width!==1400||transport.derived.height!==788||transport.derived.mimeType!=='image/jpeg')throw Error('DERIVED_IMAGE_CHANGED')
route.fallbacks=[]
const provenance={source:transport.source,derived:transport.derived,method:transport.method,pixelPreserving:false,coordinatesPreserved:true}
const image={name:'authorized-page-15-derived-q90.jpg',page:15,mimeType:'image/jpeg',sha256:derivedSha,data:transport.bytes.toString('base64')}
if(mode==='preflight'){console.log(JSON.stringify({source,imageSha,provenance,observationSha256:m.observationSha256,componentCount:observation.components.length,route,maxRequests:1,timeoutMs:180000,modelCalls:0}));process.exit(0)}
await mkdir(m.output,{recursive:true,mode:0o700});const lock=await open(m.output+'/one-run.lock','wx',0o600);await lock.close()
const started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error('ACCEPTANCE_TIMEOUT')),180000),terminate=()=>controller.abort(Error('ACCEPTANCE_TIMEOUT'));process.once('SIGTERM',terminate)
const {ProjectWorkers}=await import(pathToFileURL(repo+'/web/worker/runtime.mjs')),workers=new ProjectWorkers({settings:m.settings,credentials:m.credentials,privateRoot:m.output+'/private-worker'}),configuration=workers.configuration.bind(workers)
workers.configuration=async(...a)=>boundedModelRuntime(await configuration(...a))
const receipt={source,imageSha,provenance,observationSha256:m.observationSha256,modelCalls:0,modelTimings:[],budget:{maxRequests:1,timeoutMs:180000,outputTokens:4096,providerRetries:0},candidateCreated:false,currencyCost:null}
try{
const configured=await workers.configuration(policy,['vision'],{parentRole:'vision'}),provider=configured.model.providers[policy.models.find(row=>row.provider===route.primary.provider&&row.model===route.primary.model)?.runtimeProvider]
if(!provider||provider.api!=='openai-responses')throw Error('WIRE_PROTOCOL_UNSUPPORTED')
const wireBudget={protocol:'openai-responses',url:provider.baseURL.replace(/\/$/,'')+'/responses',model:'yaoguang02-gpt-6-astra',imageSha256:derivedSha,maxBodyBytes:800000,deadlineAt:started+180000,receiptPath:m.output+'/wire-receipt.jsonl'}
 await workers.validateTaskConfiguration(policy,['vision']);controller.signal.throwIfAborted()
 const result=await runVisualSemanticsTrial({source,observation,image,policy,signal:controller.signal,runModel:async input=>{
  if(input.stage!=='semantics-1'||receipt.modelCalls!==0)throw Error('STAGE_BUDGET');receipt.modelCalls++
  const value=await timedAcceptanceModel({...input,requestBudget:{maxRequests:1,deadlineAt:started+180000},wireBudget},x=>workers.runLayoutReference(x),receipt.modelTimings)
  await writeFile(m.output+'/raw-response.json',JSON.stringify(value),{mode:0o600});return value
 }})
 await writeFile(m.output+'/observation.json',JSON.stringify(result),{mode:0o600});receipt.status='validated-observation-not-visual-acceptance'
}catch(error){receipt.status='failed';receipt.error=acceptanceErrorRecord(error,controller.signal)}
finally{clearTimeout(timer);process.removeListener('SIGTERM',terminate);await workers.closeAll();receipt.elapsedMs=Date.now()-started;receipt.actualRequests=receipt.modelTimings.reduce((n,t)=>n+t.actualRequests,0);receipt.actualUsage=receipt.modelTimings.map(t=>t.actualUsage);await writeFile(m.output+'/receipt.json',JSON.stringify(receipt,null,2),{mode:0o600});console.log(JSON.stringify(receipt));if(receipt.status==='failed')process.exitCode=1}
