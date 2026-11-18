import {createContentMappingPreflight} from './content-mapping-preflight.mjs'
import {prepareLayoutPreview} from './layout-preview.mjs'
import {createContentFitPreviews} from './content-fit-preview.mjs'
import {createHash} from 'node:crypto'
import {contentMappingSchema,contentSourceOptions} from './content-mapping.mjs'
import {z} from 'zod'
import {createPackage,validatePackage,patchSchema,fail,exportReusable,packageDigest} from './contract.mjs'
import {samplePages,validatePublication} from './validation.mjs'
import {renderNativeDocument} from './render.mjs'
import {importReference} from './reference.mjs'
import {referencePagesForLayout} from './reference-review.mjs'
import {MAX_REFERENCE_UPLOAD_BYTES} from './reference-uploads.mjs'
const id=z.string().uuid(),version=z.number().int().positive(),requestId=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)
const target=z.object({requestId,id,version}).strict()
const mutation=z.object({requestId}).strict()
const ref=z.object({resourceId:id,version}).strict().nullable()
const binding=z.object({requestId,baseRevision:z.number().int().nonnegative(),draftId:id,expectedRevision:z.number().int().nonnegative(),scope:z.enum(['global','local','manual','content']),pageIds:z.array(z.string().max(150)).min(1).max(200).refine(a=>new Set(a).size===a.length).optional(),resource:ref.optional(),overrides:patchSchema.optional(),contentMapping:contentMappingSchema.optional(),remove:z.boolean().optional()}).strict()
 .refine(b=>b.scope==='content'?b.pageIds?.length===1&&(b.remove?b.contentMapping===undefined:!!b.contentMapping):b.contentMapping===undefined,'文字映射须单页明确提交或移除')
