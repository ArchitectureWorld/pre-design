import test from 'node:test'
import assert from 'node:assert/strict'
import {nativePackageFixture} from './fixtures/native-design-v3-fixture.mjs'
import {assessFidelity,validateFidelityFeatures} from '../src/layout-library/fidelity-assessment.mjs'
import {reuseGuideHtml} from '../src/layout-library/reuse-guide-ui.js'
const fixture=async()=>{const pkg=await nativePackageFixture();const layout=pkg.layouts[0];const e=pkg.designProfile.evidence.find(e=>e.fileSha256&&e.pageNumber);return {pkg,layout,e}}
test('old packages retain unknown visual quality even when engineering validation passed',async()=>{
 const {pkg}=await fixture();const a=assessFidelity(pkg)
 assert.equal(a.visualStatus,'unassessed');assert.equal(a.reuseStatus,'unassessed');assert.equal(a.features.length,0)
 assert.match(reuseGuideHtml(pkg),/视觉还原未评估/)
})
test('feature assessment preserves source observation and explicit derivative separately',async()=>{
 const {pkg,layout,e}=await fixture();pkg.fidelityFeatures=[{layoutId:layout.id,source:{sha256:e.fileSha256,page:e.pageNumber},feature:'typography',observed:'原字形',representation:'derived',reason:'字体无再分发授权，采用可编辑替代',slotIds:[layout.slots[0].id],editability:'text'}]
 validateFidelityFeatures(pkg);const a=assessFidelity(pkg)
 assert.equal(a.visualStatus,'needs-review');assert.equal(a.features[0].observed,'原字形');assert.equal(a.features[0].representation,'derived')
 assert.match(reuseGuideHtml(pkg),/字体无再分发授权/)
})
test('source and target binding reject wrong page, source, layout or slot',async()=>{
 const {pkg,layout,e}=await fixture();const f={layoutId:layout.id,source:{sha256:e.fileSha256,page:e.pageNumber},feature:'texture',observed:'纸纹',representation:'missing',reason:'尚未提取',slotIds:[],editability:'none'}
 for(const patch of [{layoutId:'missing'},{source:{sha256:'f'.repeat(64),page:e.pageNumber}},{source:{sha256:e.fileSha256,page:999}},{slotIds:['missing']}]){pkg.fidelityFeatures=[{...f,...patch}];assert.throws(()=>validateFidelityFeatures(pkg))}
})
test('derived representation requires reason and markup is escaped; metadata never proves fidelity',async()=>{
 const {pkg,layout,e}=await fixture();const f={layoutId:layout.id,source:{sha256:e.fileSha256,page:e.pageNumber},feature:'typography',observed:'<script>source</script>',representation:'derived',slotIds:[layout.slots[0].id],editability:'text'}
 pkg.fidelityFeatures=[f];assert.throws(()=>validateFidelityFeatures(pkg));f.reason='替代';validateFidelityFeatures(pkg)
 assert.doesNotMatch(reuseGuideHtml(pkg),/<script>/);assert.notEqual(assessFidelity(pkg).visualStatus,'passed')
})
test('native import keeps valid assessment metadata and rejects extra unsafe fields',async()=>{
 const {validatePackage}=await import('../src/layout-library/contract.mjs');const {pkg,layout,e}=await fixture()
 pkg.fidelityFeatures=[{layoutId:layout.id,source:{sha256:e.fileSha256,page:e.pageNumber},feature:'texture',observed:'独立图像纸纹',representation:'missing',reason:'未加入可追溯视觉层',slotIds:[],editability:'none',evidenceKind:'image'}]
 assert.equal(validatePackage(pkg).fidelityFeatures[0].evidenceKind,'image')
 pkg.fidelityFeatures[0].url='https://evil.example';assert.throws(()=>validatePackage(pkg))
})
test('evidence classes and exact source identity are visible, including absent kind as unknown',async()=>{
 const {pkg,layout,e}=await fixture();const f={layoutId:layout.id,source:{sha256:e.fileSha256,page:e.pageNumber},feature:'typography',observed:'文字外观',representation:'represented',slotIds:[layout.slots[0].id],editability:'text'}
 pkg.fidelityFeatures=[f]
 for(const [kind,label]of [[undefined,'证据类型未知'],['inferred','推断'],['ocr','OCR'],['native-text','原生文字']]){f.evidenceKind=kind;const html=reuseGuideHtml(pkg);assert.match(html,new RegExp(label));assert.ok(html.includes(e.fileSha256))}
})
test('unsupported editability cannot be claimed without corresponding content slot capability',async()=>{
 const {pkg,layout,e}=await fixture();const f={layoutId:layout.id,source:{sha256:e.fileSha256,page:e.pageNumber},feature:'typography',observed:'文字',representation:'represented',slotIds:[],editability:'text'}
 pkg.fidelityFeatures=[f];assert.throws(()=>validateFidelityFeatures(pkg))
 f.slotIds=[layout.slots.find(s=>s.role==='image').id];assert.throws(()=>validateFidelityFeatures(pkg))
 f.editability='unknown';assert.doesNotThrow(()=>validateFidelityFeatures(pkg));assert.match(reuseGuideHtml(pkg),/编辑能力待核对/)
})
test('apply then reusable export retains source observations for the selected layout',async()=>{
 const {resolvePage,exportReusable}=await import('../src/layout-library/contract.mjs');const {pkg,layout,e}=await fixture()
 pkg.fidelityFeatures=[{layoutId:layout.id,source:{sha256:e.fileSha256,page:e.pageNumber},feature:'texture',observed:'纸纹',representation:'missing',reason:'待补',slotIds:[],editability:'none',evidenceKind:'image'}]
 const page={id:'test',item:{title:'标题',paragraphs:['内容'],points:['要点'],evidenceIndexes:[0],figure:{materialId:'00000000-0000-4000-8000-000000000001',caption:'图'}},nativeAssets:{image:{dataUrl:'data:image/png;base64,eA=='}}}
 page.nativeLayout=resolvePage({page,globalPackage:pkg});assert.deepEqual(exportReusable(page,'复用').fidelityFeatures,pkg.fidelityFeatures)
})
test('emphasis candidate preserves image source and strict pending geometry without text claims',async()=>{
 const {pkg,layout,e}=await fixture(),slot=layout.slots.find(s=>s.role==='title');const f={layoutId:layout.id,source:{sha256:e.fileSha256,page:e.pageNumber},feature:'rich-text',observed:'图像强调候选',representation:'unverified',reason:'须选择项目原文',slotIds:[slot.id],editability:'unknown',evidenceKind:'image',emphasisCandidate:{version:1,componentId:slot.id,status:'pending-text-binding',regions:[{x:.1,y:.1,w:.2,h:.1}]}};pkg.fidelityFeatures=[f];assert.doesNotThrow(()=>validateFidelityFeatures(pkg))
 for(const mutate of [x=>x.emphasisCandidate.quote='secret',x=>x.emphasisCandidate.status='accepted',x=>x.emphasisCandidate.regions[0].x=.9,x=>x.emphasisCandidate.version=2,x=>x.slotIds=[layout.slots.find(s=>s.role==='image').id],x=>x.evidenceKind='inferred',x=>x.editability='text',x=>x.emphasisCandidate.componentId='other']){const bad=structuredClone(f);mutate(bad);pkg.fidelityFeatures=[bad];assert.throws(()=>validateFidelityFeatures(pkg))}
})
test('candidate review exposes exact source, component, normalized region and pending binding',async()=>{const {emphasisCandidateReviewHtml}=await import('../src/layout-library/fidelity-assessment.mjs');assert.equal(typeof emphasisCandidateReviewHtml,'function');const {pkg,layout,e}=await fixture(),slot=layout.slots.find(s=>s.role==='title');pkg.fidelityFeatures=[{layoutId:layout.id,source:{sha256:e.fileSha256,page:e.pageNumber},feature:'rich-text',observed:'强调候选',representation:'unverified',reason:'待绑定',slotIds:[slot.id],editability:'unknown',evidenceKind:'image',emphasisCandidate:{version:1,componentId:slot.id,status:'pending-text-binding',regions:[{x:.1,y:.2,w:.3,h:.1}]}}];const html=emphasisCandidateReviewHtml(pkg,layout.id);assert(html.includes(e.fileSha256));assert(html.includes(slot.id));assert.match(html,/10\.0%/);assert.match(html,/待绑定/);assert.match(html,/data-emphasis-source-page/);assert.doesNotMatch(emphasisCandidateReviewHtml(pkg,'unknown'),/data-emphasis-source-page/)})
