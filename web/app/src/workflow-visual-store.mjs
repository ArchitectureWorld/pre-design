import {randomUUID,createHash} from 'node:crypto'
import {workflowError} from './workflow-contract.mjs'
import {workflowBlockItems} from './workflow-content.mjs'
import {verifyPages} from './layout-library/validation.mjs'
import {packageDigest,RENDERER,RENDERER_V2} from './layout-library/contract.mjs'
import {VISUAL_THEME,renderVisualDeck} from './workflow-visual-view.mjs'
const fingerprint=body=>createHash('sha256').update(JSON.stringify(body)).digest('hex')
export async function createWorkflowVisualStore(db,{currentDraft,layoutLibrary,verifyLayoutPages=verifyPages,resolveLayoutAssets=async pages=>pages}){
 await db.query(`CREATE TABLE IF NOT EXISTS workflow_visuals(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),version integer NOT NULL,draft_id uuid NOT NULL REFERENCES workflow_drafts(id),document jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,version));
 CREATE TABLE IF NOT EXISTS workflow_visual_requests(project_id uuid NOT NULL REFERENCES projects(id),request_id text NOT NULL,fingerprint text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(project_id,request_id));`)
 const query=async(sql,args=[])=>(await db.query(sql,args)).rows
 const hydrate=row=>row?{...row.document,id:row.id,version:row.version,createdAt:new Date(row.created_at).toISOString()}:null
 async function current(p,draft){
  const rows=await query('SELECT * FROM workflow_visuals WHERE project_id=$1 ORDER BY version DESC',[p.id]),doc=hydrate(rows[0])
  if(doc){doc.stale=!draft||draft.stale||draft.id!==doc.draftId||!draft.approval;delete doc.renderedHtml}
  if(doc&&layoutLibrary){const config=await layoutLibrary.bindings(p);doc.layoutPending=config.revision!==(doc.layoutBindingRevision??0)||config.draftId!==null&&config.draftId!==draft?.id}
  return {current:doc,history:rows.map(row=>({id:row.id,version:row.version,draftId:row.draft_id,createdAt:new Date(row.created_at).toISOString()}))}
 }
 async function generate(p,body){
  const hash=fingerprint(body),conn=await db.connect()
  try{
   await conn.query('BEGIN');await conn.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[p.id])
   const prior=(await conn.query('SELECT fingerprint,result FROM workflow_visual_requests WHERE project_id=$1 AND request_id=$2',[p.id,body.requestId])).rows[0]
   if(prior){if(prior.fingerprint!==hash)throw workflowError('请求编号已用于其他成果操作。');await conn.query('COMMIT');return prior.result}
   if((await conn.query("SELECT id FROM jobs WHERE project_id=$1 AND status IN ('queued','running','cancelling') LIMIT 1",[p.id])).rows.length)throw workflowError('项目任务正在执行，请结束后生成成果。')
   const draft=await currentDraft(p)
   if(!draft||draft.id!==body.draftId||draft.stale||draft.formatVersion!==2||!draft.approval)throw workflowError('请先确认当前完整条目脚本，再生成整套成果。')
   const previous=(await conn.query('SELECT * FROM workflow_visuals WHERE project_id=$1 ORDER BY version DESC LIMIT 1',[p.id])).rows[0]
   const source=hydrate(previous),isRevision=!!body.baseVisualId
   if(isRevision&&(!source||source.id!==body.baseVisualId||source.draftId!==draft.id))throw workflowError('成果或脚本版本已更新，请打开当前成果再修改。')
   if(!isRevision&&(body.pageIds||body.layout))throw workflowError('首次生成须使用整份脚本与统一版式。',400)
   let pages
   if(isRevision&&!body.applyLibrary){
    if(!body.pageIds?.length||!body.layout)throw workflowError('请选择要调整的页面和版式。',400)
    const ids=new Set(body.pageIds)
    if([...ids].some(id=>!source.pages.some(page=>page.id===id)))throw workflowError('选定页面不在当前成果中。',404)
    pages=source.pages.map(page=>ids.has(page.id)?{...page,layout:body.layout,...(page.nativeLayout?{protectedLayout:{...page.protectedLayout,layoutId:body.layout}}:{})}:page)
   }else if(isRevision){pages=source.pages.map(p=>({...p}))
   }else{
    let number=0
    pages=draft.flow.flatMap(chapterId=>draft.blocks.filter(block=>block.chapterId===chapterId).flatMap(block=>workflowBlockItems(block).map(item=>({id:'visual-page-'+item.id,itemId:item.id,blockId:block.id,itemCount:workflowBlockItems(block).length,number:++number,chapterTitle:draft.chapters.find(chapter=>chapter.id===chapterId)?.title??chapterId,sectionTitle:block.title,item,layout:item.presentation?.layout??'points'}))))
   }
   if(!pages.length)throw workflowError('当前脚本没有可生成的条目。')
   let bindingRevision=null,qa=null
   if(layoutLibrary){
    const config=await layoutLibrary.bindings(p,conn)
    if(isRevision&&!body.applyLibrary&&[RENDERER,RENDERER_V2].includes(source?.renderer)&&config.revision!==source.layoutBindingRevision)throw workflowError('另有版式配置待应用，请先应用该配置，再做单页修改。')
    if(body.applyLibrary&&body.expectedBindingRevision!==config.revision)throw workflowError('版式配置已经改变，请刷新后重排。')
    if(body.applyLibrary||config.revision||[RENDERER,RENDERER_V2].includes(source?.renderer)||pages.some(p=>p.item.figure||p.item.figures?.length||p.item.table||p.item.chart||p.item.timeline||p.item.diagram)){
     if(config.draftId!==null&&config.draftId!==draft.id)throw workflowError('版式绑定属于旧稿，请先在版式库为当前稿重新保存配置。')
     pages=layoutLibrary.compilePages(pages,config)
     pages=await resolveLayoutAssets(pages,p)
     qa=await verifyLayoutPages(pages)
     bindingRevision=config.revision
    }
   }

   const id=randomUUID(),version=(previous?.version??0)+1,createdAt=new Date().toISOString(),document={id,version,projectName:draft.projectName,draftId:draft.id,draftVersion:draft.version,theme:source?.theme??VISUAL_THEME,pages,evidence:draft.evidence,createdAt,sourceVisualId:source?.id??null}
   if(bindingRevision!==null){
    document.layoutBindingRevision=bindingRevision;document.renderer=pages.some(p=>p.nativeLayout.renderer===RENDERER_V2)?RENDERER_V2:RENDERER;document.layoutQa=qa;document.layoutSkillIds=['V07','V08','V10','V11','V12','V13','Q07']
    document.renderedHtml=renderVisualDeck(document);document.renderedHtmlHash=packageDigest(document.renderedHtml)
   }
   await conn.query('INSERT INTO workflow_visuals(id,project_id,version,draft_id,document) VALUES($1,$2,$3,$4,$5)',[id,p.id,version,draft.id,document])
   if(bindingRevision!==null)for(const page of pages)for(const ref of page.nativeLayout.resourceRefs){
    await conn.query('INSERT INTO layout_library_usage(visual_id,resource_id,resource_version,page_id,project_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(visual_id,resource_id,page_id) DO NOTHING',[id,ref.resourceId,ref.version,page.id,p.id])
   }
   const result={id,version,draftId:draft.id,pageCount:pages.length}

   await conn.query('INSERT INTO workflow_visual_requests(project_id,request_id,fingerprint,result) VALUES($1,$2,$3,$4)',[p.id,body.requestId,hash,result]);await conn.query('COMMIT');return result
  }catch(error){await conn.query('ROLLBACK');throw error}finally{conn.release()}
 }
 const filename=doc=>`${doc.projectName.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,90)}_汇报成果_V${doc.version}.html`
 async function listArtifacts(p){return(await query('SELECT * FROM workflow_visuals WHERE project_id=$1 ORDER BY version DESC',[p.id])).map(row=>{const doc=hydrate(row);return {id:`workflow-visual-${row.id}-html`,filename:filename(doc),kind:'workflow-visual',bytes:Buffer.byteLength(renderVisualDeck(doc)),version:doc.version,draftVersion:doc.draftVersion,pageCount:doc.pages.length,status:'generated'}})}
 async function readArtifact(p,id){const match=/^workflow-visual-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})-html$/.exec(id);if(!match)throw workflowError('成果文件不存在。',404);const row=(await query('SELECT * FROM workflow_visuals WHERE project_id=$1 AND id=$2',[p.id,match[1]]))[0];if(!row)throw workflowError('成果文件不存在。',404);const doc=hydrate(row);return {data:Buffer.from(renderVisualDeck(doc)),filename:filename(doc),contentType:'text/html; charset=utf-8'}}
 return {current,generate,listArtifacts,readArtifact}
}
