import type {
  ClientContentBlock,
  ClientPolicyViolation,
  ClientReport,
  ClientSiteAnalysisKind,
  ClientVisualAsset,
} from './client-types.ts'

const CLIENT_FORBIDDEN = /\b(?:Gate|Workflow|Revision|approved|approved_with_conditions|returned|blocked|R\d+|mcp__[\w-]+|(?:gemini|gpt|claude)[\w.-]*|INFO|DEBUG|TRACE)\b|工作项|完成度|审批状态|artifact-manifest|[A-Z]:[\\/]|\\\\|(?:^|\s)\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+|\b[a-f0-9]{64}\b|\{\s*["'][\w.-]+["']\s*:/iu
const WEAK_HEADLINES = new Set(['项目背景', '现状分析', '案例研究', '方案展示', '工作内容', '投资估算'])
const REQUIRED_SITE_ANALYSES: readonly ClientSiteAnalysisKind[] = [
  'regional-context',
  'site-boundary',
  'existing-condition',
  'accessibility',
  'circulation',
  'constraints',
]

function visibleString(path: string): boolean {
  return !/\.sourcePath$|\.sha256$|\.sourceFileSha256$|\.boundary(?:Source|Geometry)Sha256$|^theme\.|\.assetId$|\.chapterId$|\.productId$|\.evidenceId$|^schemaVersion$/u.test(path)
}

function walkStrings(
  value: unknown,
  visit: (path: string, text: string) => void,
  path = '',
): void {
  if (typeof value === 'string') {
    if (visibleString(path)) visit(path, value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => walkStrings(child, visit, path + '[' + index + ']'))
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    walkStrings(child, visit, path === '' ? key : path + '.' + key)
  }
}

function push(
  violations: ClientPolicyViolation[],
  code: string,
  path: string,
  message: string,
): void {
  violations.push({ code, path, message })
}

function validateEvidence(report: ClientReport, violations: ClientPolicyViolation[]): void {
  report.evidence.forEach((evidence, index) => {
    const base = 'evidence[' + index + ']'
    if (evidence.sourceLabel.trim() === '' || evidence.sourceDate.trim() === '' || evidence.locator.trim() === '') {
      push(violations, 'EVIDENCE_SOURCE_MISSING', base, 'evidence requires source label, date, and locator')
    }
    if (evidence.kind === 'calculation' && (
      evidence.unit?.trim() === '' || evidence.unit === undefined
      || evidence.assumption?.trim() === '' || evidence.assumption === undefined
    )) {
      push(violations, 'CALCULATION_CONTRACT_MISSING', base, 'calculation requires unit and assumption')
    }
  })
}

function validateAssets(report: ClientReport, violations: ClientPolicyViolation[]): void {
  const chapterIds = new Set(report.chapters.map(chapter => chapter.id))
  const productIds = new Set(report.products.map(product => product.productId))
  report.assets.forEach((asset, index) => {
    const base = 'assets[' + index + ']'
    if (!chapterIds.has(asset.chapterId)) {
      push(violations, 'ASSET_BINDING_MISSING', base + '.chapterId', 'asset chapter does not exist')
    }
    if (asset.productId !== undefined && !productIds.has(asset.productId)) {
      push(violations, 'ASSET_BINDING_MISSING', base + '.productId', 'asset product does not exist')
    }
    if (asset.width <= 0 || asset.height <= 0) {
      push(violations, 'ASSET_DIMENSIONS_INVALID', base, 'asset dimensions must be positive')
    }
  })
}

function blockEvidenceIds(block: ClientContentBlock): readonly string[] {
  if (block.type === 'decision') return block.rationaleEvidenceIds
  if (block.type === 'product' || block.type === 'scene') return []
  return block.evidenceIds
}

function blockAssetIds(block: ClientContentBlock): readonly string[] {
  if (block.type === 'evidence' || block.type === 'comparison' || block.type === 'product' || block.type === 'scene') {
    return block.assetIds
  }
  if (block.type === 'map') return [block.assetId]
  return []
}

function blockProductIds(block: ClientContentBlock): readonly string[] {
  if (block.type === 'product') return [block.productId]
  if (block.type === 'scene') return block.productIds
  return []
}

function validateVisualContract(report: ClientReport, violations: ClientPolicyViolation[]): void {
  if (report.visualContractVersion !== 'architectural-v1') return
  const usedAssetIds = new Set([
    ...report.assets.filter(asset => asset.role === 'hero').map(asset => asset.assetId),
    ...report.chapters.flatMap(chapter => chapter.blocks.flatMap(block => blockAssetIds(block))),
  ])
  const usedAssets = report.assets.filter(asset => usedAssetIds.has(asset.assetId))
  const evidenceIds = new Set(report.evidence.map(evidence => evidence.evidenceId))
  usedAssets.forEach(asset => {
    const base = 'assets[' + report.assets.findIndex(candidate => candidate.assetId === asset.assetId) + ']'
    if (asset.analysisKind !== undefined || asset.role === 'chart') {
      validateVisualProvenance(asset, base, evidenceIds, violations)
    }
    if (asset.analysisKind !== undefined) validateCartography(asset, base, violations)
    if (asset.role === 'chart') validateChartContract(asset, base, violations)
    if (asset.analysisKind !== undefined && asset.role !== 'map' && asset.role !== 'diagram') {
      push(violations, 'SITE_DRAWING_ROLE_INVALID', base + '.role', 'site analysis must use map or diagram role')
    }
    if (asset.chartTopic !== undefined && asset.role !== 'chart') {
      push(violations, 'CHART_ROLE_INVALID', base + '.role', 'chart topic must use chart role')
    }
  })
  const professionalAssets = usedAssets.filter(asset => asset.analysisKind !== undefined || asset.role === 'chart')
  if (new Set(professionalAssets.map(asset => asset.sha256)).size !== professionalAssets.length) {
    push(violations, 'PROFESSIONAL_ASSET_SHA_DUPLICATE', 'assets', 'professional visual content SHA-256 values must be unique')
  }
  report.chapters.forEach((chapter, chapterIndex) => chapter.blocks.forEach((block, blockIndex) => {
    const professional = blockAssetIds(block).filter(assetId => {
      const asset = report.assets.find(candidate => candidate.assetId === assetId)
      return asset?.analysisKind !== undefined || asset?.role === 'chart'
    })
    if (professional.length > 1) {
      push(violations, 'PROFESSIONAL_ASSET_PAGE_INVALID', `chapters[${chapterIndex}].blocks[${blockIndex}]`, 'one professional visual asset is required per block')
    }
  }))
  const charts = usedAssets.filter(asset => asset.role === 'chart')
  if (charts.length < 6) {
    push(violations, 'DATA_CHART_COUNT_LOW', 'assets', `client report requires at least 6 used chart assets; found ${charts.length}`)
  }
  const chartTopics = new Set(charts.flatMap(asset => asset.chartTopic === undefined ? [] : [asset.chartTopic]))
  if (chartTopics.size < 4) {
    push(violations, 'DATA_CHART_TOPIC_COVERAGE_LOW', 'assets', `client report charts must cover at least 4 topics; found ${chartTopics.size}`)
  }
  const analysisKinds = new Set(usedAssets.flatMap(asset => asset.analysisKind === undefined ? [] : [asset.analysisKind]))
  const missing = REQUIRED_SITE_ANALYSES.filter(kind => !analysisKinds.has(kind))
  if (missing.length > 0) {
    push(violations, 'SITE_ANALYSIS_SERIES_INCOMPLETE', 'assets', `missing required site analyses: ${missing.join(', ')}`)
  }
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const date = new Date(value + 'T00:00:00.000Z')
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function validateVisualProvenance(
  asset: ClientVisualAsset,
  base: string,
  evidenceIds: ReadonlySet<string>,
  violations: ClientPolicyViolation[],
): void {
  const provenance = asset.provenance
  if (!isRecord(provenance)) {
    push(violations, 'VISUAL_PROVENANCE_INVALID', base + '.provenance', 'professional visual requires provenance')
    return
  }
  if (!nonEmptyString(provenance.sourceLabel)) {
    push(violations, 'VISUAL_PROVENANCE_INVALID', base + '.provenance.sourceLabel', 'visual provenance requires source label')
  }
  if (typeof provenance.sourceDate !== 'string' || !validDate(provenance.sourceDate)) {
    push(violations, 'VISUAL_PROVENANCE_INVALID', base + '.provenance.sourceDate', 'visual provenance requires YYYY-MM-DD source date')
  }
  if (!nonEmptyString(provenance.locator)) {
    push(violations, 'VISUAL_PROVENANCE_INVALID', base + '.provenance.locator', 'visual provenance requires locator')
  }
  if (typeof provenance.sourceFileSha256 !== 'string' || !/^[a-f0-9]{64}$/iu.test(provenance.sourceFileSha256)) {
    push(violations, 'VISUAL_PROVENANCE_INVALID', base + '.provenance.sourceFileSha256', 'visual provenance requires SHA-256')
  }
  if (!Array.isArray(provenance.evidenceIds) || provenance.evidenceIds.length === 0) {
    push(violations, 'VISUAL_PROVENANCE_INVALID', base + '.provenance.evidenceIds', 'visual provenance requires evidence')
  } else if (provenance.evidenceIds.some(evidenceId => typeof evidenceId !== 'string' || !evidenceIds.has(evidenceId))) {
    push(violations, 'VISUAL_PROVENANCE_INVALID', base + '.provenance.evidenceIds', 'visual provenance references missing evidence')
  }
}

function validateCartography(
  asset: ClientVisualAsset,
  base: string,
  violations: ClientPolicyViolation[],
): void {
  const cartography = asset.cartography
  if (!isRecord(cartography)) {
    push(violations, 'SITE_DRAWING_CONTRACT_INVALID', base + '.cartography', 'site drawing requires cartography')
    return
  }
  if (cartography.boundary !== 'confirmed' && cartography.boundary !== 'research' && cartography.boundary !== 'not-applicable') {
    push(violations, 'SITE_DRAWING_CONTRACT_INVALID', base + '.cartography.boundary', 'site drawing requires an explicit boundary marker')
  } else if (asset.analysisKind === 'site-boundary' && cartography.boundary === 'not-applicable') {
    push(violations, 'SITE_DRAWING_CONTRACT_INVALID', base + '.cartography.boundary', 'site-boundary drawing requires project boundary')
  }
  if (asset.analysisKind === 'site-boundary' && cartography.boundary === 'research') {
    const required = ['研究范围（待核）', '非法定红线', '非测绘成果']
    if (!Array.isArray(cartography.disclosures) || required.some((item, index) => cartography.disclosures![index] !== item)) {
      push(violations, 'SITE_BOUNDARY_DISCLOSURE_MISSING', base + '.cartography.disclosures', 'research boundary must disclose its non-legal and non-survey status')
    }
  }
  if (asset.analysisKind === 'site-boundary' && cartography.boundary === 'confirmed') {
    const sourceMatches = typeof cartography.boundarySourceSha256 === 'string'
      && cartography.boundarySourceSha256 === asset.provenance?.sourceFileSha256
    const geometryMatches = cartography.boundarySourceSha256 === undefined
      && typeof cartography.boundaryGeometrySha256 === 'string'
      && asset.provenance?.sourceFileSha256 === asset.sha256
    if (!sourceMatches && !geometryMatches) {
      push(violations, 'SITE_BOUNDARY_SOURCE_MISMATCH', base + '.cartography', 'site-boundary asset does not align to the confirmed boundary source')
    }
  }
  if (cartography.legend !== 'present') {
    push(violations, 'SITE_DRAWING_CONTRACT_INVALID', base + '.cartography.legend', 'site drawing requires legend')
  }
  if (cartography.northArrow !== 'present') {
    push(violations, 'SITE_DRAWING_CONTRACT_INVALID', base + '.cartography.northArrow', 'site drawing requires north arrow')
  }
  if (!isRecord(cartography.scale) || (cartography.scale.kind !== 'nts' && cartography.scale.kind !== 'scale-bar')) {
    push(violations, 'SITE_DRAWING_CONTRACT_INVALID', base + '.cartography.scale', 'site drawing requires scale bar or NTS')
  } else if (cartography.scale.kind === 'scale-bar' && !nonEmptyString(cartography.scale.label)) {
    push(violations, 'SITE_DRAWING_CONTRACT_INVALID', base + '.cartography.scale.label', 'scale bar requires label')
  }
}

function validateChartContract(
  asset: ClientVisualAsset,
  base: string,
  violations: ClientPolicyViolation[],
): void {
  const chartContract = asset.chartContract
  if (!isRecord(chartContract)) {
    push(violations, 'CHART_CONTRACT_INVALID', base + '.chartContract', 'chart requires unit and methodology')
    return
  }
  let invalid = false
  if (!nonEmptyString(chartContract.unit)) {
    invalid = true
    push(violations, 'CHART_CONTRACT_INVALID', base + '.chartContract.unit', 'chart requires unit')
  }
  if (!nonEmptyString(chartContract.methodology)) {
    invalid = true
    push(violations, 'CHART_CONTRACT_INVALID', base + '.chartContract.methodology', 'chart requires methodology')
  }
  if (invalid) {
    push(violations, 'CHART_CONTRACT_INVALID', base + '.chartContract', 'chart requires unit and methodology')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function validateReferences(report: ClientReport, violations: ClientPolicyViolation[]): void {
  const evidenceIds = new Set(report.evidence.map(evidence => evidence.evidenceId))
  const assetIds = new Set(report.assets.map(asset => asset.assetId))
  const productIds = new Set(report.products.map(product => product.productId))

  report.products.forEach((product, index) => {
    for (const evidenceId of product.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        push(violations, 'REFERENCE_NOT_FOUND', 'products[' + index + '].evidenceIds', 'missing evidence ' + evidenceId)
      }
    }
  })

  report.chapters.forEach((chapter, chapterIndex) => {
    chapter.blocks.forEach((block, blockIndex) => {
      const base = 'chapters[' + chapterIndex + '].blocks[' + blockIndex + ']'
      for (const evidenceId of blockEvidenceIds(block)) {
        if (!evidenceIds.has(evidenceId)) {
          push(violations, 'REFERENCE_NOT_FOUND', base, 'missing evidence ' + evidenceId)
        }
      }
      for (const assetId of blockAssetIds(block)) {
        if (!assetIds.has(assetId)) push(violations, 'REFERENCE_NOT_FOUND', base, 'missing asset ' + assetId)
      }
      for (const productId of blockProductIds(block)) {
        if (!productIds.has(productId)) push(violations, 'REFERENCE_NOT_FOUND', base, 'missing product ' + productId)
      }
    })
  })
}

function validateHeadlineRatio(report: ClientReport, violations: ClientPolicyViolation[]): void {
  if (report.chapters.length === 0) {
    push(violations, 'CLAIM_TITLE_RATIO_LOW', 'chapters', 'client report requires chapters')
    return
  }
  const conclusionHeadlines = report.chapters.filter(chapter =>
    chapter.headline.trim().length >= 12 && !WEAK_HEADLINES.has(chapter.headline.trim())).length
  if (conclusionHeadlines / report.chapters.length < 0.8) {
    push(violations, 'CLAIM_TITLE_RATIO_LOW', 'chapters', 'at least 80% of chapter headlines must state a conclusion')
  }
}

export function validateClientReportPolicy(report: ClientReport): ClientPolicyViolation[] {
  const violations: ClientPolicyViolation[] = []
  walkStrings(report, (path, value) => {
    const match = value.match(CLIENT_FORBIDDEN)
    if (match !== null) {
      push(violations, 'CLIENT_FORBIDDEN_TERM', path, 'client-visible text contains ' + match[0])
    }
  })
  validateEvidence(report, violations)
  validateAssets(report, violations)
  validateReferences(report, violations)
  validateHeadlineRatio(report, violations)
  validateVisualContract(report, violations)
  return violations
}

export function assertClientReportPolicy(report: ClientReport): void {
  const violations = validateClientReportPolicy(report)
  if (violations.length > 0) {
    throw new Error(violations.map(row =>
      row.code + ' ' + row.path + ': ' + row.message).join('\n'))
  }
}
