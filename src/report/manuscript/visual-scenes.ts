import type { FrozenProjectInput } from '../types.ts'
import type { PlanningManuscriptPage } from './types.ts'
import { makeSourceIndex, manuscriptSourceFingerprint } from './source.ts'
import { sha256CanonicalJson } from '../../presentation/canonical-json.ts'
import { REPORT_IMAGE_POLICY_VERSION, permitsInternationalImages, type ImageSlotBrief } from '../../visual/image-policy.ts'
import { inferPlanningPageTask, isGeographicTask } from './content-plan.ts'

export const REPORT_SCENE_POLICY_VERSION = 'report-scenes-2026-09-19.3'
export const REPORT_SCENE_PREFIX = 'report-scene:'
export interface ReportSceneBinding {
  readonly findingId: string
  readonly pageId: string
  readonly nodeIds?: readonly string[]
}
export interface ReportSceneIdentity {
  readonly kind: 'report_scene'
  readonly projectId: string
  readonly sceneKey: string
  readonly sourceRevision: number
  readonly sourceFingerprint: string
  readonly contentHash: string
}
export interface ReportSceneRequirement extends ReportSceneIdentity {
  readonly brief: ImageSlotBrief
  readonly findingId: string
  readonly topic: string
  readonly title: string
  readonly prompt: string
  readonly chapterId?: string
  readonly workItemId?: string
  readonly sourceObjectIds: readonly string[]
  readonly sourceRefs: readonly string[]
  readonly bindings: readonly ReportSceneBinding[]
}

// These are visual activities, not project templates. An unrecognised subject is
// deliberately page-specific; it cannot inherit another project's themed image.
const activities = [
  ['sanitation', /卫生|厕所|污水|污废物|废弃物|垃圾|清运|密闭暂存|供水|接收.*设施/u, '卫生、供排水或废弃物收集设施'],
  ['water-management', /防洪|灌溉|水工|水位|岸坡|库容|水域|大坝|溢洪|管护|调度/u, '与正文所述水体相关的管理设施和环境'],
  ['safety', /疏散|撤离|应急|预警|安全导|禁入|不宜进入|入口告知|清楚提示/u, '场所入口、导引与安全通行设施'],
  ['reuse', /旧.*厂|存量建筑|存量.*活化|房屋|厂房.*改|室内.*研学|建筑.*改造/u, '正文中相关建筑及其适用活动空间'],
  ['retail', /采购|选购|展销|直销|零售|售卖|农产|茶品/u, '与本项目产品相关的展示、选购与服务场所'],
  ['arrival', /停车|集散|接驳|候车|换乘|到达|返程|入口|驿站/u, '到达、集散与换乘服务场所'],
  ['exhibition', /博物|展陈|展览|展厅|陈列|生产线/u, '正文所述展陈内容及参观空间'],
  ['experience', /体验|研学|学习|科普|观摩|品饮|品茶|识茶|茶事|采摘|手作/u, '项目核心体验活动及其真实空间载体'],
  ['rest', /休息|休憩|廊亭|观景|草地/u, '沿游览活动组织的休息与观景场所'],
  ['walking', /步行|步道|慢行|漫游|漫行|游线|游程|骑行|栈道/u, '正文描述的步行或慢行游览环境'],
  ['road', /道路|农事.*通行|生产.*通行/u, '项目涉及的道路及生产通行环境'],
  ['construction', /建设|建造|施工|验收|扩建/u, '正文明确提出的建设设施与空间载体'],
  ['operation', /维护|运营|经营|巡查|环境服务|合作组织|场所与服务/u, '正文涉及的场所服务与日常维护活动'],
  ['landscape', /梯田|茶园|茶山|林地|森林|湿地|海滨|海岸/u, '正文所述自然环境与相关游览活动'],
] as const
const settings = [
  ['industrial', /工业|工厂|厂房|钢铁|矿|机械|生产线/u],
  ['coastal', /海滨|海岸|沙滩|海湾|滨海|海洋|渔港/u],
  ['tea', /茶园|茶山|茶田|茶旅|茶事|茶品|茶厂|白茶/u],
  ['forest', /森林|林地|林下|山林/u],
  ['urban', /城市|街区|商业街|城镇|市民/u],
  ['water', /水库|湖|河流|水岸|河岸|湿地/u],
  ['rural', /乡村|村落|农田|农庄/u],
] as const

