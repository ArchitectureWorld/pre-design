import test from 'node:test'
import assert from 'node:assert/strict'
import {agentActivity,createTaskProgressReporter,taskProgress} from '../src/task-progress.mjs'
const settled=()=>new Promise(resolve=>setImmediate(resolve))

test('进度只接受白名单活动，未知事件、原始消息和回调终态均丢弃',async()=>{
  const saved=[],reporter=createTaskProgressReporter({write:value=>saved.push(value),now:()=>1000})
  for(const value of [{stage:'__proto__'},{stage:'constructor'},{stage:'completed'},{stage:'cancelled'},
    {method:'session.event',params:{event:{type:'assistant/message',data:{text:'SECRET'}}}},
    {type:'research-progress',status:'failed',error:'SECRET'},null])reporter.report(value)
  reporter.report({stage:'generating',label:'SECRET',updatedAt:'SECRET',data:'SECRET',percentage:99})
  await reporter.close()
  assert.deepEqual(saved,[{stage:'generating',label:'正在生成回复',updatedAt:'1970-01-01T00:00:01.000Z'}])
  assert.equal(taskProgress('constructor'),null)
  for(const value of [null,{}, {method:'session.status',params:{status:'idle'}},
    {method:'session.event',params:{event:{type:'assistant/reasoning',data:{text:'SECRET'}}}},
    {method:'session.event',params:{event:{type:'tool/call',data:{arguments:'SECRET'}}}}])assert.equal(agentActivity(value),null)
})

test('同一秒大量切换活动只写首条和最后一条，之后新的真实活动可更新时间',async t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  let now=0;const saved=[],reporter=createTaskProgressReporter({write:value=>saved.push(value),now:()=>now})
  reporter.report({stage:'generating'});await settled()
  now=100
  for(let i=0;i<500;i++){reporter.report({stage:'tool_result'});reporter.report({stage:'reading_material'})}
  await settled();assert.equal(saved.length,1)
  now=999;t.mock.timers.tick(899);await settled();assert.equal(saved.length,1)
  now=1000;t.mock.timers.tick(1);await settled()
  assert.deepEqual(saved.map(value=>value.stage),['generating','reading_material'])
  assert.equal(saved[1].updatedAt,'1970-01-01T00:00:00.100Z','尾部合并保留实际收到活动的时间')
  now=1100;reporter.report({stage:'reading_material'});t.mock.timers.tick(1000);await settled();assert.equal(saved.length,2)
  now=2200;reporter.report({stage:'reading_material'});await reporter.close()
  assert.equal(saved.length,3);assert.equal(saved[2].updatedAt,'1970-01-01T00:00:02.200Z')
})

test('终态前等待正在持久化的活动完成，丢弃待发及迟到活动',async t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  const gate=Promise.withResolvers(),saved=[]
  const reporter=createTaskProgressReporter({write:async value=>{await gate.promise;saved.push(value)},now:()=>0})
  reporter.report({stage:'reading_material'});reporter.report({stage:'tool_result'})
  let closed=false;const closing=reporter.close().then(()=>{closed=true;saved.push({stage:'completed'})})
  await settled();assert.equal(closed,false)
  gate.resolve();await closing
  reporter.report({stage:'generating'});t.mock.timers.tick(5000);await settled()
  assert.deepEqual(saved.map(value=>value.stage),['reading_material','completed'])
})

test('单次进度写入失败不打断模型执行，后续活动仍可持久化',async()=>{
  let now=0,calls=0,errors=0;const saved=[]
  const reporter=createTaskProgressReporter({now:()=>now,write:value=>{calls++;if(calls===1)throw new Error('DATABASE_TEMPORARY');saved.push(value)},onError:()=>{errors++}})
  reporter.report({stage:'reading_material'});await settled()
  now=2000;reporter.report({stage:'generating'});await reporter.close()
  assert.equal(errors,1);assert.deepEqual(saved.map(value=>value.stage),['generating'])
})
