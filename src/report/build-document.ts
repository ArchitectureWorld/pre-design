import type { FrozenProjectInput, ReportDocument, ReportNode, ReportSection } from './types.ts'

export const EXPECTED_REPORT_SECTIONS = Object.freeze([
  'executive-decision',
  'project-brief',
  'goals-boundaries',
  'evidence-baseline',
  'policy-market',
  'site-context',
  'constraints-opportunities',
  'vision-positioning',
  'strategy-framework',
  'spatial-structure',
  'program-mix',
  'mobility-access',
  'ecology-public-space',
  'concept-options',
  'implementation-phasing',
  'investment-risk',
  'decisions-appendix',
] as const)

const SECTION_DEFINITIONS = [
  ['executive-decision', '核心结论与需甲方决策事项', '先明确本轮建议、决策点和授权边界。'],
  ['project-brief', '项目任务与启动背景', '项目任务、启动原因和委托边界已形成一致基线。'],
  ['goals-boundaries', '目标体系与研究边界', '目标、成果深度和本阶段不处理事项相互匹配。'],
  ['evidence-baseline', '资料基础与证据边界', '所有结论区分事实、用户陈述、假设和待补证据。'],
  ['policy-market', '政策与市场研判', '外部条件用于校准选择，不替代项目自身决策。'],
  ['site-context', '场地与区域关系', '场地价值来自区域联系、公共资源和可达性的叠加。'],
  ['constraints-opportunities', '约束、机会与核心命题', '先锁定不可突破条件，再把机会转化为设计任务。'],
  ['vision-positioning', '总体愿景与项目定位', '定位应能被建设、运营与公众体验共同验证。'],
  ['strategy-framework', '策划策略与价值框架', '策略以可执行抓手连接定位、空间和运营。'],
  ['spatial-structure', '空间结构与功能骨架', '空间骨架优先保证公共性、连续性和分期兼容。'],
  ['program-mix', '功能组合与场景策划', '功能组合围绕全天候使用和复合收益组织。'],
  ['mobility-access', '交通组织与慢行体验', '到达、换乘、步行和后勤体系需同时成立。'],
  ['ecology-public-space', '生态策略与公共空间', '生态基础设施与高品质公共空间采用同一套系统。'],
  ['concept-options', '概念方案与方向比选', '概念图用于表达方向，不作为现状或法定事实。'],
  ['implementation-phasing', '实施路径与分期计划', '以首期可启动性控制长期愿景的落地风险。'],
  ['investment-risk', '投入重点、风险与应对', '投入优先级与风险责任需要同步确认。'],
  ['decisions-appendix', '决策清单与成果索引', '以可追溯 Revision 结束本轮，并明确下一步。'],
] as const

const SECTION_WORK_ITEMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'project-brief': ['01-01', '01-04'],
  'goals-boundaries': ['01-02', '01-03', '01-06'],
  'evidence-baseline': ['01-05', '01-07'],
  'policy-market': ['02-01', '02-07'],
  'site-context': ['02-02', '02-03', '02-04', '02-05', '02-06', '02-08'],
  'constraints-opportunities': ['03-01', '03-02', '03-03', '03-04', '03-05', '03-06'],
  'vision-positioning': ['04-01', '04-05'],
  'strategy-framework': ['04-02', '04-03', '04-04', '04-06'],
  'concept-options': ['05-01', '05-02', '05-03', '05-04', '05-05', '05-06', '05-07'],
  'program-mix': ['06-01', '06-02', '06-03', '06-04', '06-05', '06-06', '06-07'],
  'spatial-structure': ['07-01', '07-02', '07-03', '07-07'],
  'mobility-access': ['07-04', '07-06'],
  'ecology-public-space': ['07-05'],
  'implementation-phasing': ['07-08', '08-01', '08-07'],
  'investment-risk': ['08-02', '08-03', '08-04', '08-05', '08-06', '08-08'],
})

const GATE_TITLES: Readonly<Record<string, string>> = Object.freeze({
  G1: '项目任务', G2: '现状摸底', G3: '问题与机会', G4: '目标与方向',
  G5: '方案选择', G6: '功能与规模', G7: '空间与技术', G8: '投资与实施',
})

const DECISION_LABELS: Readonly<Record<FrozenProjectInput['gates'][number]['decision'], string>> = Object.freeze({
  approved: '已确认',
  approved_with_conditions: '有条件确认',
  returned: '退回完善',
  blocked: '暂缓确认',
})

