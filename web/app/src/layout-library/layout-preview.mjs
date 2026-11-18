import {fail,packageDigest} from './contract.mjs'
import {renderNativeDocument} from './render.mjs'
export async function prepareLayoutPreview({actor,p,state,b,library,resolveLayoutAssets,requireReviewed=false,connection}){
  const draft=state.current
  if(!draft||draft.stale||draft.id!==b.draftId)throw fail('稿件已更新，请重新选择页脚本。',409)
  const pages=draft.flow.flatMap(chapterId=>draft.blocks.filter(block=>block.chapterId===chapterId).flatMap(block=>(block.items??[]).map(item=>({
   id:'visual-page-'+item.id,itemId:item.id,blockId:block.id,item,chapterTitle:draft.chapters.find(c=>c.id===chapterId)?.title??chapterId,sectionTitle:block.title,
  })))).map((page,index)=>({...page,number:index+1}))
  const page=pages.find(page=>page.id===b.pageId)
  if(!page)throw fail('当前稿件中没有这页脚本。',404)
  const deck=state.visuals?.current
  if(deck&&!deck.stale&&deck.draftId===draft.id)page.protectedLayout=deck.pages.find(previous=>previous.id===page.id)?.protectedLayout
  const config=structuredClone(await library.bindings(p,connection))
  if(config.draftId&&config.draftId!==draft.id)throw fail('版式配置属于旧稿，请先为当前稿保存配置。',409)
  if(b.scope==='global'){config.global=await (requireReviewed?library.freezeRef(actor,b.resource,connection):library.previewRef(actor,b.resource));config.globalOverrides=b.overrides??{}}
  if(b.scope==='local')config.local[b.pageId]={resource:await (requireReviewed?library.freezeRef(actor,b.resource,connection):library.previewRef(actor,b.resource)),overrides:b.overrides??{}}
  if(b.scope==='manual')config.manual[b.pageId]={...config.manual[b.pageId],...b.overrides,theme:{...config.manual[b.pageId]?.theme,...b.overrides?.theme}}
  if(b.scope==='content'){
   config.contentMappings??={}
   if(b.remove)delete config.contentMappings[b.pageId];else config.contentMappings[b.pageId]=b.contentMapping
   if(b.resource!==undefined)config.local[b.pageId]={resource:await (requireReviewed?library.freezeRef(actor,b.resource,connection):library.previewRef(actor,b.resource)),overrides:b.overrides??{}}
   else if(b.overrides!==undefined)config.manual[b.pageId]={...config.manual[b.pageId],...b.overrides,theme:{...config.manual[b.pageId]?.theme,...b.overrides?.theme}}
  }
  if(b.expectedRevision!==undefined&&config.revision!==b.expectedRevision)throw fail('版式配置已变化，请重新核对。',409)
  const rendered=await resolveLayoutAssets(library.compilePages([page],config),p,connection)
  return {html:renderNativeDocument(rendered,{title:page.item.title}),draftId:draft.id,pageId:page.id,bindingRevision:config.revision,identity:{actorId:actor.id,projectId:p.id,draftHash:packageDigest(draft),configHash:packageDigest(config),renderedHash:packageDigest(rendered)}}
}
