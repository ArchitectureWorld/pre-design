import type { FrozenProjectInput } from '../../report/types.ts'
import { audienceText } from './editorial-composition.ts'
import { compileReportOutline, type ReportOutlineFinding } from './report-outline.ts'
import { authoredFindings } from './manuscript-outline.ts'
import { DEFAULT_PRESENTATION_TOPICS } from './topics.ts'

export const CLIENT_COMPOSITION_VERSION = 'planning-manuscript-2026-09-19.1'
export interface ClientFinding extends ReportOutlineFinding {
  readonly visualRequirement: 'concept' | 'source' | 'diagram' | 'none'
  readonly visualBrief: string
  readonly manuscriptPage?: import('../../report/manuscript/types.ts').PlanningManuscriptPage
}

export function clientReportTopics(input: FrozenProjectInput) {
  if (!input.manuscript) return DEFAULT_PRESENTATION_TOPICS
  const chapters = input.manuscript.chapters.map(chapter => ({ key: `manuscript:${chapter.id}`, title: chapter.title }))
  if (input.caseStudies) chapters.splice(Math.min(3, chapters.length), 0, { key: 'manuscript:case-studies', title: '真实项目案例与借鉴' })
  return chapters.map((chapter, order) => ({ ...chapter, order }))
}

/** Keep whole source clauses and their qualifications; never invent a conclusion. */
export function summaryStatement(value: string, limit = 100): string {
  const direction = /启动原因[^：]*：用户要求[^；。]*?明确方向为[“「"]([^”」"]+)[”」"]/u.exec(value)?.[1]
  const prepared = direction ? `策划方向：${direction}` : value
    .replace(/该选择属\s*agent\s*推断与假设[^；。]*/giu, '（策划假设）')
    .replace(/unknown-decision-owner/gu, '待明确')
    .replace(/内部初步决策最小深度[^；。]*/gu, '初步策划论证（实施条件待核验）')
    .replace(/用户(.{2,20}?)方向诉求/gu, '$1策划方向')
  const clean = audienceText(prepared).split(/[；;\n]/u)
    .filter(clause => !/^(?:调查与计算方法|依据与性质|内容性质|公平性：证据说明|补充说明)/u.test(clause.trim()))
    .join('；').replace(/来源可靠性：尚待核实/gu, '待核实')
    .replace(/[（(][a-z][a-z0-9_\s/.-]*_[a-z0-9_\s/.-]*[)）](?:[（(]含义待核对[)）])?/gu, '')
    .replace(/^(?:现有成果提出|核心判断|关键结论)[：:]/u, '')
    .replace(/[（(]missingDataPointId:[^）)]*[）)]/gu, '')
    .replace(/\s*\([A-Za-z][A-Za-z\s/&-]+\)/gu, '')
    .replace(/目前为([a-z][a-z_]+)(?:[（(]含义待核对[）)])?/gu, (_match, status: string) => status === 'established' ? ''
      : /pending|verification|unknown/u.test(status) ? '（待核实）' : /deferred/u.test(status) ? '（条件式暂缓）' : '（策划建议）')
    .replace(/\s*\/\s*[A-Z][A-Za-z -]+(?=[)）])/gu, '')
    .replace(/\b(?:FUNC|GRP|CRIT|VETO|OBJ|PROD|ZONE|COND|STRESS)-[\d/]+\b/gu, '')
    .replace(/[（(]\s*[)）]/gu, '').replace(/[，,]\s*(?=[（(]|[；;。]|$)/gu, '')
    .replace(/【[^】]+】/gu, '').replace(/([？?！!])[。]+/gu, '$1').replace(/\s+/gu, ' ').trim()
    .replace(/^.*?需要决定[：:]\s*/u, '')
  const pair = clean.split(/[:：]/u)
  if (pair.length === 2 && pair[1]!.trim().startsWith(pair[0]!.trim())) return summaryStatement(pair[1]!.trim(), limit)
  if (clean.length <= limit) return clean
  const clauses = clean.split(/[。；;\n]/u).map(s => s.trim()).filter(Boolean)
  const candidate = clauses.find(s => s.length >= 8 && s.length <= limit) ?? clauses[0] ?? clean
  const parts = candidate.split(/[，,]/u)
  let first = parts[0]!
  for (const part of parts.slice(1)) {
    if (first.length + part.length + 1 > limit) break
    first += `，${part}`
  }
  if (first.length > limit) first = `${first.slice(0, limit - 1)}…`
  const condition = clauses.find(s => s !== first && /须|尚待|待核|未落实|假设|前提|仅在/u.test(s))
  return condition && first.length + condition.length < limit ? `${first}；${condition}` : first
}

