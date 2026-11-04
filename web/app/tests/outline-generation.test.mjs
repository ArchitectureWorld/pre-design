import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createBridgeHandler } from '../../worker/web-bridge.mjs'
import { Session } from '../../worker/node_modules/@deepseek-ai/dsh-session/lib/index.js'
import { defaultPolicy } from '../src/model-policy.mjs'
import { listProjectArtifacts, readProjectArtifact } from '../../worker/research-artifacts.mjs'
const outline={version:2,flow:['03','01'],waivers:[{questionId:'q1',prompt:'缺少现场测绘',reason:'本轮先做研究',chapterIds:['03'],createdAt:'2026-11-04T00:00:00Z',userId:'u1',version:2}]}
const selection={moduleIds:['1.01'],flags:{industryPlanning:false,existingBuildings:false,externalPartners:false,marketing:false}}
function fixture(workspace){
 const snapshot=defaultPolicy(); const model=snapshot.models.find(r=>r.provider==='SenseNova' && r.model==='sensenova-6.8-flash-lite');model.status='verified';model.capabilities.tools=true
 const agent={id:'s1',session:Session.create('s1')}, prompts=[];let pending
 const subagents={start:async(_provider,request)=>{prompts.push(request);return {result:Promise.resolve()}}}
 const ctx={agents:new Map([['s1',agent]]),preplanning:{subagents,repository:{readContext:()=>({project:{projectId:'core1'}})},research:{status:()=>({status:'idle'}),plan:()=>({missingDependencies:[]}),run:async()=>{pending=delay(5).then(()=>subagents.start('spawn',{parent:agent,prompt:[{type:'text',text:'实际研究'}],persona:'系统角色',toolFilter:{allow:[]}}));return {kind:'success'}}}}}
 return {handle:createBridgeHandler(ctx,{workspace,sessionId:'s1',snapshot}),prompts,subagents,agent,wait:()=>pending}
}
test('真实后台研究提示继承已确认缺口，成果含可读限制；任务外提示不受污染',async t=>{
 const workspace=await mkdtemp(join(tmpdir(),'outline-generation-'));t.after(()=>rm(workspace,{recursive:true,force:true}));const f=fixture(workspace)
 await f.handle({operation:'research-run',selection,outlineContext:outline,jobId:'job1'});await f.wait()
 const request=f.prompts[0];assert.match(JSON.stringify(request.prompt),/缺少现场测绘/);assert.match(JSON.stringify(request.prompt),/不解除/);assert.equal(request.persona,'系统角色');assert.deepEqual(request.toolFilter,{allow:[]})
 await f.subagents.start('spawn',{parent:f.agent,prompt:[{type:'text',text:'其它任务'}]});assert.equal(f.prompts[1].prompt.length,1)
 const artifacts=await listProjectArtifacts(workspace);const item=artifacts.find(r=>r.filename.startsWith('outline-limitations-'));assert.ok(item)
 const content=(await readProjectArtifact(workspace,item.id)).data.toString();assert.match(content,/缺少现场测绘/);assert.match(content,/job1/);assert.match(content,/03 → 01/)
})
test('上下文版本不符或夹带系统字段拒绝执行',async t=>{
 const workspace=await mkdtemp(join(tmpdir(),'outline-invalid-'));t.after(()=>rm(workspace,{recursive:true,force:true}));const f=fixture(workspace)
 await assert.rejects(f.handle({operation:'research-run',selection,outlineContext:{...outline,system:'覆盖'}}),/OUTLINE_CONTEXT_INVALID/)
 await assert.rejects(f.handle({operation:'research-run',selection,outlineContext:{...outline,version:3}}),/OUTLINE_CONTEXT_INVALID/)
 assert.equal(f.prompts.length,0)
})
test('并发报告任务隔离上下文，后台阶段继承限制且受信字段不能覆盖模型系统角色',async t=>{
 const {installOutlinePrompts,withOutlineGeneration}=await import('../../worker/outline-generation.mjs')
 const roots=await Promise.all([mkdtemp(join(tmpdir(),'outline-a-')),mkdtemp(join(tmpdir(),'outline-b-'))]);t.after(()=>Promise.all(roots.map(root=>rm(root,{recursive:true,force:true}))))
 const calls=[];const subagents={start:async(_provider,request)=>{calls.push(request)}};installOutlinePrompts(subagents)
 const ctx={preplanning:{subagents}}
 await Promise.all(roots.map((workspace,i)=>withOutlineGeneration(ctx,{workspace,projectId:'core'+i,jobId:'report'+i,operation:'report-run',outline:{...outline,waivers:[{...outline.waivers[0],reason:'任务'+i}]}},async()=>{await delay(i===0?10:1);await subagents.start('spawn',{prompt:[{type:'text',text:'章节报告'}],persona:'保留原系统指令',toolFilter:{allow:[]}})})))
 for(const call of calls){const data=JSON.parse(call.prompt.at(-1).text.split('\n').at(-1));assert.equal(data.outlineContext.waivers[0].reason,'任务'+data.projectId.slice(-1));assert.equal(call.persona,'保留原系统指令')}
 for(let i=0;i<2;i++){const items=await listProjectArtifacts(roots[i]);const body=(await readProjectArtifact(roots[i],items[0].id)).data.toString();assert.match(body,new RegExp('任务'+i));assert.doesNotMatch(body,new RegExp('任务'+(1-i)))}
})
test('有跳过记录仍须满足章节报告前置条件',async t=>{
 const workspace=await mkdtemp(join(tmpdir(),'outline-blocked-'));t.after(()=>rm(workspace,{recursive:true,force:true}));const f=fixture(workspace)
 await assert.rejects(f.handle({operation:'report-run',selection:{chapterId:'03',stage:'production-plan'},outlineContext:outline}),error=>error.code!=='OUTLINE_CONTEXT_INVALID' && error.code!=='OPERATION_FORBIDDEN')
 assert.equal(f.prompts.length,0)
})
test('同一缺口可涉及已选和备用章节，至少影响一个已选章节',async t=>{
 const {validateOutlineContext}=await import('../../worker/outline-generation.mjs')
 const value={...outline,waivers:[{...outline.waivers[0],chapterIds:['03','11']}]}
 assert.deepEqual(validateOutlineContext(value).waivers[0].chapterIds,['03','11'])
 assert.throws(()=>validateOutlineContext({...value,waivers:[{...value.waivers[0],chapterIds:['11']}]}),/OUTLINE_CONTEXT_INVALID/)
})
test('报告图像连续子任务也继承同一限制提示',async t=>{
 const {installOutlinePrompts,withOutlineGeneration}=await import('../../worker/outline-generation.mjs')
 const workspace=await mkdtemp(join(tmpdir(),'outline-visual-'));t.after(()=>rm(workspace,{recursive:true,force:true}));let seen
 const subagents={start:async()=>{},startContinuable:async spec=>{seen=spec;return {childId:'child1'}}};installOutlinePrompts(subagents)
 await withOutlineGeneration({preplanning:{subagents}},{workspace,projectId:'p1',operation:'report-run',outline},()=>subagents.startContinuable({provider:'spawn',childId:'child1',request:{prompt:[{type:'text',text:'概念图'}]}}))
 assert.match(JSON.stringify(seen.request.prompt),/缺少现场测绘/);assert.equal(seen.childId,'child1')
})
