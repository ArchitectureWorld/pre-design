import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectLayoutPreview} from '../src/layout-library/project-preview-ui.js'
const context={projectId:'11111111-1111-4111-8111-111111111111',draftId:'22222222-2222-4222-8222-222222222222',pageId:'visual-page-item-1'},resource={id:'33333333-3333-4333-8333-333333333333',version:2,hash:'a'.repeat(64),package:{layouts:[{id:'layout-one'},{id:'layout-two'}]}},response={draftId:context.draftId,pageId:context.pageId,html:'<main>actual project</main>'}
const setup=overrides=>({context:structuredClone(context),resource:structuredClone(resource),isCurrent:()=>true,request:async()=>({...response}),...overrides})
test('routes only read-only preview with frozen context and exact saved resource version',async()=>{
 const calls=[],args=setup({request:async(...a)=>{calls.push(a);return {...response}}}),preview=createProjectLayoutPreview(args),controller=new AbortController()
 args.context.projectId='changed';args.resource.version=9;args.resource.package.layouts[0].id='changed'
 assert.deepEqual(await preview('layout-one',{signal:controller.signal}),response)
 assert.deepEqual(calls,[[`/projects/${context.projectId}/layout-preview`,{method:'POST',body:{draftId:context.draftId,pageId:context.pageId,scope:'local',resource:{resourceId:resource.id,version:2},overrides:{layoutId:'layout-one'}},signal:controller.signal}]])
})
test('missing or invalid identity, hash, version, layouts and lifecycle guard reject',()=>{
 for(const mutate of [a=>delete a.context.projectId,a=>a.context.projectId='../other',a=>delete a.context.draftId,a=>a.context.pageId='',a=>a.resource.version=0,a=>a.resource.version=1.5,a=>delete a.resource.hash,a=>a.resource.hash='fake',a=>a.resource.package.layouts=[],a=>a.resource.package.layouts.push({id:'layout-one'}),a=>delete a.isCurrent]){const a=setup();mutate(a);assert.throws(()=>createProjectLayoutPreview(a))}
})
test('unknown layout and stale context fail before any request',async()=>{
 let calls=0;const request=async()=>{calls++;return response}
 await assert.rejects(createProjectLayoutPreview(setup({request}))('unknown'))
 await assert.rejects(createProjectLayoutPreview(setup({request,isCurrent:()=>false}))('layout-one'),e=>e.name==='AbortError');assert.equal(calls,0)
})
test('checks current identity after response and never reuses successful content',async()=>{
 let current=true,calls=0;const preview=createProjectLayoutPreview(setup({isCurrent:()=>current,request:async()=>{calls++;return response}}));await preview('layout-one');current=false;await assert.rejects(preview('layout-one'),e=>e.name==='AbortError');assert.equal(calls,1)
 current=true;const delayed=createProjectLayoutPreview(setup({isCurrent:()=>current,request:async()=>{current=false;return response}}));await assert.rejects(delayed('layout-one'),e=>e.name==='AbortError')
})
test('cancellation propagates signal and discards late results even if transport ignores abort',async()=>{
 const controller=new AbortController();let calls=0
 const preview=createProjectLayoutPreview(setup({request:async(_path,options)=>{calls++;assert.equal(options.signal,controller.signal);controller.abort();return response}}))
 await assert.rejects(preview('layout-one',{signal:controller.signal}),e=>e.name==='AbortError');await assert.rejects(preview('layout-one',{signal:controller.signal}),e=>e.name==='AbortError');assert.equal(calls,1)
})
test('wrong response identity or missing HTML is rejected without sample substitution',async()=>{
 for(const bad of [{...response,draftId:'other'},{...response,pageId:'other'},{...response,html:''},{html:response.html},null]){let calls=0;await assert.rejects(createProjectLayoutPreview(setup({request:async()=>{calls++;return bad}}))('layout-one'));assert.equal(calls,1)}
})
test('preview failures remain failures with no retry, mutation or sample fallback',async()=>{
 const failure=Object.assign(Error('缺少图片映射'),{code:'CONTENT_MAPPING_REQUIRED'}),paths=[];const preview=createProjectLayoutPreview(setup({request:async path=>{paths.push(path);throw failure}}));await assert.rejects(preview('layout-two'),e=>e===failure);assert.equal(paths.length,1);assert(paths[0].endsWith('/layout-preview'))
})
