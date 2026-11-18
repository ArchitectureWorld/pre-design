import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {mountNativePreview,verifyNativePreviewFit} from '../src/layout-library/preview-ui.js'
function setup(t,{overflow=false,image=false}={}){
 const dom=new JSDOM('<div id="box"></div>',{pretendToBeVisual:true});t.after(()=>dom.window.close());const doc=dom.window.document
 Object.defineProperty(doc,'fonts',{value:{ready:Promise.resolve(),[Symbol.iterator]:function*(){}}})
 const mounted=mountNativePreview(doc.querySelector('#box'),`<div class="native-deck"><div data-layout-slot="text">synthetic</div>${image?'<img src="synthetic.png">':''}</div>`);t.after(()=>mounted.dispose())
 const slot=mounted.host.shadowRoot.querySelector('[data-layout-slot]');for(const[k,v]of Object.entries({clientWidth:48,clientHeight:45,scrollWidth:overflow?64:48,scrollHeight:overflow?1149:45}))Object.defineProperty(slot,k,{value:v,configurable:true})
 return {dom,doc,host:mounted.host,slot}
}
test('fits only after fonts images and two frames settle',async t=>{
 const {host,doc,dom}=setup(t,{image:true});let fontsDone=false,decoded=false,frames=0
 doc.fonts.ready=Promise.resolve().then(()=>{fontsDone=true});const img=host.shadowRoot.querySelector('img');img.decode=async()=>{decoded=true};Object.defineProperty(img,'naturalWidth',{value:20});Object.defineProperty(img,'naturalHeight',{value:20})
 const original=dom.window.requestAnimationFrame.bind(dom.window);dom.window.requestAnimationFrame=cb=>original(ts=>{frames++;cb(ts)})
 await verifyNativePreviewFit(host);assert(fontsDone&&decoded);assert.equal(frames,2)
})
test('rejects clipped text at actual scroll metrics rather than slot metadata',async t=>{
 const {host}=setup(t,{overflow:true});await assert.rejects(verifyNativePreviewFit(host),e=>e.code==='NATIVE_PREVIEW_FIT'&&/超出/.test(e.message))
})
test('rejects unreadable zero dimensions and missing slots',async t=>{
 const {host,slot}=setup(t);Object.defineProperty(slot,'clientWidth',{value:0});await assert.rejects(verifyNativePreviewFit(host));slot.remove();await assert.rejects(verifyNativePreviewFit(host))
})
test('font and image failures reject instead of counting as fit',async t=>{
 const {host,doc}=setup(t,{image:true}),img=host.shadowRoot.querySelector('img');img.decode=async()=>{throw Error('broken')};await assert.rejects(verifyNativePreviewFit(host),/图片/)
 img.remove();doc.fonts.ready=Promise.reject(Error('font failure'));await assert.rejects(verifyNativePreviewFit(host),/字体/)
 doc.fonts.ready=Promise.resolve();doc.fonts[Symbol.iterator]=function*(){yield{status:'error'}};await assert.rejects(verifyNativePreviewFit(host),/字体/)
})
test('abort stops bounded waiting and removes listener and timer',async t=>{
 const {host,doc,dom}=setup(t);doc.fonts.ready=new Promise(()=>{});const c=new AbortController();let added=0,removed=0,cleared=0;const add=c.signal.addEventListener.bind(c.signal),remove=c.signal.removeEventListener.bind(c.signal),clear=dom.window.clearTimeout.bind(dom.window)
 c.signal.addEventListener=(...args)=>{added++;return add(...args)};c.signal.removeEventListener=(...args)=>{removed++;return remove(...args)};dom.window.clearTimeout=id=>{cleared++;clear(id)}
 const pending=verifyNativePreviewFit(host,{signal:c.signal});c.abort();await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(added,removed);assert(cleared>0)
 await assert.rejects(verifyNativePreviewFit(host,{signal:c.signal}),e=>e.name==='AbortError')
})
test('timeout rejects a stuck font wait without unbounded background frames',async t=>{
 const {host,doc,dom}=setup(t);doc.fonts.ready=new Promise(()=>{});dom.window.setTimeout=callback=>setTimeout(callback,0);dom.window.clearTimeout=clearTimeout
 await assert.rejects(verifyNativePreviewFit(host),/超时/)
})
test('allows at most two pixels of rounding tolerance',async t=>{
 const {host,slot}=setup(t);Object.defineProperty(slot,'scrollWidth',{value:50,configurable:true});Object.defineProperty(slot,'scrollHeight',{value:47});await verifyNativePreviewFit(host)
 Object.defineProperty(slot,'scrollWidth',{value:51});await assert.rejects(verifyNativePreviewFit(host),/超出/)
})
