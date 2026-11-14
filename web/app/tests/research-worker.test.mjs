import test from 'node:test'
import assert from 'node:assert/strict'
import { ProjectWorkers } from '../../worker/runtime.mjs'
import { defaultPolicy } from '../src/model-policy.mjs'
const project = {id:'project1',session_id:'session1',workspace:'/tmp/test-project'}
const selection = {moduleIds:['1.01'],flags:{industryPlanning:false,existingBuildings:false,externalPartners:false,marketing:false}}
function snapshot() {
  const value = defaultPolicy(), model = value.models.find(row => row.provider === 'SenseNova' && row.model === 'sensenova-6.8-flash-lite')
  model.status = 'verified'; model.capabilities.tools = true
  return value
}
class WorkerFixture extends ProjectWorkers {
  constructor(rpc) { super({pollIntervalMs:1}); this.rpc = rpc; this.disposed = 0 }
  async start(_project, _snapshot, roles) { this.roles=roles; return { rpc:this.rpc, harness:{close:async () => {this.disposed++}}, session:{run:async () => {throw new Error('NO_MODEL_CALL_IN_TEST')}} } }
}
test('后台研究启动成功后持续查询到partial，不能冒充completed', async () => {
  const operations = []
  let polls = 0
  const worker = new WorkerFixture(async input => {
    operations.push(input.operation)
    if(input.operation === 'research-run') return {status:'running',modules:[]}
    if(input.operation === 'research-status') return ++polls < 2 ? {status:'running',modules:[]} : {status:'partial',modules:[{itemId:'1.01',status:'limited'}],limitations:['资料不足']}
    throw new Error('UNEXPECTED_OPERATION')
  })
  assert.equal(typeof worker.runResearch, 'function')
  const events = []
  const result = await worker.runResearch(project, selection, snapshot(), event => events.push(event))
  assert.deepEqual(worker.roles,['parent','text','web'])
  assert.equal(result.status, 'partial'); assert.equal(result.limitations[0], '资料不足')
  assert.equal(polls, 2); assert.equal(events.at(-1).status, 'partial')
  assert.deepEqual(operations, ['research-run','research-status','research-status'])
  await worker.closeAll()
})
test('取消发生在启动期间，Worker启动后先退出，不能开始收费研究', async () => {
  let release, calls = 0, receivedSignal
  const gate = new Promise(resolve => {release=resolve})
  class SlowWorker extends WorkerFixture { async start(...args) { receivedSignal=args[3]; await gate; return super.start(...args) } }
  const worker = new SlowWorker(async () => {calls++;return {status:'completed'}})
  assert.equal(typeof worker.runResearch, 'function')
  const controller = new AbortController()
  const pending = worker.runResearch(project,selection,snapshot(),undefined,controller.signal)
  await new Promise(resolve => setImmediate(resolve)); controller.abort(new Error('USER_CANCELLED')); release()
  await assert.rejects(pending,/USER_CANCELLED/)
  assert.equal(receivedSignal,controller.signal,'启动探测须继承本次用户取消信号')
  assert.equal(calls, 0); assert.equal(worker.disposed, 1)
})
test('Worker尚在启动时已预留项目，第二个研究不能并发进入', async () => {
  let release, calls = 0
  const gate = new Promise(resolve => {release=resolve})
  class SlowWorker extends WorkerFixture { async start() {await gate;return super.start()} }
  const worker = new SlowWorker(async () => {calls++;return {status:'completed',modules:[]}})
  const first = worker.runResearch(project,selection,snapshot())
  const second = worker.runResearch(project,selection,snapshot())
  release()
  const settled = await Promise.allSettled([first,second])
  assert.equal(settled[0].status,'fulfilled')
  assert.equal(settled[1].status,'rejected')
  assert.equal(settled[1].reason.code,'WORKER_TASK_BUSY')
  assert.equal(calls,1)
  await worker.closeAll()
})
test('研究期间桥接断线会终止实例，不重放启动，也不留下后台收费任务',async()=>{
  let calls=0
  const worker=new WorkerFixture(async()=>{calls++;if(calls===1)return{status:'running',modules:[]};throw new Error('ECONNRESET')})
  await assert.rejects(worker.runResearch(project,selection,snapshot()),/ECONNRESET/)
  assert.equal(calls,2)
  assert.equal(worker.disposed,1)
})
test('已经取消的任务在模型校验与Worker启动前退出',async()=>{
  const worker=new WorkerFixture(async()=>{throw new Error('SHOULD_NOT_START')})
  const controller=new AbortController();controller.abort(new Error('USER_CANCELLED_EARLY'))
  await assert.rejects(worker.runResearch(project,selection,null,undefined,controller.signal),/USER_CANCELLED_EARLY/)
  assert.equal(worker.instances.size,0)
})
test('普通Agent从SDK session.event读取真实活动，只传固定标签而不外传消息、思考和工具参数',async()=>{
  const secret='PRIVATE_THOUGHT_AND_API_KEY', notifications=[
    {method:'session.status',params:{sessionId:project.session_id,status:'running'}},
    ...[
      ['turn/start',{turn:1}],
      ['step/start',{turn:1,step:1}],
      ['tool/call',{turn:1,step:1,callId:'read',name:'preplanning_read_material',arguments:secret}],
      ['tool/result',{turn:1,step:1,message:{toolCallId:'read',content:[{type:'text',text:secret}]}}],
      ['tool/call',{turn:1,step:1,callId:'context',name:'preplanning_get_context',arguments:secret}],
      ['tool/call',{turn:1,step:1,callId:'other',name:secret,arguments:secret}],
      ['assistant/message',{turn:1,step:1,message:{role:'assistant',content:[{type:'thinking',thinking:secret},{type:'text',text:secret}]},stream:[]}],
      ['assistant/reasoning',{text:secret}],
      ['turn/end',{turn:1,reason:{kind:'completed'}}],
    ].map(([type,data],seq)=>({method:'session.event',params:{sessionId:project.session_id,event:{type,data,seq,time:Date.now()}}})),
    {method:'session.status',params:{sessionId:project.session_id,status:'idle'}},
  ]
  class AgentFixture extends ProjectWorkers {
    async start(){return{harness:{close:async()=>{}},session:{run:async(_text,{onNotification})=>{
      for(const notification of notifications)onNotification(notification)
      return{finalResponse:'可审阅的回复',events:[{type:'turn/end',data:{reason:{kind:'completed'}}}]}
    }}}}
  }
  const worker=new AgentFixture(),events=[]
  try{
    const result=await worker.run(project,'test',value=>events.push(value),snapshot())
    assert.equal(result.response,'可审阅的回复')
    assert.deepEqual(events.map(value=>value.stage),['agent_running','generating','reading_material','tool_result','reading_context','tool_running','response_received'])
    assert.ok(events.every(value=>typeof value.label==='string'&&Object.keys(value).sort().join(',')==='label,stage'))
    assert.doesNotMatch(JSON.stringify(events),new RegExp(secret))
    assert.ok(!events.some(value=>['completed','failed','cancelled'].includes(value.stage)),'SDK活动不能决定API任务终态')
  }finally{await worker.closeAll()}
})

