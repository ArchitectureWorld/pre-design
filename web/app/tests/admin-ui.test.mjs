import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { defaultPolicy } from '../src/model-policy.mjs'
import { mountAdminControls } from '../src/admin-ui.js'

const modelKey = (provider, model) => JSON.stringify([provider, model])
const byLabel = (document, label) => [...document.querySelectorAll('[aria-label]')].find(element => element.getAttribute('aria-label') === label)
const button = (document, text) => [...document.querySelectorAll('button')].find(element => element.textContent.trim() === text)
async function settle(predicate) {
  for (let count = 0; count < 20; count++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)) }
  assert.ok(predicate(), '界面未完成预期的异步更新')
}
function change(window, element, value) {
  assert.ok(element, '应找到可操作的字段')
  if (element.type === 'checkbox') element.checked = value
  else element.value = value
  element.dispatchEvent(new window.Event(element.tagName === 'SELECT' || element.type === 'checkbox' ? 'change' : 'input', { bubbles: true }))
}
function readyPolicy() {
  const policy = defaultPolicy(); policy.revision = 4
  for (const [provider, model] of [['SenseNova', 'sensenova-6.8-flash-lite'], ['SenseNova', 'deepseek-v4-pro'], ['deepseek-official', 'deepseek-v4-pro']]) {
    const entry = policy.models.find(item => item.provider === provider && item.model === model)
    entry.status = 'verified'; entry.capabilities.tools = true
  }
  policy.models.find(item => item.model === 'Klein').imageConfig.referenceImageWorkflow = 'workflows/klein-edit.json'
  return policy
}
function fixture(t, { role = 'admin', policy = readyPolicy(), putError, jobs = [], users = [] } = {}) {
  const dom = new JSDOM('<!doctype html><body><div class="top-right"><button>配色</button></div></body>', { url: 'http://localhost' })
  const { document } = dom.window, calls = [], notices = []
  let current = structuredClone(policy)
  const request = async (path, options = {}) => {
    calls.push({ path, options: structuredClone(options) })
    if (path === '/admin/jobs') return structuredClone(jobs)
    if (path === '/admin/users') return structuredClone(users)
    assert.equal(path, '/admin/models')
    if (options.method === 'PUT') {
      if (putError) throw Object.assign(new Error('远端请求失败'), { status: putError })
      current = { ...structuredClone(options.body.policy), revision: current.revision + 1 }
    }
    return structuredClone(current)
  }
  const controls = mountAdminControls({ request, notify: message => notices.push(message), container: document.querySelector('.top-right'), identity: { id: 'operator', role } })
  t.after(() => { controls.dispose(); dom.window.close() })
  const open = async () => {
    button(document, '模型管理').click()
    await settle(() => byLabel(document, '文本生成主模型'))
  }
  return { document, window: dom.window, calls, notices, controls, open, setRemote: value => { current = structuredClone(value) } }
}

test('普通用户不创建模型管理入口、不创建弹窗，也不请求管理接口', t => {
  const { document, calls, controls } = fixture(t, { role: 'user' })
  assert.equal(button(document, '模型管理'), undefined)
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(document.querySelectorAll('button').length, 1)
  assert.deepEqual(calls, [])
  assert.doesNotThrow(() => controls.dispose())
})

test('管理员填写独立搜索和 ComfyUI 地址，仅提交凭据引用并保留工作流版本',async t=>{
  const {document,window,calls,open}=fixture(t,{policy:defaultPolicy()});await open()
  change(window,byLabel(document,'启用独立搜索'),true)
  change(window,byLabel(document,'搜索服务地址'),'https://search.example.org/v1/tools')
  change(window,byLabel(document,'搜索凭据引用'),'credential:SEARCH_KEY')
  change(window,byLabel(document,'ComfyUI 服务地址'),'http://127.0.0.1:8188')
  button(document,'保存策略').click()
  await settle(()=>calls.some(call=>call.options.method==='PUT'))
  const sent=calls.find(call=>call.options.method==='PUT').options.body.policy
  assert.equal(sent.search.enabled,true);assert.equal(sent.search.credentialRef,'credential:SEARCH_KEY')
  assert.equal(sent.models[10].imageConfig.baseURL,'http://127.0.0.1:8188')
  assert.equal(sent.models[10].imageConfig.textToImageWorkflow,'flux3-klein-t2i@2026-11-03.1')
  assert.equal(sent.models[10].status,'unverified')
})

