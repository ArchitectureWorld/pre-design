import {resolveBrowserExecutable} from '../../../../src/report/browser-executable.ts'
import {measureContentFitSlots} from './content-fit-measurement.js'
/** Only server-rendered native HTML may be passed here; all network is blocked. */
export async function measureContentFitHtml(html,{canvas,policies,signal}){
 signal?.throwIfAborted()
 const {chromium}=await import('playwright-core')
 const browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true,timeout:20000})
 const abort=()=>{void browser.close()};signal?.addEventListener('abort',abort,{once:true})
 try{
  signal?.throwIfAborted()
  const context=await browser.newContext({viewport:{width:Math.ceil(canvas.width+80),height:Math.ceil(canvas.height+80)},serviceWorkers:'block'});await context.route('**/*',route=>route.abort())
  const page=await context.newPage();await page.setContent(html,{waitUntil:'load',timeout:15000});await page.waitForFunction(()=>document.fonts.status==='loaded',{},{timeout:10000})
  if(await page.locator('[data-native-page]').count()!==1)throw Error('CONTENT_FIT_SINGLE_PAGE_REQUIRED')
  return await page.evaluate(({fn,canvas,policies})=>(0,eval)('('+fn+')')(document.querySelector('[data-native-page]'),{canvas,policies}),{fn:measureContentFitSlots.toString(),canvas,policies})
 }finally{signal?.removeEventListener('abort',abort);await browser.close()}
}
