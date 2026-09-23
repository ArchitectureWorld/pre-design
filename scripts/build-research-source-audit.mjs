import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'))
const esc = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const link = (url, label = url) => url ? `<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(label)}</a>` : '<span class="muted">非网站来源</span>'
const badge = (text, cls = '') => `<span class="badge ${cls}">${esc(text)}</span>`
const statusLabel = status => ({
  verified_public_access: '公开入口已核查',
  verified_official_content_direct_probe_limited: '官方内容已核查；直接探测受限',
  verified_official_service_via_subdomain: '官方服务子域入口已核查',
  official_domain_confirmed_direct_probe_limited: '官方域名已确认；直接探测受限',
  verified_official_resources_home_probe_limited: '官方资源已核查；部分访问受限',
  verified_official_domain_pattern: '官方域名规则已核查',
  local_source: '项目本地来源',
  not_external_source: '非外部网站来源',
})[status] ?? '尚无核查记录'
const statusClass = status => /limited/u.test(status) ? 'warn' : /verified/u.test(status) ? 'ok' : 'neutral'

const chapterNames = {
  '01': '项目认知与任务', '02': '现状事实底板', '03': '问题与机会', '04': '目标与方向',
  '05': '方案选择', '06': '功能与规模', '07': '空间与技术', '08': '投资与实施',
}

const researchDir = resolve(root, 'research/v2.0.1')
const specFiles = (await readdir(researchDir))
  .filter(name => name === 'workflow-research-specs.json' || /^workflow-research-specs-ch\d{2}\.json$/u.test(name))
  .sort((left, right) => left.localeCompare(right))
const specs = []
for (const name of specFiles) {
  const document = JSON.parse(await readFile(resolve(researchDir, name), 'utf8'))
  specs.push(...document.workflows)
}
const duplicateSpecIds = specs.map(spec => spec.workflowId).filter((id, index, rows) => rows.indexOf(id) !== index)
if (duplicateSpecIds.length) throw new Error(`duplicate workflow research specs: ${[...new Set(duplicateSpecIds)].join(', ')}`)

const sourcesDoc = await readJson('research/v2.0.1/data-sources.json')
const auditDoc = await readJson('research/v2.0.1/source-audit-status.json')
const sourceById = new Map(sourcesDoc.sources.map(source => [source.sourceId, source]))
const specByWorkflow = new Map(specs.map(spec => [spec.workflowId, spec]))
const auditBySource = new Map(auditDoc.checks.map(check => [check.sourceId, check]))

const workflowDir = resolve(root, 'contracts/v0.6/workflows')
const workflowFiles = (await readdir(workflowDir)).filter(name => /^preplan\.wf\.\d{2}\.\d{2}\.contract\.json$/u.test(name)).sort()
const workflows = []
for (const name of workflowFiles) workflows.push(JSON.parse(await readFile(resolve(workflowDir, name), 'utf8')))

const reverseSourceUsage = new Map()
for (const spec of specs) {
  for (const step of spec.researchSteps) {
    for (const sourceId of step.sourceIds) {
      const rows = reverseSourceUsage.get(sourceId) ?? []
      rows.push({ workflowId: spec.workflowId, stepId: step.stepId, stepTitle: step.title, dataPointIds: step.dataPointIds })
      reverseSourceUsage.set(sourceId, rows)
    }
  }
}

function sourceCard(sourceId, preference) {
  const source = sourceById.get(sourceId)
  const audit = auditBySource.get(sourceId)
  if (!source) return `<div class="source missing">未知来源：${esc(sourceId)}</div>`
  const status = audit?.status ?? 'not_checked'
  const cls = statusClass(status)
  const necessity = preference?.required === true ? badge('本 Workflow 必需来源', 'required') : badge('条件/辅助来源', 'neutral')
  const authorityReason = `${source.priority}/${source.reliabilityGrade}；发布方：${source.publisher}；核查状态：${statusLabel(status)}（${status}）`
  const workflowPurpose = preference?.purpose || '为当前 Workflow 提供已登记、可追溯的证据输入。'
  const choiceReason = preference?.required === true
    ? `该来源是当前 Workflow 的必需来源；${workflowPurpose}`
    : `该来源用于补充或交叉核验当前 Workflow；${workflowPurpose}`
  return `<div class="source"><div class="source-head"><strong>${esc(source.name)}</strong>${badge(source.priority)}${badge(source.reliabilityGrade)}${necessity}${badge(statusLabel(status), cls)}</div><div class="rationale"><strong>为什么选择这个来源：</strong>${esc(choiceReason)}</div><div class="rationale"><strong>来源权威性：</strong>${esc(authorityReason)}</div><div class="rationale"><strong>该来源在本 Workflow 中的用途：</strong>${esc(workflowPurpose)}</div><div class="meta"><span>访问方式：${esc(source.accessModes.join(' / '))}</span></div><div class="links">主入口：${link(source.homepage)}${audit?.workingUrl && audit.workingUrl !== source.homepage ? ` · 本次可工作入口：${link(audit.workingUrl)}` : ''}</div><div class="note">${esc(audit?.note ?? source.notes)}</div></div>`
}

