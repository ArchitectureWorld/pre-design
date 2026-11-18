import {test} from 'node:test'
import assert from 'node:assert/strict'
import {inferSparseCardFamily} from '../src/layout-library/sparse-card-family.mjs'
const source={fileSha256:'a'.repeat(64),pageNumber:41}
function fixture(n=3){return {source,components:Array.from({length:n},(_,i)=>{
 const x=.06+i*.88/n,w=.8/n,r={x,y:.25,w,h:.65},id=`arbitrary-${i}`
 return [{id,kind:'group',rect:r},{id:`body-${i}`,kind:'text',purpose:'body',parentId:id,rect:{x:x+.01,y:.5,w:w-.02,h:.3}},{id:`heading-${i}`,kind:'text',purpose:'heading',parentId:id,rect:{x:x+.01,y:.3,w:w-.02,h:.07}}]
}).flat()}}
for(const n of [2,3,4])test(`recognizes ${n} spatial cards without page or name coupling`,()=>{
 const raw=fixture(n),copy=structuredClone(raw);raw.components.reverse()
 const result=inferSparseCardFamily(raw,[source]);assert.equal(result.eligible,true);assert.equal(result.groups.length,n);assert.equal(result.derivation,'platform-sparse-card-v1');assert.deepEqual(result.groups.map(g=>g.id),Array.from({length:n},(_,i)=>`arbitrary-${i}`));assert.deepEqual(copy.components,raw.components.toReversed())
})
for(const [name,mutate] of [
 ['overlap',r=>r.components[3].rect.x=.08],
 ['unequal height',r=>r.components[3].rect.h=.2],
 ['unequal width',r=>r.components[3].rect.w=.1],
 ['nested',r=>r.components[3].parentId=r.components[0].id],
 ['missing body',r=>r.components[1].purpose='label'],
 ['outside child',r=>r.components[1].rect.y=.1],
 ['mixed table',r=>r.components.push({id:'table',kind:'table',rect:{x:.1,y:.1,w:.2,h:.1}})],
])test(`fails closed for ${name}`,()=>{const raw=fixture();mutate(raw);assert.equal(inferSparseCardFamily(raw,[source]).eligible,false)})
test('source not authorized and orphan observations rejected',()=>{assert.throws(()=>inferSparseCardFamily(fixture(),[]),{code:'REFERENCE_COMPONENT_INVALID'});const r=fixture();r.components[1].parentId='absent';assert.throws(()=>inferSparseCardFamily(r,[source]),{code:'REFERENCE_COMPONENT_INVALID'})})
import * as sparse from '../src/layout-library/sparse-card-family.mjs'
import {nativeDesignInput} from './fixtures/native-design-v3-fixture.mjs'
import {compileNativeDesignPackageV3} from '../src/layout-library/native-design-compiler.mjs'
import {assertCompositionCoverage} from '../src/layout-library/composition-contract.mjs'
test('derived native input preserves original and consumes sparse user content without fabricated fields',()=>{
 assert.equal(typeof sparse.appendSparseCardVariants,'function')
 const input=nativeDesignInput(),original=structuredClone(input),raw=fixture(3)
 // Source reference binds inference to the exact observed page, not arbitrary design evidence.
 const e=input.designSpec.profile.evidence[0];raw.source={fileSha256:e.fileSha256,pageNumber:e.pageNumber}
 const result=sparse.appendSparseCardVariants(input,raw,[raw.source]);assert.deepEqual(input,original)
 const pkg=compileNativeDesignPackageV3(result)
 assert.deepEqual(pkg.layouts[0],compileNativeDesignPackageV3(original).layouts[0])
 const variants=pkg.layouts.filter(l=>l.id.startsWith('sparse-card-'));assert.equal(variants.length,3)
 for(const [i,l]of variants.entries()){
  const item={title:'保留标题',paragraphs:['保留原段落'],points:Array.from({length:i+1},(_,j)=>`原始要点${j}`),evidenceIndexes:[]}
  assert.equal(assertCompositionCoverage(l,item),l);assert.match(l.label,/无图.*派生/);assert(!l.slots.some(s=>['text','image'].includes(s.role)))
  assert.throws(()=>assertCompositionCoverage(l,{...item,figures:[{materialId:'image',caption:'图'}]}))
  assert.throws(()=>assertCompositionCoverage(l,{...item,points:[...item.points,'不能丢失']}))
 }
})
test('derivation rejects unrelated evidence, unknown groups, and preexisting derived ids',()=>{
 assert.equal(typeof sparse.appendSparseCardVariants,'function');assert.throws(()=>sparse.appendSparseCardVariants(nativeDesignInput(),fixture(),[source]))
 const input=nativeDesignInput(),raw=fixture();const e=input.designSpec.profile.evidence[0];raw.source={fileSha256:e.fileSha256,pageNumber:e.pageNumber};raw.components[1].purpose='label';assert.throws(()=>sparse.appendSparseCardVariants(input,raw,[raw.source]))
})
test('new variants retain strict content coverage and do not silently truncate tables or mapped text',()=>{
 const input=nativeDesignInput(),raw=fixture(2),e=input.designSpec.profile.evidence[0];raw.source={fileSha256:e.fileSha256,pageNumber:e.pageNumber}
 const result=sparse.appendSparseCardVariants(input,raw,[raw.source]),pkg=compileNativeDesignPackageV3(result),l=pkg.layouts.at(-1),item={title:'标题',paragraphs:[],points:['一','二'],evidenceIndexes:[]}
 assert.equal(assertCompositionCoverage(l,item),l)
 assert.throws(()=>assertCompositionCoverage(l,{...item,table:{columns:['一','二'],rows:[['a','b']]}}))
 assert.throws(()=>assertCompositionCoverage(l,{...item,textBlocks:[{key:'extra',text:'原文不能遗漏'}]}))
 assert.throws(()=>sparse.appendSparseCardVariants(result,raw,[raw.source]),{code:'SPARSE_CARD_DERIVATION_INVALID'})
})
test('unknown outer narrative or vertical groups fail closed',()=>{
 const raw=fixture();raw.components.push({id:'outside-narrative',kind:'text',purpose:'body',rect:{x:.91,y:.5,w:.06,h:.1}});assert.equal(inferSparseCardFamily(raw,[source]).eligible,false)
 const vertical=fixture(2);vertical.components[3].rect.y=.01;assert.equal(inferSparseCardFamily(vertical,[source]).eligible,false)
})
test('tiny repeated geometry is not offered as a reusable card family',()=>{
 const raw=fixture(3);for(const c of raw.components){c.rect.x*=.2;c.rect.w*=.2}assert.equal(inferSparseCardFamily(raw,[source]).eligible,false)
})
test('private derivation receipt binds exact geometry and strategy without copying content or granting rights',()=>{
 const input=nativeDesignInput(),raw=fixture(),e=input.designSpec.profile.evidence[0];raw.source={fileSha256:e.fileSha256,pageNumber:e.pageNumber}
 const out=sparse.appendSparseCardVariants(input,raw,[raw.source]);assert.equal(out.sparseCardDerivation.strategy,'platform-sparse-card-v1');assert.match(out.sparseCardDerivation.observationSha256,/^[a-f0-9]{64}$/);assert.equal(out.sparseCardDerivation.groups.length,3);assert.equal(out.sparseCardDerivation.visualAcceptance,'pending');assert.deepEqual(out.rights,input.rights)
 const changed=structuredClone(raw);changed.components[1].rect.h-=.01;assert.notEqual(sparse.appendSparseCardVariants(input,changed,[raw.source]).sparseCardDerivation.observationSha256,out.sparseCardDerivation.observationSha256)
})
test('paragraph-only content has a dedicated native variant without manufacturing points',()=>{
 const input=nativeDesignInput(),raw=fixture(),e=input.designSpec.profile.evidence[0];raw.source={fileSha256:e.fileSha256,pageNumber:e.pageNumber}
 const pkg=compileNativeDesignPackageV3(sparse.appendSparseCardVariants(input,raw,[raw.source])),layout=pkg.layouts.find(l=>l.id==='sparse-text-0');assert(layout)
 const item={title:'只有段落',paragraphs:['原文第一段','原文第二段'],points:[],evidenceIndexes:[]};assert.equal(assertCompositionCoverage(layout,item),layout);assert(!layout.slots.some(s=>s.role==='body'));assert.match(layout.label,/纯段落/)
})
test('short overview variants use deliberate readable hierarchy rather than small text suspended in empty columns',()=>{
 const input=nativeDesignInput(),raw=fixture(2),e=input.designSpec.profile.evidence[0];raw.source={fileSha256:e.fileSha256,pageNumber:e.pageNumber}
 const pkg=compileNativeDesignPackageV3(sparse.appendSparseCardVariants(input,raw,[raw.source])),layout=pkg.layouts.find(l=>l.id==='sparse-card-2');assert(layout.slots.find(s=>s.role==='title').style.fontSize>=64);assert(layout.slots.filter(s=>s.role==='body').every(s=>s.style.fontSize>=32));assert(layout.contentFitRules.maxBodyCharacters<=120)
})
test('private receipt distinguishes different derived output even for identical observations',()=>{
 const input=nativeDesignInput(),raw=fixture(),e=input.designSpec.profile.evidence[0];raw.source={fileSha256:e.fileSha256,pageNumber:e.pageNumber}
 const first=sparse.appendSparseCardVariants(input,raw,[raw.source]);assert.match(first.sparseCardDerivation.outputSha256,/^[a-f0-9]{64}$/)
 input.designSpec.profile.designSystem.colors.accent='#263a7d';const second=sparse.appendSparseCardVariants(input,raw,[raw.source]);assert.equal(first.sparseCardDerivation.observationSha256,second.sparseCardDerivation.observationSha256);assert.notEqual(first.sparseCardDerivation.outputSha256,second.sparseCardDerivation.outputSha256)
})
test('mixed-length card content shares a stable top reading baseline',()=>{
 const input=nativeDesignInput(),raw=fixture(3),e=input.designSpec.profile.evidence[0];raw.source={fileSha256:e.fileSha256,pageNumber:e.pageNumber}
 const pkg=compileNativeDesignPackageV3(sparse.appendSparseCardVariants(input,raw,[raw.source])),slots=pkg.layouts.find(l=>l.id==='sparse-card-3').slots.filter(s=>s.role==='body');assert(slots.every(s=>s.style.verticalAlign==='top'));assert.equal(new Set(slots.map(s=>s.rect.y)).size,1)
})
test('baseline title area accommodates two readable lines without colliding with introduction',()=>{
 const input=nativeDesignInput(),raw=fixture(),e=input.designSpec.profile.evidence[0];raw.source={fileSha256:e.fileSha256,pageNumber:e.pageNumber};const pkg=compileNativeDesignPackageV3(sparse.appendSparseCardVariants(input,raw,[raw.source]));for(const l of pkg.layouts.slice(1)){const title=l.slots.find(s=>s.role==='title'),intro=l.slots.find(s=>s.role==='claim');assert(title.rect.h*pkg.canvas.height>=title.style.fontSize*title.style.lineHeight*2);assert(title.rect.y+title.rect.h<=intro.rect.y)}
})
