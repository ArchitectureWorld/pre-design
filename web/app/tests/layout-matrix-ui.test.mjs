import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
const tick=()=>new Promise(r=>setImmediate(r))
const html=id=>`<style></style><div class="native-deck" data-canvas-width="1600" data-canvas-height="900"><div>${id}</div></div>`
test('all cards render distinct real previews and support selection and accessible open',async()=>{
 const {mountLayoutMatrix}=await import('../src/layout-library/matrix-ui.js'),dom=new JSDOM('<main/>'),root=dom.window.document.querySelector('main'),selected=[],opened=[]
 const ui=mountLayoutMatrix(root,{layouts:[{id:'a',label:'甲'},{id:'b',label:'乙'}],renderPreview:async id=>({html:html(id)}),onSelect:id=>selected.push(id),onOpen:id=>opened.push(id)})
 await tick();assert.equal(root.querySelectorAll('[data-layout-card]').length,2)
 const cards=[...root.querySelectorAll('[data-layout-card]')];assert.match(cards[0].querySelector('.ll-preview-host').shadowRoot.textContent,/a/);assert.match(cards[1].querySelector('.ll-preview-host').shadowRoot.textContent,/b/)
 cards[1].querySelector('[data-layout-select]').click();assert.deepEqual(selected,['b']);cards[1].dispatchEvent(new dom.window.MouseEvent('dblclick',{bubbles:true}));assert.deepEqual(opened,['b'])
 cards[0].querySelector('[data-layout-open]').click();assert.deepEqual(opened,['b','a']);ui.dispose();dom.window.close()
})
test('disposal aborts pending work and prevents stale response mounting',async()=>{
 const {mountLayoutMatrix}=await import('../src/layout-library/matrix-ui.js'),dom=new JSDOM('<main/>'),root=dom.window.document.querySelector('main');let done,signal
 const ui=mountLayoutMatrix(root,{layouts:[{id:'a',label:'甲'}],renderPreview:(_,{signal:s})=>{signal=s;return new Promise(r=>done=r)}});await tick();ui.dispose();assert(signal.aborted);done({html:html('stale')});await tick();assert.equal(root.querySelector('.ll-preview-host'),null);dom.window.close()
})
test('large preview closes and restores focus without late response leaking',async()=>{
 const {openLayoutPreview}=await import('../src/layout-library/matrix-ui.js'),dom=new JSDOM('<button id="origin">打开</button>'),doc=dom.window.document
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false}
 let done;const origin=doc.querySelector('button'),ui=openLayoutPreview({document:doc,layout:{id:'a',label:'甲'},renderPreview:()=>new Promise(r=>done=r),returnFocus:origin});await tick();doc.querySelector('dialog button').click();done({html:html('late')});await ui.ready;assert.equal(doc.querySelector('dialog'),null);assert.equal(doc.activeElement,origin);dom.window.close()
})
test('preview concurrency is bounded and queued work never starts after dispose',async()=>{const {mountLayoutMatrix}=await import('../src/layout-library/matrix-ui.js'),dom=new JSDOM('<main/>');let count=0;const ui=mountLayoutMatrix(dom.window.document.querySelector('main'),{layouts:Array.from({length:12},(_,i)=>({id:String(i),label:String(i)})),renderPreview:()=>{count++;return new Promise(()=>{})}});assert.equal(count,3);ui.dispose();await tick();assert.equal(count,3);dom.window.close()})
test('native component selection preserves stable slot identity',async()=>{const {mountNativePreview}=await import('../src/layout-library/preview-ui.js'),dom=new JSDOM('<main/>');let selected;const ui=mountNativePreview(dom.window.document.querySelector('main'),'<div class="native-deck"><div data-layout="a"><div data-layout-slot="body" data-layout-slot-id="card-heading">正文</div></div></div>',{onSelect:value=>selected=value});ui.host.shadowRoot.querySelector('[data-layout-slot]').click();assert.deepEqual(selected,{layoutId:'a',slot:'body',slotId:'card-heading'});ui.dispose();dom.window.close()})
