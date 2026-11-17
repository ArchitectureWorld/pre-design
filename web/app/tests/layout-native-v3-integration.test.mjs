import test from 'node:test'
import assert from 'node:assert/strict'
import {nativePackageFixture} from './fixtures/native-design-v3-fixture.mjs'
import {validatePackage,resolvePage,exportReusable,rendererForPackage,packageDigest,createPackage} from '../src/layout-library/contract.mjs'
import {renderNativePage} from '../src/layout-library/render.mjs'
import {requiresReferenceReview,isReferenceReviewCurrent} from '../src/layout-library/reference-review.mjs'
const page=()=>({id:'actual-page',number:1,chapterTitle:'实际项目',item:{title:'<实际内容>',paragraphs:['实际段落'],points:['真实要点'],evidenceIndexes:[0],figure:{materialId:'00000000-0000-4000-8000-000000000001',caption:'已授权项目素材'}},nativeAssets:{image:{dataUrl:'data:image/png;base64,eA=='}}})
test('V3 uses SVG-backed renderer via existing resolve/render/export paths and keeps review gates',async()=>{
 const pkg=await nativePackageFixture(),p=page()
 assert.equal(validatePackage(pkg).schemaVersion,'pre-design.layout-package.v3')
 assert.equal(rendererForPackage(pkg),'pre-design-native-html-v3.0')
 p.nativeLayout=resolvePage({page:p,globalPackage:pkg})
 const html=renderNativePage(p)
 assert.match(html,/data:image\/svg\+xml/)
 assert.match(html,/&lt;实际内容&gt;/)
 assert.match(html,/真实要点/)
 const reusable=exportReusable(p,'可复用设计')
 assert.equal(reusable.schemaVersion,pkg.schemaVersion)
 assert.equal(reusable.layouts[0].prototypeSvg,pkg.layouts[0].prototypeSvg)
 assert.doesNotMatch(JSON.stringify(reusable),/真实要点|已授权项目素材|实际段落/)
 assert(requiresReferenceReview(pkg));assert(!isReferenceReviewCurrent({package:pkg,hash:packageDigest(pkg)}))
})
test('V1 remains compatible and V3 unrecognized limits or unsafe prototype cannot reach render',async()=>{
 assert.equal(rendererForPackage(validatePackage(createPackage())),'pre-design-native-html-v1.0')
 const pkg=await nativePackageFixture();pkg.layouts[0].prototypeSvg='<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
 assert.throws(()=>validatePackage(pkg))
})
test('V10 chooses a declared variant with enough capacity instead of first matching roles',async()=>{
 const pkg=await nativePackageFixture(),p=page(),small=structuredClone(pkg.layouts[0])
 small.id='small';small.contentFitRules.maxBodyPoints=1
 pkg.layouts.unshift(small);p.item.points=['一','二']
 const resolved=resolvePage({page:p,globalPackage:pkg})
 assert.equal(resolved.layout.id,'mixed-page')
 assert.throws(()=>resolvePage({page:p,globalPackage:pkg,manual:{layoutId:'small'}}),/capacity|容量/)
})
test('exporting a smaller selected V3 variant produces an honest single-page capacity profile',async()=>{
 const pkg=await nativePackageFixture(),p=page(),small=structuredClone(pkg.layouts[0]);small.id='small';small.contentFitRules.maxBodyPoints=1;pkg.layouts.unshift(small)
 p.nativeLayout=resolvePage({page:p,globalPackage:pkg,manual:{layoutId:'small'}})
 const saved=exportReusable(p,'小容量页面')
 assert.equal(saved.layouts.length,1);assert.equal(saved.designProfile.archetypes[0].capacity.bodyPoints,1)
 assert.doesNotThrow(()=>validatePackage(saved))
})
test('publication sample pages respect each V3 variant capacity without weakening real content checks',async()=>{
 const {samplePages}=await import('../src/layout-library/validation.mjs'),pkg=await nativePackageFixture(),small=structuredClone(pkg.layouts[0]);small.id='small';small.contentFitRules.maxBodyPoints=1;pkg.layouts.unshift(small)
 const samples=samplePages(pkg)
 assert.equal(samples.length,4);assert(samples.filter(p=>p.nativeLayout.layout.id==='small').every(p=>p.item.points.length===1))
 assert(samples.every(p=>renderNativePage(p).includes('data:image/svg+xml')))
})
test('saving a V3 page with manual typography preserves effective theme and records user provenance',async()=>{
 const pkg=await nativePackageFixture(),p=page();p.nativeLayout=resolvePage({page:p,globalPackage:pkg,manual:{theme:{titleSize:50}}})
 const saved=exportReusable(p,'手动调整后的设计')
 assert.equal(saved.theme.titleSize,50);assert.equal(saved.designProfile.designSystem.typography.titleSize,50)
 assert(saved.designProfile.evidence.some(e=>e.provenance==='user'))
 assert.deepEqual(saved.designSpec.profile,saved.designProfile)
})
