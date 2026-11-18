import test from 'node:test'
import assert from 'node:assert/strict'
import {acceptanceSummary,referenceInput} from '../../../scripts/layout-library/real-acceptance.mjs'
test('acceptance counts failures and never turns a small perfect sample into 95% reliability',()=>{
 const a=acceptanceSummary([{passed:true},{passed:true}]);assert.equal(a.successRate,1);assert.equal(a.attempts,2);assert(a.wilson95.lower<.5);assert.equal(a.populationReliabilityEstablished,false)
 const b=acceptanceSummary([{passed:true},{passed:false}]);assert.equal(b.successRate,.5);assert.equal(acceptanceSummary([]).successRate,null)
})
test('reference preparation preserves actual bytes and makes only private artifact handles',()=>{
 const bytes=Buffer.from('reference'),image=Buffer.from('image'),artifact=Buffer.from('svg'),sha='a'.repeat(64)
 const parsed={kind:'pptx',images:[{page:1,data:image,mimeType:'image/png'}],privateArtifacts:[{path:'svg-flat/slide_01.svg',sha256:sha,bytes:3,data:artifact}]}
 const x=referenceInput({filename:'sample.pptx',bytes,parsed});assert.equal(x.images[0].fileId,x.file.id);assert.equal(x.images[0].data,image.toString('base64'));assert.equal(x.file.privateArtifacts[0].data,undefined);assert.deepEqual(x.artifacts.get('svg-flat/slide_01.svg').data,artifact);assert.equal(parsed.images[0].data,image)
})
test('acceptance disables provider retries only in the private runtime copy',async()=>{
 const {boundedModelRuntime}=await import('../../../scripts/layout-library/real-acceptance.mjs')
 const original={model:{providers:{known:{baseURL:'https://example.test',retryPolicy:{mode:'always'},models:[]}},env:{secret:'private'}},search:{}}
 const capped=boundedModelRuntime(original);assert.deepEqual(capped.model.providers.known.retryPolicy,{mode:'normal',maxRetries:0});assert.equal(original.model.providers.known.retryPolicy.mode,'always');assert.deepEqual(capped.model.env,original.model.env)
})
test('selected PDF pages retain original identity and exclude unselected images and text',()=>{
 const parsed={kind:'pdf',pageCount:87,readPages:[1,5,13],text:'whole-document-private',summary:'whole summary',images:[1,5,13].map(page=>({page,data:Buffer.from(String(page))})),pages:[1,5,13].map(page=>({page,text:`page-${page}`})),limitations:[]}
 const x=referenceInput({filename:'reference.pdf',bytes:Buffer.from('original'),parsed,selectedPages:[5,13]})
 assert.deepEqual(x.images.map(p=>p.page),[5,13]);assert.deepEqual(x.file.readPages,[5,13]);assert.equal(x.file.pageCount,87);assert.equal(x.file.text,'');assert.deepEqual(x.file.pages.map(p=>p.page),[5,13]);assert.match(x.file.summary,/5, 13/);assert.equal(parsed.text,'whole-document-private')
 for(const selectedPages of [[],[5,5],[88],[1.5]])assert.throws(()=>referenceInput({filename:'reference.pdf',bytes:Buffer.from('original'),parsed,selectedPages}))
})
test('private checkpoint files are atomic, non-overwriting and readable only from validated keys',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{privateCheckpointStore}=await import('../../../scripts/layout-library/private-checkpoints.mjs')
 const root=await mkdtemp(join(tmpdir(),'private-checkpoints-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const store=await privateCheckpointStore(root),key='f'.repeat(64),record={key,recordHash:'one'}
 assert.equal(await store.get(key),undefined);await store.put(key,record);assert.deepEqual(await store.get(key),record)
 await store.put(key,record);await assert.rejects(store.put(key,{key,recordHash:'two'}));await assert.rejects(store.get('../source'))
})
test('full acceptance reads bounded original ranges and keeps all 87 page identities',async()=>{
 const {extractAcceptanceDocument}=await import('../../../scripts/layout-library/real-acceptance.mjs'),starts=[],bytes=Buffer.from('source')
 const extract=async({pdfStartPage=1,bytes:actual})=>{assert.equal(actual,bytes);starts.push(pdfStartPage);const readPages=Array.from({length:Math.min(30,88-pdfStartPage)},(_,i)=>pdfStartPage+i);return {kind:'pdf',pageCount:87,readPages,images:readPages.map(page=>({page,data:Buffer.from('page '+page)})),pages:readPages.map(page=>({page,text:'page '+page})),limitations:[]}}
 const parsed=await extractAcceptanceDocument({extract,bytes,filename:'reference.pdf',fullDocument:true})
 assert.deepEqual(starts,[1,31,61]);assert.equal(parsed.images.length,87);assert.equal(parsed.images.at(-1).page,87);assert.equal(parsed.pages.at(-1).text,'page 87');assert.equal(parsed.text,'')
})

test('recovery options preserve explicit stage versions and scoped caps',async()=>{
 const {acceptanceWorkflowOptions}=await import('../../../scripts/layout-library/real-acceptance.mjs')
 const c={referenceWorkflowVersion:1,prototypeContractVersions:{a:'legacy-image-v1'},stageOutputTokenLimits:{'prototype-3':8192}}
 assert.deepEqual(acceptanceWorkflowOptions(c),{payload:{referenceWorkflowVersion:1,prototypeContractVersions:{a:'legacy-image-v1'}},stageOutputTokenLimits:{'prototype-3':8192}})
 assert.deepEqual(acceptanceWorkflowOptions({}),{payload:{},stageOutputTokenLimits:undefined})
 assert.throws(()=>acceptanceWorkflowOptions({stageOutputTokenLimits:{oops:1}}),/REFERENCE_STAGE_LIMIT_INVALID/)
})
test('real acceptance explicitly selects new component version without changing absent legacy options',async()=>{
 const {acceptanceWorkflowOptions}=await import('../../../scripts/layout-library/real-acceptance.mjs')
 assert.deepEqual(acceptanceWorkflowOptions({referenceComponentVersion:1}).payload,{referenceComponentVersion:1})
 assert.deepEqual(acceptanceWorkflowOptions({referenceComponentVersion:2}).payload,{referenceComponentVersion:2})
 assert.deepEqual(acceptanceWorkflowOptions({referenceComponentVersion:3}).payload,{referenceComponentVersion:3})
 assert.throws(()=>acceptanceWorkflowOptions({referenceComponentVersion:4}),/REFERENCE_COMPONENT_VERSION_INVALID/)
})
test('profile-only scope refuses new observation or downstream model calls',async()=>{
 const {assertProfileOnlyStage}=await import('../../../scripts/layout-library/real-acceptance.mjs')
 assert.doesNotThrow(()=>assertProfileOnlyStage('profile'))
 for(const stage of ['observe-1','design-spec','prototype-1','coverage-map'])assert.throws(()=>assertProfileOnlyStage(stage),e=>e.code==='ACCEPTANCE_PROFILE_SCOPE_STOP')
})
test('profile-only output cap supports profile without altering saved policy',async()=>{
 const {stagePolicyWithOutputLimit}=await import('../src/layout-library/reference-stage-policy.mjs')
 const p={routes:{parent:{primary:{provider:'p',model:'m'},fallbacks:[]}},models:[{provider:'p',model:'m',maxOutputTokens:16000}]}
 const limited=stagePolicyWithOutputLimit(p,'profile',{profile:8192});assert.equal(limited.models[0].maxOutputTokens,8192);assert.equal(p.models[0].maxOutputTokens,16000)
})
