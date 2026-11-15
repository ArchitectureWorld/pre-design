import {createHash} from 'node:crypto'
import {z} from 'zod'
import {createPackage,validatePackage,patchSchema,fail,exportReusable} from './contract.mjs'
import {samplePages,validatePublication} from './validation.mjs'
import {renderNativeDocument} from './render.mjs'
import {importReference} from './reference.mjs'
const id=z.string().uuid(),version=z.number().int().positive(),requestId=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)
const target=z.object({requestId,id,version}).strict()
const mutation=z.object({requestId}).strict()
const ref=z.object({resourceId:id,version}).strict().nullable()
const binding=z.object({requestId,baseRevision:z.number().int().nonnegative(),draftId:id,expectedRevision:z.number().int().nonnegative(),scope:z.enum(['global','local','manual']),pageIds:z.array(z.string().max(150)).min(1).max(200).refine(a=>new Set(a).size===a.length).optional(),resource:ref.optional(),overrides:patchSchema.optional(),remove:z.boolean().optional()}).strict()
export function registerLayoutRoutes({app,library,project,workflows,serial,event,enqueueReference,listReferenceJobs,cancelReference,referenceConfiguration,retryReference,validator=validatePublication}){
 app.get('/api/layout-library',async req=>({resources:await library.list(req.user)}))
 app.get('/api/layout-library/starter',async()=>({package:createPackage()}))
 app.post('/api/layout-library',async req=>{const b=mutation.extend({package:z.unknown()}).parse(req.body);return library.create(req.user,b)})
 app.post('/api/layout-library/import',async req=>{
  const b=mutation.extend({filename:z.string().min(1).max(180),content:z.string().max(12*1024*1024),name:z.string().min(1).max(100).optional()}).parse(req.body)
  const imported=await importReference(b.filename,b.content,b.name)
  return {...await library.create(req.user,{requestId:b.requestId,package:imported.package,sourceFile:{filename:b.filename,sha256:createHash('sha256').update(Buffer.from(b.content,'base64')).digest('hex'),content:b.content}}),observations:imported.observations,limitations:imported.package.source.limitations}
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
 app.post('/api/layout-library/:resourceId/:version/validate',async req=>{
  z.object({}).strict().parse(req.body??{});const r=id.parse(req.params.resourceId),v=version.parse(Number(req.params.version)),x=await library.get(req.user,r,v)
  if(x.ownerId!==req.user.id&&req.user.role!=='admin')throw fail('只允许检查自己的资源。',403)
  return serial('layout-qa',async()=>library.saveValidation(req.user,r,v,await validator(x.package)))
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
  return {...config,stale:config.draftId!==null&&config.draftId!==state.current?.id,appliedRevision:state.visuals?.current?.layoutBindingRevision??null,
   status:state.visuals?.current?.layoutBindingRevision===config.revision&&!state.visuals.current.stale?'applied':'saved-pending-apply'}
 })
 app.post('/api/projects/:id/layout-bindings',async req=>{
  const b=binding.parse(req.body),p=await project(req)
  return serial(`enqueue:${p.id}`,async()=>{
   if((p.state?.project?.currentRevision??0)!==b.baseRevision)throw fail('项目版本已变化。',409)
   const draft=(await workflows.current(p,false)).current
   const result=await library.saveBindings(req.user,p,b,draft);await event(p.id,{type:'layout-bindings-saved',revision:result.revision});return result
  })
 })
 app.post('/api/projects/:id/layout-save-page',async req=>{
  const b=mutation.extend({visualId:id,pageId:z.string().min(1).max(150),name:z.string().min(1).max(100)}).parse(req.body)
  const p=await project(req),state=await workflows.current(p),deck=state.visuals?.current
  if(!deck||deck.id!==b.visualId||deck.stale)throw fail('请先打开当前有效视觉成果。',409)
  const page=deck.pages.find(x=>x.id===b.pageId);if(!page)throw fail('页面不存在。',404)
  return library.create(req.user,{requestId:b.requestId,package:exportReusable(page,b.name)})
 })
 if(enqueueReference){
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
