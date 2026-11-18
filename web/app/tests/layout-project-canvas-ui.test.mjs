import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {mountCanvasLayouts} from '../src/layout-library/canvas-ui.js'
import {createPackage} from '../src/layout-library/contract.mjs'
const tick=()=>new Promise(r=>setImmediate(r))
test('manual layer library choice previews and saves local resource without discarding manual overrides',async t=>{
 const dom=new JSDOM('<main><article data-node-kind="script" data-item-id="item"></article></main>');globalThis.document=dom.window.document;globalThis.window=dom.window
 const node=document.querySelector('main'),resource={id:'r',version:1,ownerId:'owner',package:createPackage()},project={id:'p',revision:1,workflow:{current:{id:'d',formatVersion:2,blocks:[{items:[{id:'item',title:'真实页面'}]}]}}},manual={'visual-page-item':{theme:{accent:'#123456'}}},calls=[],notices=[];let options
 const config={revision:0,global:null,local:{},manual},request=async(path,opts={})=>{calls.push({path,...opts});if(path==='/me')return {id:'owner'};if(path==='/layout-library')return {resources:[resource]};if(path.endsWith('/layout-bindings'))return config;if(path.endsWith('/layout-preview'))return {html:'<div class="native-deck">actual</div>'};throw Error(path)}
 const ui=mountCanvasLayouts({nodeLayer:node,viewport:node,getProject:()=>project,request,notify:x=>notices.push(x),openLibrary:async x=>{options=x},refresh:async()=>{},mutate:async()=>{}})
 t.after(()=>{ui.dispose();dom.window.close();delete globalThis.document;delete globalThis.window});ui.update();await tick();document.querySelector('[data-canvas-layout]').click();await tick();await tick()
 document.querySelector('[data-layout-layer]').value='manual';document.querySelector('[data-open-layout-library]').click();assert.deepEqual(options.previewContext,{projectId:'p',draftId:'d',pageId:'visual-page-item'});assert(options.isPreviewCurrent());await options.onPick({resourceId:'r',version:1,layoutId:'columns'})
 const save=calls.find(c=>c.method==='POST'&&c.path.endsWith('/layout-bindings'));assert.equal(save.body.scope,'local');assert.deepEqual(save.body.resource,{resourceId:'r',version:1});assert.deepEqual(config.manual,manual);assert(notices.some(n=>/本页版式.*手动覆盖/.test(n)))
 resource.package.layouts.find(l=>l.id==='columns').slots=[{id:'body-a',role:'text',binding:'body-a',purpose:'body'}]
 project.workflow.current.blocks[0].items[0].textBlocks=[{key:'body-a',text:'已有内容'}]
 config.contentSources={'visual-page-item':{sourceFingerprint:'a'.repeat(64),sources:[{source:{field:'paragraphs',index:0},quote:'原文完整段落'}]}}
 calls.length=0;await options.onMap({resourceId:'r',version:1,layoutId:'columns'});assert(document.querySelector('[data-content-mapping]'));assert.equal(calls.filter(c=>c.method==='POST'&&c.path.endsWith('/layout-bindings')).length,0)
 document.querySelector('[data-mapping-cancel]').click();assert.equal(calls.filter(c=>c.method==='POST'&&c.path.endsWith('/layout-bindings')).length,0)
 project.workflow.current.id='new';assert.equal(options.isPreviewCurrent(),false)
})
test('cancelled mapping handoff cannot mount late content or remove a newer panel',async t=>{
 const dom=new JSDOM('<main><article data-node-kind="script" data-item-id="item"></article></main>');globalThis.document=dom.window.document;globalThis.window=dom.window
 const node=document.querySelector('main'),resource={id:'r',version:1,ownerId:'owner',package:createPackage()},project={id:'p',revision:1,workflow:{current:{id:'d',formatVersion:2,blocks:[{items:[{id:'item',title:'真实页面'}]}]}}};resource.package.layouts[0].slots=[{id:'text',role:'text',binding:'text',purpose:'body'}]
 const config={revision:0,global:null,local:{},manual:{},contentSources:{'visual-page-item':{sourceFingerprint:'a'.repeat(64),sources:[{source:{field:'paragraphs',index:0},quote:'合成内容'}]}}};let options,delay=false,resolve;const calls=[]
 const request=async(path,opts={})=>{calls.push({path,...opts});if(path==='/me')return{id:'owner'};if(path==='/layout-library'){if(delay){delay=false;return new Promise(r=>{resolve=()=>r({resources:[resource]})})}return{resources:[resource]}}if(path.endsWith('/layout-bindings'))return config;if(path.endsWith('/layout-preview'))return{html:'<div class="native-deck">synthetic</div>'};throw Error(path)}
 const ui=mountCanvasLayouts({nodeLayer:node,viewport:node,getProject:()=>project,request,notify:()=>{},openLibrary:async value=>{options=value},refresh:async()=>{},mutate:async()=>{}});t.after(()=>{ui.dispose();dom.window.close();delete globalThis.document;delete globalThis.window});ui.update();await tick();document.querySelector('[data-canvas-layout]').click();await tick();await tick();document.querySelector('[data-open-layout-library]').click()
 const controller=new AbortController();delay=true;const pending=options.onMap({resourceId:'r',version:1,layoutId:resource.package.layouts[0].id},{signal:controller.signal,isCurrent:()=>!controller.signal.aborted});await tick();controller.abort()
 document.querySelector('[data-canvas-layout]').click();await tick();await tick();const newer=document.querySelector('[data-canvas-layout-panel]');resolve();await pending;await tick()
 assert.equal(document.querySelector('[data-canvas-layout-panel]'),newer);assert.equal(document.querySelector('[data-content-mapping]'),null);assert.equal(calls.filter(c=>c.method==='POST'&&!c.path.endsWith('/layout-preview')).length,0)
})