test('管理员通过真实表单修改主备顺序与预算，并以原版本保存完整策略', async t => {
  const { document, window, calls, open } = fixture(t)
  await open()
  assert.equal(calls[0].path, '/admin/models')
  assert.equal(document.querySelectorAll('[data-admin-model]').length, 14)
  assert.equal(document.querySelectorAll('input[type="password"]').length, 0)
  const name = 'SenseNova / sensenova-6.8-flash-lite'
  change(window, byLabel(document, `${name} 输出预算`), '12345')
  change(window, byLabel(document, `${name} 运行提供方`), 'sensenova-linux')
  change(window, byLabel(document, `${name} 凭据引用`), 'credential:sensenova-linux')
  change(window, byLabel(document, '文本生成主模型'), modelKey('deepseek-official', 'deepseek-v4-pro'))
  byLabel(document, '文本生成添加备用').click()
  byLabel(document, '文本生成添加备用').click()
  byLabel(document, '文本生成备用模型 2 上移').click()
  change(window, byLabel(document, '全局并发上限'), '3')
  button(document, '保存策略').click()
  await settle(() => document.querySelector('[data-admin-revision]')?.textContent.includes('5'))
  const sent = calls.find(call => call.options.method === 'PUT')
  assert.equal(sent.path, '/admin/models')
  assert.equal(sent.options.body.expectedRevision, 4)
  assert.equal(sent.options.body.policy.revision, 4)
  assert.deepEqual(sent.options.body.policy.routes.text, {
    primary: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    fallbacks: [{ provider: 'SenseNova', model: 'deepseek-v4-pro' }, { provider: 'SenseNova', model: 'sensenova-6.8-flash-lite' }],
  })
  const model = sent.options.body.policy.models.find(item => item.model === 'sensenova-6.8-flash-lite')
  assert.equal(model.maxOutputTokens, 12345)
  assert.equal(model.runtimeProvider, 'sensenova-linux')
  assert.equal(model.credentialRef, 'credential:sensenova-linux')
  assert.equal(sent.options.body.policy.limits.globalConcurrency, 3)
  assert.equal(sent.options.body.policy.models.find(item => item.model === 'kimi-k3').compat.maxTokensField, 'max_completion_tokens')
  assert.equal(sent.options.body.policy.models.find(item => item.model === 'Klein').imageConfig.referenceImageWorkflow, 'workflows/klein-edit.json')
  byLabel(document, '文本生成备用模型 1 移除').click()
  button(document, '保存策略').click()
  await settle(() => calls.filter(call => call.options.method === 'PUT').length === 2)
  const second = calls.filter(call => call.options.method === 'PUT')[1].options.body
  assert.equal(second.expectedRevision, 5)
  assert.deepEqual(second.policy.routes.text.fallbacks, [{ provider: 'SenseNova', model: 'sensenova-6.8-flash-lite' }])
})

test('409 冲突保留当前草稿，只有明确重新加载才替换成服务器版本', async t => {
  const { document, window, calls, open, setRemote } = fixture(t, { putError: 409 })
  await open()
  const label = 'SenseNova / sensenova-6.8-flash-lite 输出预算'
  change(window, byLabel(document, label), '12000')
  button(document, '保存策略').click()
  await settle(() => document.querySelector('[role="alert"]')?.textContent.includes('草稿已保留'))
  assert.equal(byLabel(document, label).value, '12000')
  assert.equal(calls.filter(call => !call.options.method || call.options.method === 'GET').length, 1)
  const remote = readyPolicy(); remote.revision = 8; setRemote(remote)
  byLabel(document, '重新加载配置').click()
  await settle(() => document.querySelector('[data-admin-revision]')?.textContent.includes('8'))
  assert.equal(byLabel(document, label).value, '65536')
  assert.equal(calls.filter(call => !call.options.method || call.options.method === 'GET').length, 2)
})

