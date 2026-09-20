import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GovernanceRepository } from '../governance/repository.ts'
import type { ArtifactManifestRecord, ArtifactRecord, ReportPackageRecord } from '../governance/types.ts'
import { createConditionalReportBundle, planConditionalPages, type ConditionalReportMaterial } from './conditional-report.ts'
import { CLIENT_COMPOSITION_VERSION } from '../presentation/projector/client-outline.ts'
import type { ClientRenderContext } from './client-types.ts'
import type { FrozenProjectInput } from './types.ts'
import { renderConditionalHtml } from './conditional-render-html.ts'
import { renderPrintHtml } from './render-print-html.ts'
import { renderPptx } from './render-pptx.ts'
import { renderPdf } from './render-pdf.ts'
import { assertConditionalArtifactIntegrity, normalizeConditionalArtifactFormats, validateAndHashConditionalArtifacts } from './validate-artifacts.ts'
import { validateCaseStudies } from './case-studies/index.ts'

export interface ConditionalReportOptions {
  readonly governance: Pick<GovernanceRepository, 'readProject' | 'putReportPackage'>
  readonly source: (projectId: string, revision: number) => Promise<FrozenProjectInput>
  readonly materials?: (input: FrozenProjectInput) => Promise<readonly ConditionalReportMaterial[]>
  readonly currentRevision: (projectId: string) => number
  readonly isComplete: (projectId: string) => boolean
  readonly requireManuscript?: boolean
  readonly requireCaseStudies?: boolean
  /** Requested outputs; omitted means HTML only. Order and duplicate entries are normalized. */
  readonly formats?: readonly ArtifactRecord['format'][]
  readonly packageRoot: string
  readonly browserExecutable: string
  readonly createId?: () => string
  readonly now?: () => string
  readonly renderers?: {
    html(context: ClientRenderContext, root: string): Promise<unknown>
    printHtml(context: ClientRenderContext, root: string): Promise<string>
    pptx(context: ClientRenderContext, path: string): Promise<unknown>
    pdf(html: string, path: string, browser: string): Promise<unknown>
  }
  readonly validate?: typeof validateAndHashConditionalArtifacts
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(value) || value === '.' || value === '..') throw new Error('REPORT_ID_INVALID')
  return value
}

function hasFormats(manifest: ArtifactManifestRecord, formats: readonly ArtifactRecord['format'][]): boolean {
  return manifest.artifacts.length === formats.length
    && formats.every(format => manifest.artifacts.some(artifact => artifact.format === format))
}

export class ConditionalReportPackageService {
  private readonly running = new Map<string, { promise: Promise<ArtifactManifestRecord>; signal?: AbortSignal }>()
  private readonly renderers: NonNullable<ConditionalReportOptions['renderers']>
  private readonly validate: typeof validateAndHashConditionalArtifacts
  private readonly formats: readonly ArtifactRecord['format'][]
  constructor(private readonly options: ConditionalReportOptions) {
    this.formats = normalizeConditionalArtifactFormats(options.formats)
    this.renderers = options.renderers ?? { html: renderConditionalHtml, printHtml: renderPrintHtml, pptx: renderPptx, pdf: renderPdf }
    this.validate = options.validate ?? validateAndHashConditionalArtifacts
  }

  generate(projectId: string, revision: number, signal?: AbortSignal): Promise<ArtifactManifestRecord> {
    if (signal?.aborted) return Promise.reject(signal.reason)
    const key = `${safeId(projectId)}:${revision}:conditional`
    const pending = this.running.get(key)
    if (pending !== undefined) {
      // A resumed coordinator must wait for the cancelled renderers and cleanup,
      // then start a fresh generation instead of inheriting their rejection.
      if (pending.signal?.aborted) return pending.promise.catch(() => undefined)
        .then(() => this.generate(projectId, revision, signal))
      return pending.promise
    }
    const operation = this.generateOnce(projectId, revision, signal).finally(() => {
      if (this.running.get(key)?.promise === operation) this.running.delete(key)
    })
    this.running.set(key, { promise: operation, signal })
    return operation
  }

  private assertCurrent(projectId: string, revision: number, signal?: AbortSignal): void {
    signal?.throwIfAborted()
    if (!Number.isInteger(revision) || this.options.currentRevision(projectId) !== revision) throw new Error('REPORT_REVISION_CHANGED: 成果版本已变化，请按当前版本重新生成。')
    const governed = this.options.governance.readProject(projectId)
    if (governed.workflowRevisions?.some(row => row.status === 'pending')
      || governed.workflowRuns.some(run => run.revisionRequest !== undefined && !['confirmed', 'not_applicable'].includes(run.status))) {
      throw new Error('WORKFLOW_REVISION_INCOMPLETE: 修订尚未完成，不可生成旧成果。')
    }
    if (!this.options.isComplete(projectId)) throw new Error('REPORT_WORKFLOWS_INCOMPLETE: 策划流程尚未全部完成。')
  }

