import test from 'node:test'
import assert from 'node:assert/strict'
import {nativePackageFixture} from './fixtures/native-design-v3-fixture.mjs'
import {proposeContentStyleCompositions} from '../src/layout-library/content-style-composition-policy.mjs'
import {packageDigest} from '../src/layout-library/contract.mjs'
const api=await import('../src/layout-library/content-style-composition-plan.mjs').catch(()=>({}))
const item={title:'完整实际标题',paragraphs:['完整引言'],points:['第一原文','第二原文']}
async function input(){const sourcePackage=await nativePackageFixture();const policy=proposeContentStyleCompositions({item,sourceStyle:sourcePackage.designSpec.profile.designSystem,styleAcknowledged:true});return{sourcePackage,layoutId:'mixed-page',item:structuredClone(item),candidate:policy.candidates[0],styleAcknowledged:true}}
const measureText=async r=>({schemaVersion:r.schemaVersion,requestHash:r.requestHash,textId:r.textId,fontsReady:true,units:'canvas-pixels',lineBoxes:[{x:0,y:r.style.lineHeight<1.75?-1:1,width:80,height:25}],requiredWidth:100,requiredHeight:r.style.fontSize*2})
async function build(i){assert.equal(typeof api.buildContentStyleCompositionPlan,'function');return api.buildContentStyleCompositionPlan(i,{measureText})}
test('measured candidate compiles without mutating or relabeling original source identity',async()=>{
 const i=await input(),before=structuredClone(i),p=await build(i);assert.deepEqual(i,before);assert.equal(p.receipt.sourcePackageHash,packageDigest(i.sourcePackage));assert.equal(p.receipt.candidateHash,i.candidate.candidateHash);assert.equal(p.receipt.visualAcceptance,'pending');assert.ok(p.prototype.slots[0].style.lineHeight>=1.75);assert.ok(p.receipt.measurements[0].attempts.length>=2);assert.equal(p.receipt.measurements[0].attempts[0].response.lineBoxes[0].y,-1);assert.equal(p.prototype.slots.filter(s=>s.role==='body').length,2);assert.ok(p.prototype.prototypeSvg.includes(i.sourcePackage.theme.accent));for(const s of [item.title,...item.paragraphs,...item.points])assert.ok(!JSON.stringify(p).includes(s));
})
test('forged candidate, changed full content, changed source style, and columns refuse before measurement',async()=>{
 const i=await input();for(const change of [x=>x.candidate.typography.title.fontSize=40,x=>x.item.points[0]+='修改',x=>x.sourcePackage.designSpec.profile.designSystem.colors.accent='#000000',x=>x.candidate=proposeContentStyleCompositions({item,sourceStyle:x.sourcePackage.designSpec.profile.designSystem,styleAcknowledged:true}).candidates.find(c=>c.flow.columns===2)]){const a=structuredClone(i);change(a);let calls=0;await assert.rejects(()=>api.buildContentStyleCompositionPlan(a,{measureText:async r=>{calls++;return measureText(r)}}));assert.equal(calls,0)}
})
test('wrong measurement identity, persistent negative glyph and full-page height overflow fail closed',async()=>{
 const i=await input();for(const change of [m=>m.requestHash='wrong',m=>m.requiredHeight=9000,m=>m.lineBoxes[0].y=-1])await assert.rejects(()=>api.buildContentStyleCompositionPlan(i,{measureText:async r=>{const m=await measureText(r);change(m);return m}}));
})
test('footer is retained exactly and every measured block remains above it',async()=>{
 const i=await input(),p=await build(i),s=i.sourcePackage.layouts[0].slots.find(s=>s.role==='source');assert.deepEqual(p.prototype.slots.at(-1),s);assert.ok(p.prototype.slots.slice(0,-1).every(b=>b.rect.y+b.rect.h<=s.rect.y));assert.equal(p.receipt.sourceStyleHash,packageDigest(i.sourcePackage.designSpec.profile.designSystem));
})
test('mutating caller content during awaited browser measurement cannot change bound text or capacities',async()=>{
 const i=await input(),initial=structuredClone(i.item),seen=[];const p=await api.buildContentStyleCompositionPlan(i,{measureText:async r=>{seen.push(r.text);i.item.points[1]='竞态注入正文';i.item.title='篡改标题';return measureText(r)}});assert.ok(seen.includes(initial.points[1]));assert.ok(!seen.includes('竞态注入正文'));assert.equal(p.prototype.contentFitRules.maxTitleCharacters,Array.from(initial.title).length);assert.equal(p.prototype.contentFitRules.maxBodyCharacters,initial.points.reduce((n,s)=>n+Array.from(s).length,0))
})
test('whole page identity includes citations even when text geometry is unchanged',async()=>{
 const a=await input(),b=structuredClone(a);a.item.evidenceIndexes=[0];b.item.evidenceIndexes=[1];const x=await build(a),y=await build(b);assert.equal(x.receipt.contentHash,y.receipt.contentHash);assert.notEqual(x.receipt.inputContentHash,y.receipt.inputContentHash);assert.notEqual(x.prototype.id,y.prototype.id);assert.equal(x.receipt.inputContentHash,packageDigest(a.item));b.item.evidenceIndexes=[-1];await assert.rejects(()=>build(b))
})
