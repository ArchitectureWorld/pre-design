import {randomUUID} from 'node:crypto'
import {packageDigest,fail} from './contract.mjs'
import {measureHtml} from './validation.mjs'
const MAX_HTML=8*1024*1024
const unfit=qa=>{const issues=(Array.isArray(qa?.issues)?qa.issues:[]).slice(0,8).map(i=>Object.fromEntries(['slotId','binding','code'].filter(k=>typeof i[k]==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(i[k])).map(k=>[k,i[k]])));return fail('原文在所选版式中溢出或素材缺失，未保存。请保留原文并使用显式内容适配或更换版式。'+JSON.stringify(issues),409,'CONTENT_MAPPING_UNFIT')}
/** Browser work is outside the caller's serialized commit; no waiting queue here. */
export function createContentMappingPreflight({measure=measureHtml,timeoutMs=60000}={}){
 const active=new Set()
 async function run(actor,{prepare,commit,replay,signal}){
  signal?.throwIfAborted()
  if(active.size>=2||active.has(actor.id))throw fail('正在试排原文，请稍后重试。',429,'CONTENT_MAPPING_PREFLIGHT_BUSY')
  active.add(actor.id)
  const controller=new AbortController(),abort=()=>controller.abort(signal.reason),timer=setTimeout(()=>controller.abort(fail('原文试排超时，未保存，请稍后重试。',503,'CONTENT_MAPPING_PREFLIGHT_TIMEOUT')),timeoutMs)
  signal?.addEventListener('abort',abort,{once:true})
  const check=()=>controller.signal.throwIfAborted()
  try{
   const prior=await replay?.();check();if(prior!==undefined&&prior!==null)return prior
   const snapshot=await prepare(controller.signal);check()
   if(typeof snapshot?.html!=='string'||Buffer.byteLength(snapshot.html)>MAX_HTML)throw fail('试排页超过8 MiB限制，未保存。',413,'CONTENT_MAPPING_PREFLIGHT_LIMIT')
   const snapshotHash=packageDigest(snapshot),qa=await measure(snapshot.html,{signal:controller.signal});check()
   if(qa?.pages!==1||!Array.isArray(qa.issues)||qa.issues.length)throw unfit(qa)
   const receipt={id:randomUUID(),version:1,status:'passed',snapshotHash,checkedAt:new Date().toISOString(),scope:'actual-page-geometry-not-visual-acceptance'}
   return await commit(async save=>{
    check();const again=await prepare(controller.signal);check()
    if(packageDigest(again)!==snapshotHash)throw fail('试排期间稿件、素材或版式已变化，未保存，请重新核对。',409,'CONTENT_MAPPING_PREFLIGHT_STALE')
    return save(receipt,controller.signal)
   })
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);active.delete(actor.id)}
 }
 return{run}
}
