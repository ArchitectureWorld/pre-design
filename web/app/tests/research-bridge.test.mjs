import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defaultPolicy } from '../src/model-policy.mjs'
import { Session } from '../../worker/node_modules/@deepseek-ai/dsh-session/lib/index.js'
import { createHash } from 'node:crypto'
import { recordResearchRequest } from '../../worker/research-request.mjs'
const bridge = await import('../../worker/web-bridge.mjs')
function policy() {
  const value = defaultPolicy()
  const model = value.models.find(row => row.provider === 'SenseNova' && row.model === 'sensenova-6.8-flash-lite')
  model.status = 'verified'; model.capabilities.tools = true
  return value
}
test('桥接只传显式选择，启动回执保持running，缺口与取消来自真实Core状态', async t => {
  assert.equal(typeof bridge.createBridgeHandler, 'function')
  const workspace = await mkdtemp(join(tmpdir(), 'research-bridge-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  let state = { status: 'idle', modules: [] }, calls = 0
  const agent = { id: 'session', session: Session.create('session') }
  const ctx = { agents: new Map([['session', agent]]), preplanning: {
    repository: { readContext: () => ({ project: { projectId: 'core1', currentRevision: 0 } }) },
    research: { catalog: () => ({ chapters: [['1','启动']], modules: [{ id:'1.01', title:'启动', figures:[], table:{} }] }),
      plan: selection => ({ requestedModuleIds: selection.moduleIds, effectiveModuleIds: selection.moduleIds, dependencyModuleIds: [], missingDependencies: [], blockedModuleIds: [], activeModuleIds:['1.01'], waves:[['1.01']] }),
      status: () => state,
      run: async (_agent, selection) => { calls++; assert.deepEqual(selection.moduleIds, ['1.01']); assert.equal(selection.redo, undefined); state = {status:'running', modules:[], requestedModuleIds:['1.01']}; return {kind:'success',text:'已启动'} },
      cancel: () => { state = { status:'cancelled', modules:[] }; return {kind:'success',text:'已提交取消'} },
    }, runtime: { snapshot: () => ({}) },
  } }
  const handle = bridge.createBridgeHandler(ctx, { workspace, sessionId:'session', snapshot:policy() })
  const selection = {moduleIds:['1.01'],flags:{industryPlanning:false,existingBuildings:false,externalPartners:false,marketing:false}}
  const started = await handle({operation:'research-run',selection})
  assert.equal(started.status, 'running'); assert.equal(calls, 1)
  await assert.rejects(handle({operation:'research-run',selection}), /RESEARCH_ALREADY_RUNNING/)
  state = {status:'partial',modules:[{itemId:'1.01',status:'limited'}],limitations:['缺原始证据']}
  const status = await handle({operation:'research-status'})
  assert.equal(status.status, 'partial'); assert.equal(status.limitations[0], '缺原始证据')
  state = {status:'running',modules:[]}
  assert.equal((await handle({operation:'research-cancel'})).status, 'cancelled')
  await assert.rejects(handle({operation:'research-run',selection:{...selection,command:'--all-modules'}}))
  await assert.rejects(handle({operation:'command',command:'/preplan-export'}))
  assert.equal(calls, 1)
})
test('单模块重做仅指定该模块并复用本项目同条件检查点，保留其它成果', async t => {
  const workspace=await mkdtemp(join(tmpdir(),'research-redo-'))
  t.after(()=>rm(workspace,{recursive:true,force:true}))
  const runId='RUN-11111111-1111-4111-8111-111111111111',root=join(workspace,'research','runs',runId)
  await mkdir(root,{recursive:true})
  const flags={industryPlanning:false,existingBuildings:false,externalPartners:false,marketing:false}
  const checkpoint={projectId:'core1',snapshotId:'snapshot-original',methodVersion:'planning-modules-62.v1',status:'completed',plan:{flags},moduleRuns:[{itemId:'1.01',status:'completed'},{itemId:'1.02',status:'completed'}]}
  const saved=JSON.stringify(checkpoint)
  await writeFile(join(root,'run.json'),saved)
  const agent={id:'parent',session:Session.create('parent')}
  await recordResearchRequest({},agent,{moduleIds:['1.01','1.02'],flags},[])
  const event=agent.session.snapshotEvents().find(row=>row.type==='user/message')
  await mkdir(join(workspace,'原始资料'))
  await writeFile(join(workspace,'原始资料/source.txt'),'原始项目资料')
  await writeFile(join(root,'snapshot.json'),JSON.stringify({taskBrief:JSON.stringify({sessionId:'parent',seq:event.seq,time:new Date(event.time).toISOString(),text:event.data.content[0].text}),corpus:{documents:[{path:'原始资料/source.txt',contentHash:createHash('sha256').update('原始项目资料').digest('hex')}]}}))
  let invocation
  const ctx={agents:new Map([['parent',agent]]),preplanning:{repository:{readContext:()=>({project:{projectId:'core1',currentRevision:0}})},research:{
    status:()=>({status:'idle',modules:[]}),plan:selection=>({missingDependencies:selection.moduleIds.includes('1.01')?[]:['1.01']}),run:async(_agent,selection)=>{invocation=selection;return{kind:'success',text:'已启动'}},
  }}}
  const handle=bridge.createBridgeHandler(ctx,{workspace,sessionId:'parent',snapshot:policy()})
  await handle({operation:'research-run',selection:{moduleIds:['1.02'],flags,redo:true}})
  assert.deepEqual(invocation,{moduleIds:['1.02'],flags,resumeRunIds:[runId],reviseModuleIds:['1.02']})
  assert.equal(await readFile(join(root,'run.json'),'utf8'),saved)
  await writeFile(join(workspace,'原始资料/new.txt'),'新上传资料')
  await assert.rejects(handle({operation:'research-run',selection:{moduleIds:['1.02'],flags,redo:true}}),error=>error.code==='MODULE_REDO_INPUT_CHANGED')
  await handle({operation:'research-run',selection:{moduleIds:['1.01'],flags}})
  assert.equal(invocation.resumeRunIds,undefined)
  assert.equal(await readFile(join(root,'run.json'),'utf8'),saved)
})
test('章节preflight在无输入时阻断模型任务，返回准备入口所需的业务缺项',async t=>{
  const workspace=await mkdtemp(join(tmpdir(),'research-chapter-bridge-'))
  t.after(()=>rm(workspace,{recursive:true,force:true}))
  let calls=0
  const ctx={agents:new Map([['session',{id:'session'}]]),preplanning:{repository:{readContext:()=>({project:{projectId:'core1'}})},
    research:{run:()=>{},status:()=>({status:'idle'})},reportAccess:{status:async()=>({status:'not_ready'}),chapter:async()=>{calls++}}}}
  const handle=bridge.createBridgeHandler(ctx,{workspace,sessionId:'session',snapshot:policy()})
  const result=await handle({operation:'report-preflight',selection:{chapterId:'site',stage:'production-plan'}})
  assert.equal(result.ready,false)
  assert(result.blockers.some(row=>row.code==='CHAPTER_PRODUCTION_REQUEST_REQUIRED'))
  await assert.rejects(handle({operation:'report-run',selection:{chapterId:'site',stage:'production-plan'}}),error=>error.code==='REPORT_MODULES_INCOMPLETE')
  assert.equal(calls,0)
  const status=await handle({operation:'report-status'})
  assert.equal(status.chapters.find(row=>row.chapterId==='site').prepared,false)
})
