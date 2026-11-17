import test from 'node:test'
import assert from 'node:assert/strict'
import {validateDesignSpec} from '../src/layout-library/design-spec.mjs'
import {validateNativeDesignPackage} from '../src/layout-library/native-design-v3.mjs'
import {nativeDesignInput} from './fixtures/native-design-v3-fixture.mjs'
import {compileNativeDesignPackageV3} from '../src/layout-library/native-design-compiler.mjs'
import {validatePackage,packageDigest} from '../src/layout-library/contract.mjs'
test('strict graph rejects cycles, missing mappings and unknown declarations',()=>{
 for(const mutate of [s=>s.masterLayoutGraph[0].parentId='layout-1',s=>s.masterLayoutGraph[1].kind='slide',s=>delete s.masterLayoutGraph[1].archetypeId,s=>s.components[0].text='BUSINESS',s=>s.components[0].role='body',s=>s.fidelity='mirror']){const s=nativeDesignInput().designSpec;mutate(s);assert.throws(()=>validateDesignSpec(s))}
})
test('Native package import rejects identity/profile/capacity tampering and incomplete receipts',()=>{
 const p=compileNativeDesignPackageV3(nativeDesignInput())
 for(const mutate of [p=>p.compilerVersion='old',p=>p.upstreamRevision='0'.repeat(40),p=>p.rendererCompatibility=['unknown'],p=>p.designProfile.archetypes[0].roles=['title'],p=>p.layouts[0].contentFitRules.maxImages=6,p=>p.validationReceipts[1]=p.validationReceipts[0],p=>p.theme.accent='#000000']){const invalid=structuredClone(p);mutate(invalid);assert.throws(()=>validatePackage(invalid))}
 const changed=structuredClone(p);changed.layouts[0].prototypeSvg=changed.layouts[0].prototypeSvg.replace('width="16"','width="18"');assert.notEqual(packageDigest(p),packageDigest(changed))
 assert.deepEqual(validateNativeDesignPackage(p),p)
})
test('profile field ordering does not change a native design declaration',()=>{
 const input=nativeDesignInput(),profile=input.designSpec.profile
 const p={designSpec:input.designSpec,designProfile:Object.fromEntries(Object.entries(profile).reverse()),canvas:profile.designSystem.canvas,theme:{...profile.designSystem.colors,...profile.designSystem.typography},layouts:input.prototypes,validationReceipts:[{kind:'native-schema'},{kind:'svg-safety'}]}
 assert.doesNotThrow(()=>validateNativeDesignPackage(p))
})
test('V3 selectors must cover each variant capacity exactly without holes or duplicate regions',()=>{
 for(const mutate of [
  l=>l.slots.find(s=>s.role==='body').range={start:0,end:7},
  l=>l.slots.find(s=>s.role==='body').range={start:1,end:9},
  l=>l.slots.find(s=>s.role==='image').index=1,
  l=>l.slots.push({...l.slots.find(s=>s.role==='body'),id:'body-duplicate'}),
  l=>{const b=l.slots.find(s=>s.role==='body');b.range={start:0,end:5};l.slots.push({...b,id:'body-duplicate',range:{start:4,end:8}})},
 ]){const v=nativeDesignInput();mutate(v.prototypes[0]);assert.throws(()=>compileNativeDesignPackageV3(v),e=>e.code==='NATIVE_DESIGN_INVALID')}
})
test('small variants are allowed only when one variant fully covers all profile capacities',()=>{
 const v=nativeDesignInput(),small=structuredClone(v.prototypes[0]);small.id='small';small.contentFitRules.maxBodyPoints=3;small.slots.find(s=>s.role==='body').range={start:0,end:3}
 assert.throws(()=>compileNativeDesignPackageV3({...v,prototypes:[small]}),e=>e.code==='NATIVE_DESIGN_INVALID')
 assert.equal(compileNativeDesignPackageV3({...v,prototypes:[small,...v.prototypes]}).layouts.length,2)
 const complementary=structuredClone(v.prototypes[0]);complementary.id='complement';complementary.contentFitRules.maxImages=0
 assert.throws(()=>compileNativeDesignPackageV3({...v,prototypes:[small,complementary]}),e=>e.code==='NATIVE_DESIGN_INVALID')
})
test('positive profile image/body/table capacities require matching actual content roles',()=>{
 for(const [role,key,fit] of [['image','images','maxImages'],['body','bodyPoints','maxBodyPoints'],['table','tableRows','maxTableRows']]){
  const v=nativeDesignInput(),a=v.designSpec.profile.archetypes[0];a.roles=a.roles.filter(r=>r!==role);a.capacity[key]=1;v.prototypes[0].slots=v.prototypes[0].slots.filter(s=>s.role!==role);v.prototypes[0].contentFitRules[fit]=1
  assert.throws(()=>compileNativeDesignPackageV3(v),e=>e.code==='NATIVE_DESIGN_INVALID')
 }
})
test('a positive table capacity cannot be declared with zero usable columns',()=>{
 const v=nativeDesignInput(),a=v.designSpec.profile.archetypes[0];a.roles.push('table');a.capacity.tableRows=1
 const l=v.prototypes[0];l.contentFitRules.maxTableRows=1;l.contentFitRules.maxTableColumns=0
 l.slots.find(s=>s.role==='image').rect.w=.2
 l.slots.push({id:'data',role:'table',rect:{x:.27,y:.35,w:.2,h:.5}})
 assert.throws(()=>compileNativeDesignPackageV3(v),e=>e.code==='NATIVE_DESIGN_INVALID')
})
test('structure intent preserves every declared role/region while style allows rearrangement',()=>{
 const input=nativeDesignInput(),profile=input.designSpec.profile
 profile.intent='structure';profile.archetypes[0].regions=input.prototypes[0].slots.map(({role,rect})=>({role,rect:{...rect}}))
 assert.doesNotThrow(()=>compileNativeDesignPackageV3(input))
 for(const mutate of [
  v=>v.prototypes[0].slots.find(s=>s.role==='title').rect.y=.06,
  v=>v.designSpec.profile.archetypes[0].regions.pop(),
  v=>v.designSpec.profile.archetypes[0].regions.push(structuredClone(v.designSpec.profile.archetypes[0].regions[0])),
 ]){const bad=structuredClone(input);mutate(bad);assert.throws(()=>compileNativeDesignPackageV3(bad),e=>e.code==='NATIVE_DESIGN_INVALID')}
 const close=structuredClone(input);close.prototypes[0].slots[0].rect.y+=.0000001;assert.doesNotThrow(()=>compileNativeDesignPackageV3(close))
 const style=structuredClone(input);style.designSpec.profile.intent='style';style.prototypes[0].slots[0].rect.y=.06;assert.doesNotThrow(()=>compileNativeDesignPackageV3(style))
})
