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
