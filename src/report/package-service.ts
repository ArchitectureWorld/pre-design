import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GovernanceRepository } from '../governance/repository.ts'
import type { ArtifactManifestRecord, ReportPackageRecord } from '../governance/types.ts'
import { buildReportDocument } from './build-document.ts'
import { renderHtml } from './render-html.ts'
import { renderPdf } from './render-pdf.ts'
import { renderPptx } from './render-pptx.ts'
import type { FrozenProjectInput, ReportDocument } from './types.ts'
import { validateAndHashReportArtifacts, type ArtifactManifestIdentity } from './validate-artifacts.ts'

interface ReportRenderers {
  readonly html: (document: ReportDocument, outputRoot: string) => Promise<unknown>
  readonly pptx: (document: ReportDocument, outputPath: string) => Promise<unknown>
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
  private readonly createId: () => string
  private readonly now: () => string

  constructor(private readonly options: ReportPackageServiceOptions) {
    this.renderers = options.renderers ?? { html: renderHtml, pptx: renderPptx, pdf: renderPdf }
    this.validate = options.validate ?? validateAndHashReportArtifacts
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

    const input = await this.options.source(projectId, revision)
    if (input.projectId !== projectId || input.revision !== revision) {
      throw new Error('report source does not match requested project revision')
    }
    const document = buildReportDocument(input)
    const packageId = safeId('packageId', this.createId())
    const manifestId = `manifest-${packageId}`
    const publishedRoot = join(this.options.packageRoot, packageId)
    await mkdir(this.options.packageRoot, { recursive: true })
    const stagingRoot = await mkdtemp(join(this.options.packageRoot, `.staging-${packageId}-`))
    let published = false
    try {
      await this.renderers.html(document, stagingRoot)
      const renderResults = await Promise.allSettled([
        this.renderers.pptx(document, join(stagingRoot, 'report.pptx')),
        this.renderers.pdf(
          join(stagingRoot, 'html', 'index.html'),
          join(stagingRoot, 'report.pdf'),
          this.options.browserExecutable,
        ),
      ])
      const failedRender = renderResults.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failedRender !== undefined) throw failedRender.reason
      const createdAt = this.now()
      const adoptedAssetIds = [...document.meta.adoptedAssetIds]
      const manifest = await this.validate(stagingRoot, {
        manifestId,
        packageId,
        projectId,
        sourceRevision: revision,
        recommendationId: document.meta.recommendationId,
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
        sectionIds: document.sections.map(section => section.id),
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
