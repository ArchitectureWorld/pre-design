import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GovernanceRepository } from '../governance/repository.ts'
import type { ArtifactManifestRecord, ReportPackageRecord } from '../governance/types.ts'
import { selectConfirmedSiteBoundary, type SiteBoundaryService } from '../governance/site-boundary-service.ts'
import { assertClientReportPolicy } from './client-policy.ts'
import { assertPublishableClientReportBundle, createClientReportBundle } from './client-projection.ts'
import type {
  ClientMedium,
  ClientPagePlan,
  ClientProjectionBundle,
  ClientProjectProfile,
  ClientRenderContext,
  ClientReport,
  ClientReportBundle,
} from './client-types.ts'
import { assertClientPagePlan, planClientPages } from './page-plan.ts'
import { renderHtml } from './render-html.ts'
import { renderPdf } from './render-pdf.ts'
import { renderPptx } from './render-pptx.ts'
import { renderPrintHtml } from './render-print-html.ts'
import type { FrozenProjectInput } from './types.ts'
import {
  validateAndHashReportArtifacts,
  type ArtifactManifestIdentity,
  type ArtifactValidationSensitiveValues,
} from './validate-artifacts.ts'

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
  readonly boundaryIntegrity: Pick<SiteBoundaryService, 'assertFormalBoundaryIntegrity' | 'captureFormalBoundarySnapshot'>
  readonly packageRoot: string
  readonly browserExecutable: string
  readonly source: (projectId: string, revision: number) => Promise<FrozenProjectInput>
  readonly profile: (projectId: string, input: FrozenProjectInput) => Promise<ClientProjectProfile>
  readonly projection?: (input: FrozenProjectInput, profile: ClientProjectProfile) => ClientProjectionBundle
  readonly policy?: (report: ClientReport) => void
  readonly planner?: (report: ClientReport, medium: ClientMedium) => ClientPagePlan
  readonly renderers?: ReportRenderers
  readonly validate?: (
    stagingRoot: string,
    identity: ArtifactManifestIdentity,
    sensitive: ArtifactValidationSensitiveValues | undefined,
    bundle: ClientReportBundle,
  ) => Promise<ArtifactManifestRecord>
  readonly createId?: () => string
  readonly now?: () => string
}

function safeId(label: string, value: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(value) || value === '.' || value === '..') {
    throw new Error(`${label} contains unsafe path characters`)
  }
  return value
}

function snapshotExtension(mimeType: string): string {
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/svg+xml') return '.svg'
  throw new Error('SITE_BOUNDARY_INTEGRITY_FAILED：场地边界快照格式不受支持。')
}

function sameFormalBoundary(
  left: Awaited<ReturnType<SiteBoundaryService['captureFormalBoundarySnapshot']>>,
  right: Awaited<ReturnType<SiteBoundaryService['assertFormalBoundaryIntegrity']>>,
): boolean {
  return left.record.boundaryId === right.record.boundaryId
    && left.record.confirmedRevision === right.record.confirmedRevision
    && left.asset.assetId === right.asset.assetId
    && left.asset.sha256 === right.asset.sha256
    && left.integrityDigest === right.integrityDigest
}

