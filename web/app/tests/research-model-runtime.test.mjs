import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultPolicy } from '../src/model-policy.mjs'
const runtime = await import('../../worker/model-runtime.mjs').catch(() => ({}))
const configured = () => {
  const p = defaultPolicy(), model = p.models.find(m => m.provider === 'SenseNova' && m.model === 'sensenova-6.8-flash-lite')
  Object.assign(model, { status: 'verified', credentialRef: 'credential:SENSE_KEY', runtimeProvider: 'sensenova-local', capabilities: { text: true, tools: true, vision: true, image: false } })
  return p
}

test('运行快照仅装配已验证路由、独立预算和目标凭据，未配置时不继承环境密钥', () => {
  assert.equal(typeof runtime.materializeModelRuntime, 'function')
  const settings = { 'llm-pi-ai': { providers: {
    'sensenova-local': { api: 'openai-completions', baseURL: 'https://example.org/v1', apiKeyEnv: 'credential:SENSE_KEY', models: [{ id: 'gpt-danger' }] },
    gpt: { apiKeyEnv: 'OTHER' },
  } } }
  const empty = runtime.materializeModelRuntime(undefined, {}, {})
  assert.deepEqual(empty.providers, {})
  assert.deepEqual(empty.env, {})
  const output = runtime.materializeModelRuntime(configured(), settings, { refs: { SENSE_KEY: 'private-test-secret', OTHER: 'do-not-copy' } }, ['parent', 'text', 'web'])
  assert.deepEqual(Object.keys(output.providers), ['sensenova-local'])
  assert.deepEqual(output.providers['sensenova-local'].models.map(m => m.id), ['sensenova-6.8-flash-lite'])
  assert.equal(output.providers['sensenova-local'].models[0].maxTokens, 65536)
  assert.deepEqual(Object.values(output.env), ['private-test-secret'])
  assert.equal(output.classRoutes.image, null)
  assert.equal(output.imageAvailability.status, 'unavailable')
  assert.throws(() => runtime.materializeModelRuntime(configured(), settings, { refs: {} }, ['parent']), /MODEL_NOT_READY/)
  assert.throws(() => runtime.materializeModelRuntime(defaultPolicy(), settings, { refs: {} }, ['parent']), /模型策略未就绪/)
  assert.deepEqual(runtime.isolatedEnvironment({ PATH: '/usr/bin', HOME: '/home/user', OPENAI_API_KEY: 'no', DEEPSEEK_API_KEY: 'no', DSH_HOME: '/old', PRE_WEB_SOCKET: 'old' }), { PATH: '/usr/bin', HOME: '/home/user' })
})
test('父会话任务只启用所需角色，不读取未使用角色的凭据', () => {
  const policy = configured()
  policy.routes.text.primary = {provider:'deepseek-official',model:'deepseek-v4-flash'}
  const textModel = policy.models.find(row=>row.provider==='deepseek-official'&&row.model==='deepseek-v4-flash')
  textModel.status='verified'
  textModel.capabilities.tools=true
  const result = runtime.materializeModelRuntime(policy, {'llm-pi-ai':{providers:{'sensenova-local':{api:'openai-completions',baseURL:'https://example.org/v1',apiKeyEnv:'credential:SENSE_KEY'}}}}, {refs:{SENSE_KEY:'only-parent'}}, ['parent'])
  assert.equal(result.classRoutes.text,null)
  assert.equal(result.classRoutes.web,null)
  assert.deepEqual(Object.keys(result.providers),['sensenova-local'])
})

test('父会话与子Agent调用均受固定快照控制，失败不能退回外部GPT', async () => {
  assert.equal(typeof runtime.installModelBoundary, 'function')
  const listeners = new Map()
  const ctx = { on: (name, handler) => listeners.set(name, handler), preplanning: { agentClasses: { settings: () => ({ revision: 0 }), save: async (_revision, routes) => { assert.equal(routes.text.provider, 'sensenova-local'); assert.equal(routes.image, null) } } } }
  const policy = configured()
  await runtime.installModelBoundary(ctx, { sessionId: 'root', snapshot: policy, classRoutes: { text: { provider: 'sensenova-local', model: 'sensenova-6.8-flash-lite' }, web: { provider: 'sensenova-local', model: 'sensenova-6.8-flash-lite' }, review: null, image: null }, classFallbacks: {text:[],web:[],review:[],image:[]} })
  const request = listeners.get('agent/request')
  const config = await request({ agent: { id: 'root' } }, async () => ({ provider: 'gpt', model: 'gpt-5' }))
  assert.equal(config.provider, 'sensenova-local'); assert.equal(config.maxTokens, 65536)
  await assert.rejects(request({ agent: { id: 'child' } }, async () => ({ provider: 'gpt', model: 'gpt-5' })), /MODEL_ROUTE_FORBIDDEN/)
  let reached = false
  const stream = listeners.get('llm/stream')({ provider: 'gpt', model: 'gpt-5' }, async function* () { reached = true })
  await assert.rejects(async () => { for await (const _ of stream) {} }, /MODEL_ROUTE_FORBIDDEN/)
  assert.equal(reached, false)
})
test('父会话只沿已验证备用链切换，并采用备用模型自己的输出预算',async()=>{
  const policy=configured(), fallback=policy.models.find(row=>row.provider==='SenseNova'&&row.model==='kimi-k3')
  Object.assign(fallback,{status:'verified',runtimeProvider:'sensenova-local',capabilities:{text:true,tools:true,vision:false,image:false}})
  policy.routes.parent.fallbacks=[{provider:'SenseNova',model:'kimi-k3'}]
  const hooks=new Map(),ctx={on:(name,handler)=>hooks.set(name,handler),preplanning:{agentClasses:{settings:()=>({revision:0}),save:async()=>{}}}}
  await runtime.installModelBoundary(ctx,{sessionId:'root',snapshot:policy,classRoutes:{text:null,web:null,review:null,image:null},classFallbacks:{}})
  const fallbackDecision=await hooks.get('agent/request-error')({agent:{id:'root'},provider:'sensenova-local',failure:{code:'RATE_LIMIT'}},async()=>undefined)
  assert.deepEqual(fallbackDecision,{kind:'retry'})
  const next=await hooks.get('agent/request')({agent:{id:'root'}},async()=>({provider:'gpt',model:'gpt-old',maxTokens:1}))
  assert.deepEqual(next,{provider:'sensenova-local',model:'kimi-k3',maxTokens:131072})
  assert.equal(await hooks.get('agent/request-error')({agent:{id:'root'},provider:'sensenova-local',failure:{code:'RATE_LIMIT'}},async()=>undefined),undefined)
})
