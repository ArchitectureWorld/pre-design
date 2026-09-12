import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'))
const esc = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const link = (url, label = url) => url ? `<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(label)}</a>` : '<span class="muted">非网站来源</span>'
const badge = (text, cls = '') => `<span class="badge ${cls}">${esc(text)}</span>`

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

function sourceCard(sourceId, purpose) {
  const source = sourceById.get(sourceId)
  const audit = auditBySource.get(sourceId)
  if (!source) return `<div class="source missing">未知来源：${esc(sourceId)}</div>`
  const status = audit?.status ?? 'not_checked'
  const cls = /verified/u.test(status) ? 'ok' : /local|not_external/u.test(status) ? 'neutral' : 'warn'
  return `<div class="source"><div class="source-head"><strong>${esc(source.name)}</strong>${badge(source.priority)}${badge(source.reliabilityGrade)}${badge(status, cls)}</div><div class="purpose">${esc(purpose ?? '')}</div><div class="meta"><span>发布方：${esc(source.publisher)}</span><span>访问方式：${esc(source.accessModes.join(' / '))}</span></div><div class="links">主入口：${link(source.homepage)}${audit?.workingUrl && audit.workingUrl !== source.homepage ? ` · 本次可工作入口：${link(audit.workingUrl)}` : ''}</div><div class="note">${esc(audit?.note ?? source.notes)}</div></div>`
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
      ? step.sourceIds.map(id => sourceCard(id, preferenceBySource.get(id)?.purpose)).join('')
      : '<div class="muted">本步骤不直接访问外部来源。</div>'
    const deps = step.dependsOnStepIds.length ? step.dependsOnStepIds.join(' → ') : '起始步骤'
    return `<section class="step"><div class="step-index">${String(step.order).padStart(2, '0')}</div><div class="step-body"><h4>${esc(step.title)}</h4><div class="step-meta">${badge(step.action)}${badge(step.produces)}<span>依赖：${esc(deps)}</span></div><h5>使用的数据项</h5>${dataPoints}<h5>本步骤的数据来源</h5>${sources}${step.notes ? `<div class="note">${esc(step.notes)}</div>` : ''}</div></section>`
  }).join('')
  return `<article class="workflow mapped"><header><div><span class="workflow-id">${esc(workflow.work_item_id)}</span><strong>${esc(workflow.title)}</strong></div>${badge('Research 链已映射', 'ok')}</header><div class="flow-summary"><span>Workflow：<code>${esc(spec.workflowId)}</code></span><span>最低证据：高权威 ${spec.minimumEvidence.minHighAuthority} / 独立来源 ${spec.minimumEvidence.minIndependentSources}</span></div>${steps}<section class="methods"><h4>汇总与分析</h4><p><strong>汇总：</strong>${esc(spec.aggregationMethod.methodId)} v${esc(spec.aggregationMethod.version)} — ${esc(spec.aggregationMethod.description)}</p><p><strong>分析：</strong>${esc(spec.analysisMethod.methodId)} v${esc(spec.analysisMethod.version)} — ${esc(spec.analysisMethod.description)}</p><p><strong>缺失策略：</strong>${esc(spec.fallbackPolicy)}</p><h5>最终输出结论</h5><ul>${spec.outputClaims.map(claim => `<li>${esc(claim)}</li>`).join('')}</ul></section></article>`
}

const chapters = Object.keys(chapterNames).map(chapterId => {
  const rows = workflows.filter(workflow => workflow.chapter_id === chapterId)
  const mapped = rows.filter(workflow => specByWorkflow.has(workflow.workflow_id)).length
  return `<section class="chapter"><h2>${chapterId} · ${esc(chapterNames[chapterId])}<span>${mapped}/${rows.length} 已建立 Research 链</span></h2>${rows.map(workflowHtml).join('')}</section>`
}).join('')

const sourceAppendix = sourcesDoc.sources.map(source => {
  const audit = auditBySource.get(source.sourceId)
  const usages = reverseSourceUsage.get(source.sourceId) ?? []
  return `<tr><td><strong>${esc(source.name)}</strong><br><code>${esc(source.sourceId)}</code></td><td>${badge(source.priority)} ${badge(source.reliabilityGrade)}</td><td>${badge(audit?.status ?? 'not_checked', /verified/u.test(audit?.status ?? '') ? 'ok' : 'warn')}<br>${esc(audit?.note ?? '')}</td><td>${link(source.homepage)}${audit?.workingUrl && audit.workingUrl !== source.homepage ? `<br>${link(audit.workingUrl, '可工作入口')}` : ''}</td><td>${usages.length ? usages.map(row => `<div><code>${esc(row.workflowId)}</code> → ${esc(row.stepId)} ${esc(row.stepTitle)}<br><small>${esc(row.dataPointIds.join(', '))}</small></div>`).join('') : '<span class="muted">当前已映射 Workflow 未使用</span>'}</td></tr>`
}).join('')

