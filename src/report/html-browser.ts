import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { resolveBrowserExecutable } from './browser-executable.ts'
import type { ReportAcceptanceFinding } from './delivery-contract.ts'

export interface ReportBrowserResult {
  readonly version: 'report-browser.v1'
  readonly viewport: { width: number; height: number }
  readonly pages: readonly { pageId: string; sourcePageId: string; screenshot: string; assetIds: string[] }[]
  readonly navigation: boolean
  readonly findings: readonly ReportAcceptanceFinding[]
}
export class Cdp {
  private sequence=0
  private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:unknown)=>void}>()
  readonly ready:Promise<void>
  constructor(private socket:WebSocket,signal:AbortSignal){
    this.ready=new Promise((resolve,reject)=>{socket.addEventListener('open',()=>resolve(),{once:true});socket.addEventListener('error',()=>reject(new Error('HTML_BROWSER_CONNECT')),{once:true})})
    const stop=()=>{for(const p of this.pending.values())p.reject(new Error('HTML_BROWSER_CLOSED'));this.pending.clear()}
    socket.addEventListener('close',stop)
    socket.addEventListener('message',event=>{const row=JSON.parse(String(event.data));const p=this.pending.get(row.id);if(!p)return;this.pending.delete(row.id);if(row.error)p.reject(new Error('HTML_BROWSER_PROTOCOL: '+row.error.message));else p.resolve(row.result)})
    signal.addEventListener('abort',()=>{stop();socket.close()},{once:true})
  }
  async send(method:string,params:Record<string,unknown>={},sessionId?:string):Promise<any>{
    await this.ready
    const id=++this.sequence
    return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))})
  }
  close(){this.socket.close()}
}

