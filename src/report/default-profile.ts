import type {
  ClientChapterBlueprint,
  ClientChapterRole,
  ClientContentBlock,
  ClientEvidence,
  ClientProduct,
  ClientProjectProfile,
} from './client-types.ts'
import type { FrozenProjectInput, FrozenStateObject } from './types.ts'

const ARC: readonly Readonly<{
  id: string
  sourceObjectId: string
  sourceChapterId: string
  role: ClientChapterRole
}>[] = [
  { id: 'chapter-01', sourceObjectId: 'PS01', sourceChapterId: '01', role: 'brief' },
  { id: 'chapter-02', sourceObjectId: 'DG01', sourceChapterId: '03', role: 'diagnosis' },
  { id: 'chapter-03', sourceObjectId: 'DG05', sourceChapterId: '03', role: 'opportunity' },
  { id: 'chapter-04', sourceObjectId: 'OB01', sourceChapterId: '04', role: 'positioning' },
  { id: 'chapter-05', sourceObjectId: 'OP07', sourceChapterId: '05', role: 'strategy' },
  { id: 'chapter-06', sourceObjectId: 'PG04', sourceChapterId: '06', role: 'product' },
  { id: 'chapter-07', sourceObjectId: 'SP07', sourceChapterId: '07', role: 'spatial' },
  { id: 'chapter-08', sourceObjectId: 'IM06', sourceChapterId: '08', role: 'operation' },
  { id: 'chapter-09', sourceObjectId: 'IM07', sourceChapterId: '08', role: 'implementation' },
  { id: 'chapter-10', sourceObjectId: 'IM02', sourceChapterId: '08', role: 'decision' },
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

function products(input:FrozenProjectInput,reportEvidence:readonly ClientEvidence[]):ClientProduct[]{
  return (input.manuscript?.chapters.find(chapter=>chapter.id==='products')?.pages??[])
    .filter(page=>page.kind==='product'&&page.product)
    .map(page=>({productId:page.id,name:page.product!.name,valueProposition:page.claim,
      audiences:[page.product!.audience],contents:[page.product!.experience],usageScenarios:[page.product!.experience],
      spatialCarrier:page.product!.location,operatingModel:page.product!.operations,valueContribution:page.claim,
      evidenceIds:reportEvidence.filter(row=>row.locator.startsWith('PG04#')).map(row=>row.evidenceId)}))
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
  if (spec.role === 'product') {
    const actualProducts=products(input,reportEvidence)
    const productVisuals=input.visualAssets.slice(1).filter(asset=>asset.chapterId==='06')
    return [narrative,...productVisuals.map((asset,index):ClientContentBlock=>actualProducts[index]
      ?{type:'product',productId:actualProducts[index].productId,assetIds:[asset.assetId]}
      :{type:'evidence',headline:source.title,evidenceIds:[firstEvidenceId],assetIds:[asset.assetId]})]
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
      headline: source.title,
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
  const actualProducts=products(input,reportEvidence)
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
      ...(productIndex < 0 || productIndex >= actualProducts.length ? {} : { productId: actualProducts[productIndex]!.productId }),
      sha256: asset.sha256 ?? '0'.repeat(64),
      width: asset.width ?? 1,
      height: asset.height ?? 1,
    }
  })
  return {
    identity: {
      projectId: input.projectId,
      projectName,
      reportTitle: projectName + '前期策划汇报',
      reportDate: input.generatedAt.slice(0, 10),
      audience: 'executive-and-professional',
      locale: 'zh-CN',
    },
    proposition: {
      projectDefinition: objectForChapter(input,'PS01','01').summary,
      urgency: objectForChapter(input,'DG01','03').summary,
      coreValue: input.recommendation,
      positioning: objectForChapter(input,'OB01','04').summary,
      keywords: [...new Set(input.stateObjects.map(object=>object.title))].slice(0,5),
    },
    themeOverrides: { colors: { primary: '3F5F57', accent: 'C88752' } },
    chapters: chapters(input, reportEvidence),
    products: actualProducts,
    evidence: reportEvidence,
    assetBindings,
    requiredVisualRoles: assetBindings.length === 0 ? [] : ['hero'],
    visualContractVersion: 'architectural-v1',
  }
}
