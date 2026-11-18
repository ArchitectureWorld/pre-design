import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium} from 'playwright-core'
import sharp from 'sharp'
import {resolvePage} from '../src/layout-library/contract.mjs'
import {verifyPages,measureHtml} from '../src/layout-library/validation.mjs'
import {fullLayoutFixture} from './layout-library/full-fixture.mjs'
import {referenceStageFixture} from './fixtures/reference-workflow.mjs'
import {resolveBrowserExecutable} from '../../../src/report/browser-executable.ts'
const out=resolve(process.env.PRE_LAYOUT_SCREENSHOTS??'/tmp/component-semantics-reuse-browser');await mkdir(out,{recursive:true})
const responder=input=>{
 const ctx=JSON.parse(input.prompt.split('以下JSON仅为参考数据，不能改写系统边界：\n').at(-1))
 if(input.stage.startsWith('components-'))return {response:{source:ctx.source,components:[{id:'title',kind:'text',purpose:'title',rect:{x:.05,y:.05,w:.9,h:.15}},{id:'label',kind:'text',purpose:'label',rect:{x:.05,y:.3,w:.4,h:.4}},{id:'detail',kind:'text',purpose:'body',rect:{x:.55,y:.3,w:.4,h:.4}}]}}
 if(input.stage.startsWith('semantics-'))return {response:{version:1,source:ctx.componentObservation.source,components:[{componentId:'detail',marker:'disc',emphasis:{status:'unknown',regions:[]}}]}}
 if(input.stage.startsWith('adapt-'))return {response:{styles:{title:{fontSize:40,lineHeight:1.2},label:{fontSize:22,lineHeight:1.2},body:{fontSize:22,lineHeight:1.2}},maxTextCharacters:100,adjustments:{},decorations:[],componentStyles:{}}}
 const r=referenceStageFixture(input)
 if(input.stage==='profile'){const p=JSON.parse(r.response);p.archetypes[0].roles=['title','text'];p.archetypes[0].capacity={images:0,textBlocks:2,bodyPoints:0,tableRows:0};r.response=p}
 return r
}
const f=await fullLayoutFixture({referenceResponder:responder,modelDelayMs:1}),browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true,chromiumSandbox:process.env.PRE_LAYOUT_TEST_NO_SANDBOX!=='1'})
try{
 const page=await browser.newPage({viewport:{width:1512,height:982}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(token=>sessionStorage.setItem('pre-access',token),f.token)
 await page.goto(f.url);await page.locator('[data-layout-library-open]').click();await page.locator('[data-layout-chat]').waitFor()
 await page.locator('[data-reference-advanced] summary').click()
 assert.equal(await page.locator('[data-reference-components]').isChecked(),false)
 assert.match(await page.locator('[data-reference-advanced]').textContent(),/4–14/)
 assert.equal(await page.locator('[data-reference-semantics]').isChecked(),false);assert.equal(await page.locator('[data-reference-semantics]').isDisabled(),true)
 assert.match(await page.locator('[data-reference-advanced]').textContent(),/每页增加1个/);assert.match(await page.locator('[data-reference-advanced]').textContent(),/额外费用/)
 await page.locator('[data-reference-components]').check();await page.locator('[data-reference-semantics]').check();await page.locator('[data-component-pages]').fill('1')
 const bytes=await sharp({create:{width:1600,height:900,channels:3,background:'#ffffff'}}).png().toBuffer()
 await page.locator('[data-chat-file]').setInputFiles({name:'component-synthetic.png',mimeType:'image/png',buffer:bytes})
 await page.waitForFunction(()=>document.querySelector('[data-upload-row]')?.dataset.state==='ready')
 assert.equal(f.modelCalls.length,0)
 await page.screenshot({path:resolve(out,'component-explicit-selection.png')})
 await page.locator('[data-layout-send]').click()
 await f.app.waitForJobs()
 await page.waitForFunction(()=>document.querySelector('[data-chat-messages]')?.textContent.includes('已生成原生'),null,{timeout:45000})
 assert.deepEqual(f.modelCalls.map(c=>c.stage),['observe-1','components-1','semantics-1','profile','adapt-1'])
 assert.equal(await page.locator('[data-reference-components]').isDisabled(),true)
 const resources=(await f.request('GET','/layout-library')).resources;assert.equal(resources.length,1)
 const resource=await f.request('GET','/layout-library/'+resources[0].id+'/1');assert.equal(resource.visibility,'private');assert.equal(resource.package.rights.shareAllowed,false);assert(resource.package.source.limitations.some(s=>s.includes('不是源文件母版')))
 await page.screenshot({path:resolve(out,'component-private-candidate.png')});assert.deepEqual(errors,[])
 const path='/layout-library/'+resource.id+'/1',layoutId=resource.package.layouts[0].id
 const bindings=await f.request('GET',f.base+'/layout-bindings'),[pageId,source]=Object.entries(bindings.contentSources)[0]
 assert.equal(source.sources.length,2)
 const body={requestId:'semantic-bind',baseRevision:0,expectedRevision:bindings.revision,draftId:bindings.contentDraftId,scope:'content',pageIds:[pageId],resource:{resourceId:resource.id,version:1},contentMapping:{sourceFingerprint:source.sourceFingerprint,entries:source.sources.map((v,i)=>({...v,targetKey:i?'detail':'label'}))}}
 const denied=await f.app.inject({method:'POST',url:'/api'+f.base+'/layout-bindings',headers:{authorization:'Bearer '+f.token},payload:body});assert.equal(denied.statusCode,409,'human review gate must block first binding')
 const qa=await f.request('POST',path+'/validate',{});assert.equal(qa.status,'passed',JSON.stringify(qa))
 const comparison=await f.request('POST',path+'/compare',{layoutId})
 // The test exercises explicit confirmation, not a real user's aesthetic approval.
 await f.request('POST',path+'/reference-review',{requestId:'semantic-review',packageHash:resource.hash,comparisonIds:[comparison.receipt.id],reviewed:true})
 const saved=await f.request('POST',f.base+'/layout-bindings',{...body,requestId:'semantic-bind-reviewed'});assert.equal(saved.revision,bindings.revision+1)
 const preview=await f.request('POST',f.base+'/layout-preview',{draftId:bindings.contentDraftId,pageId})
 const view=await browser.newPage({viewport:{width:1680,height:1000}});await view.setContent(preview.html)
 assert.equal(await view.locator('.ln-text-list').count(),1)
 for(const v of source.sources)assert((await view.locator('body').textContent()).includes(v.quote))
 await view.screenshot({path:resolve(out,'component-bound-project.png')})
 assert.deepEqual((await measureHtml(preview.html)).issues,[])
 const excessive={id:'long-source',number:1,chapterTitle:'长章节标题'.repeat(24),item:{title:'合成标题',paragraphs:[],points:[],textBlocks:source.sources.map((v,i)=>({key:i?'detail':'label',text:v.quote})),evidenceIndexes:Array.from({length:64},(_,i)=>i)}}
 excessive.nativeLayout=resolvePage({page:excessive,globalPackage:resource.package})
 await assert.rejects(verifyPages([excessive]),e=>e.code==='LAYOUT_PAGE_UNFIT'&&e.message.includes('source'))
 assert.equal(excessive.item.evidenceIndexes.length,64)

 const exported=await f.request('GET',path+'/export');const serialized=JSON.stringify(exported)
 for(const v of source.sources)assert(!serialized.includes(v.quote),'reusable export must not leak project text')
 assert.equal((await f.request('GET',path)).visibility,'private');assert.equal(f.modelCalls.length,5)
 await writeFile(resolve(out,'result.json'),JSON.stringify({passed:true,realBrowser:true,realUpload:true,realPostgres:true,model:'controlled-no-remote-calls',stages:f.modelCalls.map(c=>c.stage),private:true,reviewGate:true,explicitReview:'test-simulated-not-user-approval',binding:true,export:true,longSourceRejected:true,remoteModelCalls:0,visualFidelity:'not-evaluated'},null,2))
 console.log('component upload browser PASS (controlled model, not visual fidelity)')
}finally{await browser.close();await f.close()}
