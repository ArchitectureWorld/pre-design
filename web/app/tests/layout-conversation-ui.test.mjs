import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {mountLayoutConversation} from '../src/layout-library/conversation-ui.js'
import {mountLayoutLibrary} from '../src/layout-library/ui.js'
import {createPackage} from '../src/layout-library/contract.mjs'
const settle=async fn=>{for(let i=0;i<60;i++){if(fn())return;await new Promise(r=>setImmediate(r))}assert(fn(),'异步界面未达到预期状态')}
function input(dom,element,text){element.value=text;element.dispatchEvent(new dom.window.Event('input',{bubbles:true}))}

test('提交等待期间切换会话，旧回调不锁住新会话',async t=>{
 const dom=new JSDOM('<aside></aside>'),gate=Promise.withResolvers(),posted=Promise.withResolvers()
 const request=async(path,options={})=>{
  if(path.endsWith('reference-config'))return {configured:true,modelName:'配置模型'}
  if(options.method==='POST'){posted.resolve();return gate.promise}
  return {id:path.split('/').at(-1),turns:[],resource:null}
 }
 const ui=mountLayoutConversation({container:dom.window.document.querySelector('aside'),request,notify(){},getContext:()=>({name:'版式'}),onResource(){},onImport(){}})
 t.after(()=>{ui.dispose();dom.window.close()})
 const field=dom.window.document.querySelector('textarea'),send=dom.window.document.querySelector('[data-layout-send]')
 input(dom,field,'修改标题');await settle(()=>!send.disabled);send.click();await posted.promise
 await ui.select('B');input(dom,field,'新会话内容');assert.equal(send.disabled,false)
 gate.resolve({id:'old-job',conversationId:'A'});await settle(()=>!ui.busy)
 assert.equal(field.value,'新会话内容');assert.equal(ui.id,'B')
})

test('提交等待期间的新文字、引用和待发送文件得到保留',async t=>{
 const dom=new JSDOM('<aside></aside>'),gate=Promise.withResolvers(),posted=Promise.withResolvers()
 const request=async(path,options={})=>{
  if(path.endsWith('reference-config'))return {configured:true,modelName:'配置模型'}
  if(path.endsWith('reference-files'))return {id:'00000000-0000-4000-8000-000000000001',name:'补充.md',summary:'已读取参考',hasImages:false}
  if(options.method==='POST'){posted.resolve();return gate.promise}
  return {id:'A',turns:[{id:'j',text:'原消息',status:'completed',result:{reply:'收到。'}}],resource:null}
 }
 const ui=mountLayoutConversation({container:dom.window.document.querySelector('aside'),request,notify(){},getContext:()=>({name:'版式'}),onResource(){},onImport(){}})
 t.after(()=>{ui.dispose();dom.window.close()})
 const document=dom.window.document,field=document.querySelector('textarea')
 input(dom,field,'原消息');await settle(()=>!document.querySelector('[data-layout-send]').disabled);document.querySelector('[data-layout-send]').click();await posted.promise
 input(dom,field,'下一条意见');ui.focusSelection({layoutId:'points',slot:'title'})
 const picker=document.querySelector('[data-chat-file]'),file={name:'补充.md',size:8,arrayBuffer:async()=>new TextEncoder().encode('补充参考内容').buffer}
 Object.defineProperty(picker,'files',{configurable:true,value:[file]});picker.dispatchEvent(new dom.window.Event('change'))
 await settle(()=>document.querySelector('[data-chat-files]').textContent.includes('补充.md'))
 gate.resolve({id:'j',conversationId:'A'});await settle(()=>!ui.busy)
 assert.equal(field.value,'下一条意见');assert.match(document.querySelector('[data-chat-selection]').textContent,/标题/)
 assert(document.querySelector('[data-remove-file]'),'新附件应仍待发送')
})

