import type { FrozenReportEntry } from '../../report/types.ts'

export interface EditorialDetail extends FrozenReportEntry {
  readonly objectId: string
  readonly objectTitle: string
  readonly sectionTitle: string
  readonly sectionKey: string
}

export interface EditorialPage {
  readonly entries: readonly EditorialDetail[]
  readonly points: readonly string[]
  readonly subject: string
}

const SUBJECTS = [
  ['权属与征迁', /权属|产权|征地|征迁|拆迁|搬迁|移民|安置|补偿/u],
  ['资金与财务', /筹资|融资|资金|财务|现金流|偿债|补贴|税费/u],
  ['建设投资', /工程量|工程包|造价|单价|建设投资|估算|成本|概算/u],
  ['安全与水资源', /防洪|供水|保灌|灌溉|水资源|水安全|坝址|大坝|库容/u],
  ['生态与环境', /生态|林地|水源保护|保护区|水质|消落带|雨洪/u],
  ['功能与服务', /功能|服务|客群|人群|容量|研学|游憩|科普|营地/u],
  ['空间与交通', /空间|地块|建筑|交通|停车|市政|管网|流线|节点|场地/u],
  ['实施与协同', /实施|审批|责任|主体|运营|维护|分期|时序|绩效|验收/u],
] as const

export function rawBody(entry: EditorialDetail): string {
  return entry.contentText ?? entry.text
}

