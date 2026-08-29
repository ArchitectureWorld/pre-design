import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GovernanceRepository } from '../governance/repository.ts'
import type { ArtifactManifestRecord, ReportPackageRecord } from '../governance/types.ts'
import { assertClientReportPolicy } from './client-policy.ts'
import { createClientReportBundle } from './client-projection.ts'
import type {
  ClientMedium,
  ClientPagePlan,
  ClientProjectProfile,
  ClientRenderContext,
  ClientReport,
} from './client-types.ts'
import { planClientPages } from './page-plan.ts'
import { renderHtml } from './render-html.ts'
import { renderPdf } from './render-pdf.ts'
import { renderPptx } from './render-pptx.ts'
import { renderPrintHtml } from './render-print-html.ts'
import type { FrozenProjectInput } from './types.ts'
import { validateAndHashReportArtifacts, type ArtifactManifestIdentity } from './validate-artifacts.ts'

interface ReportRenderers {
  readonly html: (context: ClientRenderContext, outputRoot: string) => Promise<unknown>
  readonly printHtml: (context: ClientRenderContext, outputRoot: string) => Promise<string>
  readonly pptx: (context: ClientRenderContext, outputPath: string) => Promise<unknown>
  readonly pdf: (htmlPath: string, outputPath: string, browserExecutable: string) => Promise<unknown>
}

interface GovernancePort {
  readProject(projectId: string): ReturnType<GovernanceRepository['readProject']>
  putReportPackage(record: ReportPackageRecord): Promise<ReportPackageRecord>
}

export interface ReportPackageServiceOptions {
  readonly governance: GovernancePort
  readonly packageRoot: string
  readonly browserExecutable: string
  readonly source: (projectId: string, revision: number) => Promise<FrozenProjectInput>
  readonly profile: (projectId: string) => Promise<ClientProjectProfile>
  readonly policy?: (report: ClientReport) => void
  readonly planner?: (report: ClientReport, medium: ClientMedium) => ClientPagePlan
  readonly renderers?: ReportRenderers
  readonly validate?: (stagingRoot: string, identity: ArtifactManifestIdentity) => Promise<ArtifactManifestRecord>
  readonly createId?: () => string
  readonly now?: () => string
}

function safeId(label: string, value: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(value) || value === '.' || value === '..') {
    throw new Error(`${label} contains unsafe path characters`)
  }
  return value
}

export class ReportPackageService {
  private readonly renderers: ReportRenderers
  private readonly validate: NonNullable<ReportPackageServiceOptions['validate']>
  private readonly policy: NonNullable<ReportPackageServiceOptions['policy']>
  private readonly planner: NonNullable<ReportPackageServiceOptions['planner']>
  private readonly createId: () => string
  private readonly now: () => string

  constructor(private readonly options: ReportPackageServiceOptions) {
    this.renderers = options.renderers ?? {
      html: renderHtml,
      printHtml: renderPrintHtml,
      pptx: renderPptx,
      pdf: renderPdf,
    }
    this.validate = options.validate ?? validateAndHashReportArtifacts
    this.policy = options.policy ?? assertClientReportPolicy
    this.planner = options.planner ?? planClientPages
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date().toISOString())
  }

  async publish(projectId: string, revision: number): Promise<ArtifactManifestRecord> {
    safeId('projectId', projectId)
    const governed = this.options.governance.readProject(projectId)
    const pendingRequired = governed.visualTasks.filter(task => task.required && task.status !== 'adopted')
    if (pendingRequired.length > 0) {
      throw new Error(`required visual asset is not adopted: ${pendingRequired.map(task => task.taskId).join(', ')}`)
    }

    const [input, profile] = await Promise.all([
      this.options.source(projectId, revision),
      this.options.profile(projectId),
    ])
    if (input.projectId !== projectId || input.revision !== revision) {
      throw new Error('report source does not match requested project revision')
    }
    const bundle = createClientReportBundle(input, profile)
    this.policy(bundle.report)
    const plans = {
      html: this.planner(bundle.report, 'html'),
      pptx: this.planner(bundle.report, 'pptx'),
      pdf: this.planner(bundle.report, 'pdf'),
    }
    const contexts = {
      html: { report: bundle.report, plan: plans.html, identity: bundle.identity },
      pptx: { report: bundle.report, plan: plans.pptx, identity: bundle.identity },
      pdf: { report: bundle.report, plan: plans.pdf, identity: bundle.identity },
    }

    const packageId = safeId('packageId', this.createId())
    const manifestId = `manifest-${packageId}`
    const publishedRoot = join(this.options.packageRoot, packageId)
    await mkdir(this.options.packageRoot, { recursive: true })
    const stagingRoot = await mkdtemp(join(this.options.packageRoot, `.staging-${packageId}-`))
    let published = false
    try {
      await this.renderers.html(contexts.html, stagingRoot)
      const printHtmlPath = await this.renderers.printHtml(contexts.pdf, stagingRoot)
      const renderResults = await Promise.allSettled([
        this.renderers.pptx(contexts.pptx, join(stagingRoot, 'report.pptx')),
        this.renderers.pdf(
          printHtmlPath,
          join(stagingRoot, 'report.pdf'),
          this.options.browserExecutable,
        ),
      ])
      const failedRender = renderResults.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failedRender !== undefined) throw failedRender.reason
      const createdAt = this.now()
      const adoptedAssetIds = [...bundle.identity.adoptedAssetIds]
      const manifest = await this.validate(stagingRoot, {
        manifestId,
        packageId,
        projectId,
        sourceRevision: revision,
        recommendationId: bundle.identity.recommendationId,
        adoptedAssetIds,
        createdAt,
      })
      if (manifest.packageId !== packageId || manifest.projectId !== projectId || manifest.sourceRevision !== revision) {
        throw new Error('artifact manifest does not match frozen report identity')
      }
      await writeFile(join(stagingRoot, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      await rename(stagingRoot, publishedRoot)
      published = true
      await this.options.governance.putReportPackage({
        packageId,
        projectId,
        sourceRevision: revision,
        status: 'published',
        sectionIds: bundle.report.chapters.map(chapter => chapter.id),
        adoptedAssetIds,
        warnings: [],
        artifactManifestId: manifest.manifestId,
        createdAt,
        publishedAt: createdAt,
      })
      return manifest
    } catch (error) {
      await rm(published ? publishedRoot : stagingRoot, { recursive: true, force: true })
      throw error
    }
  }
}
