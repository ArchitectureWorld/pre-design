import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { Session } from '../../worker/node_modules/@deepseek-ai/dsh-session/lib/index.js'
import { recordResearchRequest } from '../../worker/research-request.mjs'
const checkpoints=await import('../../worker/research-checkpoint.mjs').catch(()=>({}))
const flags={industryPlanning:false,existingBuildings:false,externalPartners:false,marketing:false}
test('恢复必须证明原始资料全集及真实任务背景未变，新增资料或新委托使用新快照',async t=>{
  assert.equal(typeof checkpoints.checkpointCompatibility,'function')
  const workspace=await mkdtemp(join(tmpdir(),'research-checkpoint-'))
  t.after(()=>rm(workspace,{recursive:true,force:true}))
  const manifestRunId='RUN-11111111-1111-4111-8111-111111111111'
  await mkdir(join(workspace,`research/runs/${manifestRunId}`),{recursive:true})
  await mkdir(join(workspace,'原始资料'))
  await writeFile(join(workspace,'原始资料/a.txt'),'用户上传的事实')
  const agent={id:'session',session:Session.create('session')}
  await recordResearchRequest({},agent,{moduleIds:['1.01'],flags},[])
  const event=agent.session.snapshotEvents().find(row=>row.type==='user/message')
  const taskBrief='真实任务背景\n'+JSON.stringify({sessionId:'session',seq:event.seq,time:new Date(event.time).toISOString(),text:event.data.content[0].text})
  const snapshot={taskBrief,corpus:{documents:[{path:'原始资料/a.txt',contentHash:createHash('sha256').update('用户上传的事实').digest('hex')}]}}
  await writeFile(join(workspace,`research/runs/${manifestRunId}/snapshot.json`),JSON.stringify(snapshot))
  assert.equal((await checkpoints.checkpointCompatibility(workspace,{manifestRunId},agent)).compatible,true)
  await writeFile(join(workspace,'原始资料/new.txt'),'新增真实资料')
  assert.deepEqual(await checkpoints.checkpointCompatibility(workspace,{manifestRunId},agent),{compatible:false,reason:'source_changed'})
  await rm(join(workspace,'原始资料/new.txt'))
  await writeFile(join(workspace,'原始资料/a.txt'),'原文件发生变化')
  assert.equal((await checkpoints.checkpointCompatibility(workspace,{manifestRunId},agent)).reason,'source_changed')
  await writeFile(join(workspace,'原始资料/a.txt'),'用户上传的事实')
  await recordResearchRequest({},agent,{moduleIds:['1.02'],flags},[])
  assert.equal((await checkpoints.checkpointCompatibility(workspace,{manifestRunId},agent)).reason,'task_changed')
  await rm(join(workspace,`research/runs/${manifestRunId}/snapshot.json`))
  assert.equal((await checkpoints.checkpointCompatibility(workspace,{manifestRunId},agent)).reason,'unverified')
})
