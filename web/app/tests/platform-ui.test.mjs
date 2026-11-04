import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
const ui = await import('../src/platform-ui.js').catch(() => ({}))

function setup(t) {
  const dom = new JSDOM('<header><div class="top-right"></div></header>', { url: 'http://localhost/' })
  const previous = { window: globalThis.window, document: globalThis.document, sessionStorage: globalThis.sessionStorage }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, sessionStorage: dom.window.sessionStorage })
  t.after(() => { Object.assign(globalThis, previous); dom.window.close() })
  return dom.window.document
}
const catalog = { chapters: [['1', '项目背景']], modules: [{ id: '1.01', title: '项目基本情况' }, { id: '1.02', title: '建设目标' }] }
const plan = { activeModuleIds: ['1.01', '1.02'], pendingModuleIds: [], inactiveModuleIds: [], blockedModuleIds: [], edges: [{ source: '1.01', target: '1.02' }] }

test('selecting research only prepares a scope; execution submits precisely the explicitly selected modules', async t => {
  assert.equal(typeof ui.mountPlatform, 'function')
  const document = setup(t), mutations = [], requests = []
  const platform = ui.mountPlatform({
    request: async (path, options) => { requests.push([path, options]); return { catalog, plan, selection: { dependencyModuleIds: ['1.01'] }, progress: { status: 'idle', modules: [] } } },
    mutate: async (path, body) => { mutations.push([path, body]); return { id: 'job-1' } },
    getProject: () => ({ id: 'project-1', outline: {status:'confirmed'}, jobs: [], revision: 0 }), getIdentity: async () => ({ id: 'alice', role: 'user' }), notify() {},
  })
  t.after(() => platform.dispose())
  await platform.openResearch()
  const checkbox = document.querySelector('input[data-module="1.02"]')
  checkbox.checked = true; checkbox.dispatchEvent(new window.Event('change', { bubbles: true }))
  assert.equal(mutations.length, 0)
  document.querySelector('[data-action="run-research"]').click()
  await new Promise(r => setTimeout(r, 20))
  assert.equal(mutations.length, 0, 'unresolved conditions must not dispatch a paid task')
  assert.match(document.querySelector('.platform-message').textContent, /四项.*条件/)
  for (const select of document.querySelectorAll('[data-condition]')) {
    select.value = 'false'; select.dispatchEvent(new window.Event('change', { bubbles: true }))
  }
  document.querySelector('[data-action="run-research"]').click()
  await new Promise(r => setTimeout(r, 20))
  assert.equal(mutations.length, 1)
  assert.equal(mutations[0][0], 'research')
  assert.deepEqual(mutations[0][1].moduleIds, ['1.02'])
  assert.equal(mutations[0][1].flags.existingBuildings, false)
  assert.ok(!JSON.stringify(mutations).includes('provider'))
})

test('task panel retains limited results and cancels the selected task without resubmitting research', async t => {
  assert.equal(typeof ui.mountPlatform, 'function')
  const document = setup(t), requests = [], mutations = []
  const project = { id: 'project-1', jobs: [{ id: 'job-1', kind: 'research', status: 'running' }, { id: 'job-2', kind: 'research', status: 'partial', result: { limitations: ['缺少测绘资料'] } }] }
  const platform = ui.mountPlatform({ request: async (path, options) => { requests.push([path, options]); return [] }, mutate: async (...args) => mutations.push(args), getProject: () => project, getIdentity: async () => ({ role: 'user' }), notify() {} })
  t.after(() => platform.dispose())
  await platform.openTasks()
  assert.match(document.body.textContent, /缺少测绘资料/)
  document.querySelector('[data-cancel-job="job-1"]').click()
  await new Promise(r => setTimeout(r, 20))
  assert.equal(requests.find(([path]) => path.endsWith('/job-1/cancel'))[1].method, 'POST')
  assert.equal(mutations.length, 0)
})

test('changing projects closes the previous research scope so stale selections cannot target another project', async t => {
  assert.equal(typeof ui.mountPlatform, 'function')
  const document = setup(t); let project = { id: 'project-a', outline: {status:'confirmed'}, jobs: [] }
  const platform = ui.mountPlatform({ request: async () => ({ catalog, plan }), mutate: async () => assert.fail('must not submit stale selection'), getProject: () => project, getIdentity: async () => ({ role: 'user' }), notify() {} })
  t.after(() => platform.dispose())
  await platform.openResearch()
  project = { id: 'project-b', outline: {status:'confirmed'}, jobs: [] }; platform.onState(project)
  assert.equal(document.querySelector('[data-platform-dialog]')?.open ?? false, false)
})