export class ReportPackageService {
  private readonly renderers: ReportRenderers
  private readonly validate: NonNullable<ReportPackageServiceOptions['validate']>
  private readonly policy: NonNullable<ReportPackageServiceOptions['policy']>
  private readonly planner: NonNullable<ReportPackageServiceOptions['planner']>
  private readonly projection: NonNullable<ReportPackageServiceOptions['projection']>
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
    this.projection = options.projection ?? createClientReportBundle
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date().toISOString())
  }

  async publish(projectId: string, revision: number): Promise<ArtifactManifestRecord> {
    safeId('projectId', projectId)
    const governed = this.options.governance.readProject(projectId)
    const confirmedBoundary = selectConfirmedSiteBoundary(governed.siteBoundaries ?? [], revision)
    if (confirmedBoundary === undefined) throw new Error('SITE_BOUNDARY_CONFIRMATION_REQUIRED: 请提供总平图、红线图或闭合红线坐标并确认。')
    const formalBoundary = await this.options.boundaryIntegrity.captureFormalBoundarySnapshot(projectId, revision)

    const input = await this.options.source(projectId, revision)
    if (input.projectId !== projectId || input.revision !== revision) {
      throw new Error('report source does not match requested project revision')
    }
    const frozenBoundary = input.siteBoundary
    if (frozenBoundary === undefined || frozenBoundary.status !== 'confirmed') {
      throw new Error('SITE_BOUNDARY_CONFIRMATION_REQUIRED: 请提供总平图、红线图或闭合红线坐标并确认。')
    }
    if (confirmedBoundary.boundaryId !== formalBoundary.record.boundaryId
      || frozenBoundary.boundaryId !== formalBoundary.record.boundaryId
      || frozenBoundary.assetId !== formalBoundary.asset.assetId
      || frozenBoundary.assetSha256 !== formalBoundary.asset.sha256
      || frozenBoundary.confirmedRevision !== formalBoundary.record.confirmedRevision
      || frozenBoundary.source !== formalBoundary.record.source
      || frozenBoundary.sourceSha256 !== formalBoundary.record.sourceAsset?.sha256
      || frozenBoundary.geometrySha256 !== formalBoundary.record.geometry?.sha256
      || frozenBoundary.integrityDigest !== formalBoundary.integrityDigest) {
      throw new Error('SITE_BOUNDARY_SOURCE_MISMATCH：冻结报告源与治理确认边界不一致。')
    }
    const pendingRequired = governed.visualTasks.filter(task => task.required && task.status !== 'adopted')
    if (pendingRequired.length > 0) {
      throw new Error(`required visual asset is not adopted: ${pendingRequired.map(task => task.taskId).join(', ')}`)
    }
    const profile = await this.options.profile(projectId, input)
    const bundle = this.projection(input, profile)
    assertPublishableClientReportBundle(bundle)
    this.policy(bundle.report)
    const plans = {
      html: this.planner(bundle.report, 'html'),
      pptx: this.planner(bundle.report, 'pptx'),
      pdf: this.planner(bundle.report, 'pdf'),
    }
    assertClientPagePlan(plans.html, bundle.report)
    assertClientPagePlan(plans.pptx, bundle.report)
    assertClientPagePlan(plans.pdf, bundle.report)
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
    const verifiedInputRoot = join(stagingRoot, '.verified-input')
    let published = false
    try {
      await mkdir(verifiedInputRoot, { recursive: true })
      const snapshotPath = join(verifiedInputRoot, `site-boundary${snapshotExtension(formalBoundary.asset.mimeType)}`)
      await writeFile(snapshotPath, formalBoundary.bytes, { flag: 'wx' })
      const snapshotReport = {
        ...bundle.report,
        assets: bundle.report.assets.map(asset => asset.assetId === formalBoundary.asset.assetId
          ? { ...asset, sourcePath: snapshotPath }
          : asset),
      }
      const snapshotContexts = {
        html: { ...contexts.html, report: snapshotReport },
        pptx: { ...contexts.pptx, report: snapshotReport },
        pdf: { ...contexts.pdf, report: snapshotReport },
      }
      await this.renderers.html(snapshotContexts.html, stagingRoot)
      const printHtmlPath = await this.renderers.printHtml(snapshotContexts.pdf, stagingRoot)
      const renderResults = await Promise.allSettled([
        this.renderers.pptx(snapshotContexts.pptx, join(stagingRoot, 'report.pptx')),
        this.renderers.pdf(
          printHtmlPath,
          join(stagingRoot, 'report.pdf'),
          this.options.browserExecutable,
        ),
      ])
      const failedRender = renderResults.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failedRender !== undefined) throw failedRender.reason
      const postRenderBoundary = await this.options.boundaryIntegrity.assertFormalBoundaryIntegrity(projectId, revision)
      if (!sameFormalBoundary(formalBoundary, postRenderBoundary)) {
        throw new Error('SITE_BOUNDARY_SOURCE_MISMATCH：渲染前后治理确认边界不一致。')
      }
      await rm(verifiedInputRoot, { recursive: true, force: true })
      const createdAt = this.now()
      const adoptedAssetIds = [...bundle.identity.adoptedAssetIds]
      const sensitiveBoundary = bundle.identity.siteBoundaryId === undefined || bundle.identity.siteBoundaryAssetId === undefined
        ? undefined
        : { siteBoundary: { boundaryId: bundle.identity.siteBoundaryId, assetId: bundle.identity.siteBoundaryAssetId } }
      const manifest = await this.validate(stagingRoot, {
        manifestId,
        packageId,
        projectId,
        sourceRevision: revision,
        recommendationId: bundle.identity.recommendationId,
        adoptedAssetIds,
        ...(bundle.identity.siteBoundaryIntegrityDigest === undefined ? {} : { siteBoundaryIntegrityDigest: bundle.identity.siteBoundaryIntegrityDigest }),
        createdAt,
      }, sensitiveBoundary, bundle)
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
