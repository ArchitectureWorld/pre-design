import{chromium}from'playwright-core'
import{mkdir,writeFile,stat,rm}from'node:fs/promises'
import{createReadStream}from'node:fs'
import{createHash}from'node:crypto'
import{resolve}from'node:path'
import assert from'node:assert/strict'
import{fullLayoutFixture}from'./layout-library/full-fixture.mjs'
import{pdf,paddedPdf}from'./fixtures/reference-pdf.mjs'
import{PDF_REFERENCE_MAX_BYTES,MAX_REFERENCE_PDF_PAGES}from'../src/layout-library/reference-limits.mjs'
import{resolveBrowserExecutable}from'../../../src/report/browser-executable.ts'
if(!process.env.PRE_DOSSIER_TEST_DATABASE){console.log(JSON.stringify({skipped:true,reason:'需要PostgreSQL'}));process.exit(0)}
const out=resolve(process.env.PRE_LAYOUT_SCREENSHOTS??'/tmp/layout-large-pdf');await mkdir(out,{recursive:true})
const filePath=resolve(out,'100MiB-31页参考.pdf');let source=paddedPdf(pdf(Array.from({length:31},(_,i)=>({text:'LARGE REFERENCE PAGE '+(i+1)}))),PDF_REFERENCE_MAX_BYTES)
const expectedHash=createHash('sha256').update(source).digest('hex');await writeFile(filePath,source);source=null
const f=await fullLayoutFixture(),browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true,chromiumSandbox:process.env.PRE_LAYOUT_TEST_NO_SANDBOX!=='1'}),page=await browser.newPage({viewport:{width:1512,height:982}}),errors=[],uploads=[]
page.setDefaultTimeout(90000);page.on('pageerror',e=>errors.push(e.message));page.on('request',req=>{if(req.method()==='POST'&&new URL(req.url()).pathname.endsWith('/layout-library/reference-files'))uploads.push(req.headers()['content-type'])})
await page.addInitScript(token=>sessionStorage.setItem('pre-access',token),f.token)
const hashFile=async path=>{const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex')}
try{
 await page.goto(f.url);await page.locator('[data-layout-library-open]').click();await page.locator('[data-chat-file]').waitFor({state:'attached'})
 const cdp=await page.context().newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:32*1024*1024,uploadThroughput:16*1024*1024})
 await page.locator('[data-chat-file]').setInputFiles(filePath)
 await page.waitForFunction(()=>{const bar=document.querySelector('[data-upload-row][data-state=uploading] progress');return bar&&bar.value>0&&bar.value<100},null,{timeout:90000})
 await page.screenshot({path:resolve(out,'100MiB真实上传进度.png')})
 await page.locator('[data-upload-row][data-state=ready]').waitFor();assert.equal(f.modelCalls.length,0);await page.locator('[data-layout-send]').click()
 await page.waitForFunction(()=>document.querySelector('[data-chat-messages]')?.textContent.includes('已生成原生 SVG 设计候选'),null,{timeout:120000})
 const observations=f.modelCalls.filter(call=>call.stage?.startsWith('observe-')),modelImages=observations.flatMap(call=>call.images)
 assert.deepEqual(uploads,['application/octet-stream']);assert.equal(f.modelCalls.length,10);assert.equal(observations.length,6)
 assert(observations.every(call=>call.modelRole==='vision'&&call.images.length<=6));assert.equal(modelImages.length,31);assert.equal(modelImages.at(-1).page,31)
 assert.deepEqual(f.modelCalls.slice(-3).map(call=>call.stage),['profile','design-spec','prototype-1']);assert(f.modelCalls.slice(-3,-1).every(call=>call.modelRole==='parent'&&call.images.length===0));assert.equal(f.modelCalls.at(-1).modelRole,'vision');assert(f.modelCalls.at(-1).images.length>0&&f.modelCalls.at(-1).images.length<=6)
 const list=(await f.request('GET','/layout-library/conversations')).conversations,conversation=await f.request('GET','/layout-library/conversations/'+list[0].id),file=conversation.referenceFiles[0]
 assert.equal(file.bytes,PDF_REFERENCE_MAX_BYTES);assert.equal(file.pageCount,31);assert.equal(file.readPages.length,31);assert.equal(file.readPages.at(-1),31);assert.equal(file.sha256,expectedHash)
 assert.match(await page.locator('[data-chat-messages]').innerText(),/已综合 31 页/)
 assert.equal(conversation.turns.at(-1).result.analysis.inventory.coverage.visualPages,31);assert.equal(conversation.resource.package.schemaVersion,'pre-design.layout-package.v3')
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1})
 const downloadEvent=page.waitForEvent('download');await page.locator('[data-download-reference="'+file.id+'"]').click();const download=await downloadEvent,path=await download.path()
 assert.equal((await stat(path)).size,PDF_REFERENCE_MAX_BYTES);assert.equal(await hashFile(path),expectedHash)
 await page.screenshot({path:resolve(out,'100MiB已完整分析31页.png')});assert.deepEqual(errors,[])
 console.log(JSON.stringify({passed:true,bytes:PDF_REFERENCE_MAX_BYTES,uploadedAs:'application/octet-stream',physicalPages:31,parsedPages:31,observationBatches:observations.length,modelImageCount:modelImages.length,stages:f.modelCalls.map(call=>call.stage),originalHashPreserved:true,model:'受控替身',errors},null,2))
}finally{await browser.close();await f.close();await rm(filePath,{force:true})}