test('待验证模型不会自动成为备用，图像与配套 LLM 未就绪会明确显示', async t => {
  const { document, window, open } = fixture(t, { policy: defaultPolicy() })
  await open()
  assert.equal(byLabel(document, '文本生成添加备用').disabled, true)
  assert.match(document.querySelector('[data-admin-role="image"]').textContent, /图像未就绪/)
  assert.match(document.querySelector('[role="dialog"]').textContent, /实际调用.*验证/)
  const label = 'SenseNova / deepseek-v4-pro'
  change(window, byLabel(document, `${label} 验证状态`), 'verified')
  assert.equal(byLabel(document, '文本生成添加备用').disabled, true)
  const vision = byLabel(document, '图片审查主模型')
  assert.ok(![...vision.options].some(option => option.value === modelKey('SenseNova', 'deepseek-v4-pro')))
  assert.equal(byLabel(document, '网络查询添加备用').disabled, true)
  change(window, byLabel(document, `${label} 工具调用`), true)
  assert.equal(byLabel(document, '文本生成添加备用').disabled, false)
  assert.equal(byLabel(document, '网络查询添加备用').disabled, false)
})

test('字段校验展开待修正模型，主选变更后键盘焦点仍在对应选择框', async t => {
  const { document, window, calls, open } = fixture(t)
  await open()
  const primary = byLabel(document, '文本生成主模型'); primary.focus()
  change(window, primary, modelKey('deepseek-official', 'deepseek-v4-pro'))
  assert.equal(document.activeElement, byLabel(document, '文本生成主模型'))
  const budget = byLabel(document, 'SenseNova / sensenova-6.8-flash-lite 输出预算')
  assert.equal(budget.closest('details').open, false)
  change(window, budget, '')
  button(document, '保存策略').click()
  assert.equal(budget.closest('details').open, true)
  assert.ok(!calls.some(call => call.options.method === 'PUT'))
})

test('已选备用的验证状态失效时保留选择并指出需要调整', async t => {
  const { document, window, open } = fixture(t)
  await open()
  byLabel(document, '文本生成添加备用').click()
  change(window, byLabel(document, 'SenseNova / deepseek-v4-pro 验证状态'), 'unverified')
  assert.equal(byLabel(document, '文本生成备用模型 1').value, modelKey('SenseNova', 'deepseek-v4-pro'))
  assert.match(document.querySelector('[data-admin-role="text"]').textContent, /备用待调整/)
})

test('运行记录与用户页签只渲染允许字段，Escape 关闭并返回入口焦点', async t => {
  const { document, window, calls, controls, open } = fixture(t, {
    jobs: [{ id: 'job-01', owner_id: 'alice', kind: 'research', status: 'partial', policy_revision: 4,
      routes: { parent: { primary: { provider: 'SenseNova', model: 'sensenova-6.8-flash-lite' }, fallbacks: [] } }, token_hash: 'NEVER_RENDER_HASH', apiKey: 'NEVER_RENDER_KEY' }],
    users: [{ id: 'alice', role: 'user', disabled: false, token_hash: 'NEVER_RENDER_HASH' }, { id: 'operator', role: 'admin', disabled: true }],
  })
  await open()
  button(document, '运行记录').click()
  await settle(() => document.body.textContent.includes('job-01'))
  assert.ok(calls.some(call => call.path === '/admin/jobs'))
  assert.match(document.body.textContent, /sensenova-6.8-flash-lite/)
  button(document, '用户账号').click()
  await settle(() => calls.some(call => call.path === '/admin/users') && document.body.textContent.includes('已禁用'))
  assert.ok(!document.body.textContent.includes('NEVER_RENDER_HASH'))
  assert.ok(!document.body.textContent.includes('NEVER_RENDER_KEY'))
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(document.activeElement, button(document, '模型管理'))
  controls.dispose()
  assert.equal(button(document, '模型管理'), undefined)
  assert.equal(document.querySelector('.top-right').textContent, '配色')
})

