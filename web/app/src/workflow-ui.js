import {agentJobView} from './outline-agent.js'
import {compactWorkflowNotes,renderWorkflowItem,workflowBlockItems,workflowBodyMarkdown} from './workflow-content.mjs'

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const active=job=>['queued','running','cancelling'].includes(job.status)
const duration=seconds=>seconds<60?`${seconds} 秒`:`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`
export const workflowIsStale=project=>!!project?.workflow?.current&&(project.workflow.current.stale||project.workflow.current.outlineVersion!==project.outline?.version||project.outline?.status!=='confirmed')

export const currentWorkflowVisual=project=>{
 const draft=project?.workflow?.current,deck=project?.workflow?.visuals?.current
 return draft&&deck?.draftId===draft.id&&!deck.stale&&!workflowIsStale(project)&&deck.pages?.length?deck:null
}

export function workflowRecord(project,block,item){
 const draft=project.workflow.current,stale=workflowIsStale(project),id=item?.id??block.id
 const evidence=(item?.evidenceIndexes??block.evidenceIndexes??[]).flatMap(index=>draft.evidence?.[index]?[{...draft.evidence[index],index}]:[])
 const subdivided=!!item&&workflowBlockItems(block).length>1,title=subdivided?item.title:block.title
 const approved=item?draft.approval?.draftId===draft.id||(draft.reviewedItemIds??[]).includes(item.id):(draft.reviewedBlockIds??[]).includes(block.id)
 return {id:draft.outlineVersion===project.outline?.version?id:`workflow-${draft.id}:${id}`,objectId:id,blockId:block.id,itemId:item?.id,item,subdivided,
  outlineTask:true,workflowDraft:true,workflowDraftId:draft.id,workflowVersion:draft.version,outlineVersion:draft.outlineVersion,legacy:draft.formatVersion!==2,
  chapterId:block.chapterId,taskIndex:block.taskIndex,title,body:item?workflowBodyMarkdown([item]):block.body,thesis:title,internalNotes:block.internalNotes??[],
  workflowEvidence:evidence,limitations:[...new Set([...(draft.limitations??[]),...(block.limitations??[])])],
  approved,textGenerated:true,generated:false,stale,revision:project.revision}
}

export function workflowStatusLabel(record){return record.stale?'旧版初稿':record.legacy?'旧版脚本':record.approved?'条目已审阅':'条目待审阅'}

function editableDraft(project,record,referenceDraftId){
 if(project?.outline?.status!=='confirmed')throw new Error('请先确认本轮章节流程。')
 const draft=project.workflow?.current
 if(!record?.workflowDraft||!draft||record.workflowDraftId!==draft.id||referenceDraftId&&referenceDraftId!==draft.id)throw new Error('引用来自旧版初稿，请重新引用当前内容。')
 if(workflowIsStale(project)||record.stale)throw new Error('这是旧版初稿，请按本轮流程重新生成。')
 if(draft.formatVersion!==2)throw new Error('旧版脚本仅供查看，请先整理条目脚本。')
 const block=draft.blocks.find(block=>block.id===record.blockId)
 if(!block||!workflowBlockItems(block).some(item=>!item.legacy&&item.id===record.itemId))throw new Error('条目不在当前初稿中，请重新打开。')
 return draft
}

export function workflowDraftMutation(project,record,text,referenceDraftId){
 if(project?.outline?.status!=='confirmed')throw new Error('请先确认本轮章节流程。')
 if(!record)return {outlineVersion:project.outline.version}
 const draft=editableDraft(project,record,referenceDraftId),feedback=String(text??'').trim()
 if(!feedback)throw new Error('请填写本条修改意见。')
 return {outlineVersion:project.outline.version,baseDraftId:draft.id,blockId:record.blockId,itemId:record.itemId,text:feedback}
}

export function workflowReviewMutation(project,record){
 const draft=editableDraft(project,record)
 return {draftId:draft.id,blockId:record.blockId,itemId:record.itemId}
}

