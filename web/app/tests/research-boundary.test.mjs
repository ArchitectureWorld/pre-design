import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const boundary = await import('../../worker/project-boundary.mjs').catch(() => ({}))

test('实际工具守卫覆盖父子Agent、越界软链接和伪造提案身份', async t => {
  assert.equal(typeof boundary.createProjectToolGuard, 'function')
  const root = await mkdtemp(join(tmpdir(), 'research-guard-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'project'); await mkdir(workspace)
  await writeFile(join(workspace, 'brief.md'), 'original')
  await writeFile(join(root, 'secret.md'), 'secret')
  await symlink(join(root, 'secret.md'), join(workspace, 'escape.md'))
  const parent = { id: 'parent', session: { header: { cwd: workspace } } }
  const child = { id: 'child', session: { header: { cwd: workspace, origin: 'subagent', parentSession: 'parent', delegationDepth: 1 } } }
  const agents = new Map([['parent', parent], ['child', child]])
  const guard = boundary.createProjectToolGuard({ workspace, sessionId: 'parent', agents, readContext: () => ({ project: { projectId: 'p1', currentRevision: 2 } }) })
  const call = (name, args = {}, agent = parent) => guard({ name, arguments: args, agent })
  assert.equal(call('preplanning_read_material', { path: 'brief.md' }), undefined)
  for (const path of ['../secret.md', join(root, 'secret.md'), 'escape.md', 'C:\\secret.md']) assert.match(call('preplanning_read_material', { path }), /WEB_/)
  for (const agent of [parent, child, undefined]) for (const name of ['bash','read','write','run_code','preplanning_run_command']) assert.match(guard({ name, arguments: {}, agent }), /WEB_/)
  assert.equal(call('structured_output', { result: 'ok' }, child), undefined)
  const envelope = { project_id: 'p1', expected_revision: 2, actor: { actor_id: 'parent', role: 'agent' }, validation_intent: 'human_review', requested_state: 'pending_review' }
  assert.equal(call('preplanning_apply_commands', { envelope }), undefined)
  for (const update of [{ project_id: 'p2' }, { expected_revision: 1 }, { requested_state: 'confirmed' }, { actor: { actor_id: 'other', role: 'agent' } }]) assert.match(call('preplanning_apply_commands', { envelope: { ...envelope, ...update } }), /WEB_/)
  assert.match(call('preplanning_apply_commands', { envelope }, child), /WEB_/)
  assert.match(call('web_fetch', { url: 'file:///etc/passwd' }, child), /WEB_/)
  assert.match(call('web_fetch', { url: 'http://127.0.0.1:3080/private' }, child), /WEB_/)
  assert.equal(call('web_fetch', { url: 'https://example.org/source' }, child), undefined)
  child.session.header.cwd = root
  assert.match(call('structured_output', {}, child), /WEB_/)
})
test('父会话保留研究子Agent继承所需的网页工具，父prompt仍隐藏；子Agent本地输出工具不当作全局工具restrict', async t => {
  const workspace=await mkdtemp(join(tmpdir(),'research-scope-'))
  t.after(()=>rm(workspace,{recursive:true,force:true}))
  const hooks=new Map(),seen=[]
  const globalNames=['preplanning_get_context','preplanning_read_material','preplanning_apply_commands','web_fetch']
  const ctx={agents:new Map(),preplanning:{repository:{readContext:()=>({project:{projectId:'p',currentRevision:0}})}},tools:{get:name=>globalNames.includes(name)?{}:undefined,guard(){}},on:(name,handler)=>hooks.set(name,handler)}
  boundary.installProjectBoundary(ctx,{workspace,sessionId:'parent'})
  const agent=id=>({id,ctx:{tools:{restrict:filter=>{for(const name of filter.allow)assert.ok(globalNames.includes(name),`Unknown global tool ${name}`);seen.push({id,allow:filter.allow})}},systemPrompt:{section(){}}}})
  hooks.get('agent/created')({agent:agent('parent')})
  assert.ok(seen[0].allow.includes('web_fetch'))
  hooks.get('agent/created')({agent:agent('child')})
  assert.deepEqual(seen[1].allow,['web_fetch'])
  const assembled={tools:[{name:'preplanning_read_material'},{name:'web_fetch'}],sections:[]}
  await hooks.get('system-prompt/assemble')(undefined,{agent:{id:'parent'}},async()=>assembled)
  assert.deepEqual(assembled.tools.map(t=>t.name),['preplanning_read_material'])
})