function workflowHtml(workflow) {
  const spec = specByWorkflow.get(workflow.workflow_id)
  if (!spec) return `<article class="workflow unmapped"><header><div><span class="workflow-id">${esc(workflow.work_item_id)}</span><strong>${esc(workflow.title)}</strong></div>${badge('ResearchSpec 待映射', 'warn')}</header><p>现有 V0.6 Workflow 保留执行；V2.0.1 尚未给此项建立“步骤 → 数据项 → 来源 → 分析 → 结论”的 Research 链，因此不得把它标记为来源可审计完成。</p></article>`
  const dataPointById = new Map([...spec.requiredDataPoints, ...spec.optionalDataPoints].map(dp => [dp.dataPointId, dp]))
  const preferenceBySource = new Map(spec.preferredSources.map(row => [row.sourceId, row]))
  const steps = spec.researchSteps.map(step => {
    const dataPoints = step.dataPointIds.length
      ? `<ul class="datapoints">${step.dataPointIds.map(id => { const dp = dataPointById.get(id); return `<li><code>${esc(id)}</code> <strong>${esc(dp?.label ?? id)}</strong><span>${esc(dp?.description ?? '')}</span></li>` }).join('')}</ul>`
      : '<div class="muted">本步骤不新增数据项，消费上游结果。</div>'
    const sources = step.sourceIds.length
      ? step.sourceIds.map(id => sourceCard(id, preferenceBySource.get(id))).join('')
      : '<div class="muted">本步骤不直接访问外部来源。</div>'
    const deps = step.dependsOnStepIds.length ? step.dependsOnStepIds.join(' → ') : '起始步骤'
    const stepReason = step.notes || `把 ${step.action} 的输入转成 ${step.produces}，并作为后续 ResearchStep 的可追溯前置结果。`
    return `<section class="step"><div class="step-index">${String(step.order).padStart(2, '0')}</div><div class="step-body"><h4>${esc(step.title)}</h4><div class="step-meta">${badge(step.action)}${badge(step.produces)}<span>依赖：${esc(deps)}</span></div><div class="rationale"><strong>为什么做这一步：</strong>${esc(stepReason)}</div><h5>使用的数据项</h5>${dataPoints}<h5>本步骤的数据来源</h5>${sources}${step.notes ? `<div class="note">执行约束：${esc(step.notes)}</div>` : ''}</div></section>`
  }).join('')
  const riskRule = spec.minimumEvidence.highRiskRequiresGradeA
    ? '高风险时必须含 A 级证据；风险只提高机器核验强度，不增加默认人工审批。'
    : '风险等级不构成人工审批条件；由证据覆盖、置信度和自动质量门决定是否继续。'
  const methodReason = `先用 ${spec.aggregationMethod.methodId} v${spec.aggregationMethod.version} 按权威等级、时效与对象/口径一致性完成确定性汇总，再用 ${spec.analysisMethod.methodId} v${spec.analysisMethod.version} 解释差异、约束、机会与限制；这样可以把“数据合并”和“专业判断”分开追溯。`
  const sourceIds = [...new Set(spec.researchSteps.flatMap(step => step.sourceIds))]
  const namedSources = sourceIds.map(id => sourceById.get(id)?.name ?? id)
  const checkedSources = sourceIds.filter(id => auditBySource.has(id)).length
  const sourcePreview = namedSources.slice(0, 3).join('、') + (namedSources.length > 3 ? ` 等 ${namedSources.length} 类` : '')
  const sourceUrls = sourceIds.flatMap(id => [sourceById.get(id)?.homepage, auditBySource.get(id)?.workingUrl].filter(Boolean))
  const searchText = [workflow.work_item_id, workflow.title, spec.workflowId, ...namedSources, ...sourceUrls, spec.aggregationMethod.description, spec.analysisMethod.description].join(' ')
  return `<article class="workflow mapped" data-search="${esc(searchText.toLowerCase())}"><details><summary><span class="workflow-title"><span class="workflow-id">${esc(workflow.work_item_id)}</span><strong>${esc(workflow.title)}</strong></span><span class="workflow-overview"><span><b>要做什么</b>${spec.researchSteps.length} 个研究步骤</span><span><b>查什么来源</b>${esc(sourcePreview || '仅用上游结果')}</span><span><b>怎么分析</b>${esc(spec.analysisMethod.description)}</span><span><b>如何判断</b>高权威 ≥${spec.minimumEvidence.minHighAuthority} · 独立来源 ≥${spec.minimumEvidence.minIndependentSources}</span></span><span class="summary-status">${badge(`研究合同已映射 · 来源记录 ${checkedSources}/${sourceIds.length}`, checkedSources === sourceIds.length ? 'ok' : 'warn')}<span aria-hidden="true">展开详情 ↓</span></span></summary><div class="workflow-detail"><div class="flow-summary"><span>Workflow：<code>${esc(spec.workflowId)}</code></span><span>Automatic：默认自动推进</span><span>来源核查记录不代表本项目已完成取证</span></div><div class="automation-note">${esc(riskRule)}</div>${steps}<section class="methods"><h4>汇总与分析</h4><div class="rationale"><strong>为什么这样汇总与分析：</strong>${esc(methodReason)}</div><p><strong>汇总：</strong>${esc(spec.aggregationMethod.methodId)} v${esc(spec.aggregationMethod.version)} — ${esc(spec.aggregationMethod.description)}</p><p><strong>分析：</strong>${esc(spec.analysisMethod.methodId)} v${esc(spec.analysisMethod.version)} — ${esc(spec.analysisMethod.description)}</p><p><strong>缺失策略：</strong>${esc(spec.fallbackPolicy)}</p><h5>预期输出结论</h5><ul>${spec.outputClaims.map(claim => `<li>${esc(claim)}</li>`).join('')}</ul></section></div></details></article>`
}