const mainText = (page: PlanningManuscriptPage) => [page.visual.subject, page.title, page.product?.name ?? '', page.visual.purpose].join('；')
const setting = (value: string) => settings.find(([, expression]) => expression.test(value))?.[0]
const activity = (value: string) => activities.find(([, expression]) => expression.test(value))
export function requiresSourceSceneImage(page: PlanningManuscriptPage): boolean {
  return page.visual.kind === 'source' || !!page.visual.sourceMaterialKey
    || /真实.{0,8}(现状|照片)|现场实拍|实地照片|实测图|测绘底图|现状照片|现状航拍/u.test(page.visual.subject)
}
function physicalSubject(page: PlanningManuscriptPage): string {
  const subjects = [page.visual.subject, page.product?.name ?? '', page.title, page.visual.purpose]
  return subjects.find(value => activity(value)?.[0] !== 'landscape' && activity(value))
    ?? subjects.find(value => activity(value)) ?? page.visual.subject
}
function projectSetting(input: FrozenProjectInput): string {
  const text = [input.projectName, ...(input.manuscript?.chapters.flatMap(chapter => chapter.pages.map(mainText)) ?? [])].join('；')
  const counts = settings.map(([key, expression]) => ({ key, count: [...text.matchAll(new RegExp(expression.source, 'gu'))].length }))
    .sort((a, b) => b.count - a.count)
  return counts[0]?.count ? counts[0].key : `project-${sha256CanonicalJson(input.projectName).slice(0, 12)}`
}
export function sceneSemanticTopic(input: FrozenProjectInput, page: PlanningManuscriptPage, nodeLabel?: string): { topic: string; title: string; subject: string } {
  const direct = nodeLabel === undefined ? physicalSubject(page) : nodeLabel
  let match = activity(direct)
  let subject = direct
  if (!match && nodeLabel !== undefined && page.visual.diagram) {
    const node = page.visual.diagram.nodes.find(node => node.label === nodeLabel)
    const adjacent = page.visual.diagram.edges.filter(edge => edge.from === node?.id || edge.to === node?.id)
      .map(edge => page.visual.diagram!.nodes.find(item => item.id === (edge.from === node?.id ? edge.to : edge.from))?.label ?? '')
    subject = adjacent.find(label => activity(label)) ?? physicalSubject(page)
    match = activity(subject)
  }
  if (!match) { subject = physicalSubject(page); match = activity(subject) }
  const environment = setting(direct) ?? setting(subject) ?? setting(mainText(page)) ?? setting(page.body.join('；')) ?? projectSetting(input)
  if (!match) return { topic: `${environment}:specific-${sha256CanonicalJson({ pageId: page.id, subject: direct }).slice(0, 16)}`,
    title: nodeLabel ?? page.visual.subject, subject: [page.visual.subject, nodeLabel ?? page.title].join('；') }
  return { topic: `${environment}:${match[0]}`, title: match[2], subject }
}

