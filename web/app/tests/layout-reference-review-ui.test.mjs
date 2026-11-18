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

test('表格槽提示仅说明模板重建与合成数据，不冒称源PDF单元格或合并关系已提取',async t=>{
 const dom=new JSDOM('<body></body>'),document=dom.window.document
 document.defaultView.HTMLDialogElement.prototype.showModal=function(){this.open=true};document.defaultView.HTMLDialogElement.prototype.close=function(){this.open=false}
 const p=compositionPackage();p.layouts.push({...p.layouts[0],id:'no-table',label:'无表格',slots:p.layouts[0].slots.filter(s=>s.role!=='table')})
 const paths=[]
 const request=async(path,options)=>{paths.push(path);return {receipt:{id:'compare-'+options.body.layoutId},source:{name:'参考.pdf',page:13,dataUrl:'data:image/png;base64,AA=='},html:'<main class="native-deck" data-canvas-width="1200" data-canvas-height="1000"><article>合成试排</article></main>'}}
 const ui=openReferenceReview({document,request,resource:{id:'test',version:1,package:p,validation:{status:'passed'}}});t.after(()=>{ui.dispose();dom.window.close()});await ui.ready
 const note=document.querySelector('[data-review-table-status]')
 assert(note,'缺少模板与源数据区别提示');assert.equal(note.hidden,false)
 assert.match(note.textContent,/可编辑模板表格.*重建结构/)
 assert.match(note.textContent,/合成数据/)
 assert.match(note.textContent,/不表示已从源参考稿提取单元格文本、数值或合并关系/)
 assert.match(document.querySelector('.ll-profile-summary').textContent,/模板表格行容量/)
 assert.equal(paths.length,1);assert(paths[0].endsWith('/compare'))
 const select=document.querySelector('[data-review-layout]');select.value='no-table';select.dispatchEvent(new dom.window.Event('change'));assert.equal(note.hidden,true)
 select.value='mixed';select.dispatchEvent(new dom.window.Event('change'));assert.equal(note.hidden,false)
 assert.doesNotMatch(note.textContent,/原稿.*单图|已识别原生表格/)
})

test('没有设计profile也按实际table槽提示，迟到对照响应不能改回已切换布局的提示',async t=>{
 const dom=new JSDOM('<body></body>'),document=dom.window.document
 document.defaultView.HTMLDialogElement.prototype.showModal=function(){this.open=true};document.defaultView.HTMLDialogElement.prototype.close=function(){this.open=false}
 const p=compositionPackage();delete p.designProfile;p.schemaVersion='pre-design.layout-package.v3';p.layouts.push({...p.layouts[0],id:'plain',slots:p.layouts[0].slots.filter(s=>s.role!=='table')})
 const response=id=>({receipt:{id},source:null,html:'<main class="native-deck" data-canvas-width="1200" data-canvas-height="1000"><article>合成试排</article></main>'}),pending=[]
 let calls=0
 const request=async()=>++calls===1?response('initial'):new Promise(resolve=>pending.push(resolve))
 const ui=openReferenceReview({document,request,resource:{id:'test',version:1,package:p,validation:{status:'passed'}}});t.after(()=>{ui.dispose();dom.window.close()});await ui.ready
 assert.equal(document.querySelector('.ll-profile-summary'),null)
 const note=document.querySelector('[data-review-table-status]'),select=document.querySelector('[data-review-layout]')
 assert.equal(note.hidden,false)
 select.value='plain';select.dispatchEvent(new dom.window.Event('change'));assert.equal(note.hidden,true)
 select.value='mixed';select.dispatchEvent(new dom.window.Event('change'));assert.equal(note.hidden,false)
 pending[1](response('current'));await settle(()=>document.querySelector('[data-review-status]').textContent.includes('页面检查通过'))
 pending[0](response('stale'));await new Promise(resolve=>setImmediate(resolve));assert.equal(note.hidden,false)
 assert.match(note.textContent,/源参考稿/);assert.doesNotMatch(note.textContent,/原生表格.*已提取|已识别.*图片/)
})