test('无成果会话不携带上一份版式，历史下拉保持所选版本',async t=>{
 const dom=new JSDOM('<div class="top-right"></div>',{url:'http://localhost'}),document=dom.window.document
 const prior={document:globalThis.document,window:globalThis.window};globalThis.document=document;globalThis.window=dom.window
 document.defaultView.HTMLDialogElement.prototype.showModal=function(){this.open=true};document.defaultView.HTMLDialogElement.prototype.close=function(){this.open=false}
 const pkg=createPackage('版式A'),old={...pkg,theme:{...pkg.theme,accent:'#111111'}}
 const resource=version=>({id:'A',version,latestVersion:2,ownerId:'owner',visibility:'private',package:version===1?old:pkg})
 let payload
 const request=async(path,options={})=>{
  if(path==='/me')return {id:'owner',role:'user'}
  if(path==='/layout-library')return {resources:[resource(2)]}
  if(path==='/layout-library/conversations')return options.method==='POST'?(payload=options.body,{id:'new',conversationId:'B'}):{conversations:[{id:'A-thread',name:'版式A',resourceId:'A'},{id:'B',name:'失败参考',resourceId:null}]}
  if(path==='/layout-library/conversations/A-thread')return {id:'A-thread',resource:resource(2),turns:[]}
  if(path==='/layout-library/conversations/B')return {id:'B',resource:null,turns:[{id:'failed',text:'失败的参考',status:'failed',error:'未完成'}]}
  if(path==='/layout-library/reference-config')return {configured:true,modelName:'配置模型'}
  if(path==='/layout-library/preview')return {html:'<html><style></style><body><main class="native-deck"><article>预览</article></main></body></html>'}
  if(path.startsWith('/layout-library/A/'))return resource(Number(path.split('/').at(-1)))
  throw Error(path)
 }
 const ui=mountLayoutLibrary({request,notify(){}})
 t.after(()=>{ui.dispose();dom.window.close();globalThis.document=prior.document;globalThis.window=prior.window})
 await ui.open();document.querySelector('[data-resource-card]').click();await settle(()=>document.querySelector('[data-history]'))
 const history=document.querySelector('[data-history]');history.value='1';history.dispatchEvent(new dom.window.Event('change',{bubbles:true}))
 await settle(()=>document.querySelector('[name=accent]')?.value==='#111111')
 assert.equal(document.querySelector('[data-history]').value,'1')
 document.querySelector('[data-conversation=B]').click()
 await settle(()=>document.querySelector('[data-chat-messages]').textContent.includes('失败的参考'))
 assert.equal(document.querySelector('[data-resource-name]'),null)
 const text=document.querySelector('[data-layout-message]');input(dom,text,'继续分析');await settle(()=>!document.querySelector('[data-layout-send]').disabled);document.querySelector('[data-layout-send]').click()
 await settle(()=>payload);assert.equal(payload.resourceId,undefined);assert.equal(payload.package,undefined)
})

test('查看当前最新版后继续对话，左侧跟进下一版并使用最新版本提交',async t=>{
 const dom=new JSDOM('<div class="top-right"></div>',{url:'http://localhost'}),document=dom.window.document
 const prior={document:globalThis.document,window:globalThis.window};globalThis.document=document;globalThis.window=dom.window
 document.defaultView.HTMLDialogElement.prototype.showModal=function(){this.open=true};document.defaultView.HTMLDialogElement.prototype.close=function(){this.open=false}
 let version=2;const payloads=[],pkg=createPackage('连续修订'),resource=v=>({id:'A',version:v,latestVersion:version,ownerId:'owner',visibility:'private',package:{...pkg,theme:{...pkg.theme,accent:v>2?'#235740':'#111111'}}})
 const request=async(path,options={})=>{
  if(path==='/me')return {id:'owner',role:'user'}
  if(path==='/layout-library')return {resources:[resource(version)]}
  if(path==='/layout-library/conversations'){
   if(options.method==='POST'){payloads.push(options.body);version++;return {id:'j'+version,conversationId:'thread'}}
   return {conversations:[{id:'thread',name:pkg.name,resourceId:'A'}]}
  }
  if(path==='/layout-library/conversations/thread')return {id:'thread',resource:resource(version),turns:[{id:'j'+version,text:'修改',status:'completed',result:{id:'A',version,reply:'已保存'}}]}
  if(path==='/layout-library/reference-config')return {configured:true,modelName:'配置模型'}
  if(path==='/layout-library/preview')return {html:'<html><style></style><body><main class="native-deck"><article>预览</article></main></body></html>'}
  if(path.startsWith('/layout-library/A/'))return resource(Number(path.split('/').at(-1)))
  throw Error(path)
 }
 const ui=mountLayoutLibrary({request,notify(){}})
 t.after(()=>{ui.dispose();dom.window.close();globalThis.document=prior.document;globalThis.window=prior.window})
 await ui.open({resourceId:'A',version:2});document.querySelector('[data-show-version]').click()
 await settle(()=>document.querySelector('[data-history]')?.value==='2')
 input(dom,document.querySelector('[data-layout-message]'),'改墨绿');await settle(()=>!document.querySelector('[data-layout-send]').disabled);document.querySelector('[data-layout-send]').click()
 await settle(()=>document.querySelector('[data-history]')?.value==='3')
 input(dom,document.querySelector('[data-layout-message]'),'继续调整');await settle(()=>!document.querySelector('[data-layout-send]').disabled);document.querySelector('[data-layout-send]').click()
 await settle(()=>payloads.length===2);assert.equal(payloads[1].resourceVersion,3)
})