  private async generateOnce(projectId: string, revision: number, signal?: AbortSignal): Promise<ArtifactManifestRecord> {
    this.assertCurrent(projectId, revision, signal)
    const input = await this.options.source(projectId, revision)
    if (input.projectId !== projectId || input.revision !== revision) throw new Error('REPORT_SOURCE_MISMATCH')
    if (this.options.requireManuscript && !input.manuscript) throw new Error('REPORT_MANUSCRIPT_REQUIRED: 请先完成汇报文案编写，再生成汇报成果。')
    if (this.options.requireCaseStudies && !input.caseStudies) throw new Error('REPORT_CASE_STUDIES_REQUIRED: 汇报需包含3至5个有来源的真实落地案例。')
    if (input.caseStudies) validateCaseStudies(input.caseStudies, input)
    const bundle = createConditionalReportBundle(input, await this.options.materials?.(input) ?? [])
    const fingerprint = createHash('sha256').update(JSON.stringify({ version: CLIENT_COMPOSITION_VERSION, formats: this.formats,
      report: bundle.report, details: input.stateObjects })).digest('hex')
    this.assertCurrent(projectId, revision, signal)
    const previousPackages = this.options.governance.readProject(projectId).reportPackages
      .filter(row => row.status === 'generated_conditional' && row.sourceRevision === revision)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    for (const previous of previousPackages) {
      try {
        const root = join(this.options.packageRoot, safeId(previous.packageId))
        const manifest = JSON.parse(await readFile(join(root, 'artifact-manifest.json'), 'utf8')) as ArtifactManifestRecord
        if (manifest.deliveryMode !== 'conditional' || manifest.publishable !== false || manifest.packageId !== previous.packageId
          || manifest.manifestId !== previous.artifactManifestId || manifest.projectId !== projectId || manifest.sourceRevision !== revision) throw new Error('REPORT_MANIFEST_MISMATCH')
        const generation = await readFile(join(root, 'generation.json'), 'utf8')
          .then(text => JSON.parse(text) as { version?: string; fingerprint?: string }).catch(() => undefined)
        if (generation?.version !== CLIENT_COMPOSITION_VERSION || generation.fingerprint !== fingerprint || !hasFormats(manifest, this.formats)) {
          // Obsolete composition/cache metadata does not invalidate healthy artifacts.
          await assertConditionalArtifactIntegrity(root, manifest)
          continue
        }
        const actual = await this.validate(root, manifest, bundle, this.formats)
        if (!hasFormats(actual, this.formats) || actual.artifacts.some(artifact => !manifest.artifacts.some(expected =>
          expected.format === artifact.format && expected.fileName === artifact.fileName && expected.sha256 === artifact.sha256 && expected.bytes === artifact.bytes))) throw new Error('REPORT_ARTIFACT_CHANGED')
        this.assertCurrent(projectId, revision, signal)
        return manifest
      } catch (error) {
        this.assertCurrent(projectId, revision, signal)
        await this.options.governance.putReportPackage({ ...previous, status: 'failed', warnings: ['既有成果文件缺失或校验失败，重新生成。'] })
      }
    }
    this.assertCurrent(projectId, revision, signal)
    const packageId = safeId(this.options.createId?.() ?? `conditional-${randomUUID()}`)
    const createdAt = this.options.now?.() ?? new Date().toISOString()
    const record: ReportPackageRecord = { packageId, projectId, sourceRevision: revision, status: 'staging',
      sectionIds: bundle.report.chapters.map(row => row.id), adoptedAssetIds: [...bundle.identity.adoptedAssetIds], warnings: [], createdAt }
    await this.options.governance.putReportPackage(record)
    let staging: string | undefined
    let published = false
    const output = join(this.options.packageRoot, packageId)
    try {
      await mkdir(this.options.packageRoot, { recursive: true })
      staging = await mkdtemp(join(this.options.packageRoot, `.staging-${packageId}-`))
      const physicalPlan = planConditionalPages(bundle, 'html')
      const context = (medium: 'html' | 'pptx' | 'pdf'): ClientRenderContext => ({ report: bundle.report, identity: bundle.identity, plan: { ...physicalPlan, medium } })
      if (this.formats.includes('html')) await this.renderers.html(context('html'), staging)
      const print = this.formats.includes('pdf') ? await this.renderers.printHtml(context('pdf'), staging) : undefined
      this.assertCurrent(projectId, revision, signal)
      const rendered = await Promise.allSettled(this.formats.filter(format => format !== 'html').map(async format =>
        format === 'pptx'
          ? this.renderers.pptx(context('pptx'), join(staging!, 'report.pptx'))
          : this.renderers.pdf(print!, join(staging!, 'report.pdf'), this.options.browserExecutable)))
      const failed = rendered.find((row): row is PromiseRejectedResult => row.status === 'rejected')
      if (failed) throw failed.reason
      this.assertCurrent(projectId, revision, signal)
      const manifest = await this.validate(staging, { manifestId: `manifest-${packageId}`, packageId, projectId,
        sourceRevision: revision, createdAt, recommendationId: bundle.identity.recommendationId, adoptedAssetIds: [...bundle.identity.adoptedAssetIds] }, bundle, this.formats)
      if (manifest.deliveryMode !== 'conditional' || manifest.publishable !== false || manifest.packageId !== packageId
        || manifest.projectId !== projectId || manifest.sourceRevision !== revision) throw new Error('REPORT_MANIFEST_MISMATCH')
      if (!hasFormats(manifest, this.formats)) throw new Error('REPORT_ARTIFACT_FORMATS_MISMATCH')
      await writeFile(join(staging, 'artifact-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
      await writeFile(join(staging, 'generation.json'), JSON.stringify({ version: CLIENT_COMPOSITION_VERSION, formats: this.formats, fingerprint }) + '\n')
      this.assertCurrent(projectId, revision, signal)
      await rename(staging, output)
      published = true
      this.assertCurrent(projectId, revision, signal)
      await this.options.governance.putReportPackage({ ...record, status: 'generated_conditional',
        artifactManifestId: manifest.manifestId, generatedAt: this.options.now?.() ?? new Date().toISOString(),
        warnings: ['条件式策划成果；不作为法定边界或正式审核结论。'] })
      return manifest
    } catch (error) {
      if (published || staging !== undefined) await rm(published ? output : staging!, { recursive: true, force: true })
      await this.options.governance.putReportPackage({ ...record, status: 'failed', warnings: ['报告生成未完成；可通过继续流程或导出命令重试。'] })
      throw error
    }
  }
}
