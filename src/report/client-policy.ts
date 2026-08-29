import type {
  ClientContentBlock,
  ClientPolicyViolation,
  ClientReport,
} from './client-types.ts'

const CLIENT_FORBIDDEN = /\b(?:Gate|Workflow|Revision|approved|approved_with_conditions|returned|blocked|R\d+)\b|工作项|完成度|审批状态|artifact-manifest|[A-Z]:[\\/]/iu
const WEAK_HEADLINES = new Set(['项目背景', '现状分析', '案例研究', '方案展示', '工作内容', '投资估算'])

function visibleString(path: string): boolean {
  return !/\.sourcePath$|\.sha256$|^theme\.|\.assetId$|\.chapterId$|\.productId$|\.evidenceId$|^schemaVersion$/u.test(path)
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
    if (asset.sourceKind === 'ai-concept' && asset.disclosure !== '概念示意') {
      push(violations, 'AI_DISCLOSURE_MISSING', base + '.disclosure', 'AI concept asset requires 概念示意')
    }
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
  return violations
}

export function assertClientReportPolicy(report: ClientReport): void {
  const violations = validateClientReportPolicy(report)
  if (violations.length > 0) {
    throw new Error(violations.map(row =>
      row.code + ' ' + row.path + ': ' + row.message).join('\n'))
  }
}