test('PDF显示真实上传百分比、解析与分析阶段，切换会话可取消未完成上传',async t=>{
 const dom=new JSDOM('<aside></aside>'),document=dom.window.document,uploaded=Promise.withResolvers(),gate=Promise.withResolvers();let progress,signal,submissions=0
 const request=async(path,options={})=>{
  if(path.endsWith('reference-config'))return {configured:true,vision:{configured:true}}
  if(path.endsWith('reference-files')){progress=options.onUploadProgress;signal=options.signal;uploaded.resolve();return Promise.race([gate.promise,new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('取消','AbortError')),{once:true}))])}
  if(options.method==='POST'){submissions++;return {id:'job',conversationId:'A'}}
  return {id:path.split('/').at(-1),turns:[],resource:null}
 }
 const ui=mountLayoutConversation({container:document.querySelector('aside'),request,notify(){},getContext:()=>({}),onResource(){},onImport(){}})
 t.after(()=>{ui.dispose();dom.window.close()})
 const picker=document.querySelector('[data-chat-file]');assert.match(picker.accept,/\.pdf/);assert.match(picker.accept,/\.jpeg/);assert.match(picker.accept,/\.docx/)
 Object.defineProperty(picker,'files',{value:[{name:'参考.pdf',size:8,arrayBuffer:async()=>new Uint8Array(8).buffer}]});picker.dispatchEvent(new dom.window.Event('change'))
 await uploaded.promise;progress({phase:'uploading',loaded:20,total:80})
 assert.equal(document.querySelector('[data-upload-row] progress').value,25);assert.match(document.querySelector('[data-upload-state]').textContent,/25%/)
 progress({phase:'parsing'});assert.equal(document.querySelector('[data-upload-row] progress').hasAttribute('value'),false);assert.match(document.querySelector('[data-upload-state]').textContent,/解析/)
 assert.equal(submissions,0,'解析完成前不能启动分析')
 await ui.select('B');assert.equal(signal.aborted,true);gate.resolve({id:'late-file',name:'参考.pdf',hasImages:true});await settle(()=>!ui.busy)
 assert.equal(document.querySelector('[data-upload-row]'),null);assert.equal(submissions,0);assert.equal(ui.id,'B')
})

test('解析失败保留可重试文件，成功后只提交服务器文件ID并显示分析活动',async t=>{
 const dom=new JSDOM('<aside></aside>'),document=dom.window.document;let uploads=0,sent
 const request=async(path,options={})=>{
  if(path.endsWith('reference-config'))return {configured:true,vision:{configured:true}}
  if(path.endsWith('reference-files')){uploads++;if(uploads===1)throw Object.assign(Error('解析失败，请重试'),{status:400});return {id:'00000000-0000-4000-8000-000000000002',name:'参考.png',summary:'已读取图片',hasImages:true}}
  if(options.method==='POST'){sent=options.body;return {id:'job',conversationId:'A'}}
  return {id:'A',referenceFiles:[{id:'00000000-0000-4000-8000-000000000002',name:'参考.png',hasImages:true}],turns:[{id:'job',text:'分析图片',status:'running',progress:{label:'正在生成回复'},startedAt:new Date().toISOString()}],resource:null}
 }
 const ui=mountLayoutConversation({container:document.querySelector('aside'),request,notify(){},getContext:()=>({}),onResource(){},onImport(){}})
 t.after(()=>{ui.dispose();dom.window.close()})
 const picker=document.querySelector('[data-chat-file]');Object.defineProperty(picker,'files',{value:[{name:'参考.png',size:8,arrayBuffer:async()=>new Uint8Array(8).buffer}]});picker.dispatchEvent(new dom.window.Event('change'))
 await settle(()=>document.querySelector('[data-retry-upload]'));assert.equal(sent,undefined)
 document.querySelector('[data-retry-upload]').click();await settle(()=>sent&&document.querySelector('[data-model-progress]').hidden===false)
 assert.deepEqual(sent.files,[{id:'00000000-0000-4000-8000-000000000002'}]);assert.equal(uploads,2)
 assert.equal(document.querySelector('[data-model-progress]').hasAttribute('value'),false,'模型没有伪造百分比')
})

