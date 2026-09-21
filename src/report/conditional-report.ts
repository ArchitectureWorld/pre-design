import type { ArtifactIdentity, ClientChapter, ClientChapterRole, ClientEvidence, ClientMedium, ClientPage, ClientPagePlan, ClientProduct, ClientReport, ClientVisualAsset } from './client-types.ts'
import { makeSourceIndex } from './manuscript/source.ts'
import { paginatePlanningPage } from './planning-page-layout.ts'
import { planRegularPages, assertRegularPagePlan } from './regular/plan.ts'
import { createHash } from 'node:crypto'
import { compileClientReportOutline } from '../presentation/projector/client-outline.ts'
import type { PresentationAdoptedAssetInput } from '../presentation/standard-project-types.ts'
import { createClientTheme } from './theme.ts'
import type { FrozenProjectInput } from './types.ts'
import { caseStudySources, caseStudyEvidenceMarkdown } from './case-studies/index.ts'

export const CONDITIONAL_REPORT_NOTICE = '条件式策划成果：保留资料缺口与成立条件，内容及测算尚待专项复核，不作为法定边界或正式审核结论。'
const conditionalBrand: unique symbol = Symbol('conditional-report')
export interface ConditionalReportBundle {
  readonly kind: 'conditional'
  readonly publishable: false
  readonly [conditionalBrand]: true
  readonly report: ClientReport
  readonly identity: ArtifactIdentity
}
const bundles = new WeakSet<object>()
const reports = new WeakSet<object>()
interface ConditionalDetail { readonly title: string; readonly entries: readonly string[] }
const details = new WeakMap<object, readonly ConditionalDetail[]>()
export function conditionalReportDetails(report: ClientReport): readonly ConditionalDetail[] {
  if (!isConditionalReport(report)) throw new Error('CONDITIONAL_REPORT_UNTRUSTED')
  return details.get(report) ?? []
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

// Presentation vocabulary only. Original state and evidence remain untouched.
function display(value: string): string {
  return value.replace(/\bWorkflow\b/giu, '策划流程').replace(/\bGate\b/giu, '阶段检查')
    .replace(/\bRevision\b/giu, '版本').replace(/\bSHA(?:-?256)?\b/giu, '文件指纹')
    .replace(/工作项/gu, '策划事项').replace(/完成度/gu, '资料覆盖情况').replace(/确认日志/gu, '过程记录')
    .replace(/(?:attachment|asset|boundary)\s*ID/giu, '资料编号').replace(/(?:附件|内部资产|边界)\s*ID/gu, '资料编号')
    .replace(/artifact-manifest/gu, '成果清单').replace(/[A-Z]:[\\/][^\s；，。)）]*/giu, '原始资料路径（内部存档）')
}

function chunks(text: string): string[] {
  const points = Array.from(display(text))
  const result: string[] = []
  let page = '', lines = 1, width = 0, count = 0
  for (const point of points) {
    const weight = /[\x00-\x7f]/u.test(point) ? 0.6 : 1
    const nextLine = point === '\n' || width + weight > 42
    if (count >= 400 || (nextLine && lines >= 13)) {
      result.push(page)
      page = ''; lines = 1; width = 0; count = 0
    }
    if (point === '\n') { lines++; width = 0 }
    else { if (width + weight > 42) { lines++; width = 0 }; width += weight }
    page += point; count++
  }
  if (page !== '') result.push(page)
  return result
}