test('原生证据标明真实页且切换中清除旧来源，未采集不伪造零图像',async t=>{
 const dom=new JSDOM('<body></body>'),document=dom.window.document
 document.defaultView.HTMLDialogElement.prototype.showModal=function(){this.open=true};document.defaultView.HTMLDialogElement.prototype.close=function(){this.open=false}
 const pkg=compositionPackage();pkg.layouts.push({...pkg.layouts[0],id:'next',label:'next'})
 let resolveNext
 const ui=openReferenceReview({document,resource:{id:'x',version:1,package:pkg,validation:{status:'passed'}},request:async(_p,o)=>o.body.layoutId==='next'?new Promise(resolve=>{resolveNext=resolve}):{receipt:{id:'first'},source:{name:'source.pdf',page:13,dataUrl:'data:image/png;base64,AA==',nativeImagePlacements:{status:'available',sourceSha256:'a'.repeat(64),page:13,occurrenceCount:3,clippedOrUncertainCount:1}},html:'<main data-canvas-width="800" data-canvas-height="600"><article>sample</article></main>'}})
 t.after(()=>{ui.dispose();dom.window.close()});await ui.ready
 const evidence=document.querySelector('[data-review-native-evidence]');assert.equal(evidence.hidden,false);assert.match(evidence.textContent,/3 次图像绘制/)
 const select=document.querySelector('[data-review-layout]');select.value='next';select.dispatchEvent(new dom.window.Event('change'))
 assert.equal(evidence.hidden,true);assert.equal(document.querySelector('[data-review-source]').children.length,0)
 resolveNext({receipt:{id:'next'},source:{name:'old.pdf',page:15,dataUrl:'data:image/png;base64,AA=='},html:'<main data-canvas-width="800" data-canvas-height="600"><article>sample</article></main>'})
 await settle(()=>!evidence.hidden);assert.match(evidence.textContent,/未采集/);assert.doesNotMatch(evidence.textContent,/3 次|0 次/)
})

test('平台风格重设计对照源资源合成样例，不冒充原PDF或文字来源，切换释放双预览',async t=>{
 const dom=new JSDOM('<body></body>'),document=dom.window.document
 document.defaultView.HTMLDialogElement.prototype.showModal=function(){this.open=true};document.defaultView.HTMLDialogElement.prototype.close=function(){this.open=false}
 const pkg=compositionPackage();pkg.layouts.push({...pkg.layouts[0],id:'old',label:'原版'})
 const sample=text=>`<main class="native-deck" data-canvas-width="1200" data-canvas-height="1000"><article>${text}</article></main>`
 const ui=openReferenceReview({document,resource:{id:'x',version:2,package:pkg,validation:{status:'passed'}},request:async(_p,o)=>o.body.layoutId==='mixed'?{receipt:{id:'style'},source:null,sourceIdentity:{resourceId:'x',version:1,hash:'a'.repeat(64),layoutId:'old',name:'源资源'},sourcePreviewHtml:sample('源版式样例'),html:sample('重新设计样例')}:{receipt:{id:'old'},source:{name:'原PDF',page:15,dataUrl:'data:image/png;base64,AA=='},html:sample('原版样例')}})
 t.after(()=>{ui.dispose();dom.window.close()});await ui.ready
 assert.match(document.querySelector('[data-source-title]').textContent,/源资源.*V1.*合成/)
 assert.match(document.querySelector('[data-review-source] .ll-preview-host').shadowRoot.textContent,/源版式样例/)
 assert.match(document.querySelector('[data-review-prototype-title]').textContent,/平台重新设计.*合成/)
 assert.match(document.querySelector('[data-review-purpose]').textContent,/不是.*原.*恢复/)
 const oldSource=document.querySelector('[data-review-source]').firstElementChild
 const select=document.querySelector('[data-review-layout]');select.value='old';select.dispatchEvent(new dom.window.Event('change'));await settle(()=>document.querySelector('[data-source-title]').textContent.includes('第 15 页'))
 assert.equal(oldSource.isConnected,false);assert.equal(document.querySelector('[data-review-source] img').alt,'原参考第 15 页');assert.match(document.querySelector('[data-review-prototype-title]').textContent,/迁移试排/)
 ui.dispose();assert.equal(document.querySelector('dialog'),null)
})