test('同名不同ID参考均显示并保留各自原件下载入口',async t=>{
 const dom=new JSDOM('<aside></aside>'),files=[{id:'one',name:'image.png',hasImages:true},{id:'two',name:'image.png',hasImages:true}]
 const ui=mountLayoutConversation({container:dom.window.document.querySelector('aside'),request:async path=>path.endsWith('reference-config')?{configured:true,vision:{configured:true}}:{id:'A',referenceFiles:files,turns:[]},notify(){},getContext:()=>({}),onResource(){},onImport(){}})
 t.after(()=>{ui.dispose();dom.window.close()});await ui.select('A')
 assert.deepEqual([...dom.window.document.querySelectorAll('[data-download-reference]')].map(el=>el.dataset.downloadReference),['one','two'])
})

test('取消仍在读取预览的原生导入，不应用其版式，并继续同批后续文件',async t=>{
 const dom=new JSDOM('<div class="top-right"></div>',{url:'http://localhost'}),document=dom.window.document,gate=Promise.withResolvers(),started=Promise.withResolvers()
 const prior={document:globalThis.document,window:globalThis.window};globalThis.document=document;globalThis.window=dom.window
 document.defaultView.HTMLDialogElement.prototype.showModal=function(){this.open=true};document.defaultView.HTMLDialogElement.prototype.close=function(){this.open=false}
 const pkg=createPackage('已取消的版式');let uploads=0,generated
 const request=async(path,options={})=>{
  if(path==='/me')return {id:'owner',role:'user'}
  if(path==='/layout-library')return {resources:[]}
  if(path==='/layout-library/conversations')return options.method==='POST'?(generated=options.body,{id:'j',conversationId:'A'}):{conversations:[]}
  if(path==='/layout-library/conversations/A')return {id:'A',referenceFiles:[],turns:[{id:'j',text:'分析',status:'completed',result:{reply:'已收悉'}}]}
  if(path==='/layout-library/reference-config')return {configured:true,vision:{configured:true}}
  if(path==='/layout-library/import')return {id:'native',version:1}
  if(path==='/layout-library/native/1'){started.resolve();await gate.promise;return {id:'native',version:1,latestVersion:1,ownerId:'owner',package:pkg}}
  if(path==='/layout-library/preview')return {html:'<html><style></style><body><main class="native-deck"><article>预览</article></main></body></html>'}
  if(path==='/layout-library/reference-files'){uploads++;return {id:'00000000-0000-4000-8000-000000000003',name:'随后.png',hasImages:true,summary:'已解析'}}
  throw Error(path)
 }
 const ui=mountLayoutLibrary({request,notify(){}});t.after(()=>{ui.dispose();dom.window.close();globalThis.document=prior.document;globalThis.window=prior.window})
 await ui.open();const picker=document.querySelector('[data-chat-file]'),file=name=>({name,size:8,arrayBuffer:async()=>new Uint8Array(8).buffer})
 Object.defineProperty(picker,'files',{value:[file('参考.json'),file('随后.png')]});picker.dispatchEvent(new dom.window.Event('change'));await started.promise
 document.querySelector('[data-remove-upload]').click();gate.resolve()
 await settle(()=>uploads===1&&generated)
 assert.equal(document.querySelector('[data-resource-name]'),null,'取消的导入不能替换左侧成果')
 assert.equal(generated.resourceId,undefined);assert.equal(generated.package,undefined)
})