/** Product runtime QA: a disposable browser/profile visits the exported package, never the user's session. */
export async function inspectReportHtml(root:string,options:{browserExecutable?:string;signal?:AbortSignal;timeoutMs?:number}={}):Promise<ReportBrowserResult>{
  const signal=AbortSignal.any([options.signal??new AbortController().signal,AbortSignal.timeout(options.timeoutMs??180000)])
  signal.throwIfAborted()
  const base=await realpath(root),profile=await mkdtemp(join(tmpdir(),'preplanning-report-browser-'))
  const failedResources=new Set<string>(),mime:Record<string,string>={'.html':'text/html; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.css':'text/css','.js':'text/javascript'}
  const server=createServer(async(req,res)=>{
    try{
      const pathname=decodeURIComponent(new URL(req.url??'/', 'http://localhost').pathname)
      if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return}
      const path=await realpath(resolve(base,'.'+pathname)),rel=relative(base,path)
      if(isAbsolute(rel)||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../'))throw new Error('outside package')
      const bytes=await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)]??'application/octet-stream','Cache-Control':'no-store'});res.end(bytes)
    }catch{failedResources.add(req.url??'/');res.writeHead(404);res.end()}
  })
  let child:ReturnType<typeof spawn>|undefined,cdp:Cdp|undefined
  const findings:ReportAcceptanceFinding[]=[],pages:ReportBrowserResult['pages'][number][]=[]
  try{
    await new Promise<void>((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done)})
    const address=server.address();if(!address||typeof address==='string')throw new Error('HTML_BROWSER_SERVER')
    const url=`http://127.0.0.1:${address.port}/html/index.html`
    const endpoint=await new Promise<string>((done,fail)=>{
      child=spawn(resolveBrowserExecutable(options.browserExecutable),['--headless=new','--edge-skip-compat-layer-relaunch','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{shell:false,windowsHide:true,stdio:['ignore','ignore','pipe']})
      let buffer=''
      const abort=()=>fail(new Error('HTML_BROWSER_TIMEOUT'))
      signal.addEventListener('abort',abort,{once:true})
      child.once('error',fail);child.once('exit',()=>fail(new Error('HTML_BROWSER_EXIT')))
      child.stderr!.on('data',chunk=>{buffer=(buffer+String(chunk)).slice(-8192);const match=/DevTools listening on (ws:\/\/[^\s]+)/u.exec(buffer);if(match){signal.removeEventListener('abort',abort);done(match[1]!)}})
    })
    cdp=new Cdp(new WebSocket(endpoint),signal);await cdp.ready
    const target=await cdp.send('Target.createTarget',{url:'about:blank'}),attached=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true}),sessionId=String(attached.sessionId)
    const send=(method:string,params:Record<string,unknown>={})=>cdp!.send(method,params,sessionId)
    const evaluate=async(expression:string)=>{signal.throwIfAborted();const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error('HTML_BROWSER_SCRIPT: '+String(r.exceptionDetails.text));return r.result.value}
    await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url})
    await evaluate(`new Promise(resolve=>{if(document.readyState==='complete')resolve(true);else window.addEventListener('load',()=>resolve(true),{once:true})})`)
    await evaluate(`document.fonts.ready.then(()=>true)`)
    const ids=await evaluate(`[...document.querySelectorAll('.report-page')].map(p=>p.id)`) as string[]
    if(!ids.length||new Set(ids).size!==ids.length)throw new Error('HTML_PAGES_INVALID')
    await mkdir(join(base,'html-review'),{recursive:true})
    const active=()=>evaluate(`document.querySelector('.report-page.active')?.id`)
    const settle=()=>evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`)
    const navigate=async(expression:string,expected:string)=>{await evaluate(expression);await settle();if(await active()!==expected)findings.push({code:'HTML_NAVIGATION',message:`导航未到达 ${expected}。`})}
    for(let i=0;i<ids.length;i++){
      await navigate(`(()=>{const jump=document.querySelector('#page-number');jump.value=${i+1};jump.dispatchEvent(new Event('change',{bubbles:true}))})()`,ids[i]!)
      const inspection=await evaluate(`(()=>{const p=document.querySelector('.report-page.active');const rect=p.getBoundingClientRect();const outside=(r,b)=>r.left<b.left-2||r.top<b.top-2||r.right>b.right+2||r.bottom>b.bottom+2;
        const overflow=[...p.querySelectorAll('.regular-text,.regular-table,td,th')].filter(e=>{const r=e.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(e);return e.scrollHeight>e.clientHeight+2||e.scrollWidth>e.clientWidth+2||outside(range.getBoundingClientRect(),r)||outside(r,rect)}).map(e=>e.dataset.nodeId||e.textContent.slice(0,60));
        const images=[...p.querySelectorAll('img')].map(e=>({assetId:e.dataset.assetId||'',loaded:e.complete&&e.naturalWidth>0,src:e.getAttribute('src'),retained:e.dataset.retainedArea===undefined?null:Number(e.dataset.retainedArea)}));
        return{pageId:p.id,sourcePageId:p.dataset.sourcePageId||p.id,overflow,images}})()`)
      for(const value of inspection.overflow)findings.push({code:'HTML_TEXT_OVERFLOW',pageId:inspection.sourcePageId,message:`文字超出版面：${value}`})
      for(const img of inspection.images){
        if(!img.loaded)findings.push({code:'HTML_IMAGE_LOAD',pageId:inspection.sourcePageId,message:`图片未加载：${img.assetId||img.src}`})
        if(img.retained!==null&&(!Number.isFinite(img.retained)||img.retained<=0))findings.push({code:'HTML_IMAGE_CROP',pageId:inspection.sourcePageId,message:`图片裁切无有效内容：${img.assetId}`})
      }
      const screenshot=`html-review/page-${String(i+1).padStart(4,'0')}.png`,capture=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
      await writeFile(join(base,screenshot),Buffer.from(capture.data,'base64'))
      pages.push({pageId:inspection.pageId,sourcePageId:inspection.sourcePageId,screenshot,assetIds:inspection.images.map((v:{assetId:string})=>v.assetId)})
      if(i<ids.length-1){await navigate(`document.querySelector('#next-page').click()`,ids[i+1]!);await navigate(`document.querySelector('#previous-page').click()`,ids[i]!)}
    }
    await navigate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))`,ids[0]!)
    if(ids.length>1){await navigate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`,ids[1]!);await navigate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`,ids[0]!)}
    await navigate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`,ids.at(-1)!)
    const chapters=await evaluate(`[...document.querySelectorAll('#chapter-select option')].map(o=>({value:o.value,id:[...document.querySelectorAll('.report-page')].find(p=>p.dataset.chapter===o.value)?.id}))`) as {value:string;id:string}[]
    if(!chapters.length)findings.push({code:'HTML_NAVIGATION',message:'章节目录缺失。'})
    for(const chapter of chapters)await navigate(`(()=>{const select=document.querySelector('#chapter-select');select.value=${JSON.stringify(chapter.value)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`,chapter.id)
    const evidence=await evaluate(`(async()=>{const link=[...document.querySelectorAll('a')].find(a=>a.getAttribute('href')==='../planning-sources.html');if(!link)return false;const r=await fetch(link.href);const text=await r.text();if(!r.ok||!text.includes('资料依据'))return false;const doc=new DOMParser().parseFromString(text,'text/html');for(const a of doc.querySelectorAll('a[href]')){const href=a.getAttribute('href');if(href.startsWith('sources/')){const response=await fetch(new URL(href,link.href));if(!response.ok)return false;await response.arrayBuffer()}}return true})()`)
    if(!evidence)findings.push({code:'HTML_SOURCES',message:'资料与计算依据入口无法读取。'})
    for(const resource of failedResources)findings.push({code:'HTML_RESOURCE_LOAD',message:`资源加载失败：${resource}`})
    signal.throwIfAborted()
    return{version:'report-browser.v1',viewport:{width:1440,height:900},pages,navigation:!findings.some(f=>f.code==='HTML_NAVIGATION'),findings}
  }finally{
    cdp?.close()
    if(child&&child.exitCode===null){child.kill();await new Promise<void>(done=>{const timer=setTimeout(done,3000);child!.once('exit',()=>{clearTimeout(timer);done()})})}
    server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()))
    await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>{})
  }
}
