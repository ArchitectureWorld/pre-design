import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {mountLayoutLibrary} from '../src/layout-library/ui.js'
import {nativePackageFixture} from './fixtures/native-design-v3-fixture.mjs'
const tick=()=>new Promise(r=>setImmediate(r)),id='11111111-1111-4111-8111-111111111111'
async function setup(t,{derive,getNext}={}){
 const dom=new JSDOM('<div class="top-right"></div>');globalThis.document=dom.window.document;globalThis.window=dom.window;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false}
 const pkg=await nativePackageFixture(),base={id,version:1,latestVersion:1,hash:'a'.repeat(64),ownerId:'owner',visibility:'private',package:pkg},next={...structuredClone(base),version:2,latestVersion:2,hash:'b'.repeat(64)},calls=[]
 next.package.layouts.push({...structuredClone(pkg.layouts[0]),id:'style-adaptation-1',label:'无图简要（平台风格重设计）'})
 next.package.designProfile.evidence.push({id:'resource-style-derived-v1',provenance:'user'})
 const request=async(path,options={})=>{calls.push({path,...options});if(path==='/me')return{id:'owner'};if(path==='/layout-library')return{resources:[base]};if(path==='/layout-library/conversations')return{conversations:[]};if(path==='/layout-library/reference-config')return{configured:false};if(path===`/layout-library/${id}/1`)return structuredClone(base);if(path===`/layout-library/${id}/2`)return getNext?getNext(next):structuredClone(next);if(path.endsWith('/derive-style-adaptation'))return derive?derive(options):{id,version:2,hash:next.hash,derived:true};if(path==='/layout-library/preview')return{html:'<div class="native-deck">示例</div>'};throw Error('unexpected '+path)}
 const ui=mountLayoutLibrary({request,notify:()=>{}});t.after(()=>{ui.dispose();dom.window.close();delete globalThis.document;delete globalThis.window});await ui.open({resourceId:id,version:1});await tick();const consent=document.querySelector('[data-style-ack]');if(consent)consent.checked=true;return{ui,calls,base,next}
}
test('explicit action creates same-resource draft version and previews new variant without publishing or applying',async t=>{
 const f=await setup(t);assert(document.querySelector('[data-derive-style]'));document.querySelector('[data-derive-style]').click();for(let i=0;i<5;i++)await tick()
 const call=f.calls.find(c=>c.path.endsWith('/derive-style-adaptation'));assert(call);assert.equal(call.body.expectedHash,f.base.hash);assert.equal(call.body.strategyVersion,1);assert.equal(call.body.styleAcknowledged,true);assert(!('source'in call.body));assert(!('package'in call.body));assert(!('analysis'in call.body));assert.match(document.querySelector('[data-ll-status]').textContent,/V2.*未发布/);assert.equal(document.querySelector('[data-layout]').value,'style-adaptation-1');assert(!f.calls.some(c=>/publish|bindings/.test(c.path)))
})
test('unsaved edit never submits sparse derivation',async t=>{const f=await setup(t);document.querySelector('[data-resource-name]').value='未保存';document.querySelector('[data-derive-style]').click();await tick();assert(!f.calls.some(c=>c.path.endsWith('/derive-style-adaptation')));assert.match(document.querySelector('[data-ll-status]').textContent,/先保存/)})
test('late completed derivation does not reopen or replace a newly opened library',async t=>{
 let finish;const f=await setup(t,{derive:()=>new Promise(resolve=>{finish=resolve})});document.querySelector('[data-derive-style]').click();await tick();await f.ui.open({resourceId:id,version:1});finish({id,version:2,hash:'b'.repeat(64),derived:true});for(let i=0;i<4;i++)await tick();assert.equal(document.querySelector('[data-history]').value,'1');assert(!f.calls.some(c=>c.path===`/layout-library/${id}/2`))
})
test('pending derivation locks unsaved-edit controls and restores them on failure',async t=>{
 let fail;const f=await setup(t,{derive:()=>new Promise((_,reject)=>{fail=reject})});document.querySelector('[data-derive-style]').click();await tick();assert.equal(document.querySelector('[data-resource-name]').disabled,true);assert.equal(document.querySelector('[data-json]').disabled,true);assert.equal(document.querySelector('[data-derive-style]').disabled,true);fail(Error('没有可信分析'));for(let i=0;i<3;i++)await tick();assert.equal(document.querySelector('[data-resource-name]').disabled,false);assert.equal(document.querySelector('[data-history]').value,'1');assert.match(document.querySelector('[data-ll-status]').textContent,/可信分析/)
})

test('editor stays locked through delayed version retrieval, then unlocks on saved draft',async t=>{
 let finish;const f=await setup(t,{getNext:next=>new Promise(resolve=>{finish=()=>resolve(next)})});document.querySelector('[data-derive-style]').click();await tick();assert.equal(typeof finish,'function');assert.equal(document.querySelector('[data-resource-name]').disabled,true);assert.equal(document.querySelector('[data-json]').disabled,true);finish();for(let i=0;i<5;i++)await tick();assert.equal(document.querySelector('[data-history]').value,'2');assert.equal(document.querySelector('[data-resource-name]').disabled,false)
})

test('style redesign requires separate explicit acknowledgement and does not call trusted observation endpoint',async t=>{const f=await setup(t);const consent=document.querySelector('[data-style-ack]');assert(consent);assert.match(consent.parentElement.textContent,/不是.*原.*恢复/);consent.checked=false;document.querySelector('[data-derive-style]').click();await tick();assert(!f.calls.some(c=>c.path.endsWith('/derive-style-adaptation')));assert.match(document.querySelector('[data-ll-status]').textContent,/确认/);assert(!f.calls.some(c=>c.path.endsWith('/derive-sparse-cards')))})

test('saved style variant exposes rename but does not offer unsupported design or rights edits',async t=>{await setup(t);document.querySelector('[data-derive-style]').click();for(let i=0;i<5;i++)await tick();assert.equal(document.querySelector('[data-resource-name]').disabled,false);for(const el of document.querySelector('[data-editor]').elements)assert.equal(el.disabled,true);assert.match(document.querySelector('[data-style-edit-limit]').textContent,/仅支持改名.*颜色和结构/);assert.equal(document.querySelector('[data-save]').disabled,false)})
