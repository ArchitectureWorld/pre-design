import type { FrozenProjectInput, FrozenReportEntry, FrozenStateObject } from '../../report/types.ts'
import { adaptFrozenProjectToPresentationFindings } from './frozen-project-adapter.ts'
import { DEFAULT_PRESENTATION_TOPICS } from './topics.ts'
import type { ProfessionalFinding, SupportingBlock } from './types.ts'

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

interface Detail extends FrozenReportEntry {
  readonly objectId: string
  readonly objectTitle: string
  readonly sectionTitle: string
  readonly sectionKey: string
}

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
  return entry.contentText ?? entry.text
}

function pageSubject(entries: readonly Detail[]): string {
  const candidates = entries.map(entry => {
    const body = bodyText(entry).replace(`${entry.sectionTitle}：`, '')
    const subject = body.split(/[；;。\n]/u)[0]!.trim()
    return subject.length > 36 ? `${subject.slice(0, 36)}…` : subject
  })
  return candidates.find(value => value.length >= 8 && /\p{Script=Han}/u.test(value)
    && !/[A-Za-z]+_/u.test(value)
    && !/^(?:DSH|资料定位|可信程度|适用限制|判断依据|单位|上限|下限|推荐理由|[\d.]+[\s万千亿%])/u.test(value)
    && !value.includes('补充内容')) ?? distinct(entries.map(entry => entry.sectionTitle)).slice(0, 2).join('与')
}

function evidenceIds(entries: readonly Detail[]): string[] {
  return distinct(entries.flatMap(entry => entry.evidenceRefs?.map(ref => ref.evidenceId) ?? [])).sort()
}

function assetsFor(input: FrozenProjectInput, objectIds: readonly string[]): string[] {
  const members = input.stateObjects.filter(object => objectIds.includes(object.objectId))
  return input.visualAssets.filter(asset => (input.adoptedAssetIds === undefined || input.adoptedAssetIds.includes(asset.assetId))
    && members.some(object => asset.workItemId !== undefined ? object.workItemId === asset.workItemId : object.chapterId === asset.chapterId))
    .map(asset => asset.assetId).sort()
}

const LENSES = [
  { key: 'basis', title: '依据与测算', match: /baseline|population|demographic|demand|need|capacity|quantit|area|capex|cost|irr|dscr|npv|cashflow|revenue|amount|price|unit|formula|parameter|target|definition|score|weight|criter|metric|range|comparison/u },
  { key: 'proposal', title: '内容与组织', match: /./u },
  { key: 'conditions', title: '条件、风险与验证', match: /constraint|risk|condition|assumption|approval|gap|limit|veto|uncertain|trigger|test|dependenc|validation|conflict|prohibit|restrict|sensitivity|stress|fallback|rejection|exception|prerequisite/u },
] as const

function lensFor(key: string): typeof LENSES[number] {
  return LENSES[2].match.test(key) ? LENSES[2] : LENSES[0].match.test(key) ? LENSES[0] : LENSES[1]
}

/** Keep semantic entities intact. Limits bound page density, never total content. */
function paginate(entries: readonly Detail[]): Detail[][] {
  const pages: Detail[][] = []
  for (const entry of entries) {
    let page = pages.at(-1)
    const weight = (value: Detail) => bodyText(value).length
    if (page === undefined || (page.length > 0 && (page.length >= 12 || page.reduce((sum, value) => sum + weight(value), 0) + weight(entry) > 2400))) {
      page = []
      pages.push(page)
    }
    page.push(entry)
  }
  return pages
}