const chapters = Object.keys(chapterNames).map(chapterId => {
  const rows = workflows.filter(workflow => workflow.chapter_id === chapterId)
  const mapped = rows.filter(workflow => specByWorkflow.has(workflow.workflow_id)).length
  return `<section class="chapter" id="chapter-${chapterId}"><h2>${chapterId} · ${esc(chapterNames[chapterId])}<span>${mapped}/${rows.length} 已建立 Research 链</span></h2>${rows.map(workflowHtml).join('')}</section>`
}).join('')

const sourceAppendix = sourcesDoc.sources.map(source => {
  const audit = auditBySource.get(source.sourceId)
  const usages = reverseSourceUsage.get(source.sourceId) ?? []
  return `<tr><td><strong>${esc(source.name)}</strong><br><code>${esc(source.sourceId)}</code></td><td>${badge(source.priority)} ${badge(source.reliabilityGrade)}</td><td>${badge(statusLabel(audit?.status), statusClass(audit?.status ?? ''))}<br>${esc(audit?.note ?? '')}</td><td>${link(source.homepage)}${audit?.workingUrl && audit.workingUrl !== source.homepage ? `<br>${link(audit.workingUrl, '可工作入口')}` : ''}</td><td>${usages.length ? usages.map(row => `<div><code>${esc(row.workflowId)}</code> → ${esc(row.stepId)} ${esc(row.stepTitle)}<br><small>${esc(row.dataPointIds.join(', '))}</small></div>`).join('') : '<span class="muted">当前已映射 Workflow 未使用</span>'}</td></tr>`
}).join('')

