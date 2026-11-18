import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {createPackage} from '../src/layout-library/contract.mjs'
import {mountLayoutLibrary} from '../src/layout-library/ui.js'
const tick=()=>new Promise(r=>setImmediate(r))
async function fixture(t,{projectResponse,editorialResponse}={}){
 const dom=new JSDOM('<div class="top-right"></div>');globalThis.document=dom.window.document;globalThis.window=dom.window;dom.window.requestAnimationFrame=fn=>setImmediate(fn);dom.window.cancelAnimationFrame=clearImmediate;Object.defineProperty(dom.window.document,'fonts',{value:Object.assign([],{ready:Promise.resolve()})});for(const key of ['clientWidth','clientHeight','scrollWidth','scrollHeight'])Object.defineProperty(dom.window.HTMLElement.prototype,key,{get:()=>100,configurable:true})
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false}
 const pkg=createPackage('测试版式'),resource={id:'11111111-1111-4111-8111-111111111111',version:1,latestVersion:1,hash:'a'.repeat(64),ownerId:'owner',visibility:'private',package:pkg},calls=[]
 const html=value=>`<div class="native-deck" data-canvas-width="1600" data-canvas-height="900"><div data-layout-slot="body">${value}</div></div>`
 const request=async(path,options={})=>{calls.push({path,...options});if(path==='/me')return {id:'owner'};if(path==='/layout-library')return {resources:[resource]};if(path==='/layout-library/conversations')return {conversations:[]};if(path==='/layout-library/reference-config')return {configured:false};if(path==='/layout-library/11111111-1111-4111-8111-111111111111/1')return structuredClone(resource);if(path==='/layout-library/preview')return {html:html('示例')};if(path==='/projects/22222222-2222-4222-8222-222222222222/layout-editorial-preview'){if(editorialResponse)return editorialResponse(options);return {experimental:true,html:html('只读实验真实内容'),draftId:options.body.draftId,pageId:options.body.pageId,resourceId:resource.id,version:resource.version,sourceHash:resource.hash,sourceLayoutId:options.body.layoutId,fallback:true,typography:{body:{fontSize:22}}}};if(path==='/projects/22222222-2222-4222-8222-222222222222/layout-preview'){if(projectResponse)return projectResponse(options);return {html:html('当前页实际内容 '+options.body.overrides.layoutId),draftId:'33333333-3333-4333-8333-333333333333',pageId:'page'}};throw Error('unexpected '+path)}
 const ui=mountLayoutLibrary({request,notify:()=>{}});t.after(()=>{ui.dispose();dom.window.close();delete globalThis.document;delete globalThis.window})
 return {dom,ui,calls,resource}
}
test('project library matrix and large preview use current page while ordinary library stays sample',async t=>{
 const f=await fixture(t),context={projectId:'22222222-2222-4222-8222-222222222222',draftId:'33333333-3333-4333-8333-333333333333',pageId:'page'}
 await f.ui.open({resourceId:'11111111-1111-4111-8111-111111111111',version:1,previewContext:context,isPreviewCurrent:()=>true});await tick()
 assert.equal(document.querySelector('[data-ll-status]').textContent,'');assert.match(document.querySelector('[data-preview-mode]').textContent,/当前页.*未保存/)
 assert(f.calls.some(c=>c.path==='/projects/22222222-2222-4222-8222-222222222222/layout-preview'));assert(!f.calls.some(c=>c.path==='/layout-library/preview'))
 assert.match(document.querySelector('.ll-preview-host').shadowRoot.textContent,/当前页实际内容/)
 document.querySelector('[data-layout-open]').click();await tick();assert.match(document.querySelector('.ll-large-preview .ll-preview-host').shadowRoot.textContent,/当前页实际内容/);assert.match(document.querySelector('.ll-large-preview [data-preview-context]')?.textContent??'',/当前页.*未保存/)
 assert(f.calls.filter(c=>c.method==='POST').every(c=>c.path.endsWith('/layout-preview')))
 f.calls.length=0;await f.ui.open({resourceId:'11111111-1111-4111-8111-111111111111',version:1});await tick();assert.match(document.querySelector('[data-preview-mode]').textContent,/示例/);assert(f.calls.some(c=>c.path==='/layout-library/preview'))
})
test('unsaved resource edits do not silently preview the old saved version with real contents',async t=>{
 const f=await fixture(t);await f.ui.open({resourceId:'11111111-1111-4111-8111-111111111111',version:1,previewContext:{projectId:'22222222-2222-4222-8222-222222222222',draftId:'33333333-3333-4333-8333-333333333333',pageId:'page'},isPreviewCurrent:()=>true});await tick();f.calls.length=0
 document.querySelector('[data-resource-name]').value='未保存修改';document.querySelector('[data-preview]').click();await tick();await tick()
 assert.equal(f.calls.filter(c=>c.path.includes('preview')).length,0);assert.match(document.querySelector('[data-preview-mode]').textContent,/先保存/)
})

