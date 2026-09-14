from pathlib import Path

ROOT = Path('.')

def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing expected block: {label}')
    return text.replace(old, new, 1)

# 1) Fix field labels and classify English field names by token semantics rather than substring collisions.
p = ROOT / 'scripts/apply-v201-full-research-coverage.mjs'
s = p.read_text()
s = replace_once(
    s,
    "  procurement: '采购', governance: '治理', roles: '角色', responsibility: '责任', risks: '风险', assumptions: '假设', decision: '决策', decisions: '决策', indicators: '指标', metrics: '指标', metric: '指标',\n",
    "  procurement: '采购', governance: '治理', role: '角色', roles: '角色', strategic: '战略', fit: '适配度', evaluation: '评价', model: '模型', version: '版本', demands: '需求', balance: '平衡', responsibility: '责任', risks: '风险', assumptions: '假设', decision: '决策', decisions: '决策', indicators: '指标', metrics: '指标', metric: '指标',\n",
    'TOKEN_LABELS semantic labels',
)
start = s.index('function inferDataKind(field, contract) {')
end = s.index('\n\nconst QUERY_HINTS = {', start)
new_infer = r'''function inferDataKind(field, contract) {
  const fieldText = field.toLowerCase().replace(/[_-]+/gu, ' ')
  const contextText = `${contract.title} ${contract.purpose}`.toLowerCase()
  const fieldMatches = regex => regex.test(fieldText)
  const contextMatches = regex => regex.test(contextText)

  if (fieldMatches(/\b(?:parcel|parcels|land|redline|boundary|boundaries|right|rights|lease|leases|mortgage|mortgages|ownership)\b/u) || contextMatches(/产权|土地|权属|红线/u)) return 'land'
  if (fieldMatches(/\b(?:terrain|topography|topographic)\b/u) || contextMatches(/地形/u)) return 'natural_resource'
  if (fieldMatches(/\b(?:hydrology|hydrologic|flood|flooding)\b/u) || contextMatches(/水文|洪涝|防洪|水系/u)) return 'hydrology'
  if (fieldMatches(/\b(?:ecology|ecological|contamination|contaminated|environment|environmental)\b/u) || contextMatches(/环境|生态|污染/u)) return 'environment'
  if (fieldMatches(/\b(?:climate|temperature|precipitation|wind)\b/u) || contextMatches(/气候|温度|降水|风/u)) return 'climate'
  if (fieldMatches(/\b(?:hazard|hazards|disaster|disasters|fire safety|structural safety|resilience)\b/u) || contextMatches(/安全|消防|灾害|韧性/u)) return 'safety'
  if (fieldMatches(/\b(?:population|demographic|demographics|household|households|group|groups|journey|journeys)\b|\b(?:peak periods?|time patterns?)\b/u) || contextMatches(/人群|人口|客流|行为/u)) return 'population'
  if (fieldMatches(/\b(?:facility|facilities|service|services|capacity|capacities|utilization|shareability|education|health|elderly)\b/u) || contextMatches(/社区|公共服务|教育|医疗|养老/u)) return 'public_service'
  if (fieldMatches(/\b(?:sector|sectors|business|businesses|poi|pois|rent|rents|footfall|sales|competitor|competitors|market|operator|operators|supply)\b/u) || contextMatches(/产业|市场|商业|运营|租金|竞品/u)) return 'market'
  if (fieldMatches(/\b(?:traffic|parking|transit|mobility)\b/u) || contextMatches(/交通|停车|公交/u)) return 'transport'
  if (fieldMatches(/\b(?:utilities|utility|energy|power)\b/u) || contextMatches(/市政|能源|电力|管线/u)) return 'utilities'
  if (fieldMatches(/\b(?:heritage|culture|tourism)\b/u) || contextMatches(/文保|文化|旅游/u)) return 'culture'
  if (fieldMatches(/\b(?:cost|costs|capex|opex|rate|rates|quantity|quantities|tax|taxes|contingency|contingencies)\b/u) || contextMatches(/造价|投资|成本|单价|工程量/u)) return 'cost'
  if (fieldMatches(/\b(?:finance|financing|fund|funding|cashflow|cashflows|return|returns|revenue|revenues|npv|irr|dscr)\b/u) || contextMatches(/财政|融资|资金|收益/u)) return 'finance'
  if (fieldMatches(/\b(?:standard|standards)\b/u) || contextMatches(/标准|规范/u)) return 'standard'
  if (fieldMatches(/\b(?:policy|policies|regulation|regulations)\b/u) || contextMatches(/法规|政策/u)) return 'policy'
  if (fieldMatches(/\b(?:planning|spatial|layout|zone|zones|geometry|area|areas|height|heights|building|buildings|site)\b/u) || contextMatches(/空间|规划|建筑|场地|面积|布局/u)) return 'spatial_planning'
  if (fieldMatches(/\b(?:schedule|schedules|phase|phases|milestone|milestones|procurement|governance|implementation)\b/u) || contextMatches(/实施|进度|采购|治理|分期|时序|启动计划/u)) return 'implementation'
  if (fieldMatches(/\b(?:industry|industrial)\b/u) || contextMatches(/产业/u)) return 'industry'
  return 'project_analysis'
}'''
s = s[:start] + new_infer + s[end:]
p.write_text(s)

