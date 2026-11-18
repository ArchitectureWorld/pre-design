import test from 'node:test'
import assert from 'node:assert/strict'
import {validateComponentProfile,adaptComponentProposal,componentSourceForArchetype} from '../src/layout-library/component-upload-workflow.mjs'
import {profileFixture} from './fixtures/reference-workflow.mjs'
const source={fileSha256:'a'.repeat(64),pageNumber:1}
const observation={source,components:[{id:'title',kind:'text',purpose:'title',rect:{x:.05,y:.05,w:.9,h:.15}},{id:'label',kind:'text',purpose:'label',rect:{x:.05,y:.3,w:.4,h:.2}},{id:'photo',kind:'image',rect:{x:.55,y:.3,w:.4,h:.5}}]}
function profile(){const p=profileFixture({page:1,factId:'observation-1-1-1'});p.archetypes[0].roles=['title','text','image'];p.archetypes[0].capacity={images:1,bodyPoints:0,tableRows:0,textBlocks:1};return p}
const proposal=()=>({styles:{title:{fontSize:40,lineHeight:1.2,color:'#222222'},label:{fontSize:22,lineHeight:1.2,color:'#222222'},image:{fit:'contain'}},maxTextCharacters:300,adjustments:{},decorations:[],componentStyles:{}})
test('component profile requires exact independent text/image roles and all observed pages',()=>{
 const p=profile();assert.equal(validateComponentProfile(p,[observation]),p)
 for(const mutate of [x=>x.archetypes[0].capacity.textBlocks=0,x=>x.archetypes[0].capacity.images=2,x=>x.archetypes[0].roles=['title','body','image'],x=>x.evidence[0].pageNumber=2]){
  const x=profile();mutate(x);assert.throws(()=>validateComponentProfile(x,[observation]))
 }
 assert.throws(()=>validateComponentProfile(p,[observation,{...observation,source:{...source,pageNumber:2}}]))
})
test('one archetype cannot silently aggregate different page component structures',()=>{
 const p=profile();p.evidence.push({...p.evidence[0],id:'evidence-2',pageNumber:2});p.archetypes[0].evidenceIds.push('evidence-2')
 assert.throws(()=>componentSourceForArchetype(p,p.archetypes[0],[observation,{...observation,source:{...source,pageNumber:2}}]))
})
test('strict style proposal creates private pending adaptation without source mutation',()=>{
 const p=profile(),before=JSON.stringify(observation),result=adaptComponentProposal({raw:proposal(),profile:p,archetype:p.archetypes[0],observation,index:0})
 assert.equal(result.layout.slots.length,3);assert.equal(result.review.shareAllowed,false);assert.equal(result.review.visualAcceptance,'pending');assert.equal(JSON.stringify(observation),before)
})
test('proposal cannot inject SVG, source or sharing permission',()=>{
 for(const extra of [{prototypeSvg:'<svg/>'},{source},{rights:{shareAllowed:true}},{review:{visualAcceptance:'passed'}}]){
  const p=profile();assert.throws(()=>adaptComponentProposal({raw:{...proposal(),...extra},profile:p,archetype:p.archetypes[0],observation,index:0}))
 }
})
test('multiple page titles and profile-omitted tables are rejected explicitly',()=>{
 for(const component of [{id:'title-two',kind:'text',purpose:'title',rect:{x:.1,y:.1,w:.2,h:.1}},{id:'table',kind:'table',rect:{x:.1,y:.1,w:.2,h:.1}}]){
  const p=profile(),o=structuredClone(observation);o.components.push(component);assert.throws(()=>validateComponentProfile(p,[o]))
 }
})
test('observed table gets an explicit bounded editable table contract, not omitted content',()=>{
 const p=profile(),o=structuredClone(observation);o.components[1]={id:'table',kind:'table',rect:{x:.05,y:.3,w:.4,h:.5}}
 p.archetypes[0].roles=['title','table','image'];p.archetypes[0].capacity={images:1,bodyPoints:0,tableRows:5,textBlocks:0}
 assert.equal(validateComponentProfile(p,[o]),p)
 const raw=proposal();delete raw.styles.label;raw.styles.table={fontSize:22,lineHeight:1.2};raw.maxTextCharacters=0;raw.maxTableRows=5;raw.maxTableColumns=3
 const result=adaptComponentProposal({raw,profile:p,archetype:p.archetypes[0],observation:o,index:0})
 assert.equal(result.layout.slots.find(s=>s.role==='table').style.background,p.designSystem.colors.background);assert.equal(result.layout.contentFitRules.maxTableRows,5);assert.equal(result.layout.slots.filter(s=>s.role==='table').length,1)
 raw.maxTableRows=6;assert.throws(()=>adaptComponentProposal({raw,profile:p,archetype:p.archetypes[0],observation:o,index:0}))
})
test('v3 profile omits duplicate coarse regions without truncating the separate component inventory',async()=>{
 const {componentProfileSchema}=await import('../src/layout-library/component-upload-workflow.mjs'),{referenceProfileSchema}=await import('../src/layout-library/reference-profile.mjs')
 const p=profile();p.archetypes[0].regions=[{role:'title',rect:{x:.1,y:.1,w:.5,h:.1}}]
 assert.equal(referenceProfileSchema.safeParse(p).success,true,'legacy profile still accepts its optional coarse regions')
 assert.equal(componentProfileSchema.safeParse(p).success,false,'v3 never silently strips optional regions')
 delete p.archetypes[0].regions;assert.equal(componentProfileSchema.safeParse(p).success,true)
})
test('title reuse is opt-in and remains an explicit derived variant with bounded content',async()=>{
 const {assertNativeContentFits}=await import('../src/layout-library/svg-native-renderer.mjs')
 const p=profile(),raw=proposal(),before=JSON.stringify(raw),base=adaptComponentProposal({raw,profile:p,archetype:p.archetypes[0],observation,index:0})
 const derived=adaptComponentProposal({raw,profile:p,archetype:p.archetypes[0],observation,index:0,titleReuse:true})
 assert.equal(JSON.stringify(raw),before);assert.equal(base.review.titleReuse,undefined);assert(derived.review.titleReuse);assert(derived.layout.contentFitRules.maxTitleCharacters<100)
 const item={title:'原文'.repeat(100),paragraphs:[],points:[],textBlocks:[{key:'label',text:'说明'}]},original=JSON.stringify(item)
 assert.throws(()=>assertNativeContentFits(item,derived.layout),e=>e.code==='CONTENT_FIT');assert.equal(JSON.stringify(item),original)
})
test('explicit content-fit metadata retains real parent bounds without enabling old jobs',()=>{
 const p=profile(),o=structuredClone(observation);o.components.unshift({id:'card',kind:'group',rect:{x:.01,y:.25,w:.45,h:.4}});o.components.find(c=>c.id==='label').parentId='card';
 const args={raw:proposal(),profile:p,archetype:p.archetypes[0],observation:o,index:0};assert.equal(adaptComponentProposal(args).layout.contentAdaptationPolicy,undefined);
 const next=adaptComponentProposal({...args,contentFitPolicy:true});assert.equal(next.layout.contentAdaptationPolicy.version,1);assert.deepEqual(next.layout.contentAdaptationPolicy.entries[0].bounds,o.components[0].rect)
})
test('legacy model adaptation schema keeps its exact pre-presentation checkpoint input',async()=>{const {createHash}=await import('node:crypto');const {componentAdaptationSchema}=await import('../src/layout-library/component-upload-workflow.mjs');assert.equal(createHash('sha256').update(JSON.stringify(componentAdaptationSchema())).digest('hex'),'91d0a1e88d4768c0fa2261b6642920a9d3aa5dca5a36934f2170798e47898162');for(const field of ['styles','componentStyles']){const raw=proposal();raw[field]={...raw[field],image:{fit:'contain',presentationVersion:1,captionPolicy:'when-present'}};const p=profile();assert.throws(()=>adaptComponentProposal({raw,profile:p,archetype:p.archetypes[0],observation,index:0}))}})
