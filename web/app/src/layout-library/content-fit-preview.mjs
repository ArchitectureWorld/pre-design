import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {samplePages,measureHtml} from './validation.mjs'
import {renderNativeDocument} from './render.mjs'
import {validatePackage,resolvePage} from './contract.mjs'
import {adaptationFingerprint,proposeContentFitAdaptation} from './content-fit-adaptation.mjs'
import {validateContentFitPolicy} from './content-fit-policy.mjs'
import {measureContentFitHtml} from './content-fit-browser.mjs'
const key=z.string().regex(/^[a-z][a-z0-9-]{0,47}$/)
const input=z.object({layoutId:key,title:z.string().trim().min(1).max(100),textBlocks:z.array(z.object({key,text:z.string().min(1).max(5000)}).strict()).min(1).max(32),policies:z.array(z.object({slotId:key,direction:z.enum(['left','up','down'])}).strict()).min(1).max(32)}).strict()
const confirmation=z.object({previewId:z.string().uuid(),requestId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),reviewed:z.literal(true)}).strict()
const fail=(message,statusCode=409)=>{throw Object.assign(Error(message),{code:'CONTENT_FIT_PREVIEW_INVALID',statusCode})}
export function createContentFitPreviews({library,measure=measureContentFitHtml,check=measureHtml,clock=Date.now}){
 const active=new Set(),pending=new Map(),ttl=15*60*1000
 const clean=()=>{for(const [id,p]of pending)if(p.expiresAt<=clock())pending.delete(id)}
 async function current(actor,id,version,hash){const r=await library.get(actor,id,version);if(r.ownerId!==actor.id)fail('只允许适配自己的版式。',403);if(r.deleted||r.retired||r.version!==version||r.latestVersion!==version||hash&&hash!==r.hash)fail('原版已变化，请重新预览。');return r}
 async function preview(actor,id,version,body,{signal}={}){
  const b=input.parse(body);signal?.throwIfAborted()
  if(active.size>=2||active.has(actor.id))fail('正在生成适配预览，请稍后重试。',429)
  active.add(actor.id)
  const controller=new AbortController(),abort=()=>controller.abort(signal.reason),timer=setTimeout(()=>controller.abort(Error('CONTENT_FIT_TIMEOUT')),60000)
  signal?.addEventListener('abort',abort,{once:true})
  try{return await performPreview(actor,id,version,b,controller.signal)}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);active.delete(actor.id)}
 }
 async function performPreview(actor,id,version,b,signal){
  signal.throwIfAborted();clean();if(pending.size>=32||[...pending.values()].filter(p=>p.ownerId===actor.id).length>=8)fail('待确认预览过多，请稍后重试。',429)
  const r=await current(actor,id,version);signal.throwIfAborted();if(Buffer.byteLength(JSON.stringify(r.package))>2*1024*1024)fail('此版式过大，暂不支持在线适配。');const pkg=validatePackage(structuredClone(r.package)),layout=pkg.layouts.find(l=>l.id===b.layoutId)
  if(!layout?.contentAdaptationPolicy)fail('此版式尚无可核对的适配边界。')
  const policy=validateContentFitPolicy(layout.contentAdaptationPolicy,layout)
  if(new Set(b.policies.map(p=>p.slotId)).size!==b.policies.length||new Set(b.textBlocks.map(t=>t.key)).size!==b.textBlocks.length)fail('槽位或正文重复。')
  const rules=b.policies.map(rule=>{const saved=policy.entries.find(e=>e.slotId===rule.slotId);if(!saved||!saved.directions.includes(rule.direction))fail('此槽位不支持所选方向。');return{...rule,maxGrowth:saved.maxGrowth}})
  const groups=new Map();for(const e of policy.entries){const prior=groups.get(e.parentId);if(prior&&JSON.stringify(prior.rect)!==JSON.stringify(e.bounds))fail('父组边界不一致。');groups.set(e.parentId,{id:e.parentId,kind:'group',rect:e.bounds})}
  const observation={source:policy.source,components:[...groups.values(),...policy.entries.map(e=>({id:e.slotId,kind:'text',parentId:e.parentId,rect:e.sourceRect}))]},contentBySlot={}
  for(const slot of layout.slots.filter(s=>s.role==='text')){const text=b.textBlocks.find(t=>t.key===slot.binding);if(!text)fail('请提供每个文字槽位的完整试排内容。');contentBySlot[slot.id]=text.text}
  const page=samplePages(pkg).find(p=>p.nativeLayout.layout.id===layout.id);if(!page)fail('版式无试排页。');page.item.title=b.title;page.item.textBlocks=b.textBlocks
  page.nativeLayout=resolvePage({page,globalPackage:pkg,local:{overrides:{layoutId:layout.id}}})
  const beforeHtml=renderNativeDocument([page]),measured=await measure(beforeHtml,{canvas:pkg.canvas,policies:rules,signal}),measurement={...adaptationFingerprint(layout,contentBySlot,pkg.canvas,observation),slots:measured.slots}
  signal.throwIfAborted()
  const proposal=proposeContentFitAdaptation({layout,contentBySlot,canvas:pkg.canvas,observation,measurement,policies:rules,gap:policy.minGap})
  const next=structuredClone(pkg),nextLayout=next.layouts.find(l=>l.id===layout.id)
  for(const slot of nextLayout.slots)if(proposal.adjustments[slot.id])slot.rect=proposal.adjustments[slot.id].rect
  next.source.limitations.push('显式内容适配：仅在已保存父组边界内派生槽位几何；原观察、字号、正文不变。真实内容试排通过不等于原稿视觉一致或任意内容均可复用；图像仅合成占位。')
  const validated=validatePackage(next);page.nativeLayout=resolvePage({page,globalPackage:validated,local:{overrides:{layoutId:layout.id}}});const afterHtml=renderNativeDocument([page]),qa=await check(afterHtml,{signal})
  if(qa.pages!==1||!Array.isArray(qa.issues)||qa.issues.length)fail('派生版式仍存在溢出或缺失，未生成可确认预览。')
  signal.throwIfAborted();await current(actor,id,version,r.hash);signal.throwIfAborted();clean();if(pending.size>=32)fail('待确认预览过多。',429)
  const previewId=randomUUID(),expiresAt=clock()+ttl;pending.set(previewId,{ownerId:actor.id,id,version,hash:r.hash,package:validated,expiresAt})
  return{previewId,resourceId:id,sourceVersion:version,sourceHash:r.hash,expiresAt,beforeHtml,afterHtml,changes:proposal.review.changes,qa,visualAcceptance:'pending',fixtureImages:true}
 }
 async function confirm(actor,id,body){
  const b=confirmation.parse(body);clean();const p=pending.get(b.previewId);if(!p||p.ownerId!==actor.id||p.id!==id)fail('预览不存在或已过期，请重新计算。')
  if(p.result){if(p.requestId!==b.requestId)fail('该预览已保存。');return p.result}
  await current(actor,id,p.version,p.hash)
  const result=await library.revise(actor,{id,requestId:b.requestId,expectedVersion:p.version,expectedHash:p.hash,requireActive:true,package:p.package});p.result=result;p.requestId=b.requestId;return result
 }
 return{preview,confirm}
}
