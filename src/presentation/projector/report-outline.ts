import type { FrozenProjectInput, FrozenStateObject } from '../../report/types.ts'
import { adaptFrozenProjectToPresentationFindings } from './frozen-project-adapter.ts'
import { DEFAULT_PRESENTATION_TOPICS } from './topics.ts'
import type { ProfessionalFinding, SupportingBlock } from './types.ts'
import { argumentPriority, audienceText, composeEditorialPages, composeNarration, contentWithoutLabel, displayPoints, isCondition, narrativeEntries, rawBody, type EditorialDetail } from './editorial-composition.ts'

/** Editorial sections are report questions, not workflow steps or a target page count. */
export interface ReportOutlineFinding extends ProfessionalFinding {
  readonly sectionKey: string
  readonly sectionTitle: string
  readonly sectionOrder: number
}

interface EditorialSection {
  readonly key: string
  readonly topic: string
  readonly title: string
  readonly question: string
  readonly objects: readonly string[]
  readonly visual: string
}

const SECTIONS: readonly EditorialSection[] = [
  { key: 'mandate', topic: 'project_brief', title: '项目背景与决策任务', question: '为什么启动本项目，本轮汇报需要解决哪些决策问题？', objects: ['PS01', 'PS02'], visual: '背景—任务—决策问题关系图' },
  { key: 'scope', topic: 'project_brief', title: '研究边界与已知约束', question: '研究、实施和影响范围分别是什么，哪些边界不能混用？', objects: ['PS03', 'PS05'], visual: '研究范围与实施范围对照图，约束清单' },
  { key: 'brief-evidence', topic: 'project_brief', title: '相关方诉求与成果依据', question: '谁使用成果、谁受影响，现有资料能支持什么深度的判断？', objects: ['PS04', 'PS06', 'PS07'], visual: '相关方关系表与关键资料缺口表' },
  { key: 'planning-land', topic: 'diagnosis', title: '规划管控、权属与开发边界', question: '上位规划与资产权属允许做什么，需先解决哪些限制？', objects: ['BL01', 'BL02'], visual: '规划管控叠合图与权属约束对照表' },
  { key: 'site-baseline', topic: 'diagnosis', title: '自然本底与空间现状', question: '自然环境与现状空间提供哪些条件，又形成哪些限制？', objects: ['BL03', 'BL04'], visual: '自然敏感性、灾害风险与现状空间分析图' },
  { key: 'service-baseline', topic: 'diagnosis', title: '人群需求与设施服务能力', question: '实际服务对象及使用特征是什么，设施、市场和基础设施能否支撑？', objects: ['BL05', 'BL06', 'BL07', 'BL08'], visual: '服务人群—供给—需求缺口对照表' },
  { key: 'problem-causes', topic: 'diagnosis', title: '核心问题、成因与利益矛盾', question: '哪些是表面现象，哪些是根本原因，项目能解决到什么程度？', objects: ['DG01', 'DG02', 'DG03'], visual: '问题—成因—影响对象因果图及利益冲突矩阵' },
  { key: 'resource-opportunity', topic: 'opportunity', title: '资源价值与外部机会', question: '哪些资源和机会可转化为项目价值，成立前提是什么？', objects: ['DG04', 'DG05'], visual: '资源—价值—激活条件对应表' },
  { key: 'priority-agenda', topic: 'opportunity', title: '关键策划议题与优先顺序', question: '从问题和机会中提炼出的重点议题是什么，为什么优先？', objects: ['DG06'], visual: '关键议题优先级与关联关系图' },
  { key: 'mission-targets', topic: 'positioning', title: '项目定位、公共价值与目标', question: '项目服务谁、创造什么价值，目标如何回应前述问题？', objects: ['OB01', 'OB02'], visual: '问题—使命—目标树' },
  { key: 'target-constraints', topic: 'positioning', title: '目标指标与刚性底线', question: '成功如何衡量，哪些指标和底线必须在方案中落实？', objects: ['OB03', 'OB04'], visual: '目标值、基线、口径及底线校核表' },
  { key: 'direction-evaluation', topic: 'positioning', title: '发展方向与评价准则', question: '方向假设如何检验，比选采用哪些评价规则？', objects: ['OB05', 'OB06'], visual: '方向假设与评价指标权重表' },
  { key: 'option-definition', topic: 'positioning', title: '可选路径与规模试排', question: '在统一前提下有哪些可选路径，差异体现在哪里？', objects: ['OP01', 'OP02', 'OP03'], visual: '方案差异矩阵与规模试排对照图' },
  { key: 'option-comparison', topic: 'positioning', title: '效益成本、可行性与综合比选', question: '各方案效益、成本和风险是否可比，排序是否稳健？', objects: ['OP04', 'OP05', 'OP06'], visual: '成本效益比较表、否决项与敏感性矩阵' },
  { key: 'recommended-path', topic: 'positioning', title: '推荐路径及成立条件', question: '为什么推荐这一方案，哪些条件变化会触发调整或回退？', objects: ['OP07'], visual: '推荐理由—前置验证—备选路径决策树' },
  { key: 'user-functions', topic: 'program_product', title: '使用场景与功能体系', question: '使用需求怎样转化为功能层级、服务与活动？', objects: ['PG01', 'PG02'], visual: '人群—场景—功能映射图' },
  { key: 'capacity-sharing', topic: 'program_product', title: '规模测算与共享组织', question: '容量和面积如何从需求推导，共享与分隔如何安排？', objects: ['PG03', 'PG05'], visual: '需求—参数—规模测算表与邻接共享矩阵' },
  { key: 'product-brief', topic: 'program_product', title: '产品服务组合与公益经营边界', question: '提供哪些具体产品服务，公益与经营边界如何写入任务书？', objects: ['PG04', 'PG06', 'PG07'], visual: '产品服务清单、公益经营分账与功能任务书' },
  { key: 'spatial-framework', topic: 'spatial_strategy', title: '总体空间结构与功能落位', question: '推荐的功能和规模具体落在哪里，空间容量是否匹配？', objects: ['SP01', 'SP02'], visual: '总体结构、分区落位与面积平衡图表' },
  { key: 'building-design', topic: 'spatial_strategy', title: '建筑更新与重点场景控制', question: '既有建筑如何利用，重点节点、界面和尺度如何控制？', objects: ['SP03', 'SP07'], visual: '建筑干预清单、典型剖面与节点示意图' },
  { key: 'spatial-support', topic: 'spatial_strategy', title: '交通组织、生态空间与技术支撑', question: '交通、生态和基础设施如何支撑使用，专项可行性缺口在哪里？', objects: ['SP04', 'SP05', 'SP06'], visual: '交通流线、生态网络与专项能力校核矩阵' },
  { key: 'spatial-phasing', topic: 'spatial_strategy', title: '空间分期与独立运行', question: '各阶段空间能否独立运行，临时使用、交接和预留如何安排？', objects: ['SP08'], visual: '分期范围与建设期间运行组织图' },
  { key: 'packages-cost', topic: 'delivery_model', title: '实施工程包与投资估算', question: '建设内容如何形成工程包，投资组成、范围和估算口径是什么？', objects: ['IM01', 'IM02'], visual: '工程包—工程量—费用构成对照表' },
  { key: 'funding-finance', topic: 'delivery_model', title: '资金筹措与运营财务情景', question: '已落实资金与筹资设想有何区别，不同情景下缺口和偿付压力怎样？', objects: ['IM03', 'IM06'], visual: '资金落实状态表、情景现金流与敏感性比较表' },
  { key: 'approval-operator', topic: 'delivery_model', title: '审批征迁与建设运营主体', question: '审批、产权和征迁如何推进，建设、运营、维护责任由谁承担？', objects: ['IM04', 'IM05'], visual: '审批关键路径与全周期责任分工表' },
  { key: 'roadmap-risk', topic: 'delivery_model', title: '实施时序、风险与绩效', question: '什么先做、何时启动，发生哪些风险时应调整方案？', objects: ['IM07', 'IM08'], visual: '分期实施路线图、风险触发与绩效监测表' },
]

