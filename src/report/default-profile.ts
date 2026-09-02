import type {
  ClientChapterBlueprint,
  ClientChapterRole,
  ClientContentBlock,
  ClientEvidence,
  ClientProduct,
  ClientProjectProfile,
} from './client-types.ts'
import type { FrozenProjectInput, FrozenStateObject } from './types.ts'

const PRODUCT_IDS = [
  'product-cultural-district',
  'product-waterfront',
  'product-city-events',
] as const

const ARC: readonly Readonly<{
  id: string
  sourceObjectId: string
  sourceChapterId: string
  role: ClientChapterRole
  headline: string
  claim: string
}>[] = [
  { id: 'chapter-01', sourceObjectId: 'PS01', sourceChapterId: '01', role: 'brief', headline: '这不是一次单点改造，而是一套完整的城市更新产品', claim: '先把项目价值、服务对象与更新边界放在同一张蓝图中。' },
  { id: 'chapter-02', sourceObjectId: 'DG01', sourceChapterId: '03', role: 'diagnosis', headline: '空间、内容与运营的断点共同限制了资源价值', claim: '真正需要解决的不是一个界面，而是体验与实施之间的系统断点。' },
  { id: 'chapter-03', sourceObjectId: 'DG05', sourceChapterId: '03', role: 'opportunity', headline: '存量资源可以转化为持续发生的城市生活目的地', claim: '把既有资源重新组织，才能形成可使用、可传播、可运营的公共价值。' },
  { id: 'chapter-04', sourceObjectId: 'OB01', sourceChapterId: '04', role: 'positioning', headline: '以清晰定位建立具有传播力的项目身份', claim: '统一的价值主张让空间、产品与品牌表达指向同一个答案。' },
  { id: 'chapter-05', sourceObjectId: 'OP07', sourceChapterId: '05', role: 'strategy', headline: '公共价值与经营活力必须由同一策略统筹', claim: '策略不是口号，而是对产品组合、空间载体与实施顺序的共同约束。' },
  { id: 'chapter-06', sourceObjectId: 'PG04', sourceChapterId: '06', role: 'product', headline: '三类核心产品共同支撑全天候城市体验', claim: '文化体验、滨水休闲与城市活动形成互补的使用场景和价值贡献。' },
  { id: 'chapter-07', sourceObjectId: 'SP07', sourceChapterId: '07', role: 'spatial', headline: '连续空间让产品、活动与人流真正发生', claim: '空间结构必须把核心产品、公共界面与运营节点组织成连续体验。' },
  { id: 'chapter-08', sourceObjectId: 'IM06', sourceChapterId: '08', role: 'operation', headline: '公益开放与专业运营共同建立长期生命力', claim: '公共服务托住底线，主题内容和轻运营创造持续活力。' },
  { id: 'chapter-09', sourceObjectId: 'IM07', sourceChapterId: '08', role: 'implementation', headline: '先行示范段以可控投入验证场景与运营', claim: '从可快速落地的节点开始，逐步验证客流、产品和建设协同。' },
  { id: 'chapter-10', sourceObjectId: 'IM02', sourceChapterId: '08', role: 'decision', headline: '现在需要锁定定位、首期边界与实施机制', claim: '把共同判断转化为明确授权，项目才能进入下一阶段。' },
]

function cleanProjectName(value: string): string {
  const cleaned = value
    .replace(/[-_—\s]*v\d+(?:\.\d+)*(?:候选验收)?[-_\s]*\d{8}$/iu, '')
    .trim()
  return cleaned === '' ? value.trim() : cleaned
}

function objectForChapter(input: FrozenProjectInput, objectId: string, chapterId: string): FrozenStateObject {
  return input.stateObjects.find(object => object.objectId === objectId)
    ?? input.stateObjects.find(object => object.chapterId === chapterId)
    ?? input.stateObjects[0]!
}