const mappedCount = workflows.filter(workflow => specByWorkflow.has(workflow.workflow_id)).length
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pre 2.0.1 数据源与分析链核查</title><style>
:root{font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2328;background:#f6f8fa}body{margin:0}.wrap{max-width:1440px;margin:auto;padding:28px}.hero,.workflow,.source,.methods,table{background:#fff;border:1px solid #d8dee4;border-radius:12px}.hero{padding:24px;margin-bottom:22px}.hero h1{margin:0 0 8px}.hero p{color:#59636e}.stats{display:flex;gap:10px;flex-wrap:wrap}.chapter{margin:30px 0}.chapter h2{display:flex;justify-content:space-between;align-items:center}.chapter h2 span{font-size:13px;font-weight:500;color:#59636e}.workflow{margin:14px 0;padding:18px}.workflow header{display:flex;justify-content:space-between;gap:12px;align-items:center}.workflow-id{font:700 13px ui-monospace;margin-right:10px}.unmapped{border-style:dashed}.badge{display:inline-block;border-radius:999px;background:#eef1f4;padding:2px 8px;font-size:11px;margin:0 4px}.badge.ok{background:#dafbe1;color:#116329}.badge.warn{background:#fff1e5;color:#9a6700}.badge.neutral{background:#eaeef2}.flow-summary,.step-meta,.meta{display:flex;gap:10px;flex-wrap:wrap;color:#59636e;font-size:12px;margin-top:10px}.step{display:grid;grid-template-columns:42px 1fr;gap:12px;border-top:1px solid #eaeef2;padding:16px 0}.step-index{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:#0969da;color:#fff;font-weight:700}.step h4,.methods h4{margin:0 0 8px}.step h5,.methods h5{margin:14px 0 7px}.datapoints{margin:0;padding-left:20px}.datapoints li{margin:7px 0}.datapoints span{display:block;color:#59636e;font-size:12px}.source{padding:11px;margin:8px 0}.source-head{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.purpose,.note,.links{font-size:12px;margin-top:6px}.note{color:#59636e}.methods{padding:14px;margin-top:12px}.methods p{font-size:13px}.muted{color:#8c959f;font-size:12px}a{color:#0969da;text-decoration:none}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f6f8fa;padding:1px 4px;border-radius:4px}.appendix{overflow:auto}table{width:100%;border-collapse:separate;border-spacing:0;overflow:hidden}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #eaeef2;font-size:12px}th{background:#f6f8fa;position:sticky;top:0}@media(max-width:720px){.wrap{padding:14px}.chapter h2,.workflow header{align-items:flex-start;flex-direction:column}.step{grid-template-columns:34px 1fr}}
</style></head><body><main class="wrap"><section class="hero"><h1>Pre 2.0.1 · 数据源与分析链核查</h1><p>主线不是“网站清单”，而是 <strong>Chapter → Workflow → ResearchStep → DataPoint → DataSource → Evidence → 汇总/计算 → AnalysisTrace → OutputClaim</strong>。网站只出现在真正使用它的步骤下面。</p><div class="stats">${badge(`V2.0.0 基线 main@49140423…`)}${badge(`57 Workflow`)}${badge(`${mappedCount}/57 已映射`, mappedCount === 57 ? 'ok' : 'warn')}${badge(`ResearchSpec 文件 ${specFiles.length}`)}${badge(`网站核查 ${esc(auditDoc.checkedAt)}`)}</div></section>${chapters}<section class="chapter"><h2>附录 · 数据源反向索引<span>来源 → 被哪些步骤使用</span></h2><div class="appendix"><table><thead><tr><th>数据源</th><th>等级</th><th>访问核查</th><th>入口</th><th>对应 Workflow / ResearchStep / DataPoint</th></tr></thead><tbody>${sourceAppendix}</tbody></table></div></section></main></body></html>`

await writeFile(resolve(root, 'research/v2.0.1/source-audit.html'), html)
console.log(`PRE_RESEARCH_SOURCE_AUDIT_PASS workflows=${workflows.length} mapped=${mappedCount} sources=${sourcesDoc.sources.length} specFiles=${specFiles.length}`)
