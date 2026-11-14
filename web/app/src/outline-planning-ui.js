import {researchDepthLabel} from './outline-readiness.mjs'
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const states={suggested:'待讨论',adopted:'已采用',deferred:'已暂缓'}

export function chapterPreview(plan,id) {
  const rows=plan?.entries[id]
  if(!rows)return ''
  const first=rows.find(r=>r.state!=='deferred')
  return `<button type="button" class="flow-proposal-preview" data-plan-open="${id}" title="${escape(first?.text??'全部暂缓')}">${plan.changed.includes(id)?'<b>已调整</b> ':''}${escape(first?.text??'本章任务已暂缓')}</button>`
}

export function chapterPlanMarkup(outline,chapter,materials) {
  const plan=outline.planning,rows=plan.entries[chapter.id]
  const editable=!outline.confirmedAt&&!outline.planningInputsChanged
  const names=new Map(materials.map(f=>[f.id,f.filename]))
  const assessment=chapter.assessment
  const refs=assessment?assessment.evidenceIndexes.map(i=>outline.draft.evidence[i]).filter(Boolean):outline.draft.evidence.filter(e=>chapter.basis.includes(e.materialId))
  const scope=assessment?`<section class="plan-questions" data-assessment><b>${researchDepthLabel(assessment.level)}</b>${chapter.canDo.map(s=>`<p>${escape(s)}</p>`).join('')}${chapter.cannotDo.length?`<small>本轮限制</small><ul>${chapter.cannotDo.map(s=>`<li>${escape(s)}</li>`).join('')}</ul>`:''}</section>`:''
  const questions=plan.questions[chapter.id]??[]
  const actions=(r,index)=>`<div class="plan-row-actions">${r.state==='deferred'?`<button type="button" data-plan-choice="restore" data-index="${index}">恢复</button>`:`${r.state==='suggested'?`<button type="button" data-plan-choice="adopt" data-index="${index}">采用</button>`:''}<button type="button" data-plan-edit="${index}">修改</button><button type="button" data-plan-choice="defer" data-index="${index}">暂缓</button>`}</div>`
  return `<p class="plan-reason">${escape(chapter.reason)}</p>${scope}<section class="plan-tasks" aria-label="本章建议">${rows.map((r,i)=>`<article class="plan-task ${r.state==='deferred'?'is-deferred':''}" data-plan-row="${i}"><div><small>${states[r.state]}</small><span data-plan-text>${escape(r.text)}</span></div>${editable?actions(r,i):''}${r.original!==r.text?`<details><summary>原建议</summary>${escape(r.original)}</details>`:''}</article>`).join('')}</section>`+
    (questions.length?`<section class="plan-questions"><b>待决定</b><ul>${questions.map(q=>`<li>${escape(q)}</li>`).join('')}</ul></section>`:'')+
    (plan.changed.includes(chapter.id)&&plan.previousTasks?.[chapter.id]?`<details><summary>对照 V${plan.previousVersion} 任务</summary><ul>${plan.previousTasks[chapter.id].map(task=>`<li>${escape(task)}</li>`).join('')}</ul></details>`:'')+
    `<details class="plan-sources"><summary>依据与限制</summary>${refs.map(ref=>`<p><b>${escape(names.get(ref.materialId)??'项目资料')} · ${escape(ref.locator)}</b><br>${escape(ref.quote??ref.summary)}</p>`).join('')||'<p>本章暂无原件直接引用。</p>'}<ul>${(assessment?chapter.unlockWhen:[...chapter.cannotDo,...chapter.unlockWhen]).map(s=>`<li>${escape(s)}</li>`).join('')}</ul></details>`+
    (editable?`<form class="plan-feedback" data-plan-adjust><label>跟 Agent 调整本章<textarea required maxlength="4000" rows="2" placeholder="说明想调整的任务或方向"></textarea></label><button type="submit" class="ghost-btn">更新章节建议</button></form>`:'')
}

export function bindChapterPlan(dialog,chapterId,{onTaskChoice,onChapterFeedback}) {
  for(const button of dialog.querySelectorAll('[data-plan-choice]')){
    button.onclick=()=>onTaskChoice(chapterId,Number(button.dataset.index),button.dataset.planChoice)
  }
  for(const button of dialog.querySelectorAll('[data-plan-edit]'))button.onclick=()=>{
    const row=button.closest('[data-plan-row]'),text=row.querySelector('[data-plan-text]'),actions=row.querySelector('.plan-row-actions')
    const form=dialog.ownerDocument.createElement('form')
    form.className='plan-line-editor'
    form.innerHTML='<label>修改任务<textarea required maxlength="1600" rows="2"></textarea></label><button type="submit">保存并采用</button><button type="button" data-cancel>取消</button>'
    const field=form.querySelector('textarea');field.value=text.textContent
    text.hidden=true;actions.hidden=true;row.append(form);field.focus()
    form.querySelector('[data-cancel]').onclick=()=>{form.remove();text.hidden=false;actions.hidden=false;button.focus()}
    form.onsubmit=event=>{event.preventDefault();const value=field.value.trim();if(value)onTaskChoice(chapterId,Number(row.dataset.planRow),'adopt',value)}
  }
  const form=dialog.querySelector('[data-plan-adjust]')
  if(form)form.onsubmit=event=>{
    event.preventDefault()
    const field=form.querySelector('textarea'),value=field.value.trim()
    if(value)onChapterFeedback(chapterId,value)
  }
}