export type ConditionalReportMaterial = PresentationAdoptedAssetInput & { readonly sha256: string }
export function createConditionalReportBundle(input: FrozenProjectInput, materials: readonly ConditionalReportMaterial[] = []): ConditionalReportBundle {
  if (!Number.isInteger(input.revision) || input.revision < 0 || input.stateObjects.length === 0) {
    throw new Error('CONDITIONAL_REPORT_SOURCE_INVALID: 缺少有效的策划成果快照。')
  }
  const boundary = input.siteBoundary?.status === 'confirmed'
    ? '已有登记边界；本报告不替代边界资料及正式审核。'
    : '法定场地边界尚未确认，面积、建设规模与实施范围均须结合有效边界资料核定。'
  const chapters: ClientChapter[] = [{ id: 'conditional-scope', role: 'brief', headline: '项目研究范围与决策条件',
    claim: CONDITIONAL_REPORT_NOTICE, blocks: [`${CONDITIONAL_REPORT_NOTICE}\n\n${boundary}`,
    ].map(statement => ({ type: 'narrative', statement, evidenceIds: [] })) }]
  const fullDetails: ConditionalDetail[] = []
  for (const object of [...input.stateObjects].sort((a, b) => (a.workItemId ?? a.objectId).localeCompare(b.workItemId ?? b.objectId))) {
    const entries = object.reportSections?.flatMap(section => section.entries.map(entry => `${entry.text}\n依据与性质：${entry.basis}`)) ?? []
    const fullEntries = entries.length > 0 ? entries : object.facts.map(fact => `${fact.label}：${fact.value}\n依据与性质：${fact.basis}`)
    fullDetails.push({ title: display(object.title), entries: [object.summary, ...fullEntries].map(display) })
  }
  const assets: ClientVisualAsset[] = []
  const products: ClientProduct[] = []
  const scope = input.manuscript ? chapters.pop() : undefined
  const findings = compileClientReportOutline(input)
  for (const finding of findings) {
    const id = `client-${createHash('sha256').update(finding.findingId).digest('hex').slice(0, 16)}`
    const points = finding.supportingBlocks.flatMap(block => block.type === 'list' ? block.items : [])
    const page = finding.manuscriptPage
    const roles: Record<string, ClientChapterRole> = { opportunity: 'opportunity', site: 'diagnosis', positioning: 'positioning',
      products: 'product', spatial: 'spatial', launch: 'implementation', operation: 'operation' }
    chapters.push({ id, role: roles[finding.sectionKey.replace('manuscript:', '')] ?? 'diagnosis', headline: finding.title, claim: finding.keyMessage,
      blocks: page ? [{ type: 'planning-page', page, chapterTitle: finding.sectionTitle }]
        : [{ type: 'narrative', statement: [finding.keyMessage, ...points.map(point => `• ${point}`)].join('\n\n'), evidenceIds: [] }] })
    if (page?.product) {
      const p = page.product
      products.push({ productId: page.id, name: p.name, valueProposition: page.claim, audiences: [p.audience], contents: [p.experience],
        usageScenarios: page.body, spatialCarrier: p.location, operatingModel: p.operations, valueContribution: p.scale, evidenceIds: finding.evidenceIds })
    }
    const matched = materials.filter(asset => {
      const pageMatch = asset.pageBindings?.some(binding => binding.findingId === finding.findingId && binding.role !== 'reference')
      return asset.pageBindingOnly ? pageMatch : pageMatch || asset.objectIds.some(objectId => finding.objectIds.includes(objectId))
        || finding.assetIds?.some(assetId => [asset.sourceKey, ...asset.aliases ?? []].includes(assetId))
    })
    for (const material of matched) {
      const ai = material.semanticRole === 'concept_visual'
      assets.push({ assetId: `a-${createHash('sha256').update(`${id}:${material.sourceKey}`).digest('hex').slice(0, 20)}`,
        role: ai ? 'product-scene' : material.cartography ? 'map' : material.semanticRole === 'deterministic_visual' ? 'diagram' : 'site-photo', chapterId: id,
        caption: page?.visual.caption ?? material.displayName, sourceKind: ai ? 'ai-concept' : material.semanticRole === 'source_evidence' || material.origin.type === 'source_material' || material.cartography && material.provenance ? 'project-source' : 'deterministic',
        sourcePath: material.sourcePath, sha256: material.sha256, width: material.widthPx ?? 1, height: material.heightPx ?? 1,
        ...(material.imageIdentity ? { imageIdentity: material.imageIdentity } : {}),
        ...(material.imageQuality ? { imageQuality: material.imageQuality } : {}),
        ...(material.cartography ? { cartography: material.cartography, analysisKind: material.analysisKind, provenance: material.provenance } : {}),
        ...(material.physicalPlacement ? { physicalPlacement: material.physicalPlacement } : {}),
        ...(material.semanticRole === 'source_evidence' && !material.provenance ? { provenance: { sourceLabel: material.displayName, sourceDate: material.createdAt.slice(0, 10), locator: material.origin.method, sourceFileSha256: material.sha256, evidenceIds: material.evidenceIds } } : {}),
        ...(material.pageBindings?.find(binding => binding.findingId === finding.findingId)?.nodeIds?.length
          ? { stageNodeIds: material.pageBindings.find(binding => binding.findingId === finding.findingId)!.nodeIds } : {}),
        ...(ai ? { disclosure: '概念示意' as const } : {}),
      })
    }
  }
  for (const material of materials.filter(m => m.pageBindings?.some(b => b.findingId === 'report:cover'))) {
    assets.push({ assetId: `cover-${createHash('sha256').update(material.sourceKey).digest('hex').slice(0, 20)}`, role: 'hero', chapterId: 'opening',
      caption: '', sourceKind: material.semanticRole === 'concept_visual' ? 'ai-concept' : 'project-source', sourcePath: material.sourcePath,
      sha256: material.sha256, width: material.widthPx ?? 1, height: material.heightPx ?? 1, imageIdentity: material.imageIdentity, imageQuality: material.imageQuality,
      physicalPlacement: material.physicalPlacement })
  }
  // Material qualifications remain in the separately exported source record.
  if (scope) fullDetails.unshift({ title: scope.headline, entries: [CONDITIONAL_REPORT_NOTICE, boundary] })
  if (input.caseStudies) fullDetails.push({ title: '真实项目案例资料依据', entries: [caseStudyEvidenceMarkdown(input.caseStudies)] })
  const usedSources = new Set(findings.flatMap(finding => finding.manuscriptPage?.sourceRefs ?? []))
  const manuscriptEvidence: ClientEvidence[] = [...makeSourceIndex(input), ...input.caseStudies ? caseStudySources(input.caseStudies) : []].filter(source => usedSources.has(source.id)).map(source => ({ evidenceId: source.id,
    kind: 'assumption', statement: source.text, sourceLabel: source.basis || '项目策划资料', sourceDate: input.generatedAt.slice(0, 10),
    locator: `${source.objectId}/${source.fieldPath}`, assumption: source.basis }))
  const analysisEvidence = [...new Map(materials.flatMap(material => material.analysisEvidence ?? []).map(evidence => [evidence.evidenceId, evidence])).values()]
  if (analysisEvidence.length) fullDetails.push({ title: '地域分析资料依据', entries: analysisEvidence.map(evidence => `${evidence.statement}\n${evidence.sourceLabel}｜${evidence.sourceDate}｜${evidence.locator}`) })
  const coreValue = findings.find(f => f.sectionKey === 'manuscript:positioning' || f.sectionKey === 'recommended-path')?.keyMessage ?? findings[0]?.keyMessage ?? CONDITIONAL_REPORT_NOTICE
  const report: ClientReport = {
    schemaVersion: 'preplan.client-report.v1',
    identity: { projectId: input.projectId, projectName: display(input.projectName), reportTitle: input.manuscript?.title ?? `${display(input.projectName)}｜前期策划汇报`,
      reportDate: input.generatedAt.slice(0, 10), audience: 'executive-and-professional', locale: 'zh-CN' },
    proposition: { projectDefinition: input.manuscript ? coreValue : `${display(input.projectName)}前期策划`, urgency: '项目价值 · 产品场景 · 实施路径',
      coreValue,
      positioning: '开发判断 · 业态定位 · 实施路径', keywords: ['项目价值', '产品场景', '实施路径'] },
    chapters, products, evidence: [...manuscriptEvidence, ...analysisEvidence], assets, theme: createClientTheme({}),
  }
  const bundle = freeze({ kind: 'conditional', publishable: false, [conditionalBrand]: true, report,
    identity: { projectId: input.projectId, sourceRevision: input.revision,
      recommendationId: input.recommendationId ?? `recommendation-r${input.revision}`, adoptedAssetIds: assets.map(asset => asset.assetId) },
  }) as ConditionalReportBundle
  bundles.add(bundle)
  reports.add(report)
  details.set(report, freeze(fullDetails))
  return bundle
}

