import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { ContractRegistry } from '../src/contracts/registry.ts'
import { assertClientReportPolicy } from '../src/report/client-policy.ts'
import { createClientResearchPreviewBundle } from '../src/report/client-projection.ts'
import type { ClientProjectProfile } from '../src/report/client-types.ts'
import { planClientPages } from '../src/report/page-plan.ts'
import { renderHtml } from '../src/report/render-html.ts'
import { renderPdf } from '../src/report/render-pdf.ts'
import { renderPptx } from '../src/report/render-pptx.ts'
import { renderPrintHtml } from '../src/report/render-print-html.ts'
import type { FrozenProjectInput, ReportAsset } from '../src/report/types.ts'
import {
  validateAndHashResearchPreviewArtifacts,
  type ResearchPreviewEvidence,
} from '../src/report/validate-artifacts.ts'
import { inspectClientArtifacts, type ClientArtifactInspection } from './inspect-client-artifacts.ts'

export type GoldenProjectFormat = 'html' | 'pptx' | 'pdf'

const DEFAULT_GOLDEN_PROJECT_FORMATS: readonly GoldenProjectFormat[] = ['html']

export interface GoldenProjectResult {
  readonly publishable: false
  readonly project: { readonly currentRevision: number; readonly recommendation: string }
  readonly workflowCounts: { readonly total: number; readonly confirmed: number; readonly blocked: number }
  readonly gateCounts: { readonly total: number; readonly decided: number }
  readonly visualCounts: { readonly aiConcepts: number; readonly deterministicCharts: number }
  readonly evidence: ResearchPreviewEvidence
  readonly adoptedAssetIds: readonly string[]
  readonly client: Readonly<{
    schemaVersion: 'preplan.client-report.v1'
    pptxPages: number
    pdfPages: number
    forbiddenTermHits: ClientArtifactInspection['forbiddenTermHits']
  }>
}

interface GoldenBrief {
  readonly projectId: string
  readonly projectName: string
  readonly revision: number
  readonly generatedAt: string
  readonly recommendationId: string
  readonly recommendation: string
  readonly decisionItems: readonly string[]
  readonly workflowStatus: { readonly total: number; readonly confirmed: number; readonly blocked: number }
  readonly gateDecisions: readonly {
    readonly gateId: string
    readonly decision: 'approved' | 'approved_with_conditions' | 'returned' | 'blocked'
    readonly revision: number
  }[]
  readonly chapterSummaries: Readonly<Record<string, string>>
}

