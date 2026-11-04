import {randomUUID,createHash} from 'node:crypto'
import {workflowError} from './workflow-contract.mjs'
import {workflowBlockItems} from './workflow-content.mjs'
import {VISUAL_THEME,renderVisualDeck} from './workflow-visual-view.mjs'
const fingerprint=body=>createHash('sha256').update(JSON.stringify(body)).digest('hex')
export async function createWorkflowVisualStore(db,{currentDraft}){
 await db.query(`CREATE TABLE IF NOT EXISTS workflow_visuals(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),version integer NOT NULL,draft_id uuid NOT NULL REFERENCES workflow_drafts(id),document jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,version));
 CREATE TABLE IF NOT EXISTS workflow_visual_requests(project_id uuid NOT NULL REFERENCES projects(id),request_id text NOT NULL,fingerprint text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(project_id,request_id));`)
 const query=async(sql,args=[])=>(await db.query(sql,args)).rows
 const hydrate=row=>row?{...row.document,id:row.id,version:row.version,createdAt:new Date(row.created_at).toISOString()}:null
 async function current(p,draft){
  const rows=await query('SELECT * FROM workflow_visuals WHERE project_id=$1 ORDER BY version DESC',[p.id]),doc=hydrate(rows[0])
  if(doc)doc.stale=!draft||draft.stale||draft.id!==doc.draftId||!draft.approval
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
   if(isRevision){
    if(!body.pageIds?.length||!body.layout)throw workflowError('请选择要调整的页面和版式。',400)
    const ids=new Set(body.pageIds)
    if([...ids].some(id=>!source.pages.some(page=>page.id===id)))throw workflowError('选定页面不在当前成果中。',404)
    pages=source.pages.map(page=>ids.has(page.id)?{...page,layout:body.layout}:page)
   }else{
    let number=0
    pages=draft.flow.flatMap(chapterId=>draft.blocks.filter(block=>block.chapterId===chapterId).flatMap(block=>workflowBlockItems(block).map(item=>({id:'visual-page-'+item.id,itemId:item.id,blockId:block.id,itemCount:workflowBlockItems(block).length,number:++number,chapterTitle:draft.chapters.find(chapter=>chapter.id===chapterId)?.title??chapterId,sectionTitle:block.title,item,layout:'points'}))))
   }
   if(!pages.length)throw workflowError('当前脚本没有可生成的条目。')
   const id=randomUUID(),version=(previous?.version??0)+1,createdAt=new Date().toISOString(),document={id,version,projectName:draft.projectName,draftId:draft.id,draftVersion:draft.version,theme:source?.theme??VISUAL_THEME,pages,evidence:draft.evidence,createdAt,sourceVisualId:source?.id??null}
   await conn.query('INSERT INTO workflow_visuals(id,project_id,version,draft_id,document) VALUES($1,$2,$3,$4,$5)',[id,p.id,version,draft.id,document])
   const result={id,version,draftId:draft.id,pageCount:pages.length}
   await conn.query('INSERT INTO workflow_visual_requests(project_id,request_id,fingerprint,result) VALUES($1,$2,$3,$4)',[p.id,body.requestId,hash,result]);await conn.query('COMMIT');return result
  }catch(error){await conn.query('ROLLBACK');throw error}finally{conn.release()}
 }
 const filename=doc=>`${doc.projectName.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,90)}_汇报成果_V${doc.version}.html`
 async function listArtifacts(p){return(await query('SELECT * FROM workflow_visuals WHERE project_id=$1 ORDER BY version DESC',[p.id])).map(row=>{const doc=hydrate(row);return {id:`workflow-visual-${row.id}-html`,filename:filename(doc),kind:'workflow-visual',bytes:Buffer.byteLength(renderVisualDeck(doc)),version:doc.version,draftVersion:doc.draftVersion,pageCount:doc.pages.length,status:'generated'}})}
 async function readArtifact(p,id){const match=/^workflow-visual-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})-html$/.exec(id);if(!match)throw workflowError('成果文件不存在。',404);const row=(await query('SELECT * FROM workflow_visuals WHERE project_id=$1 AND id=$2',[p.id,match[1]]))[0];if(!row)throw workflowError('成果文件不存在。',404);const doc=hydrate(row);return {data:Buffer.from(renderVisualDeck(doc)),filename:filename(doc),contentType:'text/html; charset=utf-8'}}
 return {current,generate,listArtifacts,readArtifact}
}
