import test from 'node:test'
import assert from 'node:assert/strict'
import {nativePackageFixture} from './fixtures/native-design-v3-fixture.mjs'
import {compileNativeDesignPackageV3} from '../src/layout-library/native-design-compiler.mjs'
const api=await import('../src/layout-library/content-driven-style-plan.mjs').catch(()=>({}))
const item=()=>({title:'真实标题',paragraphs:['完整引言'],points:['短点一','较长的完整要点二'],evidenceIndexes:[]})
const measure=async r=>({schemaVersion:r.schemaVersion,requestHash:r.requestHash,textId:r.textId,fontsReady:true,units:'canvas-pixels',lineBoxes:[{x:0,y:0,width:60,height:r.style.fontSize}],requiredWidth:80,requiredHeight:r.style.fontSize*1.5})
async function prepare(overrides={}){assert.equal(typeof api.prepareContentDrivenStylePlan,'function');return api.prepareContentDrivenStylePlan({sourcePackage:await nativePackageFixture(),layoutId:'mixed-page',item:item(),styleAcknowledged:true,...overrides})}
test('explicit capability and text-only scope are required',async()=>{
 await assert.rejects(()=>prepare({styleAcknowledged:false}));await assert.rejects(()=>prepare({item:{...item(),chart:{type:'bar'}}}));const r=await prepare();await assert.rejects(()=>api.buildContentDrivenStylePlan(r,{}));
})
test('measured title height drives flow without count-based columns, and compiler accepts delta',async()=>{
 const pkg=await nativePackageFixture(),before=JSON.stringify(pkg),r=await prepare({sourcePackage:pkg});const p=await api.buildContentDrivenStylePlan(r,{measureText:measure});
 const taller=await api.buildContentDrivenStylePlan(r,{measureText:async q=>{const m=await measure(q);if(q.role==='title')m.requiredHeight+=60;return m}});
 assert.ok(Math.abs(taller.prototype.slots.find(s=>s.role==='claim').rect.y-p.prototype.slots.find(s=>s.role==='claim').rect.y-60/900)<1e-12);
 const body=p.prototype.slots.filter(s=>s.role==='body');assert.equal(body[0].rect.x,body[1].rect.x);assert.ok(body[1].rect.y>body[0].rect.y+body[0].rect.h);assert.equal(body[0].style.fontSize,pkg.theme.bodySize);
 assert.equal(JSON.stringify(pkg),before);for(const text of [item().title,...item().paragraphs,...item().points])assert.ok(!JSON.stringify(p).includes(text));
 const d=structuredClone(pkg.designSpec);d.profile.evidence.push(...p.delta.evidence);d.profile.archetypes.push(p.delta.archetype);d.masterLayoutGraph.push(...p.delta.masterLayoutGraph);d.components.push(...p.delta.components);
 assert.ok(compileNativeDesignPackageV3({name:pkg.name,rights:pkg.rights,designSpec:d,prototypes:[...pkg.layouts.map(({kind,...l})=>l),p.prototype]}));assert.equal(p.receipt.visualAcceptance,'pending');
})
test('malformed, stale, textual measurement and overflowing geometry fail closed',async()=>{
 const r=await prepare();for(const patch of [{requestHash:'x'},{fontsReady:false},{requiredWidth:99999},{requiredHeight:99999},{lineBoxes:[{x:0,y:0,width:1,height:NaN}]},{text:'private'}])await assert.rejects(()=>api.buildContentDrivenStylePlan(r,{measureText:async q=>({...await measure(q),...patch})}));await assert.rejects(()=>api.buildContentDrivenStylePlan(structuredClone(r),{measureText:measure}));
})
test('source style and content identities stay distinct and original text survives only in transient requests',async()=>{
 const a=await prepare(),pkg=await nativePackageFixture();pkg.layouts[0].slots.find(s=>s.role==='body').style={fontSize:30,fontWeight:600};const b=await prepare({sourcePackage:pkg,item:{...item(),title:'另一标题'}});assert.notEqual(a.contentHash,b.contentHash);assert.notEqual(a.sourceHash,b.sourceHash);assert.equal(b.requests.find(s=>s.role==='body').style.fontSize,30);assert.ok(Object.isFrozen(a.requests[0]));
})
test('no intro leaves no fixed hole and same frozen inputs give identical plan',async()=>{
 const r=await prepare({item:{...item(),paragraphs:[]}}),a=await api.buildContentDrivenStylePlan(r,{measureText:measure}),b=await api.buildContentDrivenStylePlan(r,{measureText:measure});assert.deepEqual(a,b);assert.ok(!a.prototype.slots.some(s=>s.role==='claim'));const title=a.prototype.slots[0],first=a.prototype.slots.find(s=>s.role==='body');assert.ok(Math.abs(first.rect.y-title.rect.y-title.rect.h-.03)<1e-12);assert.ok(first.rect.y<.47)
})
test('source typography and anchors are retained rather than replaced with 72px headline template',async()=>{
 const pkg=await nativePackageFixture();pkg.layouts[0].slots[0].style={fontSize:64,fontWeight:500,color:'#24364c'};pkg.layouts[0].slots[0].rect.x=.08;pkg.layouts[0].slots[0].rect.w=.87;const r=await prepare({sourcePackage:pkg}),p=await api.buildContentDrivenStylePlan(r,{measureText:measure});assert.equal(p.prototype.slots[0].style.fontSize,64);assert.equal(p.prototype.slots[0].style.fontWeight,500);assert.equal(p.prototype.slots[0].rect.x,.08);assert.equal(p.prototype.slots[0].style.color,'#24364c');assert.equal(p.delta.evidence[0].provenance,'inferred');assert.deepEqual(p.delta.evidence[0].dependsOn,['evidence-1'])
})
async function pairedSource(){const p=await nativePackageFixture(),body=p.layouts[0].slots.find(s=>s.role==='body');p.designSpec.profile.archetypes[0].capacity.bodyPoints=2;p.designProfile.archetypes[0].capacity.bodyPoints=2;p.layouts[0].contentFitRules.maxBodyPoints=2;body.rect={x:.55,y:.35,w:.18,h:.4};body.style={fontSize:28,padding:12};body.index=0;p.layouts[0].slots.push({...structuredClone(body),id:'body-2',index:1,rect:{x:.78,y:.35,w:.17,h:.4}});return p}
test('aligned same-style role grids yield traced inferred envelope and explicit padding removal',async()=>{
 const pkg=await pairedSource(),before=JSON.stringify(pkg),r=await prepare({sourcePackage:pkg}),p=await api.buildContentDrivenStylePlan(r,{measureText:measure});const b=p.prototype.slots.find(s=>s.role==='body');assert.equal(b.rect.x,.55);assert.ok(Math.abs(b.rect.w-.4)<1e-12);assert.equal(b.style.padding,0);const rule=p.receipt.roleRules.find(r=>r.role==='body');assert.equal(rule.strategy,'aligned-role-envelope');assert.deepEqual(rule.sourceSlotIds,['body','body-2']);assert.equal(rule.sourcePadding,12);assert.equal(rule.derivedPadding,0);assert.equal(rule.provenance,'inferred');assert.match(rule.sourceRectsHash,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(pkg),before)
})
test('ambiguous grids fail on style, alignment or overlap; source ordering is deterministic',async()=>{
 for(const alter of [s=>s.style.fontSize=30,s=>s.style.color='#000000',s=>s.rect.y+=.01,s=>s.rect.x=.3]){const p=await pairedSource();alter(p.layouts[0].slots.at(-1));await assert.rejects(()=>prepare({sourcePackage:p}))}
 const p=await pairedSource();p.layouts[0].slots.reverse();const r=await prepare({sourcePackage:p}),plan=await api.buildContentDrivenStylePlan(r,{measureText:measure});assert.deepEqual(plan.receipt.roleRules.find(r=>r.role==='body').sourceSlotIds,['body','body-2'])
})
test('measured font ascent triggers bounded remeasurement without shrinking font or clipping line boxes',async()=>{
 const r=await prepare(),calls=[];const plan=await api.buildContentDrivenStylePlan(r,{measureText:async q=>{calls.push(q);const m=await measure(q);if(q.style.lineHeight<1.5)m.lineBoxes[0].y=-2;return m}})
 for(const original of r.requests){const final=plan.prototype.slots.find(s=>s.id===original.textId);assert.equal(final.style.fontSize,original.style.fontSize);assert(final.style.lineHeight>=1.5);const attempts=calls.filter(q=>q.textId===original.textId);assert(attempts.length<=4);assert.notEqual(attempts[0].requestHash,attempts.at(-1).requestHash)}
 assert(plan.receipt.typographyAdjustments.every(r=>r.reason==='measured-font-line-box'&&r.derivedLineHeight>=r.sourceLineHeight));assert(!JSON.stringify(plan).includes(item().title))
})
test('font ascent that remains outside the final line box fails after finite candidates',async()=>{const r=await prepare(),calls=[];await assert.rejects(()=>api.buildContentDrivenStylePlan(r,{measureText:async q=>{calls.push(q);return {...await measure(q),lineBoxes:[{x:0,y:-2,width:60,height:q.style.fontSize}]}}}));assert(calls.length<=4);assert.equal(calls.at(-1).style.lineHeight,2)})
test('remeasurement must acknowledge the newly signed request not the original identity',async()=>{const r=await prepare();await assert.rejects(()=>api.buildContentDrivenStylePlan(r,{measureText:async q=>{const m=await measure(q);if(q.style.lineHeight<1.5)m.lineBoxes[0].y=-2;else m.requestHash=r.requests[0].requestHash;return m}}))})
test('raw CSS 1/64 pixel width quantization is accepted, larger overflow remains rejected',async()=>{
 const r=await prepare();const measured=extra=>async q=>({...await measure(q),requiredWidth:q.width+extra,lineBoxes:[{x:0,y:0,width:q.width+extra,height:q.style.fontSize}]});
 await api.buildContentDrivenStylePlan(r,{measureText:measured(1/64)});
 await assert.rejects(()=>api.buildContentDrivenStylePlan(r,{measureText:measured(1/64+.001)}));
})