interface GoldenVisualEvidence {
  readonly provider: string
  readonly model: string
  readonly assets: readonly {
    readonly assetId: string
    readonly file: string
    readonly sha256: string
    readonly status: 'adopted' | 'recovered_after_timeout' | 'research_only'
    readonly caption: string
    readonly kind?: ReportAsset['kind']
    readonly width?: number
    readonly height?: number
  }[]
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function fixturePath(fixtureRoot: string, path: string): string {
  const root = resolve(fixtureRoot)
  const output = resolve(root, path)
  const child = relative(root, output)
  if (child.startsWith('..') || resolve(root, child) !== output) throw new Error(`golden fixture path escapes root: ${path}`)
  return output
}

async function reportAssets(fixtureRoot: string, evidence: GoldenVisualEvidence): Promise<ReportAsset[]> {
  return Promise.all(evidence.assets.map(async asset => {
    const kind = asset.kind ?? 'concept'
    if (kind === 'concept' && (
      evidence.provider !== 'antigravity' || evidence.model !== 'gemini-3.1-flash-image'
    )) {
      throw new Error('golden concept visuals must use antigravity / gemini-3.1-flash-image')
    }
    const sourcePath = fixturePath(fixtureRoot, asset.file)
    const bytes = await readFile(sourcePath)
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (hash !== asset.sha256) throw new Error(`golden visual hash mismatch: ${asset.assetId}`)
    const extension = sourcePath.toLowerCase().match(/\.(png|jpe?g|webp|svg)$/u)?.[1]
    const mimeType = extension === 'png' ? 'image/png' as const
      : extension === 'webp' ? 'image/webp' as const
        : extension === 'svg' ? 'image/svg+xml' as const
          : 'image/jpeg' as const
    return {
      assetId: asset.assetId,
      kind,
      caption: asset.caption.replace('（AI 生成）', '').trim(),
      sourcePath,
      mimeType,
      ...(asset.width === undefined || asset.height === undefined ? {} : {
        sha256: hash,
        width: asset.width,
        height: asset.height,
      }),
    }
  }))
}

export async function runGoldenProject(
  fixtureRoot: string,
  outputRoot: string,
  options: { readonly browserExecutable: string; readonly formats?: readonly GoldenProjectFormat[] },
): Promise<GoldenProjectResult> {
  const formats = options.formats ?? DEFAULT_GOLDEN_PROJECT_FORMATS
  if (formats.length === 0 || formats.some(format => !['html', 'pptx', 'pdf'].includes(format))) {
    throw new Error('research preview formats must be a non-empty subset of html,pptx,pdf')
  }
  if (!formats.includes('html')) throw new Error('research preview formats must include html')
  if (await exists(join(outputRoot, 'qa', 'research-preview-evidence.json'))) {
    throw new Error('refusing to overwrite existing research preview')
  }
  const [brief, evidence, profile, registry] = await Promise.all([
    readJson<GoldenBrief>(join(fixtureRoot, 'project-brief.json')),
    readJson<GoldenVisualEvidence>(join(fixtureRoot, 'evidence-manifest.json')),
    readJson<ClientProjectProfile>(join(fixtureRoot, 'client-profile.json')),
    ContractRegistry.open(new URL('../contracts/v0.6/', import.meta.url)),
  ])
  const workflows = registry.workflows()
  if (workflows.length !== brief.workflowStatus.total || brief.workflowStatus.confirmed !== workflows.length) {
    throw new Error(`golden workflow count ${brief.workflowStatus.confirmed}/${brief.workflowStatus.total} does not match ${workflows.length} contracts`)
  }
  if (brief.gateDecisions.length !== registry.gates().length) {
    throw new Error(`golden gate count ${brief.gateDecisions.length} does not match ${registry.gates().length} contracts`)
  }
  const visualAssets = await reportAssets(fixtureRoot, evidence)
  const adoptedAssetIds = evidence.assets.filter(asset => asset.status === 'adopted').map(asset => asset.assetId)
  const boundaryAsset = visualAssets.find(asset => asset.assetId === 'map-boundary')
  if (boundaryAsset === undefined || boundaryAsset.kind === 'concept' || boundaryAsset.sha256 === undefined
    || boundaryAsset.width === undefined || boundaryAsset.height === undefined) {
    throw new Error('SITE_BOUNDARY_RESEARCH_PREVIEW_CONFLICT：Golden 研究范围资产不完整。')
  }
  const input: FrozenProjectInput = {
    projectId: brief.projectId,
    projectName: brief.projectName,
    revision: brief.revision,
    generatedAt: brief.generatedAt,
    recommendationId: brief.recommendationId,
    recommendation: brief.recommendation,
    decisionItems: [...brief.decisionItems],
    stateObjects: workflows.map(workflow => ({
      objectId: workflow.targetObjectId,
      chapterId: workflow.chapterId,
      workItemId: workflow.workItemId,
      title: workflow.title,
      summary: brief.chapterSummaries[workflow.chapterId] ?? '本章成果已纳入汇报。',
      facts: [{ label: '成果用途', value: workflow.purpose, basis: '前期策划任务书与项目资料' }],
    })),
    gates: [...brief.gateDecisions],
    visualAssets,
    adoptedAssetIds,
    siteBoundary: {
      boundaryId: 'golden-research-boundary', status: 'synthetic_research', source: 'approved_redline',
      declarations: ['研究范围（待核）', '非法定红线', '非测绘成果'],
      assetId: boundaryAsset.assetId,
      assetSha256: boundaryAsset.sha256,
    },
  }
  const bundle = createClientResearchPreviewBundle(input, profile)
  assertClientReportPolicy(bundle.report)
  const htmlPlan = planClientPages(bundle.report, 'html')
  await mkdir(outputRoot, { recursive: true })
  await renderHtml({ report: bundle.report, plan: htmlPlan, identity: bundle.identity }, outputRoot)
  const pptxPlan = formats.includes('pptx') ? planClientPages(bundle.report, 'pptx') : undefined
  const pdfPlan = formats.includes('pdf') ? planClientPages(bundle.report, 'pdf') : undefined
  if (pptxPlan !== undefined) {
    await renderPptx({ report: bundle.report, plan: pptxPlan, identity: bundle.identity }, join(outputRoot, 'report.pptx'))
  }
  if (pdfPlan !== undefined) {
    const printPath = await renderPrintHtml({ report: bundle.report, plan: pdfPlan, identity: bundle.identity }, outputRoot)
    await renderPdf(printPath, join(outputRoot, 'report.pdf'), options.browserExecutable)
  }
  const previewEvidence = await validateAndHashResearchPreviewArtifacts(outputRoot, {
    projectId: brief.projectId,
    sourceRevision: brief.revision,
    createdAt: brief.generatedAt,
  }, bundle, formats)
  await mkdir(join(outputRoot, 'qa'), { recursive: true })
  await writeFile(join(outputRoot, 'qa', 'research-preview-evidence.json'), `${JSON.stringify(previewEvidence, null, 2)}\n`, 'utf8')
  const inspection = await inspectClientArtifacts(outputRoot, { evidencePath: 'qa/research-preview-evidence.json' })
  await writeFile(join(outputRoot, 'qa', 'client-inspection.json'), `${JSON.stringify(inspection, null, 2)}\n`, 'utf8')
  return {
    publishable: false,
    project: { currentRevision: brief.revision, recommendation: brief.recommendation },
    workflowCounts: { ...brief.workflowStatus },
    gateCounts: { total: brief.gateDecisions.length, decided: brief.gateDecisions.length },
    visualCounts: {
      aiConcepts: visualAssets.filter(asset => asset.kind === 'concept').length,
      deterministicCharts: visualAssets.filter(asset => asset.kind === 'deterministic').length,
    },
    evidence: previewEvidence,
    adoptedAssetIds,
    client: {
      schemaVersion: bundle.report.schemaVersion,
      pptxPages: pptxPlan?.pages.length ?? 0,
      pdfPages: pdfPlan?.pages.length ?? 0,
      forbiddenTermHits: inspection.forbiddenTermHits,
    },
  }
}
