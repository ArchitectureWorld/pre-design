// Task 3: current-project content comparison, real HTTP/PostgreSQL/Chromium.
// Synthetic project and uploaded image; zero remote model calls/production candidates.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium} from 'playwright-core'
import {resolveBrowserExecutable} from '../../../src/report/browser-executable.ts'
import {projectContentComparisonFixture} from './fixtures/project-content-comparison.mjs'
if(!process.env.PRE_DOSSIER_TEST_DATABASE)throw Error('Real disposable PostgreSQL configuration required')
const f=await projectContentComparisonFixture(),out=resolve(process.env.PRE_LAYOUT_SCREENSHOTS??'/tmp/layout-project-content-browser');await mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true,chromiumSandbox:process.env.PRE_LAYOUT_TEST_NO_SANDBOX!=='1'})
try{
 const geometryEvidence=[];const page=await browser.newPage({viewport:{width:1512,height:1100}}),errors=[],posts=[],moduleErrors=[];page.on('response',r=>{if(new URL(r.url()).pathname.endsWith('.js')&&r.status()>=400)moduleErrors.push({url:r.url(),status:r.status()})});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/'))posts.push({url:new URL(r.url()).pathname,method:r.method()})})
 await page.addInitScript(token=>sessionStorage.setItem('pre-access',token),f.token);page.setDefaultTimeout(20000)
 const before=await f.snapshot(),initialModelCalls=f.modelCalls.length
 await page.goto(f.url);await page.getByRole('button',{name:'打开历史项目 '+f.project.name,exact:true}).click();await page.locator('#workspaceStage:not(.workspace-transitioning)').waitFor()
 await page.locator('[data-node-kind=script] [data-layout-page="'+f.context.pageId+'"]').click();await page.locator('[data-open-layout-library]').click()
 await page.locator('[data-resource-card="'+f.resource.id+'"]').click()
 assert.match(await page.locator('[data-preview-mode]').innerText(),/当前页/,'real canvas entry must carry project context')
 const card=id=>page.locator('[data-layout-card="'+id+'"]')
 for(const id of ['image-left','image-right']){
  await card(id).locator('[data-native-page]').waitFor();assert.match(await card(id).locator('[data-native-page]').innerText(),/当前项目唯一标题/)
  for(const text of [f.item.paragraphs[0],...f.item.points])assert((await card(id).locator('[data-native-page]').innerText()).includes(text))
  const src=await card(id).locator('.ln-figure-grid img').getAttribute('src');assert.match(src,/^data:image\/webp;base64,/)
  await card(id).dblclick();const large=page.locator('.ll-large-preview');await large.locator('[data-native-page]').waitFor()
  assert.equal(await large.locator('[data-native-page]').innerText(),await card(id).locator('[data-native-page]').innerText())
  assert.equal(await large.locator('.ln-figure-grid img').getAttribute('src'),src)
  const measured=await large.locator('[data-layout-slot]').evaluateAll(nodes=>nodes.map(e=>({slot:e.dataset.layoutSlot,w:e.clientWidth,h:e.clientHeight,sw:e.scrollWidth,sh:e.scrollHeight})));geometryEvidence.push({id,slots:measured});assert(measured.every(e=>e.sw<=e.w+1&&e.sh<=e.h+1),'actual content must visibly fit '+JSON.stringify(measured))
  await large.locator('[data-layout-slot=title]').click();assert.match(await page.locator('[data-chat-selection]').innerText(),/标题/)
  await page.screenshot({path:resolve(out,id+'-annotation.png')});await page.locator('.annotation-composer:not([hidden]) [data-cancel]').click();await page.locator('.annotation-composer:not([hidden])').waitFor({state:'hidden'});assert.equal(await large.isVisible(),true);await page.screenshot({path:resolve(out,id+'-actual-project.png')});await large.getByRole('button',{name:'关闭放大预览',exact:true}).click()
 }
 for(const id of ['capacity-fail','mapping-fail']){await card(id).scrollIntoViewIfNeeded();await card(id).locator('[role=status]').waitFor();assert.match(await card(id).innerText(),/不能展示当前内容/);assert.equal(await card(id).locator('[data-native-page]').count(),0)}
 // Confirm that the counterexample truly exceeds geometry before testing guarded UI.
 const rawOverflow=await f.request('POST',f.base+'/layout-preview',{draftId:f.context.draftId,pageId:f.context.pageId,scope:'local',resource:{resourceId:f.resource.id,version:f.resource.version},overrides:{layoutId:'geometry-fail'}})
 const negative=await browser.newPage();await negative.setContent(rawOverflow.html)
 const geometricOverflow=await negative.locator('[data-layout-slot]').evaluateAll(nodes=>nodes.map(e=>({slot:e.dataset.layoutSlot,w:e.clientWidth,h:e.clientHeight,sw:e.scrollWidth,sh:e.scrollHeight})).filter(e=>e.sw>e.w+2||e.sh>e.h+2));await negative.close();assert(geometricOverflow.length>0)
 await card('geometry-fail').scrollIntoViewIfNeeded();await card('geometry-fail').locator('[role=status]').waitFor();assert.match(await card('geometry-fail').innerText(),/溢出|截断|超出/);assert.equal(await card('geometry-fail').locator('[data-native-page]').count(),0)
 await card('geometry-fail').locator('[data-layout-select]').click();assert.equal(await page.locator('[data-use-layout]').isDisabled(),true)
 await card('geometry-fail').dblclick();const failedLarge=page.locator('.ll-large-preview')
 await page.waitForFunction(()=>document.querySelector('.ll-large-preview')?.textContent.includes('不能展示当前内容'))
 assert.equal(await failedLarge.locator('[data-native-page]').count(),0);assert.equal(await page.locator('[data-use-layout]').isDisabled(),true)
 await page.screenshot({path:resolve(out,'geometric-overflow-rejected.png')});await failedLarge.getByRole('button',{name:'关闭放大预览',exact:true}).click()
 await writeFile(resolve(out,'geometry-evidence.json'),JSON.stringify({geometryEvidence,geometricOverflow,guardedCardText:await card('geometry-fail').innerText(),selectionDisabled:true},null,2))
 // Explicit pick remains available, but merely viewing must not invoke it.
 assert.equal(await page.locator('[data-use-layout]').count(),1)
 await page.locator('[data-resource-name]').fill('未保存编辑');await page.locator('[data-preview]').click();assert.match(await page.locator('[data-preview-mode]').innerText(),/先保存/)
 await page.locator('[data-close]').click();assert.deepEqual(await f.snapshot(),before,'browse/large/edit-without-save/close must not write resources or bindings')
 // Independent open is visibly sample, never silently labeled current project.
 await page.locator('[data-layout-library-open]').click();await page.locator('[data-resource-card="'+f.resource.id+'"]').click();assert.match(await page.locator('[data-preview-mode]').innerText(),/示例/);await page.locator('[data-close]').click()
 // Direct library surface for controlled lifecycle races; HTTP responses still come from real server.
 await page.evaluate(async()=>{
  const {mountLayoutLibrary}=await import('/layout-library/ui.js');const t={current:true,hold:false,waiting:0,releases:[]};window.comparisonTest=t
  const request=async(path,o={})=>{const r=await fetch('/api'+path,{method:o.method??'GET',headers:{authorization:'Bearer '+sessionStorage.getItem('pre-access'),'content-type':'application/json'},...(o.body?{body:JSON.stringify(o.body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.error??data.message??'请求失败');if(t.hold&&path.endsWith('/layout-preview')){t.waiting++;await new Promise(resolve=>t.releases.push(resolve))}return data}
  t.ui=mountLayoutLibrary({request,notify:()=>{}});t.open=async(context,resource)=>{t.current=true;await t.ui.open({resourceId:resource.id,version:resource.version,previewContext:context,isPreviewCurrent:()=>t.current})}
 })
 await page.evaluate(({c,r})=>window.comparisonTest.open(c,r),{c:f.badContext,r:f.resource})
 await page.locator('[data-layout-card=image-left] [role=status]').waitFor();assert.match(await page.locator('[data-layout-card=image-left]').innerText(),/图片不存在|未核验/);assert.equal(await page.locator('[data-layout-card=image-left] img').count(),0)
 await page.evaluate(({c,r})=>window.comparisonTest.open(c,r),{c:{...f.context,projectId:f.foreignId},r:f.resource})
 await page.locator('[data-layout-card=image-left] [role=status]').waitFor();assert.match(await page.locator('[data-layout-card=image-left]').innerText(),/项目不存在/)
 await page.evaluate(({c,r})=>{window.comparisonTest.hold=true;void window.comparisonTest.open(c,r)}, {c:f.context,r:f.resource})
 await page.waitForFunction(()=>window.comparisonTest.waiting>=2)
 await page.evaluate(()=>{window.comparisonTest.current=false;window.comparisonTest.ui.reset();window.comparisonTest.hold=false;for(const r of window.comparisonTest.releases)r()})
 await page.evaluate(({r})=>window.comparisonTest.ui.open({resourceId:r.id,version:r.version}),{r:f.resource})
 await page.locator('[data-layout-card=image-left] [data-native-page]').waitFor();assert.match(await page.locator('[data-preview-mode]').innerText(),/示例/);assert(!(await page.locator('[data-layout-card=image-left] [data-native-page]').innerText()).includes(f.item.title))
 await page.evaluate(()=>window.comparisonTest.ui.dispose())
 assert.deepEqual(await f.snapshot(),before);assert.equal(f.modelCalls.length,initialModelCalls);assert.deepEqual(errors,[]);assert.deepEqual(moduleErrors,[])
 assert(posts.every(p=>p.method==='POST'&&(p.url.endsWith('/layout-preview')||p.url==='/api/layout-library/preview')),'only readonly preview POST requests permitted: '+JSON.stringify(posts))
 assert(geometricOverflow.length>0,'negative fixture must actually overflow')
 // Separate intentional-write phase. Authored native-v1 test resource exercises the real
 // selection/apply/export path while the comparisons above exercise native-v3.
 await f.prepareApply()
 await page.reload();await page.getByRole('button',{name:'打开历史项目 '+f.project.name,exact:true}).click();await page.locator('#workspaceStage:not(.workspace-transitioning)').waitFor()
 await page.locator('[data-node-kind=script] [data-layout-page="'+f.context.pageId+'"]').click()
 await page.locator('[data-layout-layer]').selectOption('manual');await page.locator('[data-canvas-accent]').fill('#7a2244');await page.locator('[data-canvas-layout-kind]').selectOption('image-left');await page.locator('[data-save-page-layout]').click()
 await page.waitForFunction(()=>document.querySelector('[data-layout-status]')?.textContent.includes('已保存'))
 const manualBefore=(await f.request('GET',f.base+'/layout-bindings')).manual[f.context.pageId]
 assert.equal(manualBefore.layoutId,'image-left');assert.equal(manualBefore.theme.accent,'#7a2244')
 await page.locator('[data-open-layout-library]').click()
 const blue=f.selectable;assert(blue)
 await page.locator('[data-resource-card="'+blue.id+'"]').click();await card('points').locator('[data-native-page]').waitFor()
 await card('points').dblclick();const manualLarge=page.locator('.ll-large-preview');await manualLarge.locator('[data-native-page]').waitFor()
 const previewNative=await manualLarge.locator('[data-native-page]').evaluate(e=>e.outerHTML)
 assert.match(previewNative,/#7a2244/);assert.match(previewNative,/data-kind="image-left"/);assert.match(await manualLarge.locator('[data-native-page]').innerText(),/当前项目唯一标题/)
 await page.screenshot({path:resolve(out,'manual-effective-preview.png')})
 await manualLarge.getByRole('button',{name:'关闭放大预览',exact:true}).click();await page.locator('[data-use-layout]').click()
 await page.waitForFunction(()=>!document.querySelector('[data-layout-library]'))
 const selected=await f.request('GET',f.base+'/layout-bindings')
 assert.deepEqual(selected.manual[f.context.pageId],manualBefore);assert.equal(selected.local[f.context.pageId].resource.resourceId,blue.id);assert.equal(selected.local[f.context.pageId].overrides.layoutId,'points')
 await f.post('/workflow/approve',{draftId:f.context.draftId})
 await f.post('/workflow/visuals',{draftId:f.context.draftId,applyLibrary:true,expectedBindingRevision:selected.revision})
 const applied=(await f.state()).workflow.visuals.current;assert(applied);assert.equal(applied.pages.find(p=>p.id===f.context.pageId).nativeLayout.layout.id,'image-left')
 const artifact=await f.app.inject({method:'GET',url:'/api'+f.base+'/artifacts/workflow-visual-'+applied.id+'-html',headers:{authorization:'Bearer '+f.token}});assert.equal(artifact.statusCode,200)
 await writeFile(resolve(out,'selected-actual-export.html'),artifact.body)
 const exported=await browser.newPage({viewport:{width:1512,height:1100}});await exported.setContent(artifact.body)
 const actualPage=exported.locator('[data-native-page="'+f.context.pageId+'"]');await actualPage.waitFor()
 assert.equal(await actualPage.evaluate(e=>e.outerHTML),previewNative,'selected/manual actual generated export must equal preview HTML, not merely bindings')
 const actualGeometry=await actualPage.locator('[data-layout-slot]').evaluateAll(nodes=>nodes.map(e=>({slot:e.dataset.layoutSlot,w:e.clientWidth,h:e.clientHeight,sw:e.scrollWidth,sh:e.scrollHeight})));assert(actualGeometry.every(e=>e.sw<=e.w+1&&e.sh<=e.h+1),JSON.stringify(actualGeometry))
 await actualPage.screenshot({path:resolve(out,'manual-selected-actual-export.png')});await exported.close()
 assert.equal(f.modelCalls.length,initialModelCalls);assert.deepEqual(moduleErrors,[]);assert.deepEqual(errors,[])
 // First-time mapping remains reachable without bypassing the fit gate.
 const mapped=await f.prepareMapping()
 const openMapped=async id=>{await page.reload();await page.getByRole('button',{name:'打开历史项目 '+f.project.name,exact:true}).click();await page.locator('#workspaceStage:not(.workspace-transitioning)').waitFor();await page.locator('[data-node-kind=script] [data-layout-page="'+f.context.pageId+'"]').click();await page.locator('[data-open-layout-library]').click();await page.locator('[data-resource-card="'+mapped.id+'"]').click();await card(id).locator('[role=status]').waitFor();await card(id).locator('[data-layout-select]').click();assert.equal(await page.locator('[data-use-layout]').isDisabled(),true);await page.locator('[data-configure-mapping]').click();await page.locator('[data-content-mapping]').waitFor()}
 const mappingBefore=await f.snapshot();await openMapped('mapped-paragraph');await page.locator('[data-mapping-cancel]').click();await page.locator('[data-layout-close]').click();assert.deepEqual(await f.snapshot(),mappingBefore,'opening/cancelling first mapping must not save any state')
 await openMapped('mapped-capacity');await page.locator('[data-mapping-key="mapped-paragraph"]').selectOption('0');await page.locator('[data-mapping-save]').click();await page.waitForFunction(()=>document.querySelector('[data-mapping-error]')?.textContent.length>0);assert.match(await page.locator('[data-mapping-error]').innerText(),/CONTENT_FIT: maxTextCharacters capacity exceeded or invalid/);assert.deepEqual(await f.snapshot(),mappingBefore,'capacity failure must not save');await page.locator('[data-layout-close]').click()
 await f.setParagraph('换行测试\n'.repeat(15));const geometricMappingBefore=await f.snapshot()
 await openMapped('mapped-paragraph');await page.locator('[data-mapping-key="mapped-paragraph"]').selectOption('0');await page.locator('[data-mapping-save]').click();await page.waitForFunction(()=>document.querySelector('[data-mapping-error]')?.textContent.length>0);assert.match(await page.locator('[data-mapping-error]').innerText(),/溢出|截断|超出/);assert.deepEqual(await f.snapshot(),geometricMappingBefore,'geometric mapping failure must not save');await page.locator('[data-layout-close]').click()
 await f.setParagraph(f.item.paragraphs[0]);await openMapped('mapped-paragraph');await page.locator('[data-mapping-key="mapped-paragraph"]').selectOption('0');await page.locator('[data-mapping-save]').click();await page.waitForFunction(()=>!document.querySelector('[data-content-mapping]'))
 const mappedBinding=await f.request('GET',f.base+'/layout-bindings');assert.equal(mappedBinding.contentMappings[f.context.pageId].entries[0].quote,f.item.paragraphs[0])
 await page.locator('[data-open-layout-library]').click();await page.locator('[data-resource-card="'+mapped.id+'"]').click();await card('mapped-paragraph').locator('[data-native-page]').waitFor();await card('mapped-paragraph').locator('[data-layout-select]').click()
 await page.waitForFunction(()=>document.querySelector('[data-use-layout]')?.disabled===false)
 assert((await card('mapped-paragraph').locator('[data-native-page]').innerText()).includes(f.item.paragraphs[0]));await page.screenshot({path:resolve(out,'first-mapping-real-content.png')});await page.locator('[data-close]').click()
 assert.equal(f.modelCalls.length,initialModelCalls);assert.deepEqual(moduleErrors,[]);assert.deepEqual(errors,[])
 await writeFile(resolve(out,'receipt.json'),JSON.stringify({passed:true,realPostgres:true,realBrowser:true,realOwnedImage:true,canvasEntry:true,sameContentCandidates:2,largeMatchesThumbnail:true,capacityAndMappingRejected:true,geometricOverflowRejected:true,firstMappingReachable:true,mappingCancelNoWrites:true,mappingCapacityAndGeometryFailuresNoWrites:true,validMappingEnablesRealPreviewAndSelection:true,foreignImageAndProjectRejected:true,staleResponsesRejected:true,noBrowsingStateWrites:true,explicitSelectionManualPreserved:true,previewMatchesSelectedActualHtmlExport:true,remoteModelCalls:0,productionCandidates:0,visualFidelity:'not-evaluated'},null,2));console.log('current-project content comparison browser PASS')
}finally{await browser.close();await f.close()}
