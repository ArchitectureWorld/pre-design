import {z} from 'zod'
import {packageDigest} from './contract.mjs'
import {compositionCanvasSchema} from './composition-contract.mjs'
import {renderNativeDocument,RENDERER_V2} from './render.mjs'
import {resolveBrowserExecutable} from '../../../../src/report/browser-executable.ts'
const invalid=()=>{throw Object.assign(Error('真实文字测量请求无效或已变化。'),{code:'CONTENT_STYLE_MEASUREMENT_INVALID'})}
const schema=z.object({schemaVersion:z.literal('content-style-measurement-v1'),requestHash:z.string().regex(/^[a-f0-9]{64}$/),textId:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),role:z.enum(['title','claim','body']),text:z.string().min(1).max(16000),width:z.number().finite().positive().max(7680),canvas:compositionCanvasSchema,style:z.object({fontFamily:z.enum(['sans','serif','calligraphic-fallback']),fontSize:z.number().finite().min(22).max(320),fontWeight:z.union([z.literal(400),z.literal(500),z.literal(600),z.literal(700)]),lineHeight:z.number().finite().min(1).max(2),letterSpacing:z.number().finite().min(-4).max(48),align:z.enum(['left','center','right']),padding:z.literal(0)}).strict()}).strict()
function checked(input){const r=schema.parse(input),{requestHash,...body}=r;if(packageDigest(body)!==requestHash||r.width>r.canvas.width||r.role==='title'&&r.style.fontSize<32)invalid();return r}
/** Build only trusted renderer markup. Text is escaped by the shared renderer. */
export function contentStyleMeasurementDocument(input){
 const r=checked(input),item={title:r.role==='title'?r.text:'Measurement',paragraphs:r.role==='claim'?[r.text]:[],points:r.role==='body'?[r.text]:[],evidenceIndexes:[]}
 const target={id:'measure',role:r.role,rect:{x:0,y:0,w:r.width/r.canvas.width,h:.9},style:r.style}
 const slots=r.role==='title'?[target]:[target,{id:'aux-title',role:'title',rect:{x:0,y:.95,w:1,h:.05}}]
 const theme={background:'#ffffff',ink:'#222222',accent:'#444444',muted:'#555555',fontFamily:r.style.fontFamily==='serif'?'serif':'sans',titleSize:48,bodySize:28,captionSize:18,lineHeight:r.style.lineHeight}
 return renderNativeDocument([{id:'measurement-page',number:1,chapterTitle:'',item,nativeLayout:{renderer:RENDERER_V2,canvas:r.canvas,theme,layout:{id:'measurement-layout',kind:'composition',slots}}}])
}
/** Integer DOM scroll widths are only overflow evidence relative to clientWidth. */
export function contentStyleRequiredWidth({outerWidth,scrollWidth,clientWidth,lineRight}){
 if(![outerWidth,scrollWidth,clientWidth,lineRight].every(n=>Number.isFinite(n)&&n>=0))invalid()
 return Math.max(outerWidth,lineRight,scrollWidth>clientWidth+1?scrollWidth:0)
}
/** Internal server capability, not an API for arbitrary HTML, CSS or URLs. */
export async function createContentStyleBrowserMeasurer({signal}={}){
 signal?.throwIfAborted()
 const {chromium}=await import('playwright-core')
 const browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true,timeout:20000,args:['--disable-background-networking','--disable-sync','--no-first-run']})
 let closed=false,busy=false
 const close=async()=>{if(closed)return;closed=true;signal?.removeEventListener('abort',abort);await browser.close()}
 const abort=()=>{void close()};signal?.addEventListener('abort',abort,{once:true})
 try{
  signal?.throwIfAborted()
  const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block'});await context.route('**/*',route=>route.abort());await context.routeWebSocket('**/*',socket=>socket.close())
  const page=await context.newPage();page.setDefaultTimeout(10000)
  return {close,async measureText(input){
   const r=checked(input);if(closed||busy)invalid();signal?.throwIfAborted();busy=true
   try{
    await page.setViewportSize({width:Math.ceil(r.canvas.width+80),height:Math.ceil(r.canvas.height+80)})
    await page.setContent(contentStyleMeasurementDocument(r),{waitUntil:'load',timeout:15000})
    const result=await page.evaluate(async()=>{
     await document.fonts.ready;if(document.fonts.status!=='loaded'||[...document.fonts].some(f=>f.status==='error'))throw Error('CONTENT_STYLE_FONTS_NOT_READY')
     const slot=document.querySelector('[data-layout-slot-id="measure"]'),content=slot?.querySelector('.ln-slot-content');if(!slot||!content)throw Error('CONTENT_STYLE_MEASUREMENT_MISSING')
     const box=slot.getBoundingClientRect(),outer=content.getBoundingClientRect(),walker=document.createTreeWalker(content,NodeFilter.SHOW_TEXT),rects=[]
     for(let node=walker.nextNode();node;node=walker.nextNode()){if(!node.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(node);for(const rect of range.getClientRects())if(rect.width>0&&rect.height>0)rects.push({x:rect.left-box.left,y:rect.top-box.top,width:rect.width,height:rect.height});range.detach()}
     rects.sort((a,b)=>a.y-b.y||a.x-b.x);const lineBoxes=[]
     for(const rect of rects){const previous=lineBoxes.at(-1);if(previous&&Math.abs(previous.y-rect.y)<.5){const right=Math.max(previous.x+previous.width,rect.x+rect.width),bottom=Math.max(previous.y+previous.height,rect.y+rect.height);previous.x=Math.min(previous.x,rect.x);previous.y=Math.min(previous.y,rect.y);previous.width=right-previous.x;previous.height=bottom-previous.y}else lineBoxes.push({...rect})}
     if(!lineBoxes.length)throw Error('CONTENT_STYLE_LINES_MISSING')
     return {fontsReady:true,units:'canvas-pixels',lineBoxes,widthMetrics:{outerWidth:outer.width,scrollWidth:content.scrollWidth,clientWidth:content.clientWidth,lineRight:Math.max(...lineBoxes.map(r=>r.x+r.width))},requiredHeight:Math.ceil(Math.max(outer.height,...lineBoxes.map(r=>r.y+r.height)))+2}
    })
    signal?.throwIfAborted();if(closed)invalid()
    result.requiredWidth=contentStyleRequiredWidth(result.widthMetrics);delete result.widthMetrics
    // Preserve raw bounds; the plan validator explicitly permits only one CSS layout quantum.
    return {schemaVersion:r.schemaVersion,requestHash:r.requestHash,textId:r.textId,...result}
   }finally{busy=false}
  }}
 }catch(error){await close();throw error}
}
