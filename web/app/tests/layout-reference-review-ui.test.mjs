import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {mountNativePreview} from '../src/layout-library/preview-ui.js'

test('参考页面预览按真实画布比例缩放，竖版不会被16:9裁掉',()=>{
 const dom=new JSDOM('<div id="preview"></div>'),box=dom.window.document.querySelector('#preview')
 Object.defineProperty(box,'clientWidth',{value:600})
 const preview=mountNativePreview(box,'<html><style></style><body><main class="native-deck" data-canvas-width="1200" data-canvas-height="1000"><article data-native-page="one">示例</article></main></body></html>')
 try{assert.equal(preview.host.style.width,'1200px');assert.equal(preview.host.style.height,'1000px');assert.equal(box.style.aspectRatio,'1200 / 1000');assert.equal(preview.host.style.transform,'scale(0.5)')}
 finally{preview.dispose();dom.window.close()}
})

import {openReferenceReview} from '../src/layout-library/review-ui.js'
import {compositionPackage} from './fixtures/composition.mjs'
const settle=async fn=>{for(let i=0;i<80;i++){if(fn())return;await new Promise(r=>setImmediate(r))}assert(fn(),'界面未到达预期状态')}
test('对照界面必须逐类查看后才能确认，源页与试排并列并明确为合成内容',async t=>{
 const dom=new JSDOM('<body></body>'),document=dom.window.document,posted=[]
 document.defaultView.HTMLDialogElement.prototype.showModal=function(){this.open=true};document.defaultView.HTMLDialogElement.prototype.close=function(){this.open=false}
 const p=compositionPackage();p.layouts.push({...p.layouts[0],id:'mixed-second',label:'另一种页面'})
 const resource={id:'resource',version:1,hash:'a'.repeat(64),package:p,validation:{status:'passed'}}
 let confirmed=0
 const request=async(path,options)=>{
  if(path.endsWith('/compare'))return {receipt:{id:'comparison-'+options.body.layoutId},source:{name:'参考.pdf',page:12,dataUrl:'data:image/png;base64,AA=='},html:'<main class="native-deck" data-canvas-width="1200" data-canvas-height="1000"><article>合成试排</article></main>'}
  posted.push(options.body);return {status:'confirmed'}
 }
 const ui=openReferenceReview({document,request,resource,onConfirmed:()=>confirmed++});t.after(()=>{ui.dispose();dom.window.close()});await ui.ready
 assert.match(document.querySelector('[data-source-title]').textContent,/第 12 页/)
 assert.match(document.querySelector('.ll-review-pair').textContent,/合成内容/)
 const checkbox=document.querySelector('[data-review-accepted]');checkbox.checked=true;checkbox.dispatchEvent(new dom.window.Event('change'))
 assert.equal(document.querySelector('[data-review-confirm]').disabled,true)
 const select=document.querySelector('[data-review-layout]');select.value='mixed-second';select.dispatchEvent(new dom.window.Event('change'))
 await settle(()=>!document.querySelector('[data-review-confirm]').disabled)
 document.querySelector('[data-review-confirm]').click();await settle(()=>confirmed===1)
 assert.deepEqual(posted[0].comparisonIds,['comparison-mixed','comparison-mixed-second']);assert.equal(posted[0].packageHash,resource.hash)
})

test('对照初始化尚未完成时关闭界面会取消请求，不留下孤立弹窗',async()=>{
 const dom=new JSDOM('<body></body>'),document=dom.window.document
 document.defaultView.HTMLDialogElement.prototype.showModal=function(){this.open=true};document.defaultView.HTMLDialogElement.prototype.close=function(){this.open=false}
 let finish,signal,loads=0
 const request=async(path,options)=>{signal=options.signal;loads++;return new Promise(resolve=>{finish=resolve})}
 const ui=openReferenceReview({document,request,resource:{id:'resource',version:1,package:compositionPackage(),validation:null}})
 ui.dispose();assert.equal(signal.aborted,true);assert.equal(document.querySelector('dialog'),null)
 finish({status:'passed'});await ui.ready;assert.equal(loads,1);dom.window.close()
})