type Detail = EditorialDetail

function details(object: FrozenStateObject): Detail[] {
  if ((object.reportSections?.length ?? 0) > 0) {
    return [...object.reportSections!].sort((a, b) => a.key.localeCompare(b.key)).flatMap(section => section.entries.map(entry => ({
      ...entry, objectId: object.objectId, objectTitle: object.title, sectionTitle: section.title, sectionKey: section.key,
    })))
  }
  // Legacy frozen inputs remain usable; no new facts are inferred from absent data.
  const facts = object.facts.length > 0 ? object.facts : [{ label: object.title, value: object.summary, basis: '原成果仅提供概述，详细依据待补充' }]
  return facts.filter(fact => fact.value.trim() !== '').map((fact, index) => ({
    key: `fact-${index}`, text: `${fact.label}：${fact.value}`, basis: fact.basis,
    fieldPath: `facts[${index}]`, objectId: object.objectId, objectTitle: object.title,
    sectionTitle: fact.label, sectionKey: 'facts',
  }))
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function headline(text: string, max = 42): string {
  const first = text.split(/[：:；;。\n]/u)[0]!.trim()
  return first.length > max ? `${first.slice(0, max)}…` : first
}

function bodyText(entry: Detail): string {
  return rawBody(entry)
}

function evidenceIds(entries: readonly Detail[]): string[] {
  return distinct(entries.flatMap(entry => entry.evidenceRefs?.map(ref => ref.evidenceId) ?? [])).sort()
}

function assetsFor(input: FrozenProjectInput, objectIds: readonly string[], pageEntries?: readonly Detail[]): string[] {
  const members = input.stateObjects.filter(object => objectIds.includes(object.objectId))
  const evidence = pageEntries ?? members.flatMap(details)
  return input.visualAssets.filter(asset => (input.adoptedAssetIds === undefined || input.adoptedAssetIds.includes(asset.assetId))
    && (members.some(object => asset.workItemId !== undefined && object.workItemId === asset.workItemId)
      || evidence.some(entry => entry.evidenceRefs?.some(ref => ref.assetId === asset.assetId))))
    .map(asset => asset.assetId).sort()
}

function evidenceTable(entries: readonly Detail[]): SupportingBlock {
  return { type: 'table', role: 'data', columns: ['完整成果内容', '依据与适用条件', '来源字段'], rows: entries.map(entry => [
    entry.text, entry.basis || '原资料未注明依据', `${entry.objectId}/${entry.fieldPath}/${entry.key}`,
  ]) }
}

/** The canonical adapter already renders keyMessage; supporting arguments must add information. */
function argumentBlocks(keyMessage: string, explanation: string, points: readonly string[]): SupportingBlock[] {
  const exact = (value: string) => value.normalize('NFC').trim().replace(/。+$/u, '')
  const key = exact(keyMessage)
  const body = explanation.split('\n\n').filter(paragraph => paragraph.trim() !== '' && exact(paragraph) !== key).join('\n\n')
  const additional = points.filter(point => exact(point) !== key)
  return [
    ...(body === '' ? [] : [{ type: 'text', role: 'body', content: body } as const]),
    ...(additional.length === 0 ? [] : [{ type: 'list', role: 'key_points', listStyle: 'unordered', items: additional } as const]),
  ]
}

function implication(sectionKey: string): string {
  const implications: Readonly<Record<string, string>> = {
    mandate: '因此，本轮选择应同时回应实际需求与实施边界，未完成验证的条件仍是后续决策的前提。',
    scope: '这些范围分别对应研究、建设和影响责任。明确彼此的区别，才能判断后续方案涉及哪些审批与协调事项。',
    'planning-land': '因此，规划允许建设与空间权利已经落实是不同的条件。方案推进仍取决于用地、权属与相关审批的实际进展。',
    'user-functions': '这意味着功能选择需要同时满足服务需求和运行前提，容量与设施配置也应与实际使用方式保持一致。',
    'capacity-sharing': '这些参数共同影响设施规模和共享方式。需求与运行条件变化时，相应容量也需要重新校核。',
    'packages-cost': '这些工程量、单价和费用共同构成当前投资估算。后续设计深化与实测结果变化时，投资基线需要同步调整。',
    'funding-finance': '因此，预期资金能够平衡不代表资金已经到位，实际推进仍取决于审批、出资和运营条件的落实。',
    'recommended-path': '推荐意见以这些条件成立为前提。验证结果发生变化时，仍需重新比较推荐与备选路径。',
    'spatial-support': '这些支撑条件共同影响空间能否安全使用。功能安排与专项能力需要保持一致，尚未核实的部分仍应保留调整空间。',
  }
  return implications[sectionKey] ?? '这些安排共同影响项目的实施范围与推进顺序。对于仍属于测算、建议或待验证的部分，后续决策需要以相应条件落实为前提。'
}

function pageClaim(entries: readonly Detail[], fallback: string): string {
  const first = narrativeEntries(entries, fallback)[0]
  const points = displayPoints(first === undefined ? [] : [first], 400)
  return points[0] === undefined ? `${fallback}仍需补充有效的项目依据。` : `${points[0].replace(/[。；;，]+$/u, '')}。`
}

function detailPages(input: FrozenProjectInput, section: EditorialSection, sectionOrder: number): ReportOutlineFinding[] {
  const members = section.objects.flatMap(id => input.stateObjects.filter(object => object.objectId === id))
  const all = members.flatMap(details)
  const pages = composeEditorialPages(all)
  return pages.map((page, pageIndex) => {
    const { entries } = page
    const first = entries[0]!
    const title = pages.length === 1 ? section.title : `${section.title}：${page.subject}·${headline(audienceText(contentWithoutLabel(first)), 34)}`
    const objectIds = distinct(entries.map(entry => entry.objectId))
    const keyMessage = pageClaim(entries, section.title)
    return {
      findingId: `pre-design:detail:${section.key}:argument:${first.objectId}:${first.sectionKey}:${first.key}`,
      topicKey: section.topic, sectionKey: section.key, sectionTitle: section.title, sectionOrder,
      order: pageIndex,
      title, keyMessage, contentNature: 'professional_judgement', objectIds, evidenceIds: evidenceIds(entries),
      supportingBlocks: [
        ...argumentBlocks(keyMessage, implication(section.key), page.points),
        evidenceTable(entries),
      ],
      speakerNotes: composeNarration({ title, claim: keyMessage, entries, kind: 'detail', implication: implication(section.key) }),
      assetIds: assetsFor(input, objectIds, entries),
    } satisfies ReportOutlineFinding
  })
}

interface AnalysisDefinition extends EditorialSection {
  readonly claim: string
}

const ANALYSES: readonly AnalysisDefinition[] = [
  { key: 'need-response', topic: 'diagnosis', title: '建设必要性：需求、成因与目标响应', question: '建设必要性是否由真实需求和因果分析支撑，哪些问题不在项目作用边界内？', objects: ['BL05', 'BL06', 'BL08', 'DG01', 'DG03', 'OB01', 'OB03', 'PG03'], visual: '需求—缺口—成因—目标—规模论证链', claim: '建设必要性取决于真实需求、现有供给和项目能够处理的问题范围。不同成因可能需要不同措施，项目目标仍受实际作用边界约束。' },
  { key: 'path-response', topic: 'positioning', title: '推荐方案：比较依据与成立条件', question: '推荐是否同时满足目标、底线、空间容量与成本约束？', objects: ['OB04', 'OB06', 'OP01', 'OP02', 'OP03', 'OP04', 'OP05', 'OP06', 'OP07'], visual: '备选路径—得失—推荐—回退条件对照表', claim: '方案的比较以共同边界和评价标准为前提。当前推荐仍受底线要求与前置验证约束，推荐意见不等于方案已经获批。' },
  { key: 'program-response', topic: 'program_product', title: '功能规模：从需求到产品服务的推导', question: '人群、需求、功能、容量和服务标准之间是否有明确推导关系？', objects: ['BL05', 'BL06', 'PG01', 'PG02', 'PG03', 'PG04', 'PG05', 'PG07'], visual: '服务对象—使用场景—功能—容量—产品对应表', claim: '功能规模由服务人群、使用时段和容量参数共同决定。峰值需求、周转率及共享条件变化，都会影响产品服务的配置与实施成本。' },
  { key: 'spatial-response', topic: 'spatial_strategy', title: '空间可实施性：功能落位与专项约束', question: '功能落位能否同时满足容量、交通、生态和技术条件？', objects: ['OB04', 'PG03', 'PG05', 'PG06', 'SP01', 'SP02', 'SP04', 'SP05', 'SP06'], visual: '功能—位置—专项能力—约束校核矩阵', claim: '空间落位同时受到功能容量、生态边界、交通及技术能力约束。公共活动与游憩属于方案设想，是否实施仍取决于保护要求和专项审查。' },
  { key: 'investment-basis', topic: 'delivery_model', title: '投资口径、资金落实与财务结论核对', question: '成本、筹资和财务模型是否使用同一口径，资金是否实际落实？', objects: ['IM01', 'IM02', 'IM03', 'IM06', 'PG06'], visual: '投资基线与财务口径对照表、资金落实状态表', claim: '建设投资、资金到位与拟筹资安排反映的是不同状态，拟筹资安排不等于资金已落实，也不能把建设费用当作已经到位的资金。财务判断仍需先统一投资范围、基准时点与融资条件。' },
  { key: 'delivery-response', topic: 'delivery_model', title: '实施闭环：启动条件、责任与风险回退', question: '工程包是否具备启动条件，谁负责落实，条件变化如何调整？', objects: ['IM01', 'IM03', 'IM04', 'IM05', 'IM07', 'IM08', 'SP08'], visual: '工程包—审批—资金—责任—时序—回退关系表', claim: '工程包的启动取决于资金、审批、征迁和责任主体共同落实。建设时序属于附条件的安排，外部条件改变时，推进顺序和实施规模也需相应调整。' },
]

function synthesisContext(members: readonly FrozenStateObject[]): Detail[] {
  return members.flatMap(member => {
    const available = details(member).filter(entry => audienceText(contentWithoutLabel(entry)) !== '')
      .sort((a, b) => argumentPriority(b) - argumentPriority(a))
    const selected = [available[0], ...available.filter(entry => entry.sectionKey === 'options' || entry.sectionKey === 'recommended_option'), available.find(entry => entry.metric !== undefined),
      available.find(entry => isCondition(entry) && entry !== available[0]), available.find(entry => entry !== available[0])]
    return [...new Set(selected.filter((entry): entry is Detail => entry !== undefined))]
  })
}

function synthesisBlocks(members: readonly FrozenStateObject[], keyMessage: string, explanation: string): SupportingBlock[] {
  const context = synthesisContext(members)
  return [
    ...argumentBlocks(keyMessage, explanation, displayPoints(context)),
    evidenceTable(context),
  ]
}

function investmentConflict(members: readonly FrozenStateObject[]): string | undefined {
  const metric = (id: string) => members.find(member => member.objectId === id)?.reportSections
    ?.filter(section => section.key === 'capex').flatMap(section => section.entries).find(entry => entry.metric !== undefined)?.metric
  const baseline = metric('IM02')
  const model = metric('IM06')
  if (baseline === undefined || model === undefined) return undefined
  if (String(baseline.value) === String(model.value) && baseline.unit === model.unit) return undefined
  return `投资口径待核对：成本基线列示${baseline.value}${baseline.unit ?? ''}，财务模型列示${model.value}${model.unit ?? ''}。两者数值或计量单位不同，需核对范围、基准时点及单位；核对前不能据此认定财务已平衡。`
}

function agendaPages(input: FrozenProjectInput): ReportOutlineFinding[] {
  const agenda = input.stateObjects.find(object => object.objectId === 'DG06')
  if (agenda === undefined) return []
  return details(agenda).filter(entry => entry.sectionKey === 'topics').map((entry, order) => {
    const statement = bodyText(entry).replace(`${entry.sectionTitle}：`, '')
    const title = statement.split(/[；;。\n]/u)[0]!.trim()
    const related = [
      ...(/比选|选址|坝址|路径|方案|规模/u.test(title) ? ['BL02', 'BL03', 'OB04', 'OP02', 'OP03', 'OP04', 'OP06', 'OP07'] : []),
      ...(/红线|生态|保护|边界|合规|占补/u.test(title) ? ['BL01', 'BL02', 'BL03', 'OB04', 'PG06', 'SP01', 'SP05', 'IM04'] : []),
      ...(/征地|安置|移民|补偿|产权|利益/u.test(title) ? ['BL02', 'BL05', 'DG02', 'SP08', 'IM02', 'IM04', 'IM07'] : []),
      ...(/资金|融资|投资|财务|筹措/u.test(title) ? ['PG06', 'IM01', 'IM02', 'IM03', 'IM06', 'IM07'] : []),
    ]
    const members = [agenda, ...distinct(related).flatMap(id => input.stateObjects.filter(object => object.objectId === id))]
    const conflict = /资金|融资|投资|财务/u.test(title) ? investmentConflict(members) : undefined
    const context = [entry, ...synthesisContext(members.filter(member => member.objectId !== 'DG06'))]
    const conclusion = conflict ?? audienceText(statement)
    return {
      findingId: `pre-design:agenda:${entry.key}`, topicKey: 'opportunity', sectionKey: 'project-agenda', sectionTitle: '项目关键议题的综合论证', sectionOrder: 79,
      order, title, keyMessage: conflict ?? statement, contentNature: conflict === undefined ? 'professional_judgement' : 'missing',
      objectIds: members.map(member => member.objectId), evidenceIds: evidenceIds([entry, ...members.flatMap(details)]),
      supportingBlocks: [
        ...argumentBlocks(conflict ?? statement, implication('recommended-path'), displayPoints(context)),
        evidenceTable(context),
      ],
      speakerNotes: composeNarration({ title, claim: conclusion, entries: [entry, ...members.filter(member => member.objectId !== 'DG06').flatMap(details)], kind: 'agenda', implication: implication('recommended-path') }),
      assetIds: assetsFor(input, members.map(member => member.objectId)),
    }
  })
}

export function compileReportOutline(input: FrozenProjectInput): readonly ReportOutlineFinding[] {
  if (input.stateObjects.length === 0) return []
  const ids = new Set(input.stateObjects.map(object => object.objectId))
  const findings: ReportOutlineFinding[] = []
  // Retain the ten previously published page keys, while replacing their digest with synthesis.
  for (const old of adaptFrozenProjectToPresentationFindings(input)) {
    const members = input.stateObjects.filter(object => old.objectIds.includes(object.objectId)).sort((a, b) => a.objectId.localeCompare(b.objectId))
    if (old.findingId === 'pre-design:delivery') {
      const cost = input.stateObjects.find(object => object.objectId === 'IM02')
      if (cost !== undefined) members.push(cost)
    }
    if (old.findingId === 'pre-design:decision') {
      members.splice(0, members.length, ...input.stateObjects.filter(object => ['PS02', 'OP07', 'IM02', 'IM06', 'IM07', 'IM08'].includes(object.objectId)).sort((a, b) => a.objectId.localeCompare(b.objectId)))
    }
    const conflict = ['pre-design:delivery', 'pre-design:decision'].includes(old.findingId) ? investmentConflict(input.stateObjects) : undefined
    const context = synthesisContext(members)
    const keyMessage = conflict ?? pageClaim(members.flatMap(details), old.title)
    const scope = old.findingId === 'pre-design:decision' ? 'recommended-path' : old.findingId === 'pre-design:delivery' ? 'funding-finance' : 'mandate'
    const decisions = distinct(input.decisionItems.map(audienceText)).filter(value => !/成果版本|Revision|Gate|R\d/u.test(value))
    const conclusion = `${implication(scope)}${old.findingId === 'pre-design:decision' && decisions.length > 0 ? `\n\n待决事项：${decisions.join('；')}` : ''}`
    findings.push({
      ...old, title: `${old.title}：综合研判`, keyMessage,
      contentNature: conflict === undefined ? 'professional_judgement' : 'missing',
      objectIds: members.map(member => member.objectId), evidenceIds: evidenceIds(members.flatMap(details)),
      sectionKey: `${old.findingId}:overview`, sectionTitle: `${old.title}综述`, sectionOrder: old.order < 40 ? old.order / 10 : 0,
      supportingBlocks: [
        ...synthesisBlocks(members, keyMessage, conclusion),
      ],
      speakerNotes: composeNarration({ title: old.title, claim: keyMessage, entries: members.flatMap(details), kind: 'overview', implication: implication(scope) }),
      assetIds: assetsFor(input, members.map(member => member.objectId)),
    })
  }
  for (const [index, section] of SECTIONS.entries()) findings.push(...detailPages(input, section, 10 + index))
  findings.push(...agendaPages(input))
  for (const [index, analysis] of ANALYSES.entries()) {
    const members = analysis.objects.flatMap(id => input.stateObjects.filter(object => object.objectId === id))
    // A cross-result analysis is only useful if at least two of its actual sources exist.
    if (members.length < 2 || !members.some(member => SECTIONS.some(section => section.topic === analysis.topic && section.objects.includes(member.objectId)))) continue
    const conflict = analysis.key === 'investment-basis' ? investmentConflict(members) : undefined
    findings.push({
      findingId: `pre-design:analysis:${analysis.key}`, topicKey: analysis.topic,
      sectionKey: `analysis:${analysis.key}`, sectionTitle: analysis.title, sectionOrder: 80 + index,
      order: 0, title: analysis.title, keyMessage: conflict ?? analysis.claim,
      contentNature: conflict === undefined ? 'professional_judgement' : 'missing',
      objectIds: members.map(member => member.objectId), evidenceIds: evidenceIds(members.flatMap(details)),
      supportingBlocks: [
        ...synthesisBlocks(members, conflict ?? analysis.claim, analysis.claim),
      ],
      speakerNotes: composeNarration({ title: analysis.title, claim: conflict ?? analysis.claim, entries: members.flatMap(details), kind: 'analysis', implication: analysis.claim }),
      assetIds: assetsFor(input, members.map(member => member.objectId)),
    })
  }
  // New/unrecognised source objects must not silently vanish from the report.
  const covered = new Set(SECTIONS.flatMap(section => section.objects))
  for (const id of [...ids].filter(id => !covered.has(id)).sort()) {
    const object = input.stateObjects.find(member => member.objectId === id)!
    findings.push(...detailPages(input, { key: `additional:${id}`, topic: 'project_brief', title: object.title, question: '本项补充成果对项目判断和汇报有哪些影响？', objects: [id], visual: '补充成果及其依据对照表' }, 90))
  }
  const topicOrder = new Map<string, number>(DEFAULT_PRESENTATION_TOPICS.map(topic => [topic.key, topic.order]))
  const ordered = findings.sort((a, b) => (topicOrder.get(a.topicKey) ?? 0) - (topicOrder.get(b.topicKey) ?? 0)
    || a.sectionOrder - b.sectionOrder || a.sectionKey.localeCompare(b.sectionKey) || a.order - b.order || a.findingId.localeCompare(b.findingId))
  return ordered.map((finding, index) => {
    const next = ordered[index + 1]
    const transition = next === undefined ? '在此基础上，后续推进仍以前述关键条件得到核实和确认作为前提。'
      : next.sectionKey === finding.sectionKey ? `在此基础上，进一步看${next.title.split('：').at(-1)}。`
        : `接下来转向${next.sectionTitle}，进一步讨论与之相关的项目条件和安排。`
    return { ...finding, speakerNotes: [...finding.speakerNotes ?? [], transition] }
  })
}
