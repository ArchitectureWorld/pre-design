import{chromium}from'playwright-core'
import{mkdir,readFile}from'node:fs/promises'
import{resolve}from'node:path'
import{randomBytes}from'node:crypto'
import assert from'node:assert/strict'
import sharp from'sharp'
import JSZip from'jszip'
import{fullLayoutFixture}from'./layout-library/full-fixture.mjs'
import{pdf}from'./fixtures/reference-pdf.mjs'
import{resolveBrowserExecutable}from'../../../src/report/browser-executable.ts'
if(!process.env.PRE_DOSSIER_TEST_DATABASE){console.log(JSON.stringify({skipped:true,reason:'需要真实PostgreSQL配置'}));process.exit(0)}
const out=resolve(process.env.PRE_LAYOUT_SCREENSHOTS??'/tmp/layout-upload-evidence');await mkdir(out,{recursive:true})
const f=await fullLayoutFixture({uploadDelayMs:1200,modelDelayMs:900}),browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true,chromiumSandbox:process.env.PRE_LAYOUT_TEST_NO_SANDBOX!=='1'}),page=await browser.newPage({viewport:{width:1512,height:982}}),errors=[]
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(30000);await page.addInitScript(token=>sessionStorage.setItem('pre-access',token),f.token)
const wait=condition=>page.waitForFunction(condition,null,{timeout:40000});let checks=0
try{
 await page.goto(f.url);await page.locator('[data-layout-library-open]').click();await page.locator('[data-layout-chat]').waitFor()
 const accept=await page.locator('[data-chat-file]').getAttribute('accept');for(const format of ['.pdf','.docx','.jpg','.jpeg','.png','.webp'])assert(accept.includes(format));checks++
 const noise=await sharp(randomBytes(512*512*3),{raw:{width:512,height:512,channels:3}}).png().toBuffer(),cdp=await page.context().newCDPSession(page)
 await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:30,downloadThroughput:1024*1024,uploadThroughput:128*1024})
 await page.locator('[data-chat-file]').setInputFiles({name:'进度与取消.png',mimeType:'image/png',buffer:noise})
 await wait(()=>{const p=document.querySelector('[data-upload-row][data-state=uploading] progress');return p&&p.value>0&&p.value<100})
 const progress=await page.locator('[data-upload-row] progress').getAttribute('value');assert(Number(progress)>0&&Number(progress)<100);assert.equal(f.modelCalls.length,0);checks++
 await page.screenshot({path:resolve(out,'真实上传进度.png')})
 await page.locator('[data-remove-upload]').click();await wait(()=>document.querySelectorAll('[data-upload-row]').length===0);assert.equal(f.modelCalls.length,0);checks++
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1})
 const originalPdf=pdf(Array.from({length:6},(_,i)=>({text:'REFERENCE PAGE '+(i+1)}))),png=await sharp({create:{width:180,height:90,channels:3,background:'#235740'}}).png().toBuffer(),jpeg=await sharp(png).jpeg().toBuffer()
 const zip=new JSZip();zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>版式文档参考，标题与正文层级清晰。</w:t></w:r></w:p></w:body></w:document>')
 const word=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})
 await page.locator('[data-chat-file]').setInputFiles([{name:'分页参考.pdf',mimeType:'application/pdf',buffer:originalPdf},{name:'图像参考.jpg',mimeType:'image/jpeg',buffer:jpeg},{name:'图像参考.jpeg',mimeType:'image/jpeg',buffer:jpeg},{name:'图像参考.png',mimeType:'image/png',buffer:png},{name:'文字参考.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:word}])
 await wait(()=>!!document.querySelector('[data-upload-row][data-state=parsing]'))
 assert.equal(await page.locator('[data-upload-row][data-state=parsing] progress').first().getAttribute('value'),null);checks++
 await page.screenshot({path:resolve(out,'文件解析状态.png')})
 await wait(()=>{const bar=document.querySelector('[data-model-progress]');return bar&&!bar.hidden})
 assert.equal(await page.locator('[data-model-progress]').getAttribute('value'),null);checks++
 await wait(()=>document.querySelector('[data-chat-messages]')?.textContent.includes('已生成墨绿色版式'))
 assert.equal(f.modelCalls.length,1);assert.equal(f.modelCalls[0].modelRole,'vision');assert.equal(f.modelCalls[0].images.length,7);assert.match(f.modelCalls[0].prompt,/版式文档参考/);checks++
 const entries=(await f.request('GET','/layout-library/conversations')).conversations,conversation=await f.request('GET','/layout-library/conversations/'+entries[0].id)
 assert.equal(conversation.referenceFiles.length,5);const pdfFile=conversation.referenceFiles.find(file=>file.kind==='pdf');assert.equal(pdfFile.pageCount,6);assert.deepEqual(pdfFile.readPages,[1,2,3,4]);checks++
 assert.match(await page.locator('[data-chat-files]').innerText(),/前4\/6页/);assert(conversation.resource.package.source.limitations.some(note=>note.includes('后 2 页未读取')));checks++
 await page.screenshot({path:resolve(out,'多格式参考已分析.png')})
 await page.locator('[data-close]').click();await page.reload();await page.locator('[data-layout-library-open]').click();await page.locator('[data-resource-card="'+conversation.resource.id+'"]').click();await wait(()=>document.querySelectorAll('[data-download-reference]').length===5);checks++
 const downloadEvent=page.waitForEvent('download');await page.locator('[data-download-reference="'+pdfFile.id+'"]').click();const download=await downloadEvent;assert.equal(download.suggestedFilename(),'分页参考.pdf');assert.deepEqual(await readFile(await download.path()),originalPdf);checks++
 await page.locator('[data-chat-file]').setInputFiles({name:'损坏.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-损坏')})
 await page.locator('[data-retry-upload]').waitFor();assert.equal(f.modelCalls.length,1);assert.match(await page.locator('[data-upload-state]').innerText(),/PDF/);checks++
 await page.locator('[data-remove-upload]').click();await wait(()=>!document.querySelector('[data-upload-row]'));assert.deepEqual(errors,[]);checks++
 console.log(JSON.stringify({checks,passed:true,transport:'真实HTTP/PostgreSQL/Chromium；真实上传字节进度；模型为受控替身',formats:['PDF','JPG','JPEG','PNG','DOCX'],screenshots:out},null,2))
}finally{await browser.close();await f.close()}