function detailPages(input: FrozenProjectInput, section: EditorialSection, sectionOrder: number): ReportOutlineFinding[] {
  const members = section.objects.flatMap(id => input.stateObjects.filter(object => object.objectId === id))
  const all = members.flatMap(details).filter(entry => bodyText(entry).trim() !== '')
  const conflict = members.some(member => ['IM02', 'IM03', 'IM06'].includes(member.objectId))
    ? investmentConflict(input.stateObjects) : undefined
  return LENSES.flatMap(lens => paginate(all.filter(entry => lensFor(entry.sectionKey).key === lens.key)).map((entries, pageIndex, pages) => {
    const first = entries[0]!
    const names = distinct(entries.map(entry => entry.sectionTitle))
    const subTitle = names.length <= 2 ? names.join('与') : `${names[0]}至${names.at(-1)}`
    const title = `${section.title}：${pages.length === 1 ? lens.title : pageSubject(entries)}`
    const objectIds = distinct(entries.map(entry => entry.objectId))
    const sources = entries.map(entry => `${entry.objectId} / ${entry.fieldPath}：${entry.basis || '来源资料未注明依据'}`)
    const keyMessage = lens.key === 'conditions'
      ? `本页列明${subTitle}，作为${section.title}的成立条件与待验证边界。`
      : `围绕${subTitle}展开${section.title}，逐项说明已有成果及其依据，不将测算或建议当作已实施事实。`
    return {
      findingId: `pre-design:detail:${section.key}:${lens.key}:${first.objectId}:${first.sectionKey}:${first.key}`,
      topicKey: section.topic, sectionKey: section.key, sectionTitle: section.title, sectionOrder,
      order: LENSES.indexOf(lens) * 10000 + pageIndex,
      title, keyMessage, contentNature: lens.key === 'conditions' ? 'assumption' : 'professional_judgement', objectIds, evidenceIds: evidenceIds(entries),
      supportingBlocks: [
        { type: 'text', role: 'body', content: `本页回答：${section.question}` },
        ...(conflict === undefined ? [] : [{ type: 'text', role: 'body', content: conflict, contentNature: 'missing' } satisfies SupportingBlock]),
        { type: 'heading', role: 'section_title', content: '汇报展开要点' },
        { type: 'list', role: 'key_points', listStyle: 'unordered', items: entries.map(bodyText) },
        { type: 'table', role: 'data', columns: ['论证内容', '依据与适用条件'], rows: entries.map(entry => [headline(entry.text), entry.basis || '来源资料未注明依据，正式汇报前核实']) },
        { type: 'text', role: 'caption', content: `建议图表：${section.visual}（编写建议，非已生成图件）。` },
        { type: 'text', role: 'source_note', content: `来源成果：${distinct(entries.map(entry => entry.objectTitle)).join('；')}。` },
      ],
      speakerNotes: [`本页回答：${section.question}`, ...entries.map(entry => entry.text), ...sources,
        ...members.flatMap(details).filter(entry => bodyText(entry).trim() === '').map(entry => `${entry.text}（${entry.objectId}/${entry.fieldPath}）`)],
      assetIds: assetsFor(input, objectIds),
    } satisfies ReportOutlineFinding
  }))
}

interface AnalysisDefinition extends EditorialSection {
  readonly claim: string
}

const ANALYSES: readonly AnalysisDefinition[] = [
  { key: 'need-response', topic: 'diagnosis', title: '建设必要性：需求、成因与目标响应', question: '建设必要性是否由真实需求和因果分析支撑，哪些问题不在项目作用边界内？', objects: ['BL05', 'BL06', 'BL08', 'DG01', 'DG03', 'OB01', 'OB03', 'PG03'], visual: '需求—缺口—成因—目标—规模论证链', claim: '把供需缺口、问题成因与目标规模对照论证；不能把相关问题都归因为单一原因，也不能承诺一个项目解决全部问题。' },
  { key: 'path-response', topic: 'positioning', title: '推荐方案：比较依据与成立条件', question: '推荐是否同时满足目标、底线、空间容量与成本约束？', objects: ['OB04', 'OB06', 'OP01', 'OP02', 'OP03', 'OP04', 'OP05', 'OP06', 'OP07'], visual: '备选路径—得失—推荐—回退条件对照表', claim: '在同一基线下比较各方案的得失，再列明推荐理由和前置验证；推荐意见不等于方案已经获批。' },
  { key: 'program-response', topic: 'program_product', title: '功能规模：从需求到产品服务的推导', question: '人群、需求、功能、容量和服务标准之间是否有明确推导关系？', objects: ['BL05', 'BL06', 'PG01', 'PG02', 'PG03', 'PG04', 'PG05', 'PG07'], visual: '服务对象—使用场景—功能—容量—产品对应表', claim: '用人群和场景需求校核功能、容量与产品组合；保留峰值、周转率和共享条件，避免只罗列功能名称。' },
  { key: 'spatial-response', topic: 'spatial_strategy', title: '空间可实施性：功能落位与专项约束', question: '功能落位能否同时满足容量、交通、生态和技术条件？', objects: ['OB04', 'PG03', 'PG05', 'PG06', 'SP01', 'SP02', 'SP04', 'SP05', 'SP06'], visual: '功能—位置—专项能力—约束校核矩阵', claim: '把空间方案与功能规模、生态边界和技术能力逐项对照；公共活动与游憩设想不代表已通过保护区等合规审查。' },
  { key: 'investment-basis', topic: 'delivery_model', title: '投资口径、资金落实与财务结论核对', question: '成本、筹资和财务模型是否使用同一口径，资金是否实际落实？', objects: ['IM01', 'IM02', 'IM03', 'IM06', 'PG06'], visual: '投资基线与财务口径对照表、资金落实状态表', claim: '先核对投资范围、基准时点与融资条件，再解释财务结果；测算资金缺口为零不等于资金已落实。' },
  { key: 'delivery-response', topic: 'delivery_model', title: '实施闭环：启动条件、责任与风险回退', question: '工程包是否具备启动条件，谁负责落实，条件变化如何调整？', objects: ['IM01', 'IM03', 'IM04', 'IM05', 'IM07', 'IM08', 'SP08'], visual: '工程包—审批—资金—责任—时序—回退关系表', claim: '将建设时序与资金、审批、征迁和运营责任对照，明确未落实的启动条件以及调整预案。' },
]

