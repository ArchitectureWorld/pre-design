// Authorized private resource/page inputs; disposable PG + real Chromium. No fake jobs.
// No remote model calls, production candidates, production bindings or user entrypoint.
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {mkdir,writeFile,readFile,copyFile} from 'node:fs/promises'
import {resolve,isAbsolute} from 'node:path'
import {chromium} from 'playwright-core'
import {resolveBrowserExecutable} from '../../../src/report/browser-executable.ts'
import {fullLayoutFixture} from './layout-library/full-fixture.mjs'
import {packageDigest} from '../src/layout-library/contract.mjs'
if(!process.env.PRE_DOSSIER_TEST_DATABASE)throw Error('Real disposable PostgreSQL configuration required')
if(!process.env.PRE_STYLE_PRIVATE_MANIFEST)throw Error('Explicit private manifest required')
assert(isAbsolute(process.env.PRE_STYLE_PRIVATE_MANIFEST),'Private manifest must be absolute')
const manifest=JSON.parse(await readFile(process.env.PRE_STYLE_PRIVATE_MANIFEST)),original=JSON.parse(await readFile(manifest.resource)),actualItem=JSON.parse(await readFile(manifest.item))
assert.equal(packageDigest(original.document),original.hash)
const f=await fullLayoutFixture(),out=resolve(process.env.PRE_LAYOUT_SCREENSHOTS??'/tmp/resource-style-private-browser')
let browser
try{
 await mkdir(out,{recursive:true})
 const pkg=original.document
 // Copy only existing rendered raster and its exact recorded source identity.
 // No PDF source bytes, native extraction, invented observations or completed jobs.
 for(const ref of manifest.references){
  const bytes=await readFile(ref.file);assert.equal(createHash('sha256').update(bytes).digest('hex'),ref.image.sha256)
  const dir=resolve(f.root,'.layout-references',ref.row.id);await mkdir(dir,{recursive:true,mode:0o700});await copyFile(ref.file,resolve(dir,ref.image.file))
  await f.db.query('INSERT INTO layout_reference_uploads(id,owner_id,request_id,fingerprint,filename,sha256,bytes,mime_type,document) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[ref.row.id,'admin',randomUUID(),'private-readonly-copy',ref.row.filename,ref.row.sha256,ref.row.bytes,ref.row.mime_type,{kind:'pdf',images:[ref.image],limitations:['Private raster-only QA copy; no native extraction']}])
 }
 const created=await f.request('POST','/layout-library',{requestId:randomUUID(),package:pkg})
 assert.equal(created.hash,original.hash)
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
 const item=row.document.blocks[0].items[0],fixtureItemId=item.id
 Object.assign(item,structuredClone(actualItem),{id:fixtureItemId})
 assert(!item.figure&&!item.figures?.length,'This private scenario must use the real imageless page')
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
 await page.screenshot({path:resolve(out,'actual-derived-preview.png'),fullPage:true});console.log('PRIVATE_PREVIEW_READY '+resolve(out,'actual-derived-preview.png'))
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
 await page.locator('[data-native-page="'+pageId+'"]').screenshot({path:resolve(out,'actual-derived-final.png')})
 // Second private test copy verifies the actual user action, not a production write.
 const uiResource=await f.request('POST','/layout-library',{requestId:randomUUID(),package:pkg})
 const bindingBefore=await f.request('GET',f.base+'/layout-bindings')
 await page.addInitScript(token=>sessionStorage.setItem('pre-access',token),f.token)
 let styleRequests=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/derive-style-adaptation'))styleRequests++})
 await page.goto(f.url);await page.getByRole('button',{name:'打开历史项目 '+f.project.name,exact:true}).click();await page.locator('#workspaceStage:not(.workspace-transitioning)').waitFor()
 await page.locator('[data-node-kind=script] [data-layout-page="'+pageId+'"]').click();await page.locator('[data-open-layout-library]').click()
 await page.locator('[data-resource-card="'+uiResource.id+'"]').click()
 await page.locator('[data-derive-style]').click();await page.locator('[data-ll-status]').filter({hasText:'请先确认这是基于当前风格的重新设计'}).waitFor();assert.equal(styleRequests,0)
 await page.locator('[data-style-ack]').check()
 const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/'+uiResource.id+'/1/derive-style-adaptation'))
 await page.locator('[data-derive-style]').click();const res=await response;assert.equal(res.status(),200,await res.text());const uiDerived=await res.json();assert.equal(uiDerived.id,uiResource.id);assert.equal(uiDerived.version,2);assert.equal(styleRequests,1)
 const uiCard=page.locator('[data-layout-card="style-adaptation-2"]');await uiCard.locator('[data-native-page]').waitFor()
 await uiCard.locator('[data-native-page]').evaluate(async e=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})
 const uiText=await uiCard.locator('[data-native-page]').innerText();for(const text of [item.title,...item.paragraphs,...item.points])assert(uiText.includes(text))
 await uiCard.locator('[data-layout-select]').click();await uiCard.dblclick();await page.locator('.ll-large-preview [data-native-page]').waitFor()
 await page.screenshot({path:resolve(out,'actual-ui-derived.png'),fullPage:true})
 const uiSaved=await f.request('GET','/layout-library/'+uiResource.id+'/2');assert.equal(uiSaved.validation,null);assert.equal(uiSaved.referenceReview,null);assert.equal(uiSaved.published,false);assert.deepEqual(await f.request('GET',f.base+'/layout-bindings'),bindingBefore)
 assert.deepEqual(errors,[]);assert.equal(f.modelCalls.length,0)
 await writeFile(resolve(out,'receipt.json'),JSON.stringify({passed:true,privateActualPage:true,completeOriginalPackage:true,uiButtonVerified:true,unacknowledgedNoRequest:true,uiActualContent:true,uiNoAutomaticBinding:true,realPostgres:true,realBrowser:true,derivedSameResource:true,idempotentConcurrent:true,negativeNoWrites:true,metadataPreserved:true,oldVersionPreserved:true,noReviewInheritance:true,normalValidationReviewPublish:true,previewMatchesFinal:true,remoteModelCalls:0,productionWrites:0,slots:slots.map(({text,...s})=>s)},null,2))
 console.log('private actual-page style adaptation PG/Chrome PASS')
}finally{await browser?.close();await f.close()}
