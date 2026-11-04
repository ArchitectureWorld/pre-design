import {chapterCapabilityLabel,outlineMarkup} from './outline-view.js'
import {mountOutlineDrag} from './outline-drag.js'
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const ids=Array.from({length:11},(_,i)=>String(i+1).padStart(2,'0'))
export const normalizeFlow=flow=>[...new Set((Array.isArray(flow)?flow:[]).filter(id=>ids.includes(id)))]
export function moveChapter(flow,id,before){if(id===before)return normalizeFlow(flow);const next=normalizeFlow(flow).filter(v=>v!==id);if(!ids.includes(id))return next;const index=next.indexOf(before);next.splice(index<0?next.length:index,0,id);return next}
export function flowCell(index,columns){const row=Math.floor(index/columns),direction=columns>1&&row%2?-1:1;return {row,column:direction===1?index%columns:columns-1-index%columns,direction}}
function layoutTrack(track){
 const columns=track.clientWidth>=660?3:track.clientWidth>=410?2:1
 track.style.setProperty('--flow-columns',columns)
 const steps=[...track.querySelectorAll('.flow-step')]
 for(const [index,el] of [...steps,track.querySelector('[data-flow-end]')].entries()){
  const cell=flowCell(index,columns);el.style.gridColumn=cell.column+1;el.style.gridRow=cell.row+1;el.dataset.flowDirection=cell.direction
 }
 const svg=track.querySelector('.flow-connectors'),origin=track.getBoundingClientRect(),turn=12
 svg.setAttribute('viewBox',`0 0 ${origin.width} ${origin.height}`)
 const paths=steps.slice(0,-1).map((el,i)=>{
  const a=el.getBoundingClientRect(),b=steps[i+1].getBoundingClientRect(),direction=Number(el.dataset.flowDirection)
  const ay=a.top-origin.top+a.height/2,by=b.top-origin.top+b.height/2
  const x1=(direction===1?a.right:a.left)-origin.left
  if(Math.abs(a.top-b.top)<1){const x2=(direction===1?b.left:b.right)-origin.left;return `M ${x1} ${ay} H ${x2-direction*3}`}
  if(columns===1)return `M ${a.left-origin.left+a.width/2} ${a.bottom-origin.top} V ${b.top-origin.top-3}`
  const x2=(direction===1?b.right:b.left)-origin.left,edge=x1+direction*turn
  return `M ${x1} ${ay} H ${edge-direction*5} Q ${edge} ${ay} ${edge} ${ay+5} V ${by-5} Q ${edge} ${by} ${edge-direction*5} ${by} H ${x2+direction*3}`
 })
 svg.innerHTML=`<defs><marker id="flow-arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="none" stroke="currentColor" stroke-width="1.4"/></marker></defs>${paths.map(d=>`<path data-flow-connector d="${d}" marker-end="url(#flow-arrowhead)"/>`).join('')}`
}
const storageKey=(projectId,outline)=>`pre-outline-flow:${projectId}:${outline.version}`
export function flowEditorState(projectId,outline){
 const original=normalizeFlow(outline?.flow??outline?.draft?.chapters.filter(c=>c.disposition==='include').map(c=>c.id))
 let selected=original
 try{const saved=JSON.parse(sessionStorage.getItem(storageKey(projectId,outline)));if(Array.isArray(saved))selected=normalizeFlow(saved)}catch{}
 return {selected,dirty:JSON.stringify(selected)!==JSON.stringify(original)}
}
export function mountFlowEditor(host,{projectId,outline,materials,onSubmit,onAnswer,onDecision,onUpload,onChange}){
 let {selected}=flowEditorState(projectId,outline),focus=selected[0]??'01',pane,feedback=''
 const chapters=outline.draft.chapters,byId=new Map(chapters.map(c=>[c.id,c]))
 let busy=!!outline.busy,resizeObserver,disposeDrag
 const questionKey=`pre-outline-question-edits:${projectId}:${outline.version}`
 let questionEdits={open:[],reasons:{}}
 try{const cached=JSON.parse(sessionStorage.getItem(questionKey));if(Array.isArray(cached?.open)&&cached.reasons&&typeof cached.reasons==='object')questionEdits=cached}catch{}
 const saveQuestionEdits=()=>sessionStorage.setItem(questionKey,JSON.stringify(questionEdits))
 function save(id,message){
  const positions=new Map([...host.querySelectorAll('[data-flow-node]')].map(el=>[el.dataset.flowNode,el.getBoundingClientRect()]))
  sessionStorage.setItem(storageKey(projectId,outline),JSON.stringify(selected));pane='flow';feedback=message;render();onChange?.()
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches
  for(const el of host.querySelectorAll('[data-flow-node]')){
   const before=positions.get(el.dataset.flowNode),after=el.getBoundingClientRect()
   if(before&&!reduced)el.animate([{transform:`translate(${before.x-after.x}px,${before.y-after.y}px)`},{transform:'translate(0,0)'}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'})
   if(el.dataset.flowNode===id)el.classList.add('is-just-moved')
  }
 }
 function move(id,before){const next=moveChapter(selected,id,before);if(JSON.stringify(next)===JSON.stringify(selected))return;selected=next;save(id,`已将「${byId.get(id).title}」移到第 ${selected.indexOf(id)+1} 位`)}
 function remove(id){if(!selected.includes(id))return;selected=selected.filter(v=>v!==id);save(id,`已将「${byId.get(id).title}」移到备用`)}
 const actions=(c,active,index)=>`<div class="flow-node-actions">${active?`<button type="button" data-flow-up="${c.id}" aria-label="上移${escape(c.title)}" title="上移" ${index===0||busy?'disabled':''}>↑</button><button type="button" data-flow-down="${c.id}" aria-label="下移${escape(c.title)}" title="下移" ${index===selected.length-1||busy?'disabled':''}>↓</button><button type="button" data-flow-remove="${c.id}" title="移到备用" aria-label="将${escape(c.title)}移到备用" ${busy?'disabled':''}>−</button>`:`<button type="button" data-flow-add="${c.id}" title="加入流程" aria-label="加入${escape(c.title)}" ${busy?'disabled':''}>＋</button>`}<button type="button" data-flow-detail="${c.id}" title="查看任务" aria-label="查看${escape(c.title)}的任务">⋯</button></div>`
 const card=(c,active,index)=>`<article class="flow-node ${active?'is-selected':''}" data-flow-node="${c.id}" draggable="${!busy}" aria-label="${escape(c.title)}"><div class="flow-node-heading"><span class="flow-grip" aria-hidden="true">⠿</span>${active?`<span class="flow-position">${String(index+1).padStart(2,'0')}</span>`:''}<b>${escape(c.title)}</b></div><span class="flow-capability ${c.readiness==='blocked'?'is-blocked':''}" title="${chapterCapabilityLabel(c)}">${chapterCapabilityLabel(c)}</span>${actions(c,active,index)}</article>`
 function render(){
  resizeObserver?.disconnect();disposeDrag?.()
  const dirty=JSON.stringify(selected)!==JSON.stringify(normalizeFlow(outline.flow)),reviewed=outline.flowReviewed&&!dirty&&outline.status!=='stale',unused=chapters.filter(c=>!selected.includes(c.id)),waivers=outline.waivers??[],current=byId.get(focus)
  const extra=host.querySelector('[data-flow-extra]');pane=reviewed?(pane??'review'):'flow'
  host.innerHTML=`<div class="outline-flow-editor" data-outline-version="${outline.version}">
   <div class="flow-stepbar"><button type="button" data-flow-tab="flow" aria-pressed="${pane==='flow'}">1 编排章节</button><button type="button" data-flow-tab="review" aria-pressed="${pane==='review'}" ${!reviewed?'disabled':''}>2 核对资料</button><button type="button" data-flow-evidence>资料与记录</button><span class="flow-feedback" role="status" aria-live="polite" data-flow-drag-status>${escape(feedback)}</span></div>
   <div data-flow-pane="flow" ${pane!=='flow'?'hidden':''}>
    <div class="flow-editor-toolbar"><strong>${dirty?'已调整 · 待提交':reviewed?'已核对的流程':'推荐流程'}</strong><button type="button" class="primary-btn" data-flow-submit ${busy||!selected.length?'disabled':''}>${busy?'正在核对…':'提交流程 ↗'}</button></div>
    <div class="flow-editor-grid">
     <section class="flow-canvas" data-flow-zone="selected" aria-label="本轮章节流程"><div class="flow-zone-title">本轮流程 <span>${selected.length} 章</span></div><div class="flow-track"><svg class="flow-connectors" aria-hidden="true"></svg><div class="flow-drop-indicator" data-flow-drop-indicator hidden></div>${selected.map((id,i)=>`<div class="flow-step">${card(byId.get(id),true,i)}</div>`).join('')}<div data-flow-end class="flow-drop-end" aria-label="拖到末尾">＋</div></div></section>
     <aside class="flow-library" data-flow-zone="library" aria-label="备用章节"><div class="flow-zone-title">备用章节 <span>${unused.length} 章</span></div>${unused.map((c,i)=>card(c,false,i)).join('')}<div class="flow-library-drop" data-flow-library-drop aria-label="拖到备用区移出本轮流程">⤴</div></aside>
    </div>
   </div>
   <section class="flow-assessment" data-flow-pane="review" data-flow-assessment ${pane!=='review'?'hidden':''}><h3>${reviewed?'按你提交流程核对资料':'提交后核对资料'}</h3>${reviewed?`<button type="button" class="ghost-btn" data-flow-upload>＋ 补充资料</button>${outline.draft.questions.map(q=>{const skipped=waivers.find(w=>w.questionId===q.id);return `<article class="flow-question" data-flow-question="${escape(q.id)}"><b>${escape(q.prompt)}</b><p>${escape(q.reason)} · 影响：${escape(q.chapterIds.map(id=>byId.get(id)?.title??id).join('、'))}</p>${skipped?`<p class="flow-waiver">本轮已跳过：${escape(skipped.reason)}。相关内容须保留缺口说明。</p><button type="button" data-flow-reopen="${escape(q.id)}" ${busy?'disabled':''}>撤销跳过</button>`:`<button type="button" data-flow-answer="${escape(q.id)}" ${busy?'disabled':''}>回答此项</button><button type="button" data-flow-upload ${busy?'disabled':''}>补充资料</button><details data-flow-skip-panel="${escape(q.id)}" ${questionEdits.open.includes(q.id)?'open':''}><summary>本轮跳过，保留缺口标注</summary><label>跳过说明<input class="field-input" data-flow-reason="${escape(q.id)}" value="${escape(questionEdits.reasons[q.id]??'')}" placeholder="例如：本轮先摸底，边界资料后续补充"></label><button type="button" data-flow-skip="${escape(q.id)}" ${busy?'disabled':''}>确认本轮跳过此项</button></details>`}</article>`}).join('')||'<p>本次核对没有需要你补充的疑点，可审阅后确认流程。</p>'}`:'<p>先决定本轮章节及顺序，再逐章比对已有材料。不会在你选择前要求补齐所有备用章的资料。</p>'}</section>
   ${outline.retainedWaivers?.length?`<div class="flow-waiver"><b>前轮明确保留的资料限制</b>${outline.retainedWaivers.map(w=>`<p>V${w.version}：${escape(w.prompt)}<br>跳过说明：${escape(w.reason)}。本轮新增或改变的问题仍需单独处理。</p>`).join('')}</div>`:''}
   <dialog class="flow-inspector" data-flow-inspector="evidence"><div class="flow-inspector-head"><b>资料与记录</b><button type="button" data-flow-close aria-label="关闭">×</button></div>${outlineMarkup({...outline,draft:{...outline.draft,questions:[]}},materials)}<section data-flow-extra></section></dialog>
   <dialog class="flow-inspector" data-flow-inspector="task"><div class="flow-inspector-head"><b>${escape(current?.title)}</b><button type="button" data-flow-close aria-label="关闭">×</button></div>${current?`<p><b>现在可做：</b>${escape(current.canDo?.join('；')||'暂缓实质工作')}</p><p><b>暂不能做：</b>${escape(current.cannotDo?.join('；')||'按已核实范围开展')}</p><p><b>启动条件：</b>${escape(current.unlockWhen?.join('；')||'已有本轮依据')}</p>`:''}</dialog>
  </div>`
  if(extra)host.querySelector('[data-flow-extra]').replaceWith(extra)
  for(const button of host.querySelectorAll('[data-flow-tab]'))button.onclick=()=>{pane=button.dataset.flowTab;render();onChange?.()}
  host.querySelector('[data-flow-evidence]').onclick=()=>host.querySelector('[data-flow-inspector="evidence"]').showModal()
  for(const button of host.querySelectorAll('[data-flow-close]'))button.onclick=()=>button.closest('dialog').close()
  host.querySelector('[data-flow-submit]').onclick=()=>onSubmit([...selected])
  for(const el of host.querySelectorAll('[data-flow-add]'))el.onclick=()=>move(el.dataset.flowAdd,null)
  for(const el of host.querySelectorAll('[data-flow-remove]'))el.onclick=()=>remove(el.dataset.flowRemove)
  for(const el of host.querySelectorAll('[data-flow-up]'))el.onclick=()=>{const id=el.dataset.flowUp;move(id,selected[selected.indexOf(id)-1])}
  for(const el of host.querySelectorAll('[data-flow-down]'))el.onclick=()=>{const id=el.dataset.flowDown;move(id,selected[selected.indexOf(id)+2])}
  for(const el of host.querySelectorAll('[data-flow-detail]'))el.onclick=()=>{focus=el.dataset.flowDetail;render();host.querySelector('[data-flow-inspector="task"]').showModal()}
  for(const el of host.querySelectorAll('[data-flow-upload]'))el.onclick=onUpload
  for(const el of host.querySelectorAll('[data-flow-answer]'))el.onclick=()=>onAnswer(outline.draft.questions.find(q=>q.id===el.dataset.flowAnswer))
  for(const el of host.querySelectorAll('[data-flow-skip-panel]'))el.ontoggle=()=>{questionEdits.open=questionEdits.open.filter(id=>id!==el.dataset.flowSkipPanel);if(el.open)questionEdits.open.push(el.dataset.flowSkipPanel);saveQuestionEdits()}
  for(const el of host.querySelectorAll('[data-flow-reason]'))el.oninput=()=>{questionEdits.reasons[el.dataset.flowReason]=el.value;saveQuestionEdits()}
  for(const el of host.querySelectorAll('[data-flow-skip]'))el.onclick=()=>{const id=el.dataset.flowSkip,reason=host.querySelector(`[data-flow-reason="${id}"]`).value.trim()||'本轮暂不提供，相关内容保留缺口，不作专业结论';onDecision(id,'skip',reason)}
  for(const el of host.querySelectorAll('[data-flow-reopen]'))el.onclick=()=>onDecision(el.dataset.flowReopen,'reopen','用户撤销跳过，重新处理此项资料')
  const track=host.querySelector('.flow-track');layoutTrack(track)
  resizeObserver=new ResizeObserver(()=>{if(host.isConnected)layoutTrack(track);else resizeObserver.disconnect()});resizeObserver.observe(track)
  disposeDrag=mountOutlineDrag(host,{selected,busy,allowedIds:ids,onMove:move,onRemove:remove})
 }
 function updateBusy(value){
  if(busy===!!value)return;busy=!!value
  for(const node of host.querySelectorAll('[data-flow-node]'))node.draggable=!busy
  for(const el of host.querySelectorAll('[data-flow-add],[data-flow-remove],[data-flow-answer],[data-flow-skip],[data-flow-reopen]'))el.disabled=busy
  for(const el of host.querySelectorAll('[data-flow-up]'))el.disabled=busy||selected.indexOf(el.dataset.flowUp)===0
  for(const el of host.querySelectorAll('[data-flow-down]'))el.disabled=busy||selected.indexOf(el.dataset.flowDown)===selected.length-1
  const submit=host.querySelector('[data-flow-submit]');submit.disabled=busy||!selected.length;submit.textContent=busy?'处理中…':'提交流程 ↗'
  disposeDrag?.();disposeDrag=mountOutlineDrag(host,{selected,busy,allowedIds:ids,onMove:move,onRemove:remove})
 }
 render()
 return {selected:()=>[...selected],updateBusy,destroy(){resizeObserver?.disconnect();disposeDrag?.()}}
}
