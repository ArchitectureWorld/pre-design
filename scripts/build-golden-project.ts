import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { ContractRegistry } from '../src/contracts/registry.ts'
import type { ArtifactManifestRecord } from '../src/governance/types.ts'
import { buildReportDocument } from '../src/report/build-document.ts'
import { renderHtml } from '../src/report/render-html.ts'
import { renderPdf } from '../src/report/render-pdf.ts'
import { renderPptx } from '../src/report/render-pptx.ts'
import type { FrozenProjectInput, ReportAsset } from '../src/report/types.ts'
import { validateAndHashReportArtifacts } from '../src/report/validate-artifacts.ts'

export interface GoldenProjectResult {
  readonly project: {
    readonly currentRevision: number
    readonly recommendation: string
  }
  readonly workflowCounts: { readonly total: number; readonly confirmed: number; readonly blocked: number }
  readonly gateCounts: { readonly total: number; readonly decided: number }
  readonly visualCounts: { readonly aiConcepts: number; readonly deterministicCharts: number }
  readonly manifest: ArtifactManifestRecord
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
    readonly status: 'adopted' | 'recovered_after_timeout'
    readonly caption: string
  }[]
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

function fixturePath(fixtureRoot: string, path: string): string {
  const root = resolve(fixtureRoot)
  const output = resolve(root, path)
  const child = relative(root, output)
  if (child.startsWith('..') || resolve(root, child) !== output) throw new Error(`golden fixture path escapes root: ${path}`)
  return output
}

async function reportAssets(fixtureRoot: string, evidence: GoldenVisualEvidence): Promise<ReportAsset[]> {
  if (evidence.provider !== 'antigravity' || evidence.model !== 'gemini-3.1-flash-image') {
    throw new Error('golden visuals must use antigravity / gemini-3.1-flash-image')
  }
  return Promise.all(evidence.assets.map(async asset => {
    const sourcePath = fixturePath(fixtureRoot, asset.file)
    const bytes = await readFile(sourcePath)
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (hash !== asset.sha256) throw new Error(`golden visual hash mismatch: ${asset.assetId}`)
    return {
      assetId: asset.assetId,
      kind: 'concept' as const,
      caption: asset.caption,
      sourcePath,
      mimeType: 'image/jpeg' as const,
    }
  }))
}

export async function runGoldenProject(
  fixtureRoot: string,
  outputRoot: string,
  options: { readonly browserExecutable: string },
): Promise<GoldenProjectResult> {
  const [brief, evidence, registry] = await Promise.all([
    readJson<GoldenBrief>(join(fixtureRoot, 'project-brief.json')),
    readJson<GoldenVisualEvidence>(join(fixtureRoot, 'evidence-manifest.json')),
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
      summary: brief.chapterSummaries[workflow.chapterId] ?? '本章成果已确认并纳入汇报。',
      facts: [
        { label: '本轮状态', value: '已确认', basis: `成果版本 R${brief.revision}` },
        { label: '成果用途', value: workflow.purpose, basis: '前期策划任务书与项目资料' },
      ],
    })),
    gates: [...brief.gateDecisions],
    visualAssets,
    adoptedAssetIds,
  }
  const document = buildReportDocument(input)
  const deterministicCharts = document.sections.flatMap(section => section.nodes)
    .filter(node => node.type === 'chart').length
  await mkdir(outputRoot, { recursive: true })
  await renderHtml(document, outputRoot)
  await Promise.all([
    renderPptx(document, join(outputRoot, 'report.pptx')),
    renderPdf(join(outputRoot, 'html', 'index.html'), join(outputRoot, 'report.pdf'), options.browserExecutable),
  ])
  const manifest = await validateAndHashReportArtifacts(outputRoot, {
    manifestId: `manifest-${brief.projectId}-r${brief.revision}`,
    packageId: `golden-${brief.projectId}-r${brief.revision}`,
    projectId: brief.projectId,
    sourceRevision: brief.revision,
    recommendationId: brief.recommendationId,
    adoptedAssetIds,
    createdAt: brief.generatedAt,
  })
  await writeFile(join(outputRoot, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return {
    project: { currentRevision: brief.revision, recommendation: brief.recommendation },
    workflowCounts: { ...brief.workflowStatus },
    gateCounts: { total: brief.gateDecisions.length, decided: brief.gateDecisions.length },
    visualCounts: { aiConcepts: visualAssets.length, deterministicCharts },
    manifest,
  }
}
