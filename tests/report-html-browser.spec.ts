import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectReportHtml } from '../src/report/html-browser.ts'
const roots:string[]=[]
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))})
async function fixture(broken=false){
  const root=await mkdtemp(join(tmpdir(),'report-browser-'));roots.push(root);await mkdir(join(root,'html'))
  await writeFile(join(root,'planning-sources.html'),'<html><body>资料依据</body></html>')
  await writeFile(join(root,'html/index.html'),`<!doctype html><style>.report-page{display:none;width:1280px;height:720px;position:relative}.active{display:block}.regular-text{width:${broken?20:500}px;height:30px;white-space:nowrap}</style>
    <section id="p1" data-source-page-id="source1" data-chapter="one" class="report-page active"><div class="regular-text">具体方案内容及依据</div>${broken?'<img src="missing.png">':''}</section>
    <section id="p2" data-source-page-id="source2" data-chapter="two" class="report-page"><div class="regular-text">启动组合</div></section>
    <button id="previous-page">prev</button><button id="next-page">next</button><input id="page-number" value="1"><select id="chapter-select"><option>one</option><option>two</option></select><a href="../planning-sources.html">资料依据</a>
    <script>const pages=[...document.querySelectorAll('.report-page')];let i=0;function show(n){i=Math.max(0,Math.min(1,n));pages.forEach((p,j)=>p.classList.toggle('active',i===j));document.querySelector('#page-number').value=i+1}document.querySelector('#next-page').onclick=()=>show(i+1);document.querySelector('#previous-page').onclick=()=>show(i-1);document.querySelector('#page-number').onchange=e=>show(Number(e.target.value)-1);document.querySelector('#chapter-select').onchange=e=>show(e.target.selectedIndex);document.onkeydown=e=>{if(e.key==='Home')show(0);if(e.key==='End')show(1);if(e.key==='ArrowRight')show(i+1);if(e.key==='ArrowLeft')show(i-1)}</script>`)
  return root
}
it('checks every actual browser page, navigation, source entry and saves viewable screenshots',async()=>{
  const root=await fixture(),result=await inspectReportHtml(root,{timeoutMs:30000})
  expect(result.findings).toEqual([]);expect(result.pages.map(p=>p.pageId)).toEqual(['p1','p2']);expect(result.navigation).toBe(true)
  expect((await readFile(join(root,result.pages[0]!.screenshot))).subarray(1,4).toString()).toBe('PNG')
},40000)
it('rejects real missing resources and rendered text overflow with page identities',async()=>{
  const result=await inspectReportHtml(await fixture(true),{timeoutMs:30000})
  expect(result.findings.some(f=>f.code==='HTML_IMAGE_LOAD'&&f.pageId==='source1')).toBe(true)
  expect(result.findings.some(f=>f.code==='HTML_TEXT_OVERFLOW'&&f.pageId==='source1')).toBe(true)
},40000)
it('rejects a broken offline response snapshot link in the source appendix', async () => {
  const root = await fixture()
  await writeFile(join(root, 'planning-sources.html'), '<html><body>资料依据<a href="sources/web/missing.json">原始响应快照</a></body></html>')
  const result = await inspectReportHtml(root, { timeoutMs: 30000 })
  expect(result.findings.some(finding => finding.code === 'HTML_SOURCES')).toBe(true)
}, 40000)