export function registerLayoutRoutes({app,library,annotations,uploads,project,workflows,serial,event,enqueueReference,listReferenceJobs,cancelReference,referenceConfiguration,retryReference,listConversations,getConversation,recordReferenceImport,resolveLayoutAssets=async pages=>pages,validator=validatePublication,mappingMeasure}){
 const contentFit=createContentFitPreviews({library})
 const mappingPreflight=createContentMappingPreflight({measure:mappingMeasure})
 app.post('/api/layout-library/:resourceId/:version/content-fit-preview',{bodyLimit:256*1024},async(req,reply)=>{
  reply.header('Cache-Control','private, no-store')
  const controller=new AbortController(),abort=()=>controller.abort(),closed=()=>{if(!reply.raw.writableEnded)abort()}
  req.raw.once('aborted',abort);reply.raw.once('close',closed)
  if(req.raw.aborted||reply.raw.destroyed)abort()
  try{return await contentFit.preview(req.user,id.parse(req.params.resourceId),version.parse(Number(req.params.version)),req.body,{signal:controller.signal})}
  finally{req.raw.removeListener('aborted',abort);reply.raw.removeListener('close',closed)}
 })
 app.post('/api/layout-library/:resourceId/content-fit-confirm',{bodyLimit:4096},async(req,reply)=>{
  reply.header('Cache-Control','private, no-store')
  return contentFit.confirm(req.user,id.parse(req.params.resourceId),req.body)
 })
 if(uploads){
  app.post('/api/layout-library/reference-files',{bodyLimit:Math.ceil(MAX_REFERENCE_UPLOAD_BYTES/3)*4+16384},async(req,reply)=>{
   const controller=new AbortController(),abort=()=>controller.abort(),closed=()=>{if(!reply.raw.writableEnded)abort()}
   req.raw.once('aborted',abort);reply.raw.once('close',closed)
   if(req.raw.aborted||reply.raw.destroyed)abort()
   try{
   if(req.headers['content-type']?.split(';')[0].trim()==='application/octet-stream'){
    let filename;try{filename=decodeURIComponent(req.headers['x-reference-filename']??'')}catch{throw fail('文件名编码无效。')}
    const body=mutation.extend({filename:z.string().min(1).max(180)}).strict().parse({requestId:req.headers['x-reference-request-id'],filename})
    const declaredLength=req.headers['content-length']===undefined?undefined:Number(req.headers['content-length'])
    return await serial('layout-upload:'+req.user.id,()=>uploads.createFromStream(req.user,body,req.body,declaredLength,{signal:controller.signal}))
   }
   const body=mutation.extend({filename:z.string().min(1).max(180),content:z.string().max(Math.ceil(MAX_REFERENCE_UPLOAD_BYTES/3)*4)}).strict().parse(req.body)
   return await serial('layout-upload:'+req.user.id,()=>uploads.create(req.user,body,{signal:controller.signal}))
   }finally{req.raw.removeListener('aborted',abort);reply.raw.removeListener('close',closed)}
  })
  app.get('/api/layout-library/reference-files/:fileId/download',async(req,reply)=>{
   const file=await uploads.download(req.user,id.parse(req.params.fileId))
   reply.header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`).header('Content-Security-Policy',"sandbox; default-src 'none'").type('application/octet-stream');return file.data
  })
 }

 if(annotations){
  app.get('/api/layout-library/:resourceId/:version/annotations',async req=>({annotations:await annotations.list(req.user,id.parse(req.params.resourceId),version.parse(Number(req.params.version)))}))
  app.post('/api/layout-library/:resourceId/:version/annotations',async req=>{
   const b=mutation.extend({packageHash:z.string().regex(/^[a-f0-9]{64}$/),layoutId:z.string().min(1).max(48),slotId:z.string().min(1).max(48).optional(),text:z.string().trim().min(1).max(5000)}).strict().parse(req.body)
   const {requestId,text,...anchor}=b;return annotations.create(req.user,{requestId,text,anchor:{...anchor,resourceId:id.parse(req.params.resourceId),version:version.parse(Number(req.params.version))}})
  })
  for(const operation of ['edit','delete'])app.post('/api/layout-library/:resourceId/annotations/:annotationId/'+operation,async req=>{
   const change=mutation.extend({expectedRevision:z.number().int().nonnegative()});const b=(operation==='edit'?change.extend({text:z.string().trim().min(1).max(5000)}):change).strict().parse(req.body)
   return annotations.change(req.user,{...b,resourceId:id.parse(req.params.resourceId),noteId:id.parse(req.params.annotationId)},operation)
  })
  app.post('/api/layout-library/:resourceId/:version/annotations/batch-submit',async req=>{
   const b=mutation.extend({packageHash:z.string().regex(/^[a-f0-9]{64}$/),annotationIds:z.array(id).min(1).max(50).refine(ids=>new Set(ids).size===ids.length),annotationRevisions:z.record(id,z.number().int().nonnegative()),allowModel:z.literal(true)}).strict().parse(req.body)
   return enqueueReference(req,{...b,mode:'conversation',resourceId:id.parse(req.params.resourceId),resourceVersion:version.parse(Number(req.params.version)),files:[],text:'',referencePipeline:'native-v3'})
  })
 }
 app.get('/api/layout-library',async req=>({resources:await library.list(req.user)}))
 app.get('/api/layout-library/starter',async()=>({package:createPackage()}))
 app.post('/api/layout-library',async req=>{const b=mutation.extend({package:z.unknown()}).parse(req.body);return library.create(req.user,b)})
 app.post('/api/layout-library/import',async req=>{
  const b=mutation.extend({filename:z.string().min(1).max(180),content:z.string().max(12*1024*1024),name:z.string().min(1).max(100).optional()}).parse(req.body)
  const imported=await importReference(b.filename,b.content,b.name)
  const input={requestId:b.requestId,package:imported.package,sourceFile:{filename:b.filename,sha256:createHash('sha256').update(Buffer.from(b.content,'base64')).digest('hex'),content:b.content}}
  const saved=recordReferenceImport?await recordReferenceImport(req,input):await library.create(req.user,input)
  return {...saved,observations:imported.observations,limitations:imported.package.source.limitations}
 })
 app.post('/api/layout-library/seed',async req=>{
  if(req.user.role!=='admin')throw fail('只有管理员可以预置官方候选。',403)
  const b=mutation.parse(req.body),created=[]
  for(const [suffix,name,colors] of [['blue','清晰蓝灰 · 汇报套件',{background:'#f7f9fc',ink:'#24364c',accent:'#3454a0',muted:'#53647c'}],['green','自然墨绿 · 规划套件',{background:'#f8f7f2',ink:'#1e302a',accent:'#285342',muted:'#4d6257'}],['gray','简约深灰 · 研究套件',{background:'#ffffff',ink:'#20242b',accent:'#363f50',muted:'#57616f'}]]){
   const p=createPackage(name);Object.assign(p.theme,colors);p.source.kind='built-in';p.rights={basis:'original',shareAllowed:true,note:'平台原创样式和声明式布局，不包含客户资料、第三方图片或字体文件。'}
   created.push(await library.create(req.user,{requestId:createHash('sha256').update(b.requestId+'-'+suffix).digest('hex'),package:p}))
  }
  return {created,status:'drafts-require-validation-and-review'}
 })
 app.get('/api/layout-library/:resourceId/source',async(req,reply)=>{
  const f=await library.sourceFile(req.user,id.parse(req.params.resourceId));reply.header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`).header('Content-Security-Policy',"sandbox; default-src 'none'").type('application/octet-stream');return Buffer.from(f.body_base64,'base64')
 })
 app.get('/api/layout-library/:resourceId/:version',async req=>library.get(req.user,id.parse(req.params.resourceId),version.parse(Number(req.params.version))))
 app.post('/api/layout-library/:resourceId/revisions',async req=>{
  const b=mutation.extend({expectedVersion:version,package:z.unknown()}).parse(req.body);return library.revise(req.user,{...b,id:id.parse(req.params.resourceId)})
 })
 app.post('/api/layout-library/:resourceId/:version/derive-style-adaptation',async req=>{
  const b=mutation.extend({expectedHash:z.string().regex(/^[a-f0-9]{64}$/),strategyVersion:z.literal(1),styleAcknowledged:z.literal(true)}).strict().parse(req.body)
  return library.deriveStyle(req.user,{...b,id:id.parse(req.params.resourceId),version:version.parse(Number(req.params.version))})
 })
 app.post('/api/layout-library/:resourceId/:version/derive-sparse-cards',async req=>{
  const source=z.object({fileSha256:z.string().regex(/^[a-f0-9]{64}$/),pageNumber:z.number().int().positive().max(300)}).strict()
  const b=mutation.extend({expectedHash:z.string().regex(/^[a-f0-9]{64}$/),strategyVersion:z.literal(1),source:source.optional()}).strict().parse(req.body)
  return library.deriveSparse(req.user,{...b,id:id.parse(req.params.resourceId),version:version.parse(Number(req.params.version))})
 })
 app.post('/api/layout-library/:resourceId/:version/validate',async req=>{
  z.object({}).strict().parse(req.body??{});const r=id.parse(req.params.resourceId),v=version.parse(Number(req.params.version)),x=await library.get(req.user,r,v)
  if(x.ownerId!==req.user.id&&req.user.role!=='admin')throw fail('只允许检查自己的资源。',403)
  return serial('layout-qa',async()=>library.saveValidation(req.user,r,v,await validator(x.package)))
 })
 app.post('/api/layout-library/:resourceId/:version/compare',async(req,reply)=>{
  const b=z.object({layoutId:z.string().min(1).max(48),source:z.object({fileSha256:z.string().regex(/^[a-f0-9]{64}$/),pageNumber:z.number().int().positive()}).strict().optional()}).strict().parse(req.body)
  const resourceId=id.parse(req.params.resourceId),v=version.parse(Number(req.params.version)),x=await library.get(req.user,resourceId,v)
  if(x.ownerId!==req.user.id)throw fail('请由资源拥有者对照自己的参考原页。',403)
  const styleSource=await library.resolveStyleSource?.(req.user,{id:resourceId,version:v,layoutId:b.layoutId})
  if(styleSource&&b.source)throw fail('平台风格重设计不接受原页来源替换。',409)
  const references=styleSource?[]:referencePagesForLayout(x.package,b.layoutId)
  if(b.source&&!references.some(p=>p.fileSha256===b.source.fileSha256&&p.pageNumber===b.source.pageNumber))throw fail('所选原页不是当前版式的证据来源。',409)
  let source=null
  for(const reference of b.source?[b.source]:references){
   try{source=await uploads?.previewBySource(req.user,reference.fileSha256,reference.pageNumber);if(source)break}
   catch(error){if(b.source||error.statusCode!==404)throw error}
  }
  if(references.length&&!source)throw fail('此页面类型的证据页没有可用原页预览。请补充相应页面截图后重新分析。',409,'LAYOUT_REFERENCE_PREVIEW_REQUIRED')
  const page=samplePages(x.package).find(page=>page.nativeLayout.layout.id===b.layoutId&&page.id.endsWith('typical'))
  if(!page)throw fail('没有此版式的试排页面。',404)
  const html=renderNativeDocument([page],{title:'参考设计迁移 · 合成内容试排'})
  const nativeImagePlacements=source&&uploads?.placementEvidence?await uploads.placementEvidence(req.user,source.fileId,source.sourceSha256,source.page):undefined
  const receipt=await library.referenceComparison(req.user,{id:resourceId,version:v,layoutId:b.layoutId,source,html})
  reply.header('Cache-Control','private, no-store')
  return {receipt,html,...(styleSource?{sourcePreviewHtml:styleSource.html,sourceIdentity:Object.fromEntries(Object.entries(styleSource).filter(([k])=>k!=='html'))}:{}),profile:x.package.designProfile,references,fixture:true,source:source?{name:source.name,page:source.page,sha256:source.sha256,...(nativeImagePlacements?{nativeImagePlacements}:{}),dataUrl:'data:'+source.mimeType+';base64,'+source.data.toString('base64')}:null}
 })
 app.post('/api/layout-library/:resourceId/:version/reference-review',async req=>{
  const b=mutation.extend({packageHash:z.string().regex(/^[a-f0-9]{64}$/),comparisonIds:z.array(id).min(1).max(100),reviewed:z.literal(true)}).strict().parse(req.body)
  return library.confirmReferenceReview(req.user,{...b,id:id.parse(req.params.resourceId),version:version.parse(Number(req.params.version))})
 })
 app.post('/api/layout-library/:resourceId/:version/publish',async req=>{
  const b=mutation.extend({visibility:z.enum(['private','shared','official']),reviewed:z.literal(true)}).parse(req.body)
  return library.publish(req.user,{...b,id:id.parse(req.params.resourceId),version:version.parse(Number(req.params.version))})
 })
 app.post('/api/layout-library/:resourceId/:version/request-share',async req=>{
  const b=mutation.parse(req.body);return library.requestShare(req.user,{...b,id:id.parse(req.params.resourceId),version:version.parse(Number(req.params.version))})
 })
 app.post('/api/layout-library/:resourceId/retire',async req=>{
  const b=mutation.extend({expectedVersion:version}).parse(req.body);return library.retire(req.user,{...b,id:id.parse(req.params.resourceId)})
 })
 app.post('/api/layout-library/:resourceId/delete',async req=>{
  const b=mutation.extend({expectedVersion:version}).parse(req.body)
  return library.remove(req.user,{...b,kind:'resource',id:id.parse(req.params.resourceId)})
 })
 app.post('/api/layout-library/:resourceId/restore',async req=>{
  const b=mutation.extend({deleteToken:id}).parse(req.body)
  return library.restore(req.user,{...b,kind:'resource',id:id.parse(req.params.resourceId)})
 })
 app.get('/api/layout-library/:resourceId/:version/export',async(req,reply)=>{
  const x=await library.get(req.user,id.parse(req.params.resourceId),version.parse(Number(req.params.version)))
  reply.type('application/json').header('Content-Disposition',`attachment; filename="pre-design-layout-${x.id}-v${x.version}.json"`)
  return x.package
 })
 app.post('/api/layout-library/preview',async req=>{
  const b=z.object({package:z.unknown(),layoutId:z.string().max(48).optional()}).strict().parse(req.body),p=validatePackage(b.package)
  const pages=samplePages(p),selected=b.layoutId?pages.find(x=>x.nativeLayout.layout.id===b.layoutId&&x.id.endsWith('typical')):pages[0]
  if(!selected)throw fail('未找到此版式。',404)
  return {html:renderNativeDocument([selected],{title:p.name}),renderer:selected.nativeLayout.renderer,fixture:true}
 })
 app.get('/api/projects/:id/layout-bindings',async req=>{
  const p=await project(req),config=await library.bindings(p),state=await workflows.current(p)
  const draft=state.current,contentSources=draft&&!draft.stale?Object.fromEntries(draft.blocks.flatMap(block=>(block.items??[]).map(item=>['visual-page-'+item.id,contentSourceOptions(item)]))):{}
  return {...config,contentSources,contentDraftId:draft?.id??null,stale:config.draftId!==null&&config.draftId!==state.current?.id,appliedRevision:state.visuals?.current?.layoutBindingRevision??null,
   status:state.visuals?.current?.layoutBindingRevision===config.revision&&!state.visuals.current.stale?'applied':'saved-pending-apply'}
 })
 app.post('/api/projects/:id/layout-bindings',{bodyLimit:256*1024},async(req,reply)=>{
  const b=binding.parse(req.body),p=await project(req)
  const ordinary=()=>serial(`enqueue:${p.id}`,async()=>{
   if((p.state?.project?.currentRevision??0)!==b.baseRevision)throw fail('项目版本已变化。',409)
   const draft=(await workflows.current(p,false)).current
   const result=await library.saveBindings(req.user,p,b,draft);await event(p.id,{type:'layout-bindings-saved',revision:result.revision});return result
  })
  if(b.scope!=='content'||b.remove)return ordinary()
  const controller=new AbortController(),abort=()=>controller.abort(),closed=()=>{if(!reply.raw.writableEnded)abort()}
  req.raw.once('aborted',abort);reply.raw.once('close',closed);if(req.raw.aborted||reply.raw.destroyed)abort()
  const prepare=async (signal,connection)=>{
   signal.throwIfAborted();const fresh=await project(req,connection)
   if((fresh.state?.project?.currentRevision??0)!==b.baseRevision)throw fail('项目版本已变化。',409)
   const state=await workflows.current(fresh,true,connection)
   const snapshot=await prepareLayoutPreview({actor:req.user,p:fresh,state,b:{...b,pageId:b.pageIds[0]},library,resolveLayoutAssets,requireReviewed:true,connection});signal.throwIfAborted();return snapshot
  }
  try{return await mappingPreflight.run(req.user,{signal:controller.signal,replay:()=>library.bindingMutationResult(req.user,p,b),prepare,
   commit:checked=>serial(`enqueue:${p.id}`,()=>checked(async (receipt,preflightSignal)=>{
    const fresh=await project(req),draft=(await workflows.current(fresh,false)).current
    const result=await library.saveBindings(req.user,fresh,b,draft,{preflight:receipt,signal:preflightSignal,assertPreflight:async connection=>{
     const snapshot=await prepare(preflightSignal,connection)
     if(packageDigest(snapshot)!==receipt.snapshotHash)throw fail('试排后内容或版式已变化，未保存，请重新核对。',409,'CONTENT_MAPPING_PREFLIGHT_STALE')
    }})
    await event(p.id,{type:'layout-bindings-saved',revision:result.revision});return result
   }))
  })}finally{req.raw.removeListener('aborted',abort);reply.raw.removeListener('close',closed)}
 })

 app.post('/api/projects/:id/layout-preview',async req=>{
  const b=z.object({draftId:id,pageId:z.string().min(1).max(150),scope:z.enum(['global','local','manual','content']).optional(),resource:ref.optional(),overrides:patchSchema.optional(),contentMapping:contentMappingSchema.optional(),remove:z.boolean().optional()}).strict()
   .refine(v=>v.scope||v.resource===undefined&&v.overrides===undefined,'预览覆盖需要指定范围')
   .refine(v=>v.scope==='content'?(v.remove?v.contentMapping===undefined:!!v.contentMapping):v.contentMapping===undefined&&v.remove===undefined,'预览映射须明确提交或移除').parse(req.body)
  const p=await project(req),state=await workflows.current(p)
  const {identity,...preview}=await prepareLayoutPreview({actor:req.user,p,state,b,library,resolveLayoutAssets});return preview
 })
 app.post('/api/projects/:id/layout-save-page',async req=>{
  const b=mutation.extend({visualId:id,pageId:z.string().min(1).max(150),name:z.string().min(1).max(100)}).parse(req.body)
  const p=await project(req),state=await workflows.current(p),deck=state.visuals?.current
  if(!deck||deck.id!==b.visualId||deck.stale)throw fail('请先打开当前有效视觉成果。',409)
  const page=deck.pages.find(x=>x.id===b.pageId);if(!page)throw fail('页面不存在。',404)
  return library.create(req.user,{requestId:b.requestId,package:exportReusable(page,b.name)})
 })
 if(enqueueReference){
  app.post('/api/layout-library/conversations/:conversationId/delete',req=>library.remove(req.user,{...mutation.parse(req.body),kind:'conversation',id:id.parse(req.params.conversationId)}))
  app.post('/api/layout-library/conversations/:conversationId/restore',req=>library.restore(req.user,{...mutation.extend({deleteToken:id}).parse(req.body),kind:'conversation',id:id.parse(req.params.conversationId)}))
  app.get('/api/layout-library/conversations',async req=>({conversations:await listConversations(req)}))
  app.get('/api/layout-library/conversations/:conversationId',req=>{id.parse(req.params.conversationId);return getConversation(req)})
  app.post('/api/layout-library/conversations',async req=>{
   const b=mutation.extend({conversationId:id.optional(),resourceId:id.optional(),resourceVersion:version.optional(),package:z.unknown().optional(),
    referenceVisualSemantics:z.boolean().optional(),referenceExtraction:z.literal('components').optional(),componentPages:z.array(z.number().int().min(1).max(300)).min(1).max(6).optional(),referencePipeline:z.enum(['native-v3','legacy-v2']).optional(),referenceScope:z.enum(['brand','style','layout','deck']).optional(),referenceFidelity:z.enum(['standard','fidelity']).optional(),referenceIntent:z.enum(['style','structure']).optional(),name:z.string().trim().min(1).max(100).optional(),text:z.string().trim().max(16000).default(''),
    files:z.array(z.union([z.object({id}).strict(),z.object({name:z.string().min(1).max(180),text:z.string().min(1).max(16000)}).strict()])).max(8).default([]),
    selection:z.object({layoutId:z.string().max(48),slot:z.enum(['title','claim','body','image','table','chart','timeline','diagram','source']),slotId:z.string().min(1).max(48).optional()}).strict().nullable().optional(),
    allowModel:z.literal(true)}).strict().refine(b=>b.text||b.files.length,'请输入消息或上传参考文件').refine(b=>!b.resourceId||b.resourceVersion,'请选择具体版式版本').parse(req.body)
   return enqueueReference(req,{...b,mode:'conversation'})
  })
  app.get('/api/layout-library/reference-config',referenceConfiguration)
  app.post('/api/layout-library/reference-jobs',async req=>{
   const b=mutation.extend({name:z.string().trim().min(1).max(100),text:z.string().trim().min(1).max(16000),allowModel:z.literal(true)}).parse(req.body)
   return enqueueReference(req,b)
  })
  app.get('/api/layout-library/reference-jobs',listReferenceJobs)
  app.post('/api/layout-library/reference-jobs/:jobId/cancel',cancelReference)
  app.post('/api/layout-library/reference-jobs/:jobId/retry',req=>{
   id.parse(req.params.jobId)
   return retryReference(req,mutation.parse(req.body))
  })
 }
}