/** Each actual position owns a brief; broad topics are retrieval hints only. */
export function sceneRequirements(input: FrozenProjectInput): readonly ReportSceneRequirement[] {
  const manuscript = input.manuscript
  if (!manuscript) return []
  const sourceFingerprint = manuscriptSourceFingerprint(input)
  if (manuscript.projectId !== input.projectId || manuscript.sourceRevision !== input.revision || manuscript.sourceFingerprint !== sourceFingerprint) {
    throw new Error('REPORT_SCENE_SOURCE_CHANGED: 文案与当前项目来源版本不匹配')
  }
  const sources = new Map(makeSourceIndex(input).map(source => [source.id, source]))
  // Only the actual project name/positioning can opt into international imagery.
  const international = permitsInternationalImages(input)
  const requirements: ReportSceneRequirement[] = []
  for (const chapter of manuscript.chapters) for (const page of chapter.pages) {
    if (isGeographicTask(inferPlanningPageTask(page))) continue
    if (page.visual.kind === 'source' || /^case[-:]/u.test(page.id) || page.sourceRefs.some(ref => /^case[-:]/u.test(ref))) continue
    const nodes = page.visual.diagram?.nodes ?? []
    const slots = nodes.length ? nodes : requiresSourceSceneImage(page) ? [] : [undefined]
    for (const node of slots) {
      const semantic = sceneSemanticTopic(input, page, node?.label)
      const id = `${page.id}:${node?.id ?? 'main'}`
      const brief: ImageSlotBrief = { id, version: REPORT_IMAGE_POLICY_VERSION, pageId: page.id,
        ...(node ? { nodeId: node.id } : {}), conclusion: page.claim,
        subjects: [semantic.subject], activities: [node?.label ?? semantic.subject],
        environment: [page.visual.subject, page.visual.purpose].join('；'), scale: 'scene',
        allowedKinds: ['photo', 'render'], allowedSources: ['project', 'web', 'generated'],
        locale: international ? 'international' : 'domestic' }
      const sourceRefs = [...new Set(page.sourceRefs)].sort()
      const sourceObjectIds = [...new Set(sourceRefs.flatMap(ref => sources.get(ref)?.objectId ?? []))].sort()
      const owner = input.stateObjects.find(object => sourceObjectIds.includes(object.objectId) && object.workItemId)
      const sceneKey = `${semantic.topic.replace(/[^a-z0-9:_-]/gu, '-')}-${sha256CanonicalJson({ projectId: input.projectId, sourceFingerprint, id }).slice(0, 16)}`
      const bindings: ReportSceneBinding[] = [{ findingId: `manuscript:${page.id}`, pageId: page.id, ...(node ? { nodeIds: [node.id] } : {}) }]
      const contentHash = sha256CanonicalJson({ policy: REPORT_SCENE_POLICY_VERSION, sourceFingerprint, brief, page, bindings })
      const context = { title: page.title, claim: page.claim, subject: brief.subjects, purpose: page.visual.purpose, body: page.body.join('；').slice(0, 1800) }
      const locale = international ? '项目有明确国际定位，人物和环境须与本页实际场景相符；必要标识使用中文。' : '采用中国本土空间环境与中国人的日常活动，必要标识只用清晰中文；不出现英文装饰、外文招牌或无关海外场景。'
      const prompt = `为“${input.projectName}”前期策划绘制一张汇报场景效果图。用图位置：${id}。具体主体：${brief.subjects.join('；')}。依据：${JSON.stringify(context)}。${locale}必须表现正文相关的空间载体、设施及活动，单一清晰视角，保留完整主体与环境。不能以同一宽泛主题替换本位置的具体内容。不绘制流程图、总平图、剖面、拼图、文字表格、抽象方框或会议画面；运营与条件步骤转译为正文相关场所的使用场景。只采用正文支持的设施，不添加无关业态，不伪造地理位置或已建成证明。优先无文字、无水印。`
      requirements.push({ kind: 'report_scene', projectId: input.projectId, sceneKey, findingId: `${REPORT_SCENE_PREFIX}${sceneKey}`,
        sourceRevision: input.revision, sourceFingerprint, contentHash, topic: semantic.topic, title: node?.label ?? page.visual.subject, prompt, brief,
        chapterId: owner?.chapterId, workItemId: owner?.workItemId, sourceObjectIds, sourceRefs, bindings })
    }
  }
  return requirements.sort((a, b) => a.brief.id.localeCompare(b.brief.id))
}

export function sceneIdentity(requirement: ReportSceneRequirement): ReportSceneIdentity {
  const { kind, projectId, sceneKey, sourceRevision, sourceFingerprint, contentHash } = requirement
  return { kind, projectId, sceneKey, sourceRevision, sourceFingerprint, contentHash }
}
