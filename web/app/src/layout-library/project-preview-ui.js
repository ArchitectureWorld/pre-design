const invalid=()=>{throw Object.assign(new Error('当前页或版式身份不完整，请重新打开预览。'),{code:'PROJECT_PREVIEW_INVALID'})}
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const identifier=value=>typeof value==='string'&&value.trim().length>0&&value.length<=150&&!/[\u0000-\u001f\u007f]/.test(value)
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const v of Object.values(value))freeze(v)}return value}
/** Saved-resource, current-page preview only. No save calls, inference or sample fallback. */
export function createProjectLayoutPreview({request,context,resource,isCurrent}={}){
 if(typeof request!=='function'||typeof isCurrent!=='function'||!uuid(context?.projectId)||!uuid(context?.draftId)||!identifier(context?.pageId)||!uuid(resource?.id)||!Number.isSafeInteger(resource?.version)||resource.version<1||typeof resource?.hash!=='string'||!/^[a-f0-9]{64}$/i.test(resource.hash))invalid()
 const layouts=resource?.package?.layouts
 if(!Array.isArray(layouts)||!layouts.length||layouts.some(l=>!identifier(l?.id))||new Set(layouts.map(l=>l.id)).size!==layouts.length)invalid()
 const fixedContext=freeze(structuredClone(context)),fixedResource=freeze(structuredClone(resource)),layoutIds=new Set(fixedResource.package.layouts.map(l=>l.id))
 function check(signal){
  if(signal?.aborted)throw signal.reason??Object.assign(new Error('预览已取消。'),{name:'AbortError'})
  if(isCurrent()!==true)throw Object.assign(new Error('当前项目、稿件或版式已变化，请重新打开预览。'),{name:'AbortError',code:'PROJECT_PREVIEW_STALE'})
 }
 return async function preview(layoutId,{signal}={}){
  check(signal)
  if(!layoutIds.has(layoutId))invalid()
  const result=await request('/projects/'+fixedContext.projectId+'/layout-preview',{method:'POST',body:{draftId:fixedContext.draftId,pageId:fixedContext.pageId,scope:'local',resource:{resourceId:fixedResource.id,version:fixedResource.version},overrides:{layoutId}},signal})
  check(signal)
  if(!result||result.draftId!==fixedContext.draftId||result.pageId!==fixedContext.pageId||typeof result.html!=='string'||!result.html.trim())invalid()
  return result
 }
}

/** Experimental own-content rendering only. Never saves or marks a layout usable. */
export function createProjectEditorialPreview({request,context,resource,isCurrent,styleAcknowledged}={}){
 if(styleAcknowledged!==true||typeof request!=='function')invalid()
 const fixed=freeze(structuredClone(resource)),fixedContext=freeze(structuredClone(context))
 return createProjectLayoutPreview({context:fixedContext,resource:fixed,isCurrent,request:async(_path,options)=>{
  const b=options.body,layoutId=b.overrides.layoutId
  const result=await request('/projects/'+fixedContext.projectId+'/layout-editorial-preview',{method:'POST',signal:options.signal,body:{draftId:b.draftId,pageId:b.pageId,resourceId:fixed.id,version:fixed.version,expectedHash:fixed.hash,layoutId,styleAcknowledged:true}})
  if(!result||result.experimental!==true||result.resourceId!==fixed.id||result.version!==fixed.version||result.sourceHash!==fixed.hash||result.sourceLayoutId!==layoutId)invalid()
  return result
 }})
}