test('closed current-page session aborts and cannot leak into reopened sample previews',async t=>{
 const pending=[];const f=await fixture(t,{projectResponse:options=>new Promise(resolve=>pending.push({options,resolve}))})
 await f.ui.open({resourceId:'11111111-1111-4111-8111-111111111111',version:1,previewContext:{projectId:'22222222-2222-4222-8222-222222222222',draftId:'33333333-3333-4333-8333-333333333333',pageId:'page'},isPreviewCurrent:()=>true});await tick();assert.equal(pending.length,3)
 await f.ui.open({resourceId:'11111111-1111-4111-8111-111111111111',version:1});await tick();assert(pending.every(p=>p.options.signal.aborted))
 for(const p of pending)p.resolve({html:'<div class="native-deck">泄露旧项目内容</div>',draftId:'33333333-3333-4333-8333-333333333333',pageId:'page'})
 await tick();assert.match(document.querySelector('[data-preview-mode]').textContent,/示例/);for(const p of document.querySelectorAll('.ll-preview-host')){assert(!p.shadowRoot.textContent.includes('泄露'));assert(p.shadowRoot.textContent.includes('示例'))}
})
test('JSON and invalid form edits immediately invalidate own-content thumbnails and open large preview',async t=>{
 const f=await fixture(t),options={resourceId:'11111111-1111-4111-8111-111111111111',version:1,previewContext:{projectId:'22222222-2222-4222-8222-222222222222',draftId:'33333333-3333-4333-8333-333333333333',pageId:'page'},isPreviewCurrent:()=>true}
 for(const selector of ['[data-json]','[name="titleSize"]']){
  await f.ui.open(options);await tick();document.querySelector('[data-layout-open]').click();await tick();assert(document.querySelector('.ll-large-preview'))
  const input=document.querySelector(selector);input.value=selector==='[data-json]'?'{':'9999';input.dispatchEvent(new window.Event('input',{bubbles:true}))
  assert.equal(document.querySelector('.ll-large-preview'),null);assert.equal(document.querySelector('[data-layout-open]'),null);assert.match(document.querySelector('[data-preview-mode]').textContent,/先保存/)
 }
})

test('real-content selection is gated until fit passes and binds the exact previewed layout',async t=>{
 const f=await fixture(t),choices=[];let current=true
 await f.ui.open({resourceId:'11111111-1111-4111-8111-111111111111',version:1,previewContext:{projectId:'22222222-2222-4222-8222-222222222222',draftId:'33333333-3333-4333-8333-333333333333',pageId:'page'},isPreviewCurrent:()=>current,onPick:c=>choices.push(c)})
 assert(document.querySelector('[data-use-layout]').disabled)
 for(let i=0;i<8;i++)await tick();assert.equal(document.querySelector('[data-use-layout]').disabled,false)
 document.querySelector('[data-use-layout]').click();for(let i=0;i<3;i++)await tick();assert.equal(choices.length,1);assert.equal(choices[0].layoutId,f.resource.package.layouts[0].id)
})
test('geometric overflow blocks selecting current contents rather than showing a clipped success',async t=>{
 const f=await fixture(t),choices=[];Object.defineProperty(window.HTMLElement.prototype,'scrollHeight',{get:()=>999,configurable:true})
 await f.ui.open({resourceId:'11111111-1111-4111-8111-111111111111',version:1,previewContext:{projectId:'22222222-2222-4222-8222-222222222222',draftId:'33333333-3333-4333-8333-333333333333',pageId:'page'},isPreviewCurrent:()=>true,onPick:c=>choices.push(c)})
 for(let i=0;i<8;i++)await tick();assert.match(document.querySelector('[data-preview-box]').textContent,/超出/);assert.equal(document.querySelector('.ll-preview-host'),null);const button=document.querySelector('[data-use-layout]');assert(button.disabled);button.dispatchEvent(new window.Event('click'));await tick();assert.deepEqual(choices,[]);assert.match(document.querySelector('[data-ll-status]').textContent,/完整呈现/)
})
test('missing text mappings expose a separate configure action without bypassing blocked selection',async t=>{
 const f=await fixture(t,{projectResponse:async()=>{throw Error('缺少文字组件映射。')}}),mapped=[],chosen=[];f.resource.package.layouts[0].slots=[{id:'text-a',role:'text',binding:'text-a',purpose:'body'}]
 await f.ui.open({resourceId:f.resource.id,version:1,previewContext:{projectId:'22222222-2222-4222-8222-222222222222',draftId:'33333333-3333-4333-8333-333333333333',pageId:'page'},isPreviewCurrent:()=>true,onPick:c=>chosen.push(c),onMap:c=>mapped.push(c)})
 await tick();assert(document.querySelector('[data-use-layout]').disabled);assert.match(document.querySelector('[data-configure-mapping]')?.textContent??'',/配置原文映射/)
 document.querySelector('[data-configure-mapping]').click();await tick();assert.equal(mapped.length,1);assert.equal(mapped[0].layoutId,f.resource.package.layouts[0].id);assert.deepEqual(chosen,[]);assert(!f.calls.some(c=>c.method==='POST'&&!c.path.endsWith('preview')))
})
for(const outcome of ['resolve','reject'])test(`cancelled mapping cannot close or pollute a newer session after late ${outcome}`,async t=>{
 const f=await fixture(t),waiters=[];f.resource.package.layouts[0].slots=[{id:'text-a',role:'text',binding:'text-a',purpose:'body'}]
 await f.ui.open({resourceId:f.resource.id,version:1,previewContext:{projectId:'22222222-2222-4222-8222-222222222222',draftId:'33333333-3333-4333-8333-333333333333',pageId:'page'},isPreviewCurrent:()=>true,onMap:(_choice,lifecycle)=>new Promise((resolve,reject)=>waiters.push({resolve,reject,lifecycle}))});await tick()
 document.querySelector('[data-configure-mapping]').click();await tick();assert.equal(waiters.length,1)
 await f.ui.open({resourceId:f.resource.id,version:1});await tick();assert(waiters[0].lifecycle?.signal?.aborted);assert.equal(waiters[0].lifecycle.isCurrent(),false)
 waiters[0][outcome](Error('旧映射错误'));await tick();await tick();assert(document.querySelector('[data-layout-library]'));assert.match(document.querySelector('[data-preview-mode]').textContent,/示例/);assert.equal(document.querySelector('[data-ll-status]').textContent,'')
})

