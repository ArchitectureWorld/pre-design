// Public controlled synthetic resource-style QA; no private inputs or invented jobs.
// No remote model calls, production candidates, production bindings or user entrypoint.
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import sharp from 'sharp'
import {chromium} from 'playwright-core'
import {resolveBrowserExecutable} from '../../../src/report/browser-executable.ts'
import {fullLayoutFixture} from './layout-library/full-fixture.mjs'
import {nativeDesignInput} from './fixtures/native-design-v3-fixture.mjs'
import {compileNativeDesignPackageV3} from '../src/layout-library/native-design-compiler.mjs'
if(!process.env.PRE_DOSSIER_TEST_DATABASE)throw Error('Real disposable PostgreSQL configuration required')
const f=await fullLayoutFixture(),out=resolve(process.env.PRE_LAYOUT_SCREENSHOTS??'/tmp/resource-style-browser')
let browser
try{
 await mkdir(out,{recursive:true})
 const pkg=compileNativeDesignPackageV3(nativeDesignInput())
 const png=await sharp({create:{width:1600,height:900,channels:3,background:'#f3f0eb'}}).png().toBuffer()
 const sourceSha=createHash('sha256').update(png).digest('hex')
 await f.request('POST','/layout-library/reference-files',{requestId:randomUUID(),filename:'synthetic-card-observation.png',content:png.toString('base64')})
 const evidence=pkg.designProfile.evidence[0];evidence.fileSha256=sourceSha;evidence.pageNumber=1;pkg.designSpec.profile=structuredClone(pkg.designProfile)
 pkg.description='Controlled synthetic sparse derivation QA';pkg.tags=['synthetic']
 const created=await f.request('POST','/layout-library',{requestId:randomUUID(),package:pkg})
 const snapshot=async()=>{const x={};for(const table of ['layout_library_resources','layout_library_versions','layout_library_mutations','layout_project_bindings','layout_reference_reviews'])x[table]=(await f.db.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS value FROM ${table} t`)).rows[0].value;return x}
 const path='/layout-library/'+created.id+'/1/derive-style-adaptation',body={requestId:randomUUID(),expectedHash:created.hash,strategyVersion:1,styleAcknowledged:true}
 const raw=(b)=>f.app.inject({method:'POST',url:'/api'+path,headers:{authorization:'Bearer '+f.token},payload:b})
 let before=await snapshot()
 for(const bad of [{...body,requestId:randomUUID(),expectedHash:'f'.repeat(64)},{...body,requestId:randomUUID(),styleAcknowledged:false}])assert([400,409].includes((await raw(bad)).statusCode))
 assert.deepEqual(await snapshot(),before)
 const replies=await Promise.all([raw(body),raw(body)]);for(const r of replies)assert.equal(r.statusCode,200,r.body)
 const derived=replies[0].json();assert.deepEqual(derived,replies[1].json());assert.equal(derived.id,created.id);assert.equal(derived.version,2)
 before=await snapshot();assert.equal((await raw({...body,requestId:randomUUID()})).statusCode,409);assert.deepEqual(await snapshot(),before)
 const base='/layout-library/'+derived.id+'/2',saved=await f.request('GET',base),old=await f.request('GET','/layout-library/'+created.id+'/1')
 assert.deepEqual(saved.package.layouts.slice(0,old.package.layouts.length),old.package.layouts)
 for(const k of ['name','description','tags','rights','theme'])assert.deepEqual(saved.package[k],old.package[k])
 assert.equal(saved.validation,null);assert.equal(saved.referenceReview,null);assert.equal(saved.published,false)
 const row=(await f.db.query('SELECT id,document FROM workflow_drafts WHERE project_id=$1 ORDER BY version DESC LIMIT 1',[f.project.id])).rows[0]
 const item=row.document.blocks[0].items[0];Object.assign(item,{title:'合成少内容页',paragraphs:['这是受控测试原文，不能替换或删除。'],points:['合成要点甲','合成要点乙']})
 delete item.figure;delete item.figures
 await f.db.query('UPDATE workflow_drafts SET document=$2 WHERE id=$1',[row.id,row.document])
 const pageId='visual-page-'+item.id,previewBody={draftId:row.id,pageId,scope:'local',resource:{resourceId:derived.id,version:2},overrides:{layoutId:'style-adaptation-2'}}
 const preview=await f.request('POST',f.base+'/layout-preview',previewBody)
 browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true,chromiumSandbox:process.env.PRE_LAYOUT_TEST_NO_SANDBOX!=='1'})
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.setContent(preview.html);await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})
 const slots=await page.locator('[data-layout-slot]').evaluateAll(es=>es.map(e=>({role:e.dataset.layoutSlot,text:e.textContent,w:e.clientWidth,h:e.clientHeight,sw:e.scrollWidth,sh:e.scrollHeight})))
 assert.equal(slots.length,saved.package.layouts.find(l=>l.id==='style-adaptation-2').slots.length)
 assert(slots.every(s=>s.w>0&&s.h>0&&s.sw<=s.w+2&&s.sh<=s.h+2))
 const previewOuter=await page.locator('[data-native-page]').evaluate(e=>e.outerHTML)
 const previewText=await page.locator('[data-native-page]').innerText();for(const text of [item.title,...item.paragraphs,...item.points])assert(previewText.includes(text))
 await page.screenshot({path:resolve(out,'synthetic-derived-preview.png'),fullPage:true})
 const validation=await f.request('POST',base+'/validate',{});assert.equal(validation.status,'passed',JSON.stringify(validation))
 const ids=[];for(const layout of saved.package.layouts){const c=await f.request('POST',base+'/compare',{layoutId:layout.id});if(layout.id.startsWith('style-adaptation-')){assert.equal(c.sourceIdentity.sourceKind,'resource-style');assert(c.sourcePreviewHtml);assert.equal(c.source,null)}else assert(c.source);ids.push(c.receipt.id)}
 await f.request('POST',base+'/reference-review',{requestId:randomUUID(),packageHash:saved.hash,comparisonIds:ids,reviewed:true})
 await f.request('POST',base+'/publish',{requestId:randomUUID(),visibility:'private',reviewed:true})
 const bindings=await f.request('GET',f.base+'/layout-bindings')
 await f.post('/layout-bindings',{draftId:row.id,expectedRevision:bindings.revision,scope:'local',pageIds:[pageId],resource:previewBody.resource,overrides:previewBody.overrides})
 const selected=await f.request('GET',f.base+'/layout-bindings')
 await f.post('/workflow/approve',{draftId:row.id})
 await f.post('/workflow/visuals',{draftId:row.id,applyLibrary:true,expectedBindingRevision:selected.revision})
 const visual=(await f.state()).workflow.visuals.current,applied=visual.pages.find(p=>p.id===pageId)
 assert.equal(applied.nativeLayout.layout.id,'style-adaptation-2')
 const artifact=await f.app.inject({method:'GET',url:'/api'+f.base+'/artifacts/workflow-visual-'+visual.id+'-html',headers:{authorization:'Bearer '+f.token}})
 assert.equal(artifact.statusCode,200);await page.setContent(artifact.body)
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})
 const finalPage=page.locator('[data-native-page="'+pageId+'"]')
 assert.equal(await finalPage.innerText(),previewText)
 assert.equal(await finalPage.evaluate(e=>e.outerHTML),previewOuter)
 const finalSlots=await finalPage.locator('[data-layout-slot]').evaluateAll(es=>es.map(e=>({role:e.dataset.layoutSlot,w:e.clientWidth,h:e.clientHeight,sw:e.scrollWidth,sh:e.scrollHeight})))
 assert.deepEqual(finalSlots,slots.map(({text,...s})=>s))
 await page.locator('[data-native-page="'+pageId+'"]').screenshot({path:resolve(out,'synthetic-derived-final.png')})
 // A distinct synthetic resource exercises the actual new UI button.
 const uiPackage=structuredClone(pkg);uiPackage.name='UI派生合成资源'
 const uiResource=await f.request('POST','/layout-library',{requestId:randomUUID(),package:uiPackage})
 await page.addInitScript(token=>sessionStorage.setItem('pre-access',token),f.token)
 const bindingBefore=await f.request('GET',f.base+'/layout-bindings');let styleRequests=0
 page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/derive-style-adaptation'))styleRequests++})
 await page.goto(f.url);await page.locator('[data-layout-library-open]').click()
 await page.locator('[data-resource-card="'+uiResource.id+'"]').click()
 await page.locator('[data-derive-style]').click();await page.locator('[data-ll-status]').filter({hasText:'请先确认这是基于当前风格的重新设计'}).waitFor();assert.equal(styleRequests,0)
 await page.locator('[data-style-ack]').check()
 const uiResponse=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/'+uiResource.id+'/1/derive-style-adaptation'))
 await page.locator('[data-derive-style]').click()
 const uiResult=await uiResponse;assert.equal(uiResult.status(),200,await uiResult.text())
 const uiDerived=await uiResult.json();assert.equal(uiDerived.id,uiResource.id);assert.equal(uiDerived.version,2);assert.equal(styleRequests,1)
 await page.locator('[data-layout-card="style-adaptation-2"] [data-native-page]').waitFor()
 await page.screenshot({path:resolve(out,'synthetic-ui-derived.png'),fullPage:true})
 const uiSaved=await f.request('GET','/layout-library/'+uiResource.id+'/2');assert.equal(uiSaved.validation,null);assert.equal(uiSaved.referenceReview,null);assert.equal(uiSaved.published,false);assert.deepEqual(await f.request('GET',f.base+'/layout-bindings'),bindingBefore)
 assert.deepEqual(errors,[]);assert.equal(f.modelCalls.length,0)
 await writeFile(resolve(out,'receipt.json'),JSON.stringify({passed:true,controlledSynthetic:true,privateInputs:false,noFabricatedJobs:true,uiButtonCreatesSameResourceVersion:true,unacknowledgedNoRequest:true,uiNoAutomaticBinding:true,realPostgres:true,realBrowser:true,derivedSameResource:true,idempotentConcurrent:true,negativeNoWrites:true,metadataPreserved:true,oldVersionPreserved:true,noReviewInheritance:true,normalValidationReviewPublish:true,previewMatchesFinal:true,remoteModelCalls:0,productionWrites:0,slots:slots.map(({text,...s})=>s)},null,2))
 console.log('controlled resource-style real PG/Chrome PASS')
}finally{await browser?.close();await f.close()}