export function isConditionalReport(report: unknown): report is ClientReport {
  return report !== null && typeof report === 'object' && reports.has(report)
}

export function assertConditionalBundle(bundle: unknown): asserts bundle is ConditionalReportBundle {
  if (bundle === null || typeof bundle !== 'object' || !bundles.has(bundle)) throw new Error('CONDITIONAL_REPORT_UNTRUSTED')
}

export function planConditionalPages(bundle: ConditionalReportBundle, medium: ClientMedium): ClientPagePlan {
  assertConditionalBundle(bundle)
  if (bundle.report.chapters.some(chapter => chapter.blocks.some(block => block.type === 'planning-page'))) {
    return freeze(planRegularPages(bundle.report, medium))
  }
  const pages: ClientPage[] = [{ pageId: 'cover', kind: 'cover', layoutVariant: 'full-bleed', chapterId: 'opening',
    headline: bundle.report.identity.reportTitle, primaryFocus: { type: 'claim', statement: bundle.report.proposition.coreValue },
    blockIndexes: [], assetIds: bundle.report.assets.filter(asset => asset.sourceKind === 'ai-concept').slice(0, 1).map(asset => asset.assetId), evidenceIds: [] }]
  for (const chapter of bundle.report.chapters) {
    chapter.blocks.forEach((block, index) => {
      if (block.type !== 'narrative' && block.type !== 'planning-page') throw new Error('CONDITIONAL_REPORT_BLOCK_INVALID')
      const assets = bundle.report.assets.filter(asset => asset.chapterId === chapter.id).slice(0, 2).map(asset => asset.assetId)
      const parts = block.type === 'planning-page' && medium !== 'html' ? paginatePlanningPage(block.page, assets.length > 0) : [undefined]
      parts.forEach((part, partIndex) => pages.push({ pageId: (index === 0 ? `${chapter.id}-divider` : `${chapter.id}-${index}`) + (partIndex ? `-part${partIndex + 1}` : ''), kind: 'evidence', layoutVariant: index % 2 === 0 ? 'editorial' : 'split',
        chapterId: chapter.id, headline: chapter.headline, primaryFocus: { type: 'claim', statement: block.type === 'planning-page' ? block.page.claim : block.statement },
        ...(part ? { planningContent: part } : {}), blockIndexes: [index], assetIds: assets, evidenceIds: [] }))
    })
  }
  return freeze({ medium, pages, layoutContract: { safeMarginRatio: 0.06, minimumTitle: 24, minimumBody: 14, minimumCaption: 10 } })
}

export function assertConditionalPagePlan(plan: ClientPagePlan, report: ClientReport): void {
  const ids = new Set<string>()
  if (!isConditionalReport(report) || plan.pages.length === 0) throw new Error('CONDITIONAL_REPORT_PLAN_INVALID')
  if (plan.canvas) return assertRegularPagePlan(plan, report)
  for (const page of plan.pages) {
    const chapter = report.chapters.find(row => row.id === page.chapterId)
    if (ids.has(page.pageId) || (page.kind !== 'cover' && chapter === undefined)
      || page.blockIndexes.some(index => chapter?.blocks[index] === undefined)
      || page.assetIds.some(id => !report.assets.some(asset => asset.assetId === id)) || page.evidenceIds.length > 0) throw new Error('CONDITIONAL_REPORT_PLAN_INVALID')
    ids.add(page.pageId)

  }
}
