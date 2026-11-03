import test from 'node:test'
import assert from 'node:assert/strict'
const trace = await import('../../worker/execution-trace.mjs').catch(() => ({}))
test('管理侧执行轨迹只采用真实request/header与Core actual，未发出的候选路由不算调用', async () => {
  assert.equal(typeof trace.collectExecutionTrace, 'function')
  const now=Date.now(), agent={id:'parent',session:{snapshotEvents:()=>[
    {type:'request/header',seq:1,time:now-20000,data:{turn:1,step:1,header:{config:{provider:'old-runtime',model:'old-model'}}}},
    {type:'request/header',seq:2,time:now,data:{turn:2,step:1,header:{config:{provider:'runtime-confirmed',model:'model-confirmed',apiKey:'do-not-return'}}}},
    {type:'assistant/message',seq:3,time:now+1,data:{text:'secret reasoning'}},
  ]}}
  const classes={executions:async()=>[
    {id:'confirmed',projectId:'p',classId:'text',childId:'child1',status:'failed',actual:{provider:'runtime-confirmed',model:'model-confirmed'},selected:{provider:'candidate-never-use',model:'candidate'},startedAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()},
    {id:'unsent',projectId:'p',classId:'web',status:'failed',selected:{provider:'candidate-never-use',model:'candidate'},startedAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()},
    {id:'other-project',projectId:'other',classId:'text',actual:{provider:'no',model:'no'},startedAt:new Date(now).toISOString()},
  ]}
  const value=await trace.collectExecutionTrace(agent,classes,'p',{since:new Date(now-1000).toISOString()})
  assert.equal(value.parent.requests.length,1)
  assert.equal(value.parent.requests[0].model,'model-confirmed')
  assert.equal(value.executions.length,2)
  assert.equal(value.executions.find(row=>row.executionId==='unsent').actual,null)
  assert.equal(value.usage,null)
  assert.doesNotMatch(JSON.stringify(value),/do-not-return|secret reasoning|candidate-never-use|old-model|other-project/)
})