const mappedCount = workflows.filter(workflow => specByWorkflow.has(workflow.workflow_id)).length
const chapterNav = Object.entries(chapterNames).map(([id, name]) => `<a href="#chapter-${id}">${id} ${esc(name)}</a>`).join('')
const dashboardScript = `<script>
const search = document.getElementById('workflow-search');
const count = document.getElementById('visible-count');
search.addEventListener('input', () => {
  const query = search.value.trim().toLocaleLowerCase();
  let visible = 0;
  document.querySelectorAll('.chapter[id] .workflow').forEach(card => {
    card.hidden = Boolean(query) && !(card.dataset.search || card.textContent.toLocaleLowerCase()).includes(query);
    if (!card.hidden) visible++;
  });
  document.querySelectorAll('.chapter[id]').forEach(chapter => {
    chapter.hidden = !chapter.querySelector('.workflow:not([hidden])');
  });
  count.textContent = visible + ' / ${workflows.length} 项工作流';
});
</script>`
const dashboardCss = `
.hero{background:linear-gradient(125deg,#102840,#164e67);color:#fff;border:0}.hero p{color:#d2e9f2}.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase}.stats .badge{background:#dcecf4;color:#17334b}
.dashboard-tools{position:sticky;top:0;z-index:3;background:#f6f8fa;padding:12px 0;border-bottom:1px solid #d8dee4}.dashboard-tools label{display:block;font-size:12px;font-weight:700;margin-bottom:6px}.dashboard-tools input{width:100%;box-sizing:border-box;border:1px solid #aab6c2;border-radius:9px;padding:10px 12px;font:inherit}.dashboard-tools nav{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}.dashboard-tools nav a{background:#e9f1f7;padding:6px 9px;border-radius:7px;font-size:12px}.dashboard-tools output{float:right;font-size:12px;color:#526273}
.chapter{scroll-margin-top:145px}.chapter[hidden],.workflow[hidden]{display:none}.workflow{padding:0;overflow:hidden}.workflow summary{cursor:pointer;list-style:none;padding:17px 18px}.workflow summary::-webkit-details-marker{display:none}.workflow summary:focus-visible{outline:3px solid #0969da;outline-offset:-3px}.workflow-title{display:flex;gap:9px;align-items:baseline;font-size:16px}.workflow-overview{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}.workflow-overview>span{display:block;min-width:0;background:#f4f7f9;border-radius:8px;padding:10px;font-size:12px;line-height:1.5;overflow-wrap:anywhere}.workflow-overview b{display:block;color:#526273;font-size:11px;margin-bottom:5px}.summary-status{display:flex;justify-content:space-between;align-items:center;color:#526273;font-size:12px}.workflow-detail{padding:0 18px 18px;border-top:1px solid #e5eaf0}.workflow details[open] .summary-status [aria-hidden]{transform:rotate(180deg)}
@media(max-width:1000px){.workflow-overview{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.workflow-overview{grid-template-columns:1fr}.dashboard-tools{position:static}.dashboard-tools output{float:none;display:block;margin-top:7px}}
`
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>同步开发看板 · Pre 2.0.2</title><style>
:root{font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2328;background:#f6f8fa}body{margin:0}.wrap{max-width:1440px;margin:auto;padding:28px}.hero,.workflow,.source,.methods,table,.automation-policy{background:#fff;border:1px solid #d8dee4;border-radius:12px}.hero{padding:24px;margin-bottom:16px}.hero h1{margin:0 0 8px}.hero p{color:#59636e}.stats{display:flex;gap:10px;flex-wrap:wrap}.automation-policy{padding:16px 18px;margin:0 0 22px;border-left:5px solid #0969da}.automation-policy h3{margin:0 0 8px}.automation-policy p{margin:5px 0;color:#59636e;font-size:13px}.chapter{margin:30px 0}.chapter h2{display:flex;justify-content:space-between;align-items:center}.chapter h2 span{font-size:13px;font-weight:500;color:#59636e}.workflow{margin:14px 0;padding:18px}.workflow header{display:flex;justify-content:space-between;gap:12px;align-items:center}.workflow-id{font:700 13px ui-monospace;margin-right:10px}.unmapped{border-style:dashed}.badge{display:inline-block;border-radius:999px;background:#eef1f4;padding:2px 8px;font-size:11px;margin:0 4px}.badge.ok{background:#dafbe1;color:#116329}.badge.warn{background:#fff1e5;color:#9a6700}.badge.neutral{background:#eaeef2}.badge.required{background:#ddf4ff;color:#0550ae}.flow-summary,.step-meta,.meta{display:flex;gap:10px;flex-wrap:wrap;color:#59636e;font-size:12px;margin-top:10px}.automation-note{margin-top:10px;padding:8px 10px;border-radius:8px;background:#f6f8fa;color:#57606a;font-size:12px}.step{display:grid;grid-template-columns:42px 1fr;gap:12px;border-top:1px solid #eaeef2;padding:16px 0}.step-index{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:#0969da;color:#fff;font-weight:700}.step h4,.methods h4{margin:0 0 8px}.step h5,.methods h5{margin:14px 0 7px}.datapoints{margin:0;padding-left:20px}.datapoints li{margin:7px 0}.datapoints span{display:block;color:#59636e;font-size:12px}.source{padding:11px;margin:8px 0}.source-head{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.purpose,.note,.links,.rationale{font-size:12px;margin-top:6px}.note{color:#59636e}.rationale{padding:7px 9px;border-left:3px solid #bf8700;background:#fff8c5;border-radius:4px;color:#3d2f00}.methods{padding:14px;margin-top:12px}.methods p{font-size:13px}.muted{color:#8c959f;font-size:12px}a{color:#0969da;text-decoration:none}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f6f8fa;padding:1px 4px;border-radius:4px}.appendix{overflow:auto}table{width:100%;border-collapse:separate;border-spacing:0;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #eaeef2;font-size:12px}th{background:#f6f8fa;position:sticky;top:0}@media(max-width:720px){.wrap{padding:14px}.chapter h2,.workflow header{align-items:flex-start;flex-direction:column}.step{grid-template-columns:34px 1fr}}
${dashboardCss}</style></head><body><main class="wrap"><section class="hero"><p class="eyebrow">Pre 2.0.2 · Research 合同 2.0.1</p><h1>同步开发看板</h1><p>按章查看每项 Skill 工作流<strong>要做什么、使用什么来源、怎么分析、如何判断证据是否足够</strong>。展开卡片可检查步骤、网站入口与核查说明、数据项、方法及预期结论。此页展示设计合同与截至核查日的来源检查，不代表当前项目已经完成取证或运行验收。</p><div class="stats">${badge(`Pre 2.0.2 · main 基线 2.0.1`)}${badge(`57 Workflow`)}${badge(`${mappedCount}/57 已映射`, mappedCount === 57 ? 'ok' : 'warn')}${badge(`ResearchSpec 文件 ${specFiles.length}`)}${badge(`网站核查 ${esc(auditDoc.checkedAt)}`)}</div></section><section class="dashboard-tools"><label for="workflow-search">查找工作流、网站或分析方法</label><input id="workflow-search" type="search" placeholder="例如 02-03、气象、空间适宜性"><output id="visible-count">${workflows.length} / ${workflows.length} 项工作流</output><nav aria-label="章节导航">${chapterNav}</nav></section><section class="automation-policy"><h3>Research 合同 2.0.1 · 自动执行边界</h3><p><strong>人工不是流程推进器。</strong> 自动模式默认完成采集、核验、分析、返工、State 写入和 Gate 推进；用户主要用于完成后的 override/edit 微调。</p><p><code>risk=H</code> 不触发人工审批，只提高证据等级、交叉核验、置信度和自动复核强度。访问受限、证据冲突和自动返工耗尽分别记录为 <code>blocked_external</code>、<code>evidence_conflict</code>、<code>quality_unresolved</code>。</p></section>${chapters}<section class="chapter"><h2>附录 · 数据源反向索引<span>来源 → 被哪些步骤使用</span></h2><div class="appendix"><table><thead><tr><th>数据源</th><th>等级</th><th>访问核查</th><th>入口</th><th>对应 Workflow / ResearchStep / DataPoint</th></tr></thead><tbody>${sourceAppendix}</tbody></table></div></section></main>${dashboardScript}</body></html>`

await writeFile(resolve(root, 'research/v2.0.1/source-audit.html'), html)
console.log(`PRE_RESEARCH_SOURCE_AUDIT_PASS workflows=${workflows.length} mapped=${mappedCount} sources=${sourcesDoc.sources.length} specFiles=${specFiles.length}`)
