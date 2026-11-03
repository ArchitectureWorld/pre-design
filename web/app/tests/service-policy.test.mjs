import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultPolicy, validatePolicy, validateSnapshot } from '../src/model-policy.mjs'
import { materializeModelRuntime, installModelBoundary } from '../../worker/model-runtime.mjs'
import { reportModelRoles, validateReportSnapshot, publicBusinessData } from '../src/research-contract.mjs'

const klein = p => p.models.find(m => m.provider === 'Comfyui-PIC')
const settings = {'llm-pi-ai':{providers:{SenseNova:{api:'openai-completions',baseURL:'https://example.org/v1',apiKeyEnv:'SENSE_KEY'}}}}
for (const provider of ['ddg','bing','exa']) test(`${provider} 策略无需密钥和地址，拒绝借服务字段覆盖固定搜索后端`,()=>{
  const p=defaultPolicy()
  p.search={enabled:true,provider,maxResults:8,maxQueries:4,timeoutMs:30000}
  const frozen=validateSnapshot(p,[])
  assert.equal(frozen.search.provider,provider);assert.equal(frozen.search.baseURL,undefined)
  p.search.enabled=false;assert.equal(frozen.search.enabled,true)
  for(const field of ['baseURL','credentialRef','apiKey','proxyURL']) {
    const bad=structuredClone(p);bad.search[field]='https://invalid.example'
    assert.throws(()=>validatePolicy(bad),e=>e.code==='INVALID_MODEL_POLICY')
  }
})
function ready() {
  const p=defaultPolicy(), main=p.models[1]
  main.status='verified';main.capabilities.tools=true
  klein(p).status='verified';klein(p).imageConfig.baseURL='http://127.0.0.1:8188'
  return p
}
test('新策略固定用户 Flux3 工作流，搜索仅保存地址和凭据引用',()=>{
  const p=defaultPolicy()
  assert.equal(klein(p).imageConfig.modelFile,'flux3-image-klein-bf16.safetensors')
  assert.equal(klein(p).imageConfig.textToImageWorkflow,'flux3-klein-t2i@2026-11-03.1')
  assert.equal(klein(p).imageConfig.referenceImageWorkflow,'flux3-klein-i2i@2026-11-03.1')
  assert.equal(p.search.enabled,false)
  p.search={enabled:true,provider:'deepseek-search-api',baseURL:'https://search.example.org/v1/tools',credentialRef:'credential:SEARCH_KEY',maxResults:8,maxQueries:4,timeoutMs:30000}
  const snapshot=validateSnapshot(p,[])
  assert.equal(snapshot.search.credentialRef,'credential:SEARCH_KEY')
  p.search.baseURL='https://changed.example.org';assert.equal(snapshot.search.baseURL,'https://search.example.org/v1/tools')
  for (const change of [p=>p.search.apiKey='secret',p=>p.search.provider='web-search-deepseek',p=>p.search.baseURL='https://user:secret@example.org',p=>p.search.baseURL='https://example.org/?key=secret',p=>p.search.maxQueries=100,p=>klein(p).imageConfig.baseURL='file:///etc/passwd']) {
    const draft=defaultPolicy();change(draft);assert.throws(()=>validatePolicy(draft),e=>e.code==='INVALID_MODEL_POLICY')
  }
})
test('图像任务装配 ComfyUI 与配套 LLM，ComfyUI 不作为文本提供方',async()=>{
  const p=ready();klein(p).credentialRef='credential:COMFY_KEY'
  const result=materializeModelRuntime(p,settings,{refs:{SENSE_KEY:'model-secret',COMFY_KEY:'image-secret'}},['parent','text','image','vision'])
  assert.deepEqual(result.classRoutes.image,{provider:'Comfyui-PIC',model:'Klein',llm:{provider:'SenseNova',model:'sensenova-6.8-flash-lite'}})
  assert.deepEqual(Object.keys(result.providers),['SenseNova'])
  assert.equal(result.imageAvailability.status,'ready')
  assert.equal(result.imageBackend.baseURL,'http://127.0.0.1:8188')
  assert.equal(result.env.PRE_WEB_COMFY_CREDENTIAL,'image-secret')
  assert.ok(!JSON.stringify(result.imageBackend).includes('image-secret'))
  const hooks=new Map(),ctx={on:(name,fn)=>hooks.set(name,fn),preplanning:{agentClasses:{settings:()=>({revision:1}),save:async()=>{}}}}
  await installModelBoundary(ctx,{sessionId:'root',snapshot:p,...result})
  assert.equal((await hooks.get('agent/request')({agent:{id:'image-child'}},async()=>result.classRoutes.image.llm)).model,'sensenova-6.8-flash-lite')
  await assert.rejects(hooks.get('agent/request')({agent:{id:'image-child'}},async()=>({provider:'Comfyui-PIC',model:'Klein'})),/MODEL_ROUTE_FORBIDDEN/)
})
test('图像缺地址、凭据、旧工作流或未实现后端时不启动配套模型',()=>{
  for (const change of [p=>delete klein(p).imageConfig.baseURL,p=>klein(p).credentialRef='credential:MISSING',p=>klein(p).imageConfig.modelFile='Flux2-Klein-9B-True-v2-bf16.safetensors',p=>{p.routes.image.primary={provider:'启航引擎AIGC组',model:'tt-image-2.5'};p.models[11].status='verified'}]) {
    const p=ready();change(p)
    assert.throws(()=>materializeModelRuntime(p,settings,{refs:{SENSE_KEY:'model-secret'}},['parent','image']),e=>/^IMAGE_/u.test(e.code))
  }
})
test('章节生图检查真实 image 与配套角色，并剔除服务内部地址',()=>{
  const p=ready(),selection={chapterId:'site',stage:'production-visuals'}
  assert.deepEqual(reportModelRoles(selection),['parent','text','image','vision'])
  assert.equal(validateReportSnapshot(p,selection).revision,p.revision)
  klein(p).status='unverified'
  assert.throws(()=>validateReportSnapshot(p,selection),e=>e.code==='MODEL_POLICY_NOT_READY')
  assert.deepEqual(publicBusinessData({status:'not_ready',baseURL:'http://private',endpoint:'http://private/search',credentialEnv:'PRE_WEB_SECRET'}),{status:'not_ready'})
})