export function workflowPreviewMarkup(record,section){
 const sources=record.workflowEvidence??[],notes=compactWorkflowNotes(record),readOnly=record.stale||record.legacy
 const body=record.item?renderWorkflowItem(record.item,null):String(record.body??'').split(/\n\s*\n/).filter(Boolean).map((paragraph,index)=>`<p class="selectable" data-block="paragraph-${index+1}">${escape(paragraph).replaceAll('\n','<br>')}</p>`).join('')
 return `<div class="script-doc-top"><div class="micro">PRE—DESIGN · 阶段初稿</div><div class="script-doc-state">${workflowStatusLabel(record)}</div></div>
 <div class="workflow-pane-tabs" aria-label="预览栏目"><button type="button" data-workflow-tab="body" aria-pressed="true">汇报正文</button><button type="button" data-workflow-tab="notes" aria-pressed="false">内部备注</button></div>
 <div class="script-doc-scroll workflow-panes" data-active-pane="body"><div class="script-doc-main" data-workflow-pane="body" tabindex="0" aria-label="汇报正文"><div class="script-meta">${escape(section.number)} · ${record.subdivided?`条 · ${escape(section.sectionName??'')}`:'节'} · 初稿 V${record.workflowVersion} · 章节流程 V${record.outlineVersion}</div><h2>${escape(record.title??section.name)}</h2>
 ${readOnly?`<div class="workflow-stale" role="status">${record.stale?'目录或资料已变化，本稿仅供查看与下载。':'此稿保留原文，可整理为条目脚本。'}<button type="button" data-workflow-generate>${record.stale?'重新生成本轮初稿':'整理条目脚本'}</button></div>`:''}
 <div class="script-divider"><span>汇报正文</span><span>${readOnly?'旧版只读':'可引用并提交修改'}</span></div><div class="script-paragraphs" data-workflow-body>${body}</div></div>
 <aside class="script-doc-aside" data-workflow-pane="notes" tabindex="0" aria-label="内部备注"><div class="script-aside-card workflow-internal-notes" data-workflow-internal-notes data-workflow-notes><span>内部备注</span>${notes.length?notes.map(note=>`<div class="workflow-note"><strong>${escape(note.title)}</strong><p>${escape(note.summary)}</p>${note.details.length?`<details><summary>查看原始说明</summary><ul>${note.details.map(value=>`<li>${escape(value)}</li>`).join('')}</ul></details>`:''}</div>`).join(''):'<p>暂无额外备注。</p>'}</div>
 <div class="script-aside-card"><span>资料依据</span>${sources.length?sources.map(source=>`<details class="workflow-evidence"><summary>[${source.index+1}] ${escape(source.filename||'项目资料')}${source.locator?' · '+escape(source.locator):''}</summary><p>${escape(source.summary)}</p>${source.quote?`<blockquote>${escape(source.quote)}</blockquote>`:''}</details>`).join(''):'<p>暂无引用。</p>'}</div>
 <div class="script-aside-card"><span>初稿下载</span><button type="button" class="link-like" data-workflow-downloads>HTML / Markdown</button></div></aside></div>`
}

