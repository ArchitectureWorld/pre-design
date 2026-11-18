import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeDesignInput} from './fixtures/native-design-v3-fixture.mjs'
import * as mod from '../src/layout-library/native-design-compiler.mjs'
test('V3 compiler preserves native spec and SVG deterministically without a V2 fallback',()=>{
 assert.ok(mod,'native compiler must exist')
 const input=nativeDesignInput(),a=mod.compileNativeDesignPackageV3(input),b=mod.compileNativeDesignPackageV3(input)
 assert.deepEqual(a,b);assert.equal(a.schemaVersion,'pre-design.layout-package.v3');assert.deepEqual(a.designSpec,input.designSpec);assert.deepEqual(a.designProfile,input.designSpec.profile);assert.match(a.layouts[0].prototypeSvg,/<rect/);assert.equal(a.compilerVersion,'pre-design-native-compiler-v3.0');assert.deepEqual(a.formats,['html']);assert(a.validationReceipts.length)
})
test('V3 compiler rejects missing prototypes, false evidence, malicious SVG and undeclared content',()=>{
 assert.ok(mod)
 for(const mutate of [v=>v.prototypes=[],v=>v.prototypes[0].archetypeId='unknown',v=>v.prototypes[0].slots.pop(),v=>v.prototypes[0].prototypeSvg='<svg><script>alert(1)</script></svg>',v=>v.prototypes[0].contentFitRules.overflow='truncate',v=>v.designSpec.rawText='PRIVATE',v=>v.designSpec.components[0].asset='/private/file',v=>v.designSpec.masterLayoutGraph[1].parentId='master-9',v=>v.designSpec.masterLayoutGraph[1].evidenceIds=['unknown'],v=>v.designSpec.masterLayoutGraph[0].id='client-name']){
  const input=nativeDesignInput();mutate(input);assert.throws(()=>mod.compileNativeDesignPackageV3(input))
 }
 assert.throws(()=>mod.compileNativeDesignPackageV3({...nativeDesignInput(),inventory:{files:[]}}))
})
test('V3 compiler rejects text boxes shorter than one rendered line instead of accepting clipped prototypes',()=>{
 for(const role of ['title','body']){
  const input=nativeDesignInput(),slot=input.prototypes[0].slots.find(s=>s.role===role)
  slot.rect.h=.02
  assert.throws(()=>mod.compileNativeDesignPackageV3(input),/一行文字/)
 }
})
test('V3 retains source colors while recording deterministic readable derived theme',()=>{
 const input=nativeDesignInput();input.designSpec.profile.designSystem.colors.muted='#7d8a8a';input.designSpec.profile.designSystem.colors.background='#f8f6f3';const before=JSON.stringify(input)
 const result=mod.compileNativeDesignPackageV3(input)
 assert.equal(JSON.stringify(input),before);assert.equal(result.designProfile.designSystem.colors.muted,'#7d8a8a');assert.equal(result.designSpec.profile.designSystem.colors.muted,'#7d8a8a')
 assert.notEqual(result.theme.muted,'#7d8a8a');assert.equal(result.themeDerivations[0].source,'#7d8a8a');assert.equal(result.themeDerivations[0].derived,result.theme.muted);assert.match(result.source.limitations.join(' '),/派生/)
})
test('readable derivations survive validation and reject tampered records and rendering colors',async()=>{
 const {validatePackage,contrast}=await import('../src/layout-library/contract.mjs');const {reuseGuideHtml}=await import('../src/layout-library/reuse-guide-ui.js')
 const input=nativeDesignInput();input.designSpec.profile.designSystem.colors.muted='#7d8a8a';input.designSpec.profile.designSystem.colors.background='#f8f6f3';const pkg=mod.compileNativeDesignPackageV3(input)
 assert(contrast(pkg.theme.muted,pkg.theme.background)>=4.5);assert.deepEqual(validatePackage(pkg),pkg);assert.match(reuseGuideHtml(pkg),/原色 #7d8a8a/)
 for(const change of [p=>delete p.themeDerivations,p=>p.themeDerivations[0].source='#000000',p=>p.themeDerivations[0].derived='#000000',p=>p.themeDerivations[0].minimum=3,p=>p.theme.muted='#000000']){const p=structuredClone(pkg);change(p);assert.throws(()=>validatePackage(p))}
})