test('任务详情区分候选路由与实际调用，缺失预算用量备用记录不会从策略推算', async t => {
  const { document, open } = fixture(t, {
    jobs: [{ id: 'job-actual', owner_id: 'alice', kind: 'research', status: 'failed', policy_revision: 4,
      routes: { parent: { primary: { provider: 'SenseNova', model: 'sensenova-6.8-flash-lite' }, fallbacks: [{ provider: 'SenseNova', model: 'kimi-k3' }] } },
      error: '研究步骤尚未取得有效结果',
      execution_metadata: {
        parent: { status: 'recorded', requests: [{ sessionId: 'session-main', seq: 3, time: 1793664000000, turn: 1, step: 2,
          provider: 'sensenova-linux', model: 'kimi-k3', evidence: 'request/header', usage: null, apiKey: 'DO_NOT_RENDER_TRACE_SECRET' }] },
        executions: [
          { executionId: 'exec-text', classId: 'text', childId: 'child-1', status: 'failed', startedAt: '2026-11-03T00:00:00.000Z', updatedAt: '2026-11-03T00:00:01.000Z',
            actual: { provider: 'deepseek-linux', model: 'deepseek-v4-pro' }, evidence: 'native-request-header', usage: null },
          { executionId: 'exec-vision', classId: 'review', childId: null, status: 'failed', startedAt: '2026-11-03T00:00:00.000Z', updatedAt: '2026-11-03T00:00:01.000Z', actual: null, evidence: 'not_recorded', usage: null },
        ], usage: null,
      },
    }, { id: 'job-no-trace', kind: 'chat', status: 'interrupted', policy_revision: null, execution_metadata: null,
      routes: { parent: { primary: { provider: 'SenseNova', model: 'sensenova-6.8-flash-lite' }, fallbacks: [] } } }],
  })
  await open(); button(document, '运行记录').click()
  await settle(() => document.querySelectorAll('.pd-admin-job').length === 2)
  const [recorded, missing] = document.querySelectorAll('.pd-admin-job')
  const details = [...recorded.querySelectorAll('details')].find(node => node.querySelector('summary').textContent === '实际调用记录')
  assert.ok(details, '应提供实际调用详情')
  details.querySelector('summary').click()
  assert.equal(details.open, true)
  assert.equal(details.querySelectorAll('.pd-admin-call').length, 3)
  assert.match(details.textContent, /sensenova-linux/)
  assert.match(details.textContent, /kimi-k3/)
  assert.match(details.textContent, /deepseek-linux/)
  assert.match(details.textContent, /deepseek-v4-pro/)
  assert.match(details.textContent, /exec-text/)
  assert.match(details.textContent, /失败/)
  assert.match(details.textContent, /预算、用量与备用切换：未记录/)
  assert.ok(!details.textContent.includes('sensenova-6.8-flash-lite'), '不得以候选主模型替代实际记录')
  assert.ok(!details.textContent.includes('131072'), '不得以候选模型预算冒充实际请求预算')
  assert.match(details.querySelectorAll('.pd-admin-call')[2].textContent, /实际模型：未记录/)
  assert.match(recorded.textContent, /任务错误：研究步骤尚未取得有效结果/)
  const candidates = [...recorded.querySelectorAll('details')].find(node => node.querySelector('summary').textContent.includes('保存的候选路由'))
  assert.match(candidates.querySelector('summary').textContent, /不代表实际调用/)
  assert.match(candidates.textContent, /sensenova-6.8-flash-lite/)
  assert.match(missing.querySelector('.pd-admin-execution').textContent, /实际调用、预算、用量与备用切换：未记录/)
  assert.match(missing.textContent, /配置版本：未记录/)
  assert.ok(!missing.querySelector('.pd-admin-execution').textContent.includes('sensenova-6.8-flash-lite'))
  assert.ok(!document.body.textContent.includes('DO_NOT_RENDER_TRACE_SECRET'))
})