export function mountWorkflowStatus(before,{onOpen,onGenerate,onDownloads,onCancel,onApprove,onVisuals,onOpenVisual,onLayout,onNotice=()=>{}}){
 const panel=document.createElement('section');panel.className='workflow-status';panel.dataset.workflowStatus='';panel.setAttribute('aria-label','阶段初稿与运行状态')
 panel.innerHTML='<div class="workflow-status-top"><strong data-workflow-state></strong><span data-workflow-time></span></div><p data-workflow-activity role="status"></p><small data-workflow-summary></small><div class="workflow-actions"><button type="button" data-workflow-open>查看本轮初稿</button><button type="button" data-workflow-generate>生成本轮初稿</button><button type="button" data-workflow-downloads>下载成果</button><button type="button" data-workflow-approve hidden>确认整稿</button><button type="button" data-workflow-visuals hidden>生成整套成果</button><button type="button" data-workflow-open-visual hidden>预览汇报页</button><button type="button" data-workflow-layout hidden>调整页面版式</button><button type="button" data-workflow-cancel hidden>中止</button></div>'
 before.before(panel)
 let current={},cancelling=false
 const find=selector=>panel.querySelector(selector)
 function render(){
  const project=current.project,draft=project?.workflow?.current,view=agentJobView((project?.jobs??[]).filter(job=>job.kind==='workflow'))
  panel.hidden=!project?.outline?.draft&&!draft&&!view
  panel.dataset.status=view?.status??'idle'
  find('[data-workflow-state]').textContent=`阶段初稿 · ${view?.active?view.label:draft?workflowIsStale(project)?'旧版待更新':`V${draft.version}`:view?.label??'尚未生成'}`
  find('[data-workflow-time]').textContent=view?.elapsedSeconds!=null?`${view.status==='queued'?'已等待':view.active?'已运行':'用时'} ${duration(view.elapsedSeconds)}`:''
  find('[data-workflow-activity]').textContent=view?.error||(view?.active?view.activity||'任务已提交，等待 Agent 开始。':'')
  find('[data-workflow-activity]').hidden=!find('[data-workflow-activity]').textContent
  const structured=draft?.formatVersion===2,busy=!!current.loading||(project?.jobs??[]).some(active),stale=workflowIsStale(project)
  const approved=!!draft&&draft.approval?.draftId===draft.id,deck=currentWorkflowVisual(project)
  const reviewSummary=approved?'整稿已确认':`已审阅 ${draft?.reviewedItemIds?.length??0} 条`
  const itemCount=structured?draft.blocks.reduce((total,block)=>total+block.items.length,0):0
  const summary=structured?`${draft.blocks.length} 节 · ${itemCount} 条 · ${stale?'旧稿只读':reviewSummary}${deck?` · ${deck.pages.length} 页成果`:''}`:draft?`${draft.blocks.length} 节 · 已审阅 ${draft.reviewedBlockIds?.length??0} 节${stale?' · 旧稿只读':''}`:'按已确认章节生成，缺口随稿保留。'
  find('[data-workflow-summary]').textContent=summary+({polling:' · 连接中断，轮询中',offline:' · 连接中断，重试中'}[current.connection]??'')
  const open=find('[data-workflow-open]');open.hidden=!draft;open.textContent=workflowIsStale(project)?'查看旧版初稿':'查看本轮初稿'
  const generate=find('[data-workflow-generate]');generate.hidden=structured&&!stale;generate.disabled=busy;generate.textContent=project?.outline?.status!=='confirmed'?'核对本轮流程':stale?'重新生成本轮初稿':draft?'整理条目脚本':'生成本轮初稿'
  const approve=find('[data-workflow-approve]');approve.hidden=!structured||stale;approve.disabled=busy||approved;approve.textContent=approved?'整稿已确认 ✓':'确认整稿'
  const visuals=find('[data-workflow-visuals]');visuals.hidden=!structured||stale||!!deck;visuals.disabled=busy||!approved;visuals.title=approved?'按全部条目生成统一 HTML 汇报页':'请先确认整稿'
  find('[data-workflow-open-visual]').hidden=!deck
  const layout=find('[data-workflow-layout]');layout.hidden=!deck;layout.disabled=busy
  find('[data-workflow-downloads]').hidden=!draft
  const cancel=find('[data-workflow-cancel]');cancel.hidden=!view?.active;cancel.disabled=cancelling||!view?.canCancel;cancel.textContent=cancelling||view?.status==='cancelling'?'中止中…':'中止'
 }
 find('[data-workflow-open]').onclick=()=>onOpen()
 find('[data-workflow-generate]').onclick=()=>onGenerate()
 find('[data-workflow-downloads]').onclick=()=>onDownloads()
 find('[data-workflow-approve]').onclick=()=>onApprove?.()
 find('[data-workflow-visuals]').onclick=()=>onVisuals?.()
 find('[data-workflow-open-visual]').onclick=()=>onOpenVisual?.()
 find('[data-workflow-layout]').onclick=()=>onLayout?.()
 find('[data-workflow-cancel]').onclick=async()=>{
  const view=agentJobView((current.project?.jobs??[]).filter(job=>job.kind==='workflow'))
  if(!view?.canCancel||cancelling)return
  const projectId=current.project.id;cancelling=true;render()
  try{await onCancel(view.id,projectId)}catch(error){onNotice(error.message)}finally{cancelling=false;render()}
 }
 const ticker=setInterval(()=>{if(!document.hidden&&panel.offsetParent)render()},1000)
 return {update(value){current=value;render()},destroy(){clearInterval(ticker);panel.remove()}}
}