function synthesisBlocks(question: string, members: readonly FrozenStateObject[], visual: string): SupportingBlock[] {
  return [
    { type: 'text', role: 'body', content: `本页回答：${question}` },
    { type: 'table', role: 'comparison', columns: ['论证环节', '已有成果提出的判断', '支撑要点与限定条件'], rows: members.map(member => [
      member.title, member.summary, details(member).map(entry => entry.text).slice(0, 2).join('；') || '尚缺展开依据，需补证',
    ]) },
    { type: 'text', role: 'caption', content: `建议图表：${visual}（编写建议，非已生成图件）。` },
    { type: 'text', role: 'source_note', content: '以下详细页展开完整成果；本页用于跨成果组织论证。资料中的判断、预测和建议均保留原有条件，未作独立事实核验。' },
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
    const question = `围绕“${title}”，已有依据、方案回应与未落实条件分别是什么？`
    const conflict = /资金|融资|投资|财务/u.test(title) ? investmentConflict(members) : undefined
    return {
      findingId: `pre-design:agenda:${entry.key}`, topicKey: 'opportunity', sectionKey: 'project-agenda', sectionTitle: '项目关键议题的综合论证', sectionOrder: 79,
      order, title, keyMessage: conflict ?? statement, contentNature: conflict === undefined ? 'professional_judgement' : 'missing',
      objectIds: members.map(member => member.objectId), evidenceIds: evidenceIds([entry, ...members.flatMap(details)]),
      supportingBlocks: [
        { type: 'text', role: 'body', content: `本页回答：${question}` },
        { type: 'text', role: 'body', content: `议题内容：${statement}` },
        ...synthesisBlocks(question, members.filter(member => member.objectId !== 'DG06'), '议题—依据—方案回应—成立条件论证表').filter(block => block.type !== 'text' || !block.content.startsWith('本页回答')),
        ...(conflict === undefined ? [] : [{ type: 'text', role: 'body', content: conflict, contentNature: 'missing' } satisfies SupportingBlock]),
      ],
      speakerNotes: [entry.text, ...members.flatMap(details).map(detail => `${detail.text}（${detail.objectId}/${detail.fieldPath}；${detail.basis}）`)],
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
      members.splice(0, members.length, ...input.stateObjects.filter(object => ['PS02', 'OP07', 'IM02', 'IM07', 'IM08'].includes(object.objectId)).sort((a, b) => a.objectId.localeCompare(b.objectId)))
    }
    const question = old.findingId === 'pre-design:decision' ? '本轮需确认哪些建议、成立条件和后续补证事项？' : `${old.title}形成了哪些判断，它们之间怎样关联，哪些依据和条件还需展开？`
    const conflict = old.findingId === 'pre-design:delivery' ? investmentConflict(members) : undefined
    findings.push({
      ...old, title: `${old.title}：综合研判`, keyMessage: conflict ?? `汇总${members.map(member => member.title).join('、')}，形成${old.title}的论证主线；具体依据、条件和测算见后续专题页。`,
      contentNature: conflict === undefined ? 'professional_judgement' : 'missing',
      objectIds: members.map(member => member.objectId), evidenceIds: evidenceIds(members.flatMap(details)),
      sectionKey: `${old.findingId}:overview`, sectionTitle: `${old.title}综述`, sectionOrder: old.order < 40 ? old.order / 10 : 0,
      supportingBlocks: [
        ...synthesisBlocks(question, members, '相关成果综合对照表'),
        ...(old.findingId !== 'pre-design:decision' ? [] : [{ type: 'list', role: 'steps', listStyle: 'ordered', items: distinct(input.decisionItems) } satisfies SupportingBlock]).filter(block => block.type !== 'list' || block.items.length > 0),
      ],
      speakerNotes: [question, ...members.flatMap(member => [member.summary, ...details(member).map(entry => `${entry.text}（依据：${entry.basis}；${member.objectId}/${entry.fieldPath}）`)])],
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
        ...synthesisBlocks(analysis.question, members, analysis.visual),
        { type: 'text', role: 'body', content: `论证要求：${analysis.claim}`, contentNature: 'professional_judgement' },
        ...(conflict === undefined ? [] : [{ type: 'text', role: 'body', content: conflict, contentNature: 'missing' } satisfies SupportingBlock]),
      ],
      speakerNotes: [analysis.question, analysis.claim, ...(conflict === undefined ? [] : [conflict]), ...members.flatMap(member => details(member).map(entry => `${entry.text}（${member.objectId}/${entry.fieldPath}；依据：${entry.basis}）`))],
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
  return findings.sort((a, b) => (topicOrder.get(a.topicKey) ?? 0) - (topicOrder.get(b.topicKey) ?? 0)
    || a.sectionOrder - b.sectionOrder || a.sectionKey.localeCompare(b.sectionKey) || a.order - b.order || a.findingId.localeCompare(b.findingId))
}
