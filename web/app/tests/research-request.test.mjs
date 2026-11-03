import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from '../../worker/node_modules/@deepseek-ai/dsh-session/lib/index.js'
const requests=await import('../../worker/research-request.mjs').catch(()=>({}))
test('新项目直接研究持久记录真实UI请求，不伪造项目事实，不使恢复快照漂移',async()=>{
  assert.equal(typeof requests.recordResearchRequest,'function')
  const session=Session.create('web-request-test'),agent={id:'web-request-test',session}
  let flushes=0
  const ctx={get:name=>name==='sessionPersistence'?{flush:async()=>{flushes++}}:undefined}
  const selection={moduleIds:['1.01'],flags:{industryPlanning:false,existingBuildings:false,externalPartners:false,marketing:false},redo:false}
  await requests.recordResearchRequest(ctx,agent,selection,[],{callerUserId:'owner-1',jobId:'job-1'})
  const event=session.snapshotEvents().find(row=>row.type==='user/message')
  assert.equal(event.data.source.kind,'user')
  assert.equal(event.data.role,'user')
  assert.deepEqual(JSON.parse(event.data.content[0].text),{operation:'research',...selection,callerUserId:'owner-1',jobId:'job-1'})
  assert.equal(flushes,1)
  await requests.recordResearchRequest(ctx,agent,selection,[],{callerUserId:'owner-1',jobId:'job-1'})
  await requests.recordResearchRequest(ctx,agent,{...selection,redo:true},['RUN-11111111-1111-4111-8111-111111111111'])
  assert.equal(session.snapshotEvents().filter(row=>row.type==='user/message').length,1)
})