const PREFERRED_FIELDS: Record<string, readonly string[]> = {
  'recommended-path': ['recommended_option', 'rationale', 'conditions', 'backup_option'],
  'user-functions': ['functions', 'scenarios', 'function_types', 'needs'],
  'product-brief': ['products', 'services', 'public_services', 'operating_products'],
  'site-baseline': ['landform', 'terrain', 'natural_features', 'resources', 'spaces', 'landscape'],
  'option-definition': ['options', 'principles', 'assumptions'],
  'spatial-framework': ['structure', 'zones', 'placements', 'nodes'],
  'mission-targets': ['mission', 'public_value', 'objectives'],
}

const CONCEPT_SECTIONS = new Set(['resource-opportunity', 'mission-targets', 'option-definition', 'recommended-path',
  'user-functions', 'product-brief', 'spatial-framework', 'building-design', 'operation-model'])

/** One client question per page. The complete source remains in the appendix/notes. */
export function compileClientReportOutline(input: FrozenProjectInput): readonly ClientFinding[] {
  if (input.manuscript) return authoredFindings(input)
  const productScenes = input.stateObjects.filter(o => ['PG04', 'PG02'].includes(o.objectId)).flatMap(o => (o.reportSections ?? [])
    .filter(s => ['products', 'functions'].includes(s.key)).flatMap(s => s.entries.map(e => (e.contentText ?? e.text).replace(`${s.title}：`, '').split(/[；;。]/u)[0]!)))
    .filter(text => !/暂缓|备选|大坝|公厕|停车|接驳|监测|隔离/u.test(text)).slice(0, 4)
  const constraintText = input.stateObjects.filter(o => ['OB04', 'PG06', 'SP05'].includes(o.objectId)).flatMap(o => (o.reportSections ?? [])
    .flatMap(s => s.entries.map(e => e.contentText ?? e.text))).join('；')
  const prohibitions = [...new Set(constraintText.split(/[。；;\n]/u).filter(s => /禁止|不得|严禁/u.test(s)))].slice(0, 10).join('；')
  const restrictedWater = /水库|大坝/u.test(constraintText) && /禁止|严禁/u.test(constraintText)
  const buildingConstraints = input.stateObjects.filter(o => ['OB01', 'SP03', 'PG06'].includes(o.objectId))
    .flatMap(o => (o.reportSections ?? []).flatMap(s => s.entries.map(e => e.contentText ?? e.text))).join('；')
  const restrictedBuildings = /暂缓|未取得|未经|严禁/u.test(buildingConstraints)
    && /农房|旧厂|旧茶厂|存量建筑|既有建筑/u.test(buildingConstraints) && /拆改|改造|重资产|鉴定/u.test(buildingConstraints)
  const groups = new Map<string, ReportOutlineFinding[]>()
  for (const finding of compileReportOutline(input)) {
    // Overview pages already synthesize the detailed sections. Extra diagnostic
    // cross-check pages belong to the working paper, not the client narrative.
    if (finding.sectionKey.startsWith('analysis:') || finding.sectionKey === 'project-agenda') continue
    groups.set(finding.sectionKey, [...groups.get(finding.sectionKey) ?? [], finding])
  }
  return [...groups.values()].map(group => {
    const lead = group[0]!
    const objectIds = [...new Set(group.flatMap(f => f.objectIds))]
    const fields = PREFERRED_FIELDS[lead.sectionKey] ?? ['mission', 'recommended_option', 'products', 'functions', 'objectives', 'zones', 'phases', 'rationale']
    const entries = input.stateObjects.filter(o => objectIds.includes(o.objectId)).flatMap(o => (o.reportSections ?? []).flatMap(s => s.entries.map(e => ({
      key: s.key, body: (e.contentText ?? e.text).replace(new RegExp(`^${s.title}[:：]`, 'u'), ''),
    })))).filter(e => fields.includes(e.key))
      .sort((a, b) => fields.indexOf(a.key) - fields.indexOf(b.key))
    const rawPoints = entries.length ? entries.map(e => e.body) : group.flatMap(f => f.supportingBlocks.flatMap(b => b.type === 'list' ? b.items : []))
    const keyMessage = summaryStatement(entries[0]?.body ?? lead.keyMessage, 100)
    const points = [...new Set(rawPoints.map(p => summaryStatement(p, 75)))].filter(p => p && p !== keyMessage).slice(0, 3)
    const condition = group.flatMap(f => f.supportingBlocks.flatMap(b => b.type === 'table' ? b.rows.map(r => String(r[0] ?? '')) : []))
      .find(p => /尚待|待核|未落实|成立条件|前提|假设/u.test(p))
    if (condition && ![keyMessage, ...points].some(p => /尚待|待核|未落实|成立条件|前提|假设/u.test(p))) {
      if (points.length === 3) points.pop()
      points.push(summaryStatement(condition, 75))
    }
    const visualRequirement = CONCEPT_SECTIONS.has(lead.sectionKey) || /^(?:pre-design:positioning|pre-design:program|pre-design:spatial)/u.test(lead.sectionKey)
      ? 'concept' : ['site-baseline', 'planning-land'].includes(lead.sectionKey) ? 'source' : 'diagram'
    const topic = lead.sectionTitle.replace(/综述$/u, '').replace(/：综合研判$/u, '')
    return { ...lead, title: topic, keyMessage, objectIds,
      evidenceIds: [...new Set(group.flatMap(f => f.evidenceIds))],
      assetIds: [...new Set(group.flatMap(f => f.assetIds ?? []))],
      supportingBlocks: points.length ? [{ type: 'list' as const, role: 'key_points' as const, listStyle: 'unordered' as const, items: points }] : [],
      speakerNotes: group.flatMap(f => [...f.speakerNotes ?? [], ...f.supportingBlocks.flatMap(b => b.type === 'table'
        ? [`资料依据（演讲备注，不上版）：\n${b.rows.map(r => r.join('｜')).join('\n')}`] : [])]),
      visualRequirement,
      visualBrief: `为${input.projectName}的“${topic}”绘制对外汇报概念场景。画面主体必须从以下正向产品体验中选择：${productScenes.length ? productScenes.join('；') : points.join('；')}。表现人的具体活动、轻量设施与自然材料，场景应有明确用途，不能画成约束讨论或审批说明。${restrictedWater ? '本项目限制水利空间的游憩利用，本张图只展示陆域场景：镜头避开水面、坝体、溢洪道、水工构筑物；不画船艇、游泳、垂钓、水上娱乐、滨坝商业或紧贴坝体的游客设施。' : ''}${restrictedBuildings ? '存量建筑改造条件尚未落实：画面不新增或虚构村落、商业街、民宿群、成组住宅和大型场馆，不把暂缓的建筑活化描绘为建成方案；仅表现地面小径、短段可逆步道和至多一个小型开放遮阳棚，避免大面积高架平台。' : ''}项目禁止项仅用于排除内容，绝不能将禁止项画成方案：${prohibitions || '不增加未经本页依据支持的设施'}。不照搬未知现场地形，不绘制法定边界、工程尺寸或统计图表。AI未来体验意向，非现场实拍。横向构图，单一完整场景，真实光影和适度使用者活动，无图中文字、标牌文字、数据、水印或拼贴。`,
    }
  })
}