function evidence(input: FrozenProjectInput, projectName: string): ClientEvidence[] {
  const selectedObjects = [...new Map(ARC
    .map(spec => objectForChapter(input, spec.sourceObjectId, spec.sourceChapterId))
    .map(object => [object.objectId, object])).values()]
  const prioritySupportingObjects = (['spatial', 'operation', 'implementation'] as const)
    .map(role => ARC.find(spec => spec.role === role))
    .filter((spec): spec is typeof ARC[number] => spec !== undefined)
    .map(spec => objectForChapter(input, spec.sourceObjectId, spec.sourceChapterId))
  const orderedObjects = [
    ...selectedObjects,
    ...input.stateObjects.filter(object => !selectedObjects.some(selected => selected.objectId === object.objectId)),
  ]
  const candidates = [
    ...selectedObjects.map(object => ({ statement: object.summary, locator: `${object.objectId}#summary` })),
    ...prioritySupportingObjects.flatMap(object => object.facts[1] === undefined ? [] : [{
      statement: `${object.facts[1].label}：${object.facts[1].value}`,
      locator: `${object.objectId}#fact-2`,
    }]),
    ...orderedObjects.flatMap(object => [
    { statement: object.summary, locator: `${object.objectId}#summary` },
    ...object.facts.map((fact, index) => ({
      statement: `${fact.label}：${fact.value}`,
      locator: `${object.objectId}#fact-${index + 1}`,
    })),
    ...object.facts.map((fact, index) => ({
      statement: `${object.title}｜${fact.label}：${fact.value}`,
      locator: `${object.objectId}#fact-${index + 1}`,
    })),
    ]),
  ]
  const unique = [...new Map(candidates
    .filter(candidate => candidate.statement.trim() !== '')
    .map(candidate => [candidate.statement, candidate])).values()]
  if (unique.length < 13) throw new Error('default client profile requires at least 13 distinct frozen conclusions or facts')
  return unique.slice(0, 13).map((candidate, index) => ({
    evidenceId: 'evidence-' + String(index + 1).padStart(2, '0'),
    kind: 'fact' as const,
    statement: candidate.statement,
    sourceLabel: projectName + '项目策划资料',
    sourceDate: input.generatedAt.slice(0, 10),
    locator: candidate.locator,
  }))
}

function evidenceIdForLocator(
  reportEvidence: readonly ClientEvidence[],
  locator: string,
  fallbackEvidenceId: string,
): string {
  return reportEvidence.find(item => item.locator === locator)?.evidenceId ?? fallbackEvidenceId
}

function decisionRationaleEvidenceIds(
  input: FrozenProjectInput,
  reportEvidence: readonly ClientEvidence[],
): string[] {
  const roles = ['positioning', 'implementation', 'operation'] as const
  return [...new Set(roles.flatMap(role => {
    const spec = ARC.find(candidate => candidate.role === role)
    if (spec === undefined) return []
    const source = objectForChapter(input, spec.sourceObjectId, spec.sourceChapterId)
    const evidenceId = reportEvidence.find(item => item.locator === `${source.objectId}#summary`)?.evidenceId
    return evidenceId === undefined ? [] : [evidenceId]
  }))]
}

function products(projectName: string): ClientProduct[] {
  return [
    {
      productId: 'product-cultural-district',
      name: projectName + '文化街区',
      valueProposition: '以在地文化内容和日常消费重新激活存量空间',
      audiences: ['周边居民', '城市家庭', '青年客群'],
      contents: ['文化展陈', '在地零售', '主题餐饮'],
      usageScenarios: ['日常生活', '周末休闲', '城市节庆'],
      spatialCarrier: '存量街巷、开放庭院与首层公共界面',
      operatingModel: '公共文化托底、主题内容引流、轻商业协同运营',
      valueContribution: '建立项目识别度并延长日常停留时间',
      evidenceIds: ['evidence-06', 'evidence-07'],
    },
    {
      productId: 'product-waterfront',
      name: '滨水生活客厅',
      valueProposition: '把连续开放空间转化为全天候的城市生活目的地',
      audiences: ['周边居民', '亲子家庭', '短途游客'],
      contents: ['亲水漫步', '生态休闲', '轻食社交'],
      usageScenarios: ['早晚慢行', '周末微度假', '黄昏社交'],
      spatialCarrier: '连续滨水步道、柔性驳岸与生态驿站',
      operatingModel: '城市公开、节点运营、品牌活动合作',
      valueContribution: '提升公共空间使用率并建立滨水体验标签',
      evidenceIds: ['evidence-08', 'evidence-09'],
    },
    {
      productId: 'product-city-events',
      name: '落日剧场与城市活动场',
      valueProposition: '用高识别度活动建立项目持续传播能力',
      audiences: ['城市青年', '文化活动客群', '游客'],
      contents: ['户外展演', '主题市集', '城市发布'],
      usageScenarios: ['黄昏演出', '节庆活动', '品牌共创'],
      spatialCarrier: '落日剧场、阶梯看台与可弹性使用的滨水草场',
      operatingModel: '年度活动日历、专业策展与多方合作运营',
      valueContribution: '制造城市记忆点并为周边产品导入稳定客流',
      evidenceIds: ['evidence-10', 'evidence-11'],
    },
  ]
}