export function contentWithoutLabel(entry: EditorialDetail): string {
  const text = rawBody(entry).trim()
  return text.startsWith(`${entry.sectionTitle}：`) ? text.slice(entry.sectionTitle.length + 1) : text
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

/** Retain source qualifiers, while removing storage labels that are not spoken content. */
export function audienceText(text: string): string {
  return text.split(/[；;\n]/u).map(value => value.trim()).filter(value => value !== ''
    && !/^(?:职责权限|承担角色|当前状态：已确认|资料定位|版本号|证据编号|关联成果编号)/u.test(value)
    && !/(?:补充内容：|dsh-user:|actor-[a-z]|DSH\s*(?:用户|v\d)|G\d\s*决策节点)/u.test(value))
    .join('；').replace(/\b(?:PS|BL|DG|OB|OP|PG|SP|IM)\d{2}[-_.][A-Za-z0-9_-]+\b/gu, '相关研究事项')
    .replace(/\b(?:PS|BL|DG|OB|OP|PG|SP|IM)\d{2}\b/gu, '')
    .replace(/当前状态：/gu, '目前为')
    .replace(/完成期限：/gu, '计划完成时间为')
    .replace(/依据前期策划缺失资料处理策略[，,]\s*/gu, '')
    .replace(/目前为初步成果/gu, '目前仍属于初步判断')
    .replace(/[。；;]+\s*(?=目前为|目前仍属于)/gu, '，')
    .replace(/。\s*[；;]+/gu, '。').replace(/。{2,}/gu, '。')
    .replace(/\s+/gu, ' ').trim()
}

function sentences(text: string): string[] {
  return distinct(text.replace(/\\r\\n|\\n/gu, '\n').split(/[。\n]/u).flatMap(sentence => sentence.split(/[；;]/u))
    .map(sentence => sentence.replace(/[：:]$/u, '')))
}

export function isCondition(entry: EditorialDetail): boolean {
  return /condition|constraint|approval|risk|assumption|gap|veto|trigger|validation|prerequisite|verification/u.test(entry.sectionKey)
    || /须|尚待|待核实|待核对|待复核|未落实|未取得|成立条件|前提|仅在|后才能|方能/u.test(rawBody(entry))
}

/** Prefer an actual project statement over identity labels, bare status enums and bookkeeping. */
export function argumentPriority(entry: EditorialDetail): number {
  const weights: Readonly<Record<string, number>> = {
    start_reason: 20, decision_question: 20, funding_gap: 26, capex: 20,
    mission: 20, public_value: 14, rationale: 16, recommended_option: 14, options: 17,
    issues: 18, problem_nodes: 18, cause_nodes: 14, conditions: 16, constraints: 16,
    functions: 18, needs: 18, demand: 18, objectives: 18, zones: 16, placements: 16,
    products: 16, services: 16, risks: 14, prerequisites: 16, phases: 16, topics: 20,
    approval_status: -12, deadline: -12, scope: -8, boundary: -6, canonical_name: -6,
    aliases: -10, origin_mode: -10, owners: -5, owner: -5, actors: -5, units: -10,
    evidence_refs: -20, confidence: -20, quality_profile: -20,
  }
  const text = audienceText(contentWithoutLabel(entry))
  return (weights[entry.sectionKey] ?? 0) + Math.min(text.length / 40, 4)
    + (entry.metric !== undefined && /已落实|已到位|实际到位/u.test(entry.metric.label) ? 30 : 0)
    - (text.length < 12 ? 12 : 0)
}

/** A report topic has an argument order; a long constraint is not automatically its lead. */
export function narrativeEntries(entries: readonly EditorialDetail[], title: string): EditorialDetail[] {
  const sequences: readonly [RegExp, readonly string[]][] = [
    [/项目认知|决策任务/u, ['PS02', 'PS01', 'PS03', 'PS05']],
    [/项目基础|基础与边界/u, ['BL01', 'BL02', 'BL03', 'BL05', 'BL04', 'BL06', 'BL07', 'BL08']],
    [/现状与核心问题|建设必要性/u, ['DG01', 'DG03', 'BL05', 'BL06', 'OB01', 'OB03']],
    [/总体策略|比选|推荐方案|推荐路径/u, ['OP02', 'OP07', 'OP04', 'OP06', 'OB04']],
    [/投资|资金|财务|筹资/u, ['IM03', 'IM02', 'IM06', 'IM01', 'PG06']],
    [/项目定位|项目目标/u, ['OB01', 'OB02', 'OB03', 'OB04', 'OB05']],
    [/产品与功能|功能规模/u, ['PG02', 'PG01', 'PG03', 'PG04', 'PG06']],
    [/空间策略|空间可实施性/u, ['SP01', 'SP02', 'SP04', 'SP05', 'SP06']],
    [/实施闭环|决策事项/u, ['OP07', 'IM07', 'IM03', 'IM04', 'IM08']],
  ]
  const sequence = sequences.find(([pattern]) => pattern.test(title))?.[1] ?? []
  const rank = (entry: EditorialDetail): number => {
    const index = sequence.indexOf(entry.objectId)
    return (index < 0 ? 0 : (sequence.length - index) * 40) + argumentPriority(entry)
  }
  const candidates = entries.filter(entry => audienceText(contentWithoutLabel(entry)) !== '')
    .sort((a, b) => rank(b) - rank(a))
  const selected: EditorialDetail[] = []
  const add = (entry: EditorialDetail | undefined) => { if (entry !== undefined && !selected.includes(entry)) selected.push(entry) }
  if (/总体策略|比选|推荐方案|推荐路径/u.test(title)) {
    for (const entry of candidates.filter(entry => entry.objectId === 'OP02' && entry.sectionKey === 'options')) add(entry)
    add(candidates.find(entry => entry.objectId === 'OP07' && entry.sectionKey === 'recommended_option'))
    add(candidates.find(entry => entry.objectId === 'OP07' && entry.sectionKey === 'rationale'))
    for (const entry of candidates.filter(entry => entry.objectId === 'OP07' && entry.sectionKey === 'conditions')) add(entry)
  } else if (/投资|资金|财务|筹资/u.test(title)) {
    add(candidates.find(entry => entry.sectionKey === 'funding_gap'))
    add(candidates.find(entry => entry.metric !== undefined && /已落实|已到位|实际到位/u.test(entry.metric.label)))
    for (const key of ['conditions', 'timelines', 'fallbacks']) {
      add(candidates.find(entry => entry.objectId === 'IM03' && entry.sectionKey === key))
    }
  } else {
    add(candidates[0])
    if (sequence.length === 0) {
      add(candidates.find(entry => entry.metric !== undefined))
      add(candidates.find(isCondition))
    }
    // Overview arguments progress across relevant disciplines, not four fields of the same object.
    for (const objectId of sequence) add(candidates.find(entry => entry.objectId === objectId))
  }
  for (const entry of candidates) add(entry)
  return selected
}

function compactEntry(entry: EditorialDetail, limit = 165): string {
  const clean = audienceText(contentWithoutLabel(entry))
  const clauses = sentences(clean)
  if (clean.length <= limit) return clean.length < 12 ? `${entry.sectionTitle}：${clean}` : clean
  const first = clauses[0] ?? clean
  const condition = clauses.find((text, index) => index > 0 && /须|尚待|待核实|待核对|未落实|前提|仅在|假设/u.test(text))
  const explanation = clauses.find((text, index) => index > 0 && text !== first && text.length > 12)
  const chosen = distinct([first, condition ?? explanation ?? ''])
  const composed = chosen.join('；')
  // Never cut a source sentence in half. Long clauses stay complete in the evidence table.
  return composed.length <= limit ? composed : (clauses.find(clause => clause.length >= 12 && clause.length <= limit) ?? first).replace(/[：:]$/u, '')
}

/** Repeated statements become one argument, while all corresponding source rows remain attached. */
export function displayPoints(entries: readonly EditorialDetail[], limit = 900): string[] {
  const unique = new Map<string, EditorialDetail>()
  for (const entry of entries) {
    const signature = audienceText(contentWithoutLabel(entry)).replace(/[\s，。；：:;,]/gu, '')
    if (signature !== '' && !unique.has(signature)) unique.set(signature, entry)
  }
  const candidates = [...unique.values()].sort((a, b) => argumentPriority(b) - argumentPriority(a))
  const selected: EditorialDetail[] = []
  const add = (entry: EditorialDetail | undefined): void => {
    if (entry !== undefined && !selected.includes(entry)) selected.push(entry)
  }
  add(candidates[0])
  add(candidates.find(entry => entry.metric !== undefined))
  add(candidates.find(isCondition))
  const fields = new Set(selected.map(entry => `${entry.objectId}/${entry.sectionKey}`))
  for (const entry of candidates) {
    const field = `${entry.objectId}/${entry.sectionKey}`
    if (!fields.has(field) && selected.length < 6) { fields.add(field); add(entry) }
  }
  for (const entry of candidates) if (selected.length < 6) add(entry)
  const points: string[] = []
  for (const entry of selected) {
    const point = compactEntry(entry)
    if (point === '' || points.includes(point)) continue
    if (points.join('').length + point.length > limit) continue
    points.push(point)
  }
  return points
}

function subjectFor(entry: EditorialDetail): string {
  const name = contentWithoutLabel(entry).split(/[；;。\n]/u)[0] ?? entry.sectionTitle
  return SUBJECTS.find(([, pattern]) => pattern.test(name))?.[0] ?? '项目条件与安排'
}

function pageSubject(entries: readonly EditorialDetail[]): string {
  const subjects = distinct(entries.map(subjectFor).filter(subject => subject !== '项目条件与安排'))
  if (subjects.length === 1) return subjects[0]!
  const fields = distinct(entries.map(entry => entry.sectionTitle))
  return fields.length <= 2 ? fields.join('与') : subjects.slice(0, 2).join('、') || fields.slice(0, 2).join('与')
}

/** Source volume guards reading depth; the separate 900-character body budget reserves the main visual. */
export function composeEditorialPages(entries: readonly EditorialDetail[]): EditorialPage[] {
  const substantive = entries.filter(entry => audienceText(contentWithoutLabel(entry)) !== '')
  const weight = (values: readonly EditorialDetail[]) => distinct(values.map(entry => audienceText(contentWithoutLabel(entry)))).join('').length
  if (substantive.length === 0) return []
  // A small coherent argument must not fragment merely because it contains more than twelve records.
  if (weight(substantive) <= 3200) return [{ entries, points: displayPoints(substantive), subject: pageSubject(substantive) }]
  const groups = new Map<string, EditorialDetail[]>()
  for (const entry of substantive) {
    const key = subjectFor(entry)
    groups.set(key, [...groups.get(key) ?? [], entry])
  }
  const pages: EditorialDetail[][] = []
  for (const group of groups.values()) {
    let current: EditorialDetail[] = []
    for (const entry of group) {
      if (current.length > 0 && weight([...current, entry]) > 3200) {
        pages.push(current)
        current = []
      }
      current.push(entry)
    }
    if (current.length > 0) {
      const preceding = pages.at(-1)
      // A tail with no independent argument belongs to its adjacent argument, not a new title page.
      if (preceding !== undefined && weight(current) < 500 && weight([...preceding, ...current]) <= 3900) preceding.push(...current)
      else pages.push(current)
    }
  }
  const omitted = entries.filter(entry => !substantive.includes(entry))
  pages[0]!.push(...omitted)
  return pages.map(values => ({ entries: values, points: displayPoints(values), subject: pageSubject(values) }))
}

export interface NarrationInput {
  readonly title: string
  readonly claim: string
  readonly entries: readonly EditorialDetail[]
  readonly kind: 'overview' | 'detail' | 'agenda' | 'analysis'
  readonly implication: string
}

function spoken(text: string): string {
  return text.replace(/现有成果提出：/u, '')
    .replace(/[。；;]+\s*(?:目前为初步成果)/gu, '，目前仍属于初步判断')
    .replace(/；\s*(-?\d[\d.,]*)\s*(万元|亿元|m2|m3|km|米|公顷|%)/gu, '为$1$2')
    .replace(/(?<![A-Za-z])m2\b/gu, '平方米').replace(/(?<![A-Za-z])m3\b/gu, '立方米').replace(/(?<![A-Za-z])km\b/gu, '公里')
    .replace(/\$|\\(?:geq|ge)/gu, match => match === '$' ? '' : '不低于')
    .replace(/\b(?:pkg|fund|eval)[-\w.]+\b/gu, '')
    .replace(/[。；;]+\s*目前为/gu, '，目前为')
    .replace(/。\s*[；;，]+/gu, '。').replace(/[；;]\s*。/gu, '。')
    .replace(/[；;]/gu, '。').replace(/[。；;，]+$/u, '').trim()
}

function spokenEntry(entry: EditorialDetail): string {
  const clean = audienceText(contentWithoutLabel(entry))
  const [label, ...rest] = clean.split(/[；;]/u)
  // Structured rows often repeat their noun-phrase label before a complete explanatory sentence.
  const body = label !== undefined && rest.length > 0 && label.length <= 45
    && rest.join('').length > label.length && !/^\s*[-\d]/u.test(rest[0]!) && !/\d{4}年|20\d\d[-/.]/u.test(label)
    ? rest.join('；') : clean
  const qualify = (value: string): string => {
    if (entry.sectionKey === 'conditions' && !/须|需要|尚待|待审批|后才能|前提/u.test(value)) return `成立条件是${value}`
    return value
  }
  if (body.length <= 320 || entry.sectionKey === 'funding_gap') return qualify(spoken(body))
  const clauses = sentences(body)
  const first = clauses[0] ?? body
  const condition = clauses.find((value, index) => index > 0 && /须|尚待|待核实|待核对|未落实|前提|仅在|假设/u.test(value))
  return qualify(spoken(distinct([first, condition ?? clauses[1] ?? '']).join('。')))
}

/** Source-grounded spoken argument. Detailed provenance belongs to structured evidence, never this script. */
export function composeNarration(input: NarrationInput): readonly string[] {
  const candidates = narrativeEntries(input.entries, input.title)
  const signature = (value: string) => spoken(value).replace(/[\s，。；：:;,]/gu, '')
  const claim = audienceText(input.claim).replace(/[。；;]+$/u, '')
  const opening = input.kind === 'agenda' ? `关于${input.title}，${spoken(claim.replace(input.title, '').replace(/^[；;：:]/u, ''))}。`
    : input.kind === 'analysis' ? `${spoken(claim)}。`
      : `从${input.title.replace(/：综合研判$/u, '')}来看，${spoken(claim)}。`
  const selected: string[] = []
  const selectedEntries = new Set<EditorialDetail>()
  const limit = /总体策略|比选|推荐方案|推荐路径/u.test(input.title) ? 8 : 4
  for (const entry of candidates) {
    let statement = spokenEntry(entry)
    const said = signature(`${claim}${selected.join('')}`)
    if (entry.sectionKey === 'funding_gap' && /投资口径待核对/u.test(claim)) {
      statement = statement.split('。').filter(sentence => !/建设投资/u.test(sentence) || /资金缺口/u.test(sentence)).join('。')
    }
    if (statement === '' || said.includes(signature(statement))) continue
    // A labelled amount already named in the lead is not new evidence. Never merge different metrics just because their values match.
    if (entry.sectionKey === 'capex' && entry.metric !== undefined && /投资|成本/u.test(claim)
      && said.includes(signature(`${entry.metric.value}${entry.metric.unit ?? ''}`))) continue
    if (entry.metric !== undefined && /已落实|已到位|实际到位/u.test(entry.metric.label)
      && /已落实|已到位/u.test(selected.join('')) && said.includes(signature(`${entry.metric.value}${entry.metric.unit ?? ''}`))) continue
    if (selected.join('').length + statement.length > 1100) continue
    selected.push(statement)
    selectedEntries.add(entry)
    if (selected.length >= limit) break
  }
  const said = signature(`${claim}${selected.join('')}`)
  const condition = candidates.find(entry => /^(?:conditions|prerequisites|approval_conditions)$/u.test(entry.sectionKey)
    && !selectedEntries.has(entry)
    && !said.includes(signature(spokenEntry(entry))))
  const qualification = condition === undefined || selected.some(value => /须|需要|成立条件|尚待|待核实|待核对|未落实|前提|后才能/u.test(value))
    ? '' : `${spokenEntry(condition)}。`
  const implication = signature(claim).includes(signature(input.implication))
    ? '因此，下一阶段的选择仍取决于相关条件的落实和验证结果。' : input.implication
  return [opening, selected.map(statement => `${statement}。`).join(''), `${qualification}${implication}`].filter(Boolean)
}