function sectionObjects(id: string, input: FrozenProjectInput): FrozenProjectInput['stateObjects'] {
  const workItems = SECTION_WORK_ITEMS[id] ?? []
  if (workItems.length === 0) return []
  const selected = input.stateObjects.filter(object => object.workItemId !== undefined && workItems.includes(object.workItemId))
  if (selected.length > 0) return selected
  const chapters = new Set(workItems.map(workItem => workItem.slice(0, 2)))
  return input.stateObjects.filter(object => chapters.has(object.chapterId))
}

function clientGateLabel(gateId: string, includeId = false): string {
  const title = GATE_TITLES[gateId] ?? '阶段确认'
  return includeId ? `${title}（${gateId}）` : title
}

function chapterNodes(objects: FrozenProjectInput['stateObjects']): ReportNode[] {
  if (objects.length === 0) return [{ type: 'warning', title: '本章资料状态', items: ['本章没有已冻结成果，不作事实性推断。'] }]
  return objects.flatMap((object): ReportNode[] => [
    { type: 'heading', level: 3, text: object.title },
    { type: 'paragraph', text: object.summary },
    ...(object.facts.length === 0 ? [] : [{
      type: 'table' as const,
      columns: ['确认事项', '本轮结论', '依据'],
      rows: object.facts.map(fact => [fact.label, fact.value, fact.basis]),
    }]),
  ])
}

function completionChart(sectionId: string, input: FrozenProjectInput, objects?: FrozenProjectInput['stateObjects']): ReportNode {
  if (objects === undefined) {
    return {
      type: 'chart', chartId: `${sectionId}-completion`, chartType: 'bar',
      labels: input.gates.map(gate => clientGateLabel(gate.gateId)),
      values: input.gates.map(gate => ({ approved: 100, approved_with_conditions: 70, returned: 35, blocked: 0 })[gate.decision]),
      unit: '%',
    }
  }
  return {
    type: 'chart', chartId: `${sectionId}-completion`, chartType: 'bar',
    labels: ['已纳入本轮成果', '待补充或未决'],
    values: [objects.length, 0],
    unit: '项',
  }
}

function nodesForSection(id: string, input: FrozenProjectInput): ReportNode[] {
  if (id === 'executive-decision') {
    return [
      { type: 'decision', title: '本轮核心建议', items: [input.recommendation] },
      { type: 'decision', title: '需甲方确认', items: input.decisionItems },
      {
        type: 'chart', chartId: 'gate-status', chartType: 'bar',
        labels: input.gates.map(gate => clientGateLabel(gate.gateId)),
        values: input.gates.map(gate => ({ approved: 100, approved_with_conditions: 70, returned: 35, blocked: 0 })[gate.decision]),
        unit: '%',
      },
    ]
  }
  if (id === 'concept-options') {
    const objects = sectionObjects(id, input)
    const images: ReportNode[] = input.visualAssets
      .filter(asset => asset.kind === 'concept')
      .map(asset => ({ type: 'image', assetId: asset.assetId, caption: asset.caption }))
    return [...chapterNodes(objects), completionChart(id, input, objects), ...images]
  }
  if (id === 'decisions-appendix') {
    return [
      { type: 'decision', title: '甲方决策事项', items: input.decisionItems },
      {
        type: 'table', columns: ['阶段确认', '状态', '成果版本'],
        rows: input.gates.map(gate => [clientGateLabel(gate.gateId, true), DECISION_LABELS[gate.decision], `R${gate.revision}`]),
      },
      completionChart(id, input),
    ]
  }
  const objects = sectionObjects(id, input)
  return [...chapterNodes(objects), completionChart(id, input, objects)]
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

export function buildReportDocument(input: FrozenProjectInput): ReportDocument {
  if (!Number.isInteger(input.revision) || input.revision < 0) throw new Error('report revision must be non-negative integer')
  const sections: ReportSection[] = SECTION_DEFINITIONS.map(([id, title, claim]) => ({
    id,
    title,
    claim,
    nodes: nodesForSection(id, input),
  }))
  return deepFreeze({
    meta: {
      projectId: input.projectId,
      projectName: input.projectName,
      sourceRevision: input.revision,
      generatedAt: input.generatedAt,
      title: input.projectName,
      subtitle: '前期策划成果汇报',
      recommendationId: input.recommendationId ?? `recommendation-r${input.revision}`,
      adoptedAssetIds: [...(input.adoptedAssetIds ?? input.visualAssets.map(asset => asset.assetId))],
    },
    executiveSummary: input.recommendation,
    sections,
    assets: [...input.visualAssets],
  })
}