function blocksFor(
  spec: typeof ARC[number],
  source: FrozenStateObject,
  input: FrozenProjectInput,
  reportEvidence: readonly ClientEvidence[],
): ClientContentBlock[] {
  const firstEvidenceId = evidenceIdForLocator(reportEvidence, `${source.objectId}#summary`, reportEvidence[0]!.evidenceId)
  const secondEvidenceId = source.facts[1] === undefined
    ? firstEvidenceId
    : evidenceIdForLocator(reportEvidence, `${source.objectId}#fact-2`, firstEvidenceId)
  const narrative: ClientContentBlock = {
    type: 'narrative',
    statement: source.summary,
    evidenceIds: [firstEvidenceId],
  }
  if (spec.role === 'decision') {
    return [narrative, {
      type: 'decision',
      headline: '把共同判断转化为三项可执行决策',
      asks: ['确认项目定位', '确认首期实施边界', '确认建设与运营协同机制'],
      rationaleEvidenceIds: decisionRationaleEvidenceIds(input, reportEvidence),
    }]
  }
  if (spec.role === 'implementation') {
    return [narrative, {
      type: 'timeline',
      headline: '从示范启动到全面运营的分期路径',
      phases: [
        { phaseId: 'phase-01', name: '首期示范', actions: ['完成核心公共界面', '导入首批内容'], prerequisites: ['边界与投资确认'] },
        { phaseId: 'phase-02', name: '产品成型', actions: ['完善空间载体', '建立运营组合'], prerequisites: ['示范效果评估'] },
        { phaseId: 'phase-03', name: '长期提升', actions: ['扩展品牌与活动', '优化经营模型'], prerequisites: ['客流与运营数据'] },
      ],
      evidenceIds: [firstEvidenceId, secondEvidenceId],
    }]
  }
  if (spec.role === 'product') {
    const productVisuals = input.visualAssets.slice(1).filter(asset => asset.chapterId === '06')
    const productBlocks = PRODUCT_IDS.flatMap((productId, productIndex): ClientContentBlock[] => {
      const asset = productVisuals[productIndex]
      if (asset === undefined) return []
      if (productId === 'product-waterfront') {
        return [{
          type: 'scene',
          headline: '滨水生活客厅',
          productIds: [productId],
          assetIds: [asset.assetId],
        }]
      }
      return [{ type: 'product', productId, assetIds: [asset.assetId] }]
    })
    return [narrative, {
      type: 'scene',
      headline: '三类产品共同构成日常、周末与节庆场景',
      productIds: PRODUCT_IDS,
      assetIds: [],
    }, ...productBlocks]
  }
  const spatialAssetId = spec.role === 'spatial'
    ? input.visualAssets.slice(1).find(asset => asset.chapterId === '07')?.assetId
    : undefined
  return [narrative, {
    type: 'evidence',
      headline: source.facts[1] === undefined
        ? source.summary
        : `${source.facts[1].label}：${source.facts[1].value}`,
    evidenceIds: [secondEvidenceId],
    assetIds: spatialAssetId === undefined ? [] : [spatialAssetId],
  }]
}

function chapters(input: FrozenProjectInput, reportEvidence: readonly ClientEvidence[]): ClientChapterBlueprint[] {
  return ARC.map(spec => {
    const source = objectForChapter(input, spec.sourceObjectId, spec.sourceChapterId)
    return {
      id: spec.id,
      role: spec.role,
      headline: spec.headline,
      claim: source.summary,
      sourceObjectIds: [source.objectId],
      blocks: blocksFor(spec, source, input, reportEvidence),
    }
  })
}

export function createDefaultClientProjectProfile(input: FrozenProjectInput): ClientProjectProfile {
  if (input.stateObjects.length === 0) throw new Error('default client profile requires frozen state objects')
  const projectName = cleanProjectName(input.projectName)
  const reportEvidence = evidence(input, projectName)
  const productVisuals = input.visualAssets.slice(1).filter(asset => asset.chapterId === '06')
  const assetBindings = input.visualAssets.map((asset, index) => {
    const productIndex = productVisuals.findIndex(candidate => candidate.assetId === asset.assetId)
    const chapterId = index === 0
      ? 'chapter-07'
      : asset.chapterId === '07'
        ? 'chapter-07'
        : 'chapter-06'
    return {
      assetId: asset.assetId,
      role: index === 0 ? 'hero' as const : 'product-scene' as const,
      chapterId,
      ...(productIndex < 0 || productIndex >= PRODUCT_IDS.length ? {} : { productId: PRODUCT_IDS[productIndex] }),
      sha256: asset.sha256 ?? '0'.repeat(64),
      width: asset.width ?? 1,
      height: asset.height ?? 1,
    }
  })
  return {
    identity: {
      projectId: input.projectId,
      projectName,
      reportTitle: projectName + '价值重构提案',
      reportDate: input.generatedAt.slice(0, 10),
      audience: 'executive-and-professional',
      locale: 'zh-CN',
    },
    proposition: {
      projectDefinition: '面向城市更新、公共生活与复合运营的一体化项目',
      urgency: '存量提质阶段需要尽快把分散资源转化为可使用、可运营、可传播的城市产品',
      coreValue: '以文化体验串联公共空间与日常生活，建立持续发生的城市目的地',
      positioning: '城市文化与滨水生活新客厅',
      keywords: ['文化活化', '公共开放', '滨水生活', '复合运营', '分期实施'],
    },
    themeOverrides: { colors: { primary: '3F5F57', accent: 'C88752' } },
    chapters: chapters(input, reportEvidence),
    products: products(projectName),
    evidence: reportEvidence,
    assetBindings,
    requiredVisualRoles: assetBindings.length === 0 ? [] : ['hero'],
    visualContractVersion: 'architectural-v1',
  }
}
