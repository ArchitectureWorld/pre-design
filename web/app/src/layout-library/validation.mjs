import {resolveBrowserExecutable} from '../../../../src/report/browser-executable.ts'
import {validatePackage,resolvePage,packageDigest,RENDERER,fail} from './contract.mjs'
import {renderNativeDocument} from './render.mjs'
export const FIXTURES_VERSION='native-layout-fixtures-1'
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
export function samplePages(pkg){
 const pages=[]
 for(const l of pkg.layouts)for(const density of ['short','typical']){
  const item={title:density==='short'?'城市更新 · 参考页':'围绕居民服务组织片区更新与分期实施',paragraphs:['明确本页结论，图文和数据均使用公开的合成测试内容。'],points:density==='short'?['公共空间','服务设施']:['比较不同人群的使用需求和活动时间。','根据真实条件安排公共空间和服务设施。','建设内容与后续运营维护相互衔接。'],evidenceIndexes:[0]}
  if(l.kind==='table'){item.points=['以下数据仅用于版式试排，不是业务结论。'];item.table={columns:['比较项目','方案甲','方案乙'],rows:[['服务场景','日常活动','周末活动'],['组织方式','就近服务','集中共享'],['实施阶段','第一阶段','第二阶段']]}}
  if(l.kind==='image-left')item.figure={materialId:'00000000-0000-4000-8000-000000000001',caption:'版式试排占位图，不是项目现场'}
  const page={id:`sample-${l.id}-${density}`,number:pages.length+1,chapterTitle:'合成试排内容',sectionTitle:l.label,item,...(item.figure?{nativeAssets:{image:{dataUrl:PNG,sha256:'fixture'}}}:{})}
  page.nativeLayout=resolvePage({page,globalPackage:pkg,local:{overrides:{layoutId:l.id}}});pages.push(page)
 }
 return pages
}
const QA_SCRIPT=`<script>(async()=>{await document.fonts.ready;await Promise.all(Array.from(document.images).map(i=>i.decode().catch(()=>{})));const issues=[];const pages=Array.from(document.querySelectorAll('[data-native-page]'));for(const page of pages){const pageId=page.dataset.nativePage;for(const el of page.querySelectorAll('[data-layout-slot]')){if(el.scrollHeight>el.clientHeight+2||el.scrollWidth>el.clientWidth+2)issues.push({pageId,slot:el.dataset.layoutSlot,code:'overflow',scrollHeight:el.scrollHeight,clientHeight:el.clientHeight});if(el.querySelector('.ln-missing'))issues.push({pageId,slot:el.dataset.layoutSlot,code:'missing'});}for(const img of page.querySelectorAll('img'))if(!img.complete||!img.naturalWidth)issues.push({pageId,code:'image-unavailable'});}const r=document.createElement('pre');r.id='native-layout-qa';r.textContent=JSON.stringify({pages:pages.length,issues});document.body.append(r)})()</script>`
export async function measureHtml(html,{signal}={}){
 const {chromium}=await import('playwright-core')
 const browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true,
  chromiumSandbox:process.env.PRE_LAYOUT_TEST_NO_SANDBOX!=='1',
  args:['--disable-background-networking','--disable-extensions','--no-first-run'],timeout:20000})
 const abort=()=>{void browser.close()};signal?.addEventListener('abort',abort,{once:true})
 try{
  signal?.throwIfAborted()
  const context=await browser.newContext({viewport:{width:1680,height:1000},serviceWorkers:'block'})
  await context.route('**/*',route=>route.abort())
  const page=await context.newPage()
  await page.setContent(html.replace('</body>',QA_SCRIPT+'</body>'),{waitUntil:'load',timeout:20000})
  await page.waitForSelector('#native-layout-qa',{timeout:15000,state:'attached'})
  const result=JSON.parse(await page.locator('#native-layout-qa').textContent())
  signal?.throwIfAborted();return result
 }catch(e){if(signal?.aborted)throw signal.reason;throw fail('浏览器页面检查未完成：'+e.message,503,'LAYOUT_QA_UNAVAILABLE')}
 finally{signal?.removeEventListener('abort',abort);await browser.close()}
}

export async function validatePublication(value,{measure=measureHtml,signal}={}){
 const pkg=validatePackage(value),pages=samplePages(pkg),html=renderNativeDocument(pages,{title:'版式入库试排'})
 const actual=await measure(html,{signal})
 if(actual.pages!==pages.length)throw fail('实际试排页面数量不一致，未验证。',503)
 const overflow=structuredClone(pages[0]);overflow.item.title='超出容量检查'.repeat(600)
 const negative=await measure(renderNativeDocument([overflow]),{signal})
 const overflowGuard=negative.pages===1&&negative.issues.some(i=>i.code==='overflow'&&i.slot==='title')
 return {status:!actual.issues.length&&overflowGuard?'passed':'failed',packageHash:packageDigest(pkg),renderer:RENDERER,fixturesVersion:FIXTURES_VERSION,pageCount:pages.length,issues:actual.issues,overflowGuard,formats:['html'],testedAt:new Date().toISOString(),scope:'browser-geometry-and-assets; semantic-reference-match-requires-human-review'}
}
export async function verifyPages(pages,options){
 if(!pages.length)throw fail('没有可检查的页面。')
 const result=await measureHtml(renderNativeDocument(pages),options)
 if(result.pages!==pages.length||result.issues.length)throw fail('页面存在内容溢出或缺少素材，请调整分页、内容或版式；未生成新成果。'+JSON.stringify(result.issues.slice(0,6)),409,'LAYOUT_PAGE_UNFIT')
 return {renderer:RENDERER,pageCount:result.pages,checkedAt:new Date().toISOString(),formats:['html']}
}
