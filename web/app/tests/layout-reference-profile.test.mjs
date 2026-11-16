import test from 'node:test'
import assert from 'node:assert/strict'
import {validateReferenceProfile} from '../src/layout-library/reference-profile.mjs'
import {profileFixture,sourceSha256} from './fixtures/reference-workflow.mjs'

const inventory={files:[{sha256:sourceSha256,pages:[{pageNumber:7,hasImage:true,extractedFacts:[{id:'fact-1-7-1',property:'canvas',value:{width:1600,height:900}}]}]}]}
const observations=[{batchId:'observe-2',pages:[{fileSha256:sourceSha256,pageNumber:7,pageType:'mixed',structure:'asymmetric-columns',density:'medium',facts:[{id:'observation-2-1-1',property:'background',value:'#ffffff'}]}]}]
test('Profile证据绑定已读页面及真实观察事实，后页不能伪装成封面证据',()=>{
 const p=profileFixture();assert.deepEqual(validateReferenceProfile(p,{inventory,observations}),p)
 for(const change of [{pageNumber:1},{fileSha256:'b'.repeat(64)},{factId:'observation-99-1-1'}]){
  const invalid=structuredClone(p);Object.assign(invalid.evidence[0],change)
  assert.throws(()=>validateReferenceProfile(invalid,{inventory,observations}),e=>e.code==='REFERENCE_PROFILE_INVALID')
 }
})
test('提取事实、推断依赖、用户输入分别记录，循环和悬空证据被拒绝',()=>{
 const p=profileFixture({provenance:'extracted',factId:'fact-1-7-1'})
 p.evidence.push({id:'evidence-2',provenance:'inferred',dependsOn:['evidence-1']});p.archetypes[0].evidenceIds=['evidence-2']
 assert.equal(validateReferenceProfile(p,{inventory,observations}).evidence[0].provenance,'extracted')
 const cycle=structuredClone(p);cycle.evidence[0]={id:'evidence-1',provenance:'inferred',dependsOn:['evidence-2']}
 assert.throws(()=>validateReferenceProfile(cycle),e=>e.code==='REFERENCE_PROFILE_INVALID')
 const missing=structuredClone(p);missing.designSystem.evidenceIds=['missing-evidence']
 assert.throws(()=>validateReferenceProfile(missing),e=>e.code==='REFERENCE_PROFILE_INVALID')
 const user=profileFixture({provenance:'user'});assert.equal(validateReferenceProfile(user).evidence[0].provenance,'user')
})
test('共享Profile没有任意原文/路径/图片字段，文本占位不能冒充已看图像',()=>{
 const p=profileFixture()
 for(const mutate of [v=>{v.sourcePath='/private/source.pdf'},v=>{v.evidence[0].summary='PRIVATE CLIENT REVENUE'},v=>{v.archetypes[0].label='客户商业计划'},v=>{v.rules=[{id:'rule-1',property:'alignment',value:'PRIVATE CLIENT',provenance:'inferred',evidenceIds:['evidence-1']}]}]){
  const invalid=structuredClone(p);mutate(invalid);assert.throws(()=>validateReferenceProfile(invalid),e=>e.code==='REFERENCE_PROFILE_INVALID')
 }
 const textOnly=structuredClone(inventory);textOnly.files[0].pages[0].hasImage=false
 assert.throws(()=>validateReferenceProfile(p,{inventory:textOnly,observations}),e=>e.code==='REFERENCE_PROFILE_INVALID')
})
test('观察依据不能更名为直接提取结论，封面观察不能充作数据原型的直接证据',()=>{
 const p=profileFixture()
 p.rules=[{id:'rule-1',property:'background',value:'#111111',provenance:'observed',evidenceIds:['evidence-1']}]
 assert.throws(()=>validateReferenceProfile(p,{inventory,observations}),e=>e.code==='REFERENCE_PROFILE_INVALID')
 p.rules[0].value='#ffffff';p.rules[0].provenance='extracted'
 assert.throws(()=>validateReferenceProfile(p,{inventory,observations}),e=>e.code==='REFERENCE_PROFILE_INVALID')
 p.rules=[];p.archetypes[0].pageType='cover'
 assert.throws(()=>validateReferenceProfile(p,{inventory,observations}),e=>e.code==='REFERENCE_PROFILE_INVALID')
})