test('chapter setup submits the actual requirements and only selected image ids without a fabricated approval', async t => {
  const document = setup(t), mutations = []
  const project = { id: 'project-1', outline: {status:'confirmed'}, jobs: [], materials: [{ id: 'image-1', filename: '项目照片.png', image: { width: 200, height: 120 } }, { id: 'text-1', filename: '任务书.txt' }] }
  const platform = ui.mountPlatform({ request: async () => ({ status: 'idle', chapters: [{ chapterId: 'site', prepared: false, readiness: { status: 'blocked', blockers: [{ message: '请先保存章节要求' }] } }] }), mutate: async (...args) => { mutations.push(args); return { status: 'configured' } }, getProject: () => project, getIdentity: async () => ({ role: 'user' }), notify() {} })
  t.after(() => platform.dispose())
  document.querySelector('[data-open="chapters"]').click(); await new Promise(r => setTimeout(r, 20))
  assert.equal(document.querySelectorAll('[data-chapter-material]').length, 1)
  const chapter = document.querySelector('[data-chapter]'); chapter.value = 'site'; chapter.dispatchEvent(new window.Event('change', { bubbles: true }))
  const message = '请使用本项目的研究成果，形成面向业主的场地章节。'
  document.querySelector('[data-chapter-message]').value = message
  document.querySelector('[data-chapter-feedback]').value = '资料不足的部分须说明。'
  document.querySelector('[data-chapter-material]').checked = true
  document.querySelector('[data-action="prepare-chapter"]').click(); await new Promise(r => setTimeout(r, 20))
  assert.deepEqual(mutations, [['chapters/prepare', { chapterId: 'site', message, feedback: '资料不足的部分须说明。', materialIds: ['image-1'] }]])
  assert.ok(!JSON.stringify(mutations).includes('planHash'))
})

test('research artifact preview displays the owned downloaded text without executing embedded markup', async t => {
  const document = setup(t), body = '# 研究结果\n资料缺口：测绘未完成\n<script>window.bad = true</script>'
  const platform = ui.mountPlatform({ request: async (path, options) => options?.download ? { filename: '研究汇编.md', blob: new Blob([body]) } : [{ id: 'artifact-1', filename: '研究汇编.md', status: 'unreviewed' }], mutate: async () => assert.fail('preview must not dispatch work'), getProject: () => ({ id: 'project-1', outline: {status:'confirmed'}, jobs: [] }), getIdentity: async () => ({ role: 'user' }), notify() {} })
  t.after(() => platform.dispose()); await platform.openTasks()
  document.querySelector('[data-preview-artifact]').click(); await new Promise(r => setTimeout(r, 20))
  assert.equal(document.querySelector('[data-preview-content]').textContent, body)
  assert.equal(document.querySelector('[data-preview-content] script'), null)
  assert.equal(window.bad, undefined)
})

test('workflow tasks and both draft download formats have Chinese status labels without implying professional approval', async t => {
  const document=setup(t),requests=[]
  const project={id:'project-1',jobs:[{id:'job-1',kind:'workflow',status:'completed',result:{response:'本轮初稿已保存。',workflowDraftId:'draft-1',version:1}}]}
  const platform=ui.mountPlatform({request:async(path,options)=>{requests.push([path,options]);return [{id:'workflow-draft-1-html',filename:'阶段初稿-V1.html',kind:'workflow-draft',status:'pending_review',bytes:2048},{id:'workflow-draft-1-md',filename:'阶段初稿-V1.md',kind:'workflow-draft',status:'pending_review',bytes:1024}]},mutate:async()=>assert.fail('viewing drafts must not dispatch tasks'),getProject:()=>project,getIdentity:async()=>({role:'user'}),notify(){}})
  t.after(()=>platform.dispose());await platform.openTasks()
  assert.match(document.querySelector('.platform-task strong').textContent,/阶段初稿/)
  assert.match(document.querySelector('[data-artifacts]').textContent,/待审阅/)
  assert.equal(document.querySelectorAll('[data-artifact]').length,2)
  assert.equal(document.querySelector('[data-artifact="workflow-draft-1-html"]').textContent,'下载 HTML')
  assert.equal(document.querySelector('[data-artifact="workflow-draft-1-md"]').textContent,'下载 Markdown')
  assert.doesNotMatch(document.querySelector('.platform-task').textContent,/workflowDraftId/)
})