# 2) Make the audit page explain why each source, step, aggregation, and analysis method is used.
p = ROOT / 'scripts/build-research-source-audit.mjs'
s = p.read_text()
start = s.index('function sourceCard(sourceId, preference) {')
end = s.index('\n\nfunction workflowHtml(workflow) {', start)
new_source_card = '''function sourceCard(sourceId, preference) {
  const source = sourceById.get(sourceId)
  const audit = auditBySource.get(sourceId)
  if (!source) return `<div class="source missing">未知来源：${esc(sourceId)}</div>`
  const status = audit?.status ?? 'not_checked'
  const cls = /verified/u.test(status) ? 'ok' : /local|not_external/u.test(status) ? 'neutral' : 'warn'
  const necessity = preference?.required === true ? badge('本 Workflow 必需来源', 'required') : badge('条件/辅助来源', 'neutral')
  const authorityReason = `${source.priority}/${source.reliabilityGrade}；发布方：${source.publisher}；核查状态：${status}`
  const workflowPurpose = preference?.purpose || '为当前 Workflow 提供已登记、可追溯的证据输入。'
  const choiceReason = preference?.required === true
    ? `该来源是当前 Workflow 的必需来源；${workflowPurpose}`
    : `该来源用于补充或交叉核验当前 Workflow；${workflowPurpose}`
  return `<div class="source"><div class="source-head"><strong>${esc(source.name)}</strong>${badge(source.priority)}${badge(source.reliabilityGrade)}${necessity}${badge(status, cls)}</div><div class="rationale"><strong>为什么选择这个来源：</strong>${esc(choiceReason)}</div><div class="rationale"><strong>来源权威性：</strong>${esc(authorityReason)}</div><div class="rationale"><strong>该来源在本 Workflow 中的用途：</strong>${esc(workflowPurpose)}</div><div class="meta"><span>访问方式：${esc(source.accessModes.join(' / '))}</span></div><div class="links">主入口：${link(source.homepage)}${audit?.workingUrl && audit.workingUrl !== source.homepage ? ` · 本次可工作入口：${link(audit.workingUrl)}` : ''}</div><div class="note">${esc(audit?.note ?? source.notes)}</div></div>`
}'''
s = s[:start] + new_source_card + s[end:]
old_step = '''    return `<section class="step"><div class="step-index">${String(step.order).padStart(2, '0')}</div><div class="step-body"><h4>${esc(step.title)}</h4><div class="step-meta">${badge(step.action)}${badge(step.produces)}<span>依赖：${esc(deps)}</span></div><h5>使用的数据项</h5>${dataPoints}<h5>本步骤的数据来源</h5>${sources}${step.notes ? `<div class="note">${esc(step.notes)}</div>` : ''}</div></section>`
'''
new_step = '''    const stepReason = step.notes || `把 ${step.action} 的输入转成 ${step.produces}，并作为后续 ResearchStep 的可追溯前置结果。`
    return `<section class="step"><div class="step-index">${String(step.order).padStart(2, '0')}</div><div class="step-body"><h4>${esc(step.title)}</h4><div class="step-meta">${badge(step.action)}${badge(step.produces)}<span>依赖：${esc(deps)}</span></div><div class="rationale"><strong>为什么做这一步：</strong>${esc(stepReason)}</div><h5>使用的数据项</h5>${dataPoints}<h5>本步骤的数据来源</h5>${sources}${step.notes ? `<div class="note">执行约束：${esc(step.notes)}</div>` : ''}</div></section>`
'''
s = replace_once(s, old_step, new_step, 'research step rationale')
old_workflow_return = next(line for line in s.splitlines(True) if line.startswith('  return `<article class="workflow mapped">'))
new_workflow_return = '''  const methodReason = `先用 ${spec.aggregationMethod.methodId} v${spec.aggregationMethod.version} 按权威等级、时效与对象/口径一致性完成确定性汇总，再用 ${spec.analysisMethod.methodId} v${spec.analysisMethod.version} 解释差异、约束、机会与限制；这样可以把“数据合并”和“专业判断”分开追溯。`
  return `<article class="workflow mapped"><header><div><span class="workflow-id">${esc(workflow.work_item_id)}</span><strong>${esc(workflow.title)}</strong></div>${badge('Research 链已映射', 'ok')}</header><div class="flow-summary"><span>Workflow：<code>${esc(spec.workflowId)}</code></span><span>最低证据：高权威 ${spec.minimumEvidence.minHighAuthority} / 独立来源 ${spec.minimumEvidence.minIndependentSources}</span><span>Automatic：默认自动推进</span></div><div class="automation-note">${esc(riskRule)}</div>${steps}<section class="methods"><h4>汇总与分析</h4><div class="rationale"><strong>为什么这样汇总与分析：</strong>${esc(methodReason)}</div><p><strong>汇总：</strong>${esc(spec.aggregationMethod.methodId)} v${esc(spec.aggregationMethod.version)} — ${esc(spec.aggregationMethod.description)}</p><p><strong>分析：</strong>${esc(spec.analysisMethod.methodId)} v${esc(spec.analysisMethod.version)} — ${esc(spec.analysisMethod.description)}</p><p><strong>缺失策略：</strong>${esc(spec.fallbackPolicy)}</p><h5>最终输出结论</h5><ul>${spec.outputClaims.map(claim => `<li>${esc(claim)}</li>`).join('')}</ul></section></article>`
'''
s = replace_once(s, old_workflow_return, new_workflow_return, 'workflow method rationale')
s = replace_once(
    s,
    '.purpose,.note,.links{font-size:12px;margin-top:6px}.note{color:#59636e}',
    '.purpose,.note,.links,.rationale{font-size:12px;margin-top:6px}.note{color:#59636e}.rationale{padding:7px 9px;border-left:3px solid #bf8700;background:#fff8c5;border-radius:4px;color:#3d2f00}',
    'audit rationale style',
)
p.write_text(s)

# 3) Lock the additional regression that exposed the generic substring bug.
p = ROOT / 'tests/research-all-chapters.spec.ts'
s = p.read_text()
addition = '''  it('does not classify strategic fit as cost because "rate" appears inside "strategic"', async () => {
    const registry = await ResearchRegistry.open(researchRoot)
    expect(dataPoint(registry, 'preplan.wf.03.06', 'strategic-fit')).toMatchObject({ dataKind: 'project_analysis' })
  })

'''
needle = "  it('renders explicit reasons for each source choice and each research step in the audit HTML', async () => {"
if addition not in s:
    if needle not in s:
        raise SystemExit('missing expected audit HTML regression test')
    s = s.replace(needle, addition + needle, 1)
p.write_text(s)

print('V201_SEMANTIC_AUDIT_FIX_APPLIED')