test('章节核对使用该项目和作业的只读会话，普通会话继续沿用项目历史', async () => {
  const worker = new ProjectWorkers()
  try {
    const task = {...project, read_only:true, task_id:'b13a677f-0ddb-438d-9aa1-861dea57bc72', outline_task_session:true}
    const primary = {rpc:()=>{}, harness:{close:async()=>{}}}
    worker.start=async () => primary
    await worker.open(project,snapshot())
    let prepared
    worker.start=async p => {prepared=p;return {rpc:()=>{},harness:{close:async()=>{}}}}
    const isolated=await worker.open(task,snapshot())
    assert.equal(prepared.task_id,task.task_id)
    const second={...task,task_id:'dcc02998-7e31-4d8f-9ac6-4164c82f5d4e'}
    assert.notEqual(await worker.open(second,snapshot()),isolated)
    assert.equal(prepared.task_id,second.task_id)
    assert.equal(await worker.open(project),await worker.instances.get(project.id))
    await assert.rejects(worker.open({...task,read_only:false},snapshot()),/READ_ONLY/)
  }finally{await worker.closeAll()}
})

test('模型明确拒绝过大的请求时准确报告原因，禁止把它误报成未确认的传输中断', async()=>{
  class OversizeFixture extends ProjectWorkers {
    async start(){return {harness:{close:async()=>{}},session:{run:async()=>({events:[{type:'turn/end',data:{
      reason:{kind:'error',error:{code:'CONTEXT_WINDOW_EXCEEDED',message:'private upstream detail'}}
    }}]})}}}
  }
  const w=new OversizeFixture()
  try{await assert.rejects(w.run(project,'核对',()=>{},snapshot()),e=>e.code==='MODEL_CONTEXT_TOO_LARGE'&&!e.message.includes('private'))}
  finally{await w.closeAll()}
})
