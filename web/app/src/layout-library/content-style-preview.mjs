import {z} from 'zod'
import {packageDigest,validatePackage,resolvePage,fail} from './contract.mjs'
import {compileNativeDesignPackageV3} from './native-design-compiler.mjs'
import {renderNativeDocument} from './render.mjs'
import {proposeContentStyleCompositions} from './content-style-composition-policy.mjs'
import {buildContentStyleCompositionPlan} from './content-style-composition-plan.mjs'
import {createContentStyleBrowserMeasurer} from './content-driven-style-browser.mjs'
import {resolveBrowserExecutable} from '../../../../src/report/browser-executable.ts'
const requestSchema=z.object({draftId:z.string().uuid(),pageId:z.string().min(1).max(150),resourceId:z.string().uuid(),version:z.number().int().positive(),expectedHash:z.string().regex(/^[a-f0-9]{64}$/),layoutId:z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),styleAcknowledged:z.literal(true)}).strict()
const invalid=(message,status=409)=>{throw fail(message,status,'CONTENT_STYLE_PREVIEW_INVALID')}
export function contentStyleExpectedSlots(expected){
 return expected.nativeLayout.layout.slots.map(s=>({id:s.id,role:s.role,selector:s.role==='title'?'h2':s.role==='claim'?'p':s.role==='body'?(s.style?.bodyPresentationVersion===1&&s.style.bodyPresentation==='labeled-paragraph'?'p':'li'):'.ln-slot-content>span',texts:s.role==='title'?[expected.item.title]:s.role==='claim'?[expected.item.paragraphs[s.index]]:s.role==='body'?[expected.item.points[s.index]]:s.role==='source'?[expected.chapterTitle+(expected.item.evidenceIndexes?.length?' · 资料 '+expected.item.evidenceIndexes.map(i=>`[${i+1}]`).join(' '):''),String(expected.number)]:[]}))
}
/** Independent full-page check. Only trusted renderer HTML reaches this browser. */
export async function checkContentStylePreviewHtml(html,{page:expected,signal}={}){
 signal?.throwIfAborted();const {chromium}=await import('playwright-core')
 const browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true,timeout:20000,args:['--disable-background-networking','--disable-sync','--no-first-run']})
 const abort=()=>{void browser.close()};signal?.addEventListener('abort',abort,{once:true})
 try{
  signal?.throwIfAborted();const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block',viewport:{width:Math.ceil(expected.nativeLayout.canvas.width+80),height:Math.ceil(expected.nativeLayout.canvas.height+80)}})
  await context.route('**/*',r=>r.abort());await context.routeWebSocket('**/*',s=>s.close())
  const tab=await context.newPage();tab.setDefaultTimeout(15000);await tab.setContent(html,{waitUntil:'load',timeout:15000})
  const expectedSlots=contentStyleExpectedSlots(expected)
  const result=await tab.evaluate(async({id,slots})=>{
   await document.fonts.ready;const issues=[],pages=[...document.querySelectorAll('[data-native-page]')];if(document.fonts.status!=='loaded'||[...document.fonts].some(f=>f.status==='error'))issues.push({code:'fonts-not-ready'})
   await Promise.all([...document.images].map(i=>i.decode().catch(()=>issues.push({code:'image-unavailable'}))))
   const page=pages.find(p=>p.dataset.nativePage===id);if(!page)return{pages:pages.length,issues:[{code:'page-missing'}],contentVerified:false}
   const bounds=page.getBoundingClientRect(),rects=[];let contentVerified=true
   for(const s of slots){const els=[...page.querySelectorAll('[data-layout-slot-id]')].filter(e=>e.dataset.layoutSlotId===s.id);if(els.length!==1){issues.push({code:'slot-missing'});contentVerified=false;continue}const el=els[0],r=el.getBoundingClientRect();rects.push(r)
    const texts=[...el.querySelectorAll(s.selector)].map(n=>n.textContent)
    if(JSON.stringify(texts)!==JSON.stringify(s.texts)){issues.push({code:'content-mismatch',slotId:s.id});contentVerified=false}
    if(r.left<bounds.left-2||r.top<bounds.top-2||r.right>bounds.right+2||r.bottom>bounds.bottom+2)issues.push({code:'bounds',slotId:s.id})
    if(el.scrollWidth>el.clientWidth+2||el.scrollHeight>el.clientHeight+2)issues.push({code:'overflow',slotId:s.id})
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);for(let n=walker.nextNode();n;n=walker.nextNode()){if(!n.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(n);for(const b of range.getClientRects())if(b.left<r.left-2||b.right>r.right+2||b.top<r.top-2||b.bottom>r.bottom+2)issues.push({code:'glyph-bounds',slotId:s.id})}
   }
   if(page.querySelectorAll('[data-layout-slot-id]').length!==slots.length){issues.push({code:'extra-slot'});contentVerified=false}
   for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++)if(Math.min(rects[i].right,rects[j].right)-Math.max(rects[i].left,rects[j].left)>1&&Math.min(rects[i].bottom,rects[j].bottom)-Math.max(rects[i].top,rects[j].top)>1)issues.push({code:'overlap'})
   return{pages:pages.length,issues,contentVerified}
  },{id:expected.id,slots:expectedSlots});signal?.throwIfAborted();return result
 }finally{signal?.removeEventListener('abort',abort);await browser.close()}
}
export function createContentStylePreviews({library,workflows,createMeasurer=createContentStyleBrowserMeasurer,check=checkContentStylePreviewHtml,timeoutMs=60000}){
 const active=new Set()
 async function snapshot(actor,p,b,refreshProject){
  const fresh=await refreshProject();if(fresh.id!==p.id)invalid('项目身份已变化。')
  const state=structuredClone(await workflows.current(fresh,true)),draft=state.current
  if(!draft||draft.stale||draft.id!==b.draftId)invalid('稿件已变化，请重新选择当前页。')
  const config=structuredClone(await library.bindings(fresh));if(config.draftId&&config.draftId!==draft.id)invalid('版式配置属于旧稿。')
  const resource=structuredClone(await library.get(actor,b.resourceId,b.version))
  if(resource.ownerId!==actor.id)invalid('只允许试排自己的资源。',403)
  if(resource.id!==b.resourceId||resource.version!==b.version||resource.latestVersion!==b.version||resource.deleted||resource.retired||resource.hash!==b.expectedHash||packageDigest(resource.package)!==b.expectedHash)invalid('资源身份、版本或内容已变化。')
  if(JSON.stringify(resource.package).length>2*1024*1024)invalid('资源过大，无法在本轮安全试排。')
  const pages=draft.flow.flatMap(chapterId=>draft.blocks.filter(block=>block.chapterId===chapterId).flatMap(block=>(block.items??[]).map(item=>({id:'visual-page-'+item.id,itemId:item.id,blockId:block.id,item,chapterTitle:draft.chapters.find(c=>c.id===chapterId)?.title??chapterId,sectionTitle:block.title})))).map((page,index)=>({...page,number:index+1}))
  const page=pages.find(x=>x.id===b.pageId);if(!page)invalid('当前稿件不存在指定页面。',404)
  const deck=state.visuals?.current,protectedLayout=deck&&!deck.stale&&deck.draftId===draft.id?deck.pages.find(x=>x.id===page.id)?.protectedLayout:null
  const identity=packageDigest({project:fresh,draft,config,resource:{id:resource.id,version:resource.version,latestVersion:resource.latestVersion,hash:resource.hash},protectedLayout:protectedLayout??null})
  return{identity,config,resource,page,protectedLayout}
 }
 async function preview(actor,p,body,{signal,refreshProject}={}){
  const b=requestSchema.parse(body);if(typeof refreshProject!=='function')invalid('缺少项目授权读取。');signal?.throwIfAborted()
  if(active.has(actor.id)||active.size>=2)invalid('正在试排或并发已满，请稍后重试。',429)
  active.add(actor.id);const controller=new AbortController(),abort=()=>controller.abort(signal.reason),timer=setTimeout(()=>controller.abort(Error('试排超时，未返回成果。')),timeoutMs);signal?.addEventListener('abort',abort,{once:true})
  if(signal?.aborted)abort();let measurer
  const stop=()=>controller.signal.throwIfAborted()
  let onAbort;const aborted=new Promise((_,reject)=>{onAbort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',onAbort,{once:true});if(controller.signal.aborted)onAbort()})
  const wait=promise=>Promise.race([promise,aborted])
  try{
   const initial=await wait(snapshot(actor,p,b,refreshProject));stop();const pkg=validatePackage(initial.resource.package)
   if(!pkg.layouts.some(l=>l.id===b.layoutId))invalid('源版式不存在。')
   const policy=proposeContentStyleCompositions({item:initial.page.item,sourceStyle:pkg.designSpec?.profile.designSystem,styleAcknowledged:true,version:'content-style-composition-v4'})
   const opening=createMeasurer({signal:controller.signal});opening.then(m=>{if(controller.signal.aborted)void m.close().catch(()=>{})},()=>{});measurer=await wait(opening);stop()
   for(const candidate of policy.candidates){
    stop();let plan
    try{plan=await wait(buildContentStyleCompositionPlan({sourcePackage:pkg,layoutId:b.layoutId,item:initial.page.item,candidate,styleAcknowledged:true},{measureText:r=>{stop();return measurer.measureText(r)}}))}catch(e){stop();if(e.code==='CONTENT_STYLE_COMPOSITION_PLAN_INVALID'&&/完整内容超过单页容量/.test(e.message))continue;throw e}
    const spec=structuredClone(pkg.designSpec);spec.profile.evidence.push(...plan.delta.evidence);spec.profile.archetypes.push(plan.delta.archetype);spec.masterLayoutGraph.push(...plan.delta.masterLayoutGraph);spec.components.push(...plan.delta.components)
    const compiled=compileNativeDesignPackageV3({name:pkg.name,rights:pkg.rights,designSpec:spec,prototypes:[...pkg.layouts.map(({kind,...l})=>l),plan.prototype]})
    const page=structuredClone(initial.page);page.nativeLayout=resolvePage({page,globalPackage:compiled,local:{overrides:{layoutId:plan.prototype.id}}})
    // Strip the private content-derived layout key from the returned HTML.
    const html=renderNativeDocument([page],{title:page.item.title}).replaceAll(`data-layout="${plan.prototype.id}"`,'data-layout="experimental-editorial-preview"')
    const qa=await wait(check(html,{page,signal:controller.signal}));stop()
    if(qa?.pages!==1||qa.contentVerified!==true||!Array.isArray(qa.issues))invalid('整页原文与来源检查未通过。')
    if(qa.issues.length){if(qa.issues.every(i=>['overflow','bounds','glyph-bounds','overlap'].includes(i.code)))continue;invalid('整页检查未通过，未返回试排。')}
    const final=await wait(snapshot(actor,p,b,refreshProject));stop();if(final.identity!==initial.identity)invalid('试排期间稿件、资源或绑定已变化，请重新试排。')
    return{html,experimental:true,visualAcceptance:'pending',projectId:p.id,draftId:b.draftId,pageId:b.pageId,resourceId:b.resourceId,version:b.version,sourceHash:b.expectedHash,sourceLayoutId:b.layoutId,bindingRevision:initial.config.revision,policyVersion:policy.version,composition:{mode:candidate.id,columns:candidate.flow.columns},fallback:candidate.selectionRole==='fallback-only',typography:{title:{fontSize:candidate.typography.title.fontSize},claim:{fontSize:candidate.typography.claim.fontSize},body:{fontSize:candidate.typography.body.fontSize}},limitations:['实验试排未保存、未发布、未改变版式绑定；不代表最终成果采用此设计。',...(candidate.flow.columns===2?['当前双栏按完整段落和原文顺序实测重设计，并非原参考布局还原。']:[]),...(plan.receipt.sourceFooter?.mode==='derived'?['当前页脚按项目引用推导，非原参考页脚还原。']:[]),...(initial.config.manual?.[b.pageId]||initial.protectedLayout?['本页已有手动或保护版式，保持未修改。']:[])]}
   }
   invalid('所有实测候选未通过完整单页检查；未截断正文或返回示例，请明确调整分页。')
  }finally{clearTimeout(timer);controller.signal.removeEventListener('abort',onAbort);signal?.removeEventListener('abort',abort);try{await measurer?.close()}finally{active.delete(actor.id)}}
 }
 return{preview}
}
