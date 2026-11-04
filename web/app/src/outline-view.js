const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const list=rows=>rows.length?`<ul>${rows.map(row=>`<li>${escape(row)}</li>`).join('')}</ul>`:'<p>暂无已记录事项。</p>'
const conditions=[['study_area','本次研究范围'],['project_boundary','项目红线 / 实施边界'],['land_use','用地性质（现状与规划）'],['planning_controls','规划管控线及适用条件']]
export const chapterCapabilityLabel=c=>c.disposition==='exclude'?'本轮不适用':c.disposition==='defer'?'缺条件暂缓':({ready:'可开展本轮任务',limited:'仅可先梳理',blocked:'缺条件暂缓'}[c.readiness]??'资料能力待核实')
export function outlineMarkup(outline,materials=[]){
 const draft=outline?.draft
 if(!draft)return `<p>${outline?.busy?'正在读取资料并梳理章节，请等待首版草案。':'先读取已上传资料，整理本项目的章节任务、依据和缺口，再询问影响流程的疑点。'}</p>`
 const counts={ready:0,limited:0,blocked:0};for(const c of draft.chapters){if(c.disposition==='exclude')continue;const key=c.disposition==='defer'?'blocked':c.readiness??'blocked';counts[key]++}
 const names=new Map(materials.map(m=>[m.id,m.relativePath??m.filename]))
 return `<div data-outline-version="${outline.version}"><strong>章节流程草案 V${outline.version} · ${outline.status==='confirmed'?'已确认':outline.status==='stale'?'资料或讨论已更新，需重新梳理':'待你审阅确认'}</strong>
 <p data-outline-capability-counts>本轮：可开展 ${counts.ready} 章 · 仅可先梳理 ${counts.limited} 章 · 缺条件暂缓 ${counts.blocked} 章</p>
 <div data-outline-conditions><p><b>先核实条件，再确定本轮能做到哪里</b></p>${conditions.map(([id,title])=>{const c=draft.conditions?.find(c=>c.id===id);return `<p><b>${title}：${({supported:'已有内容依据，按所述范围使用',unverified:'尚未核实',missing:'明确缺失',conflicting:'存在待澄清差异'}[c?.status]??'尚未评估')}</b><br>${escape(c?.detail??'旧版未评估此条件，请更新草案。')}</p>`}).join('')}<p>研究范围、项目红线、规划管控线不能相互替代。确认目录不会补齐资料，也不会解锁受限专业任务。</p></div>
 <details><summary>已知条件与资料差异</summary><p>${escape(draft.summary)}</p></details>
 <details><summary>资料依据与读取限制（${draft.evidence.length} 项）</summary>${list(draft.evidence.map(ref=>`${names.get(ref.materialId)||ref.materialId} · ${ref.locator} · ${ref.kind==='inventory'?'仅登记原件':ref.kind==='metadata'?'仅元数据':'读取内容'}：${ref.summary}${ref.quote?'；原文：“'+ref.quote+'”':''}`))}</details>
 <details><summary>研究范围判断：影响、客源与对比尺度</summary><p>直接影响：${escape(draft.scales.direct)}<br>服务或客源：${escape(draft.scales.service)}<br>竞品与案例对比：${escape(draft.scales.comparison)}</p></details>
 <div class="generated-outline"><b>11章流程 · 点击展开本项目任务</b>${draft.chapters.map(c=>`<details class="outline-line" data-outline-chapter="${c.id}"><summary>${c.id} ${escape(c.title)} · ${chapterCapabilityLabel(c)}</summary><p>${escape(c.reason)}</p><b>现在可做</b>${list(c.canDo??[])}<b>暂不能做</b>${list(c.cannotDo??[])}<b>启动条件</b>${list(c.unlockWhen??[])}<details><summary>条件补齐后的章节任务</summary>${list(c.tasks)}</details><p>资料依据：${escape(c.basis.map(id=>names.get(id)||id).join('；')||'目前缺少资料，需后续补充')}</p><p>前置章节：${escape(c.dependsOn.join('、')||'无')}</p>${c.gaps.length?`<b>缺口</b>${list(c.gaps)}`:''}</details>`).join('')}</div>
 <details><summary>章节先后关系与反馈修正</summary><p>${escape(draft.feedback)}</p></details>
 <div data-outline-questions><strong>${draft.questions.length?'需要你澄清的疑点':'本轮没有阻断章节确认的疑点'}</strong>${draft.questions.map((q,i)=>`<p><b>${i+1}. ${escape(q.prompt)}</b><br>${escape(q.reason)}（涉及第 ${escape(q.chapterIds.join('、'))} 章；${q.blocking?'确认流程前需澄清':'可后续补充'}）</p>`).join('')}</div>
 <p>你可以回答疑点、调整章节或明确暂缓事项；更新后仍需确认具体版本。确认章节不等于认可专业结论，也不会自动启动研究任务。</p></div>`
}