test('experimental editorial action is explicit own-content preview and never grants use or saves',async t=>{
 const f=await fixture(t),choices=[];f.resource.package.schemaVersion='pre-design.layout-package.v3';
 await f.ui.open({resourceId:f.resource.id,version:1,previewContext:{projectId:'22222222-2222-4222-8222-222222222222',draftId:'33333333-3333-4333-8333-333333333333',pageId:'page'},isPreviewCurrent:()=>true,onPick:c=>choices.push(c)});await tick();
 const button=document.querySelector('[data-editorial-preview]');assert(button);button.click();await tick();assert(!f.calls.some(c=>c.path.endsWith('layout-editorial-preview')));assert.match(document.querySelector('[data-ll-status]').textContent,/确认/);
 document.querySelector('[data-style-ack]').checked=true;button.click();for(let i=0;i<8;i++)await tick();
 assert.match(document.querySelector('.ll-large-preview [data-preview-context]').textContent,/实验.*未保存/);assert.match(document.querySelector('.ll-large-preview [data-preview-context]').textContent,/22/);assert.match(document.querySelector('.ll-large-preview .ll-preview-host').shadowRoot.textContent,/只读实验真实内容/);assert.deepEqual(choices,[]);assert(f.calls.filter(c=>c.method==='POST').every(c=>c.path.endsWith('preview')));
 await f.ui.open({resourceId:f.resource.id,version:1});assert.equal(document.querySelector('[data-editorial-preview]'),null);
})
test('closing experimental preview aborts work and cannot insert private result into another session',async t=>{
 const waits=[],f=await fixture(t,{editorialResponse:options=>new Promise(resolve=>waits.push({options,resolve}))});f.resource.package.schemaVersion='pre-design.layout-package.v3';const context={projectId:'22222222-2222-4222-8222-222222222222',draftId:'33333333-3333-4333-8333-333333333333',pageId:'page'};
 await f.ui.open({resourceId:f.resource.id,version:1,previewContext:context,isPreviewCurrent:()=>true});await tick();document.querySelector('[data-style-ack]').checked=true;document.querySelector('[data-editorial-preview]').click();await tick();assert.equal(waits.length,1);
 await f.ui.open({resourceId:f.resource.id,version:1});assert(waits[0].options.signal.aborted);waits[0].resolve({experimental:true,draftId:context.draftId,pageId:context.pageId,resourceId:f.resource.id,version:1,sourceHash:f.resource.hash,sourceLayoutId:waits[0].options.body.layoutId,html:'<main>不得插入新会话的私有正文</main>'});for(let i=0;i<3;i++)await tick();assert.equal(document.querySelector('.ll-large-preview'),null);assert(!document.body.textContent.includes('不得插入'));
})
