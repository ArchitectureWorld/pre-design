import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArtifactManifestRecord, ArtifactRecord } from '../governance/types.ts'
import {
  assertPublishableClientReportBundle,
  isAuthenticClientResearchPreviewBundle,
} from './client-projection.ts'
import type {
  ArtifactIdentity,
  ClientResearchPreviewBundle,
  ClientReportBundle,
} from './client-types.ts'
import { inspectPptxArtifact } from './inspect-pptx.ts'
import { assertConditionalBundle, type ConditionalReportBundle } from './conditional-report.ts'
import { MATERIAL_EXPLANATION } from './manuscript/client-copy.ts'

const FORBIDDEN_VISIBLE = /\b(?:Gate|Workflow|Revision|SHA(?:-?256)?|attachment\s*ID|asset\s*ID|boundary\s*ID)\b|附件\s*ID|内部资产\s*ID|边界\s*ID|确认日志|工作项|完成度|artifact-manifest|[A-Z]:[\\/]/iu

export interface ArtifactManifestIdentity {
  readonly manifestId: string
  readonly packageId: string
  readonly projectId: string
  readonly sourceRevision: number
  readonly createdAt: string
  readonly recommendationId?: string
  readonly adoptedAssetIds?: readonly string[]
  readonly siteBoundaryIntegrityDigest?: string
}

export interface ArtifactValidationSensitiveValues {
  readonly siteBoundary?: Readonly<{ readonly boundaryId: string; readonly assetId: string }>
}

export interface ResearchPreviewEvidenceIdentity {
  readonly projectId: string
  readonly sourceRevision: number
  readonly createdAt: string
}

export interface ResearchPreviewEvidence {
  readonly kind: 'research_preview_evidence'
  readonly publishable: false
  readonly projectId: string
  readonly sourceRevision: number
  readonly createdAt: string
  readonly recommendationId: string
  readonly adoptedAssetIds: readonly string[]
  readonly researchBoundary: ClientResearchPreviewBundle['researchBoundary']
  readonly artifacts: readonly ArtifactRecord[]
}

function requiredMeta(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const pattern = new RegExp(`<meta\\s+[^>]*name=["']${escaped}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'iu')
  const reverse = new RegExp(`<meta\\s+[^>]*content=["']([^"']*)["'][^>]*name=["']${escaped}["'][^>]*>`, 'iu')
  const value = html.match(pattern)?.[1] ?? html.match(reverse)?.[1]
  if (value === undefined) throw new Error(`HTML artifact identity meta ${name} is missing`)
  return value
}

export function readHtmlArtifactIdentity(html: string): ArtifactIdentity {
  const sourceRevision = Number(requiredMeta(html, 'preplan-source-revision'))
  if (!Number.isInteger(sourceRevision) || sourceRevision < 0) {
    throw new Error('HTML artifact source revision identity is invalid')
  }
  const boundary = html.match(/<meta\s+[^>]*name=["']preplan-site-boundary-digest["'][^>]*content=["']([^"']*)["'][^>]*>/iu)?.[1]
  return {
    projectId: requiredMeta(html, 'preplan-project-id'),
    sourceRevision,
    recommendationId: requiredMeta(html, 'preplan-recommendation-id'),
    adoptedAssetIds: requiredMeta(html, 'preplan-adopted-assets').split(',').filter(Boolean).sort(),
    ...(boundary === undefined ? {} : { siteBoundaryIntegrityDigest: boundary }),
  }
}

function visibleHtmlText(html: string): string {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/iu)?.[1] ?? ''
  return body.replace(/<script\b[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;|&#160;/gu, ' ')
    .replace(/&amp;/gu, '&')
}

function assertVisiblePolicy(
  label: string,
  text: string,
  sensitive?: ArtifactValidationSensitiveValues,
): void {
  const match = text.match(FORBIDDEN_VISIBLE)
  if (match !== null) throw new Error(`${label} contains forbidden client-visible term ${match[0]}`)
  const governedIds = sensitive?.siteBoundary === undefined
    ? []
    : [sensitive.siteBoundary.boundaryId, sensitive.siteBoundary.assetId]
  if (governedIds.some(value => value.trim() !== '' && text.includes(value))) {
    throw new Error(`${label} contains forbidden client-visible term governed boundary identity`)
  }
}

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort()
}

function assertIdentity(
  label: string,
  actual: ArtifactIdentity,
  expected: ArtifactManifestIdentity,
): void {
  if (actual.projectId !== expected.projectId) throw new Error(`${label} project identity does not match`)
  if (actual.sourceRevision !== expected.sourceRevision) throw new Error(`${label} revision identity does not match`)
  if (expected.recommendationId !== undefined && actual.recommendationId !== expected.recommendationId) {
    throw new Error(`${label} recommendation identity does not match`)
  }
  if (expected.adoptedAssetIds !== undefined
    && JSON.stringify(sorted(actual.adoptedAssetIds)) !== JSON.stringify(sorted(expected.adoptedAssetIds))) {
    throw new Error(`${label} adopted asset identity does not match`)
  }
  if (expected.siteBoundaryIntegrityDigest !== undefined && actual.siteBoundaryIntegrityDigest !== expected.siteBoundaryIntegrityDigest) {
    throw new Error(`${label} site boundary identity does not match`)
  }
}

function readPdfIdentity(content: Buffer): ArtifactIdentity | undefined {
  const encoded = content.toString('latin1').split('%PREPLAN-METADATA:').at(-1)?.split(/\r?\n/u)[0]?.trim()
  if (encoded === undefined || encoded === '') return undefined
  const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<ArtifactIdentity>
  if (typeof parsed.projectId !== 'string' || typeof parsed.sourceRevision !== 'number'
    || typeof parsed.recommendationId !== 'string' || !Array.isArray(parsed.adoptedAssetIds)) return undefined
  return {
    projectId: parsed.projectId,
    sourceRevision: parsed.sourceRevision,
    recommendationId: parsed.recommendationId,
    adoptedAssetIds: parsed.adoptedAssetIds.filter((value): value is string => typeof value === 'string').sort(),
    ...(typeof parsed.siteBoundaryIntegrityDigest === 'string' ? { siteBoundaryIntegrityDigest: parsed.siteBoundaryIntegrityDigest } : {}),
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function artifact(
  stagingRoot: string,
  format: ArtifactRecord['format'],
  fileName: string,
  signature?: Buffer,
): Promise<ArtifactRecord> {
  const bytes = await readFile(join(stagingRoot, ...fileName.split('/')))
  if (bytes.length === 0) throw new Error(`${format} artifact is empty`)
  if (signature !== undefined && !bytes.subarray(0, signature.length).equals(signature)) {
    throw new Error(`${format} artifact has an invalid file signature`)
  }
  return {
    format,
    fileName,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

async function validateArtifactFiles(
  stagingRoot: string,
  identity: ArtifactManifestIdentity,
  sensitive?: ArtifactValidationSensitiveValues,
  formats: readonly ArtifactRecord['format'][] = ['html', 'pptx', 'pdf'],
): Promise<readonly ArtifactRecord[]> {
  if (!Number.isInteger(identity.sourceRevision) || identity.sourceRevision < 0) {
    throw new Error('report source revision must be a non-negative integer')
  }
  const htmlText = formats.includes('html')
    ? await readFile(join(stagingRoot, 'html', 'index.html'), 'utf8')
    : undefined
  const isClientReport = htmlText === undefined || htmlText.includes('preplan-project-id')
  if (isClientReport) {
    if (htmlText !== undefined) {
      assertIdentity('HTML artifact', readHtmlArtifactIdentity(htmlText), identity)
      assertVisiblePolicy('HTML artifact', visibleHtmlText(htmlText), sensitive)
    }
    if (formats.includes('pdf')) {
      const printPath = join(stagingRoot, 'print', 'index.html')
      if (!await exists(printPath)) throw new Error('print HTML artifact is missing')
      const printHtml = await readFile(printPath, 'utf8')
      assertIdentity('print HTML artifact', readHtmlArtifactIdentity(printHtml), identity)
      assertVisiblePolicy('print HTML artifact', visibleHtmlText(printHtml), sensitive)

      const pdfContent = await readFile(join(stagingRoot, 'report.pdf'))
      const pdfIdentity = readPdfIdentity(pdfContent)
      if (pdfIdentity === undefined) throw new Error('PDF artifact identity is missing')
      assertIdentity('PDF artifact', pdfIdentity, identity)
    }

    if (formats.includes('pptx')) {
      const pptx = await inspectPptxArtifact(join(stagingRoot, 'report.pptx'))
      if (pptx.identity === undefined) throw new Error('PPTX artifact identity is missing')
      assertIdentity('PPTX artifact', pptx.identity, identity)
      assertVisiblePolicy('PPTX artifact', pptx.visibleText, sensitive)
    }
  } else {
    const revision = htmlText?.match(/data-report-revision=["'](\d+)["']/u)?.[1]
    if (revision !== String(identity.sourceRevision)) {
      throw new Error(`HTML report revision ${revision ?? 'missing'} does not match frozen revision ${identity.sourceRevision}`)
    }
  }

  const artifactInputs: Readonly<Record<ArtifactRecord['format'], readonly [string, Buffer?]>> = {
    html: ['html/index.html'],
    pptx: ['report.pptx', Buffer.from('PK')],
    pdf: ['report.pdf', Buffer.from('%PDF-')],
  }
  return Promise.all(formats.map(format => artifact(stagingRoot, format, ...artifactInputs[format])))
}

export async function validateAndHashReportArtifacts(
  stagingRoot: string,
  identity: ArtifactManifestIdentity,
  sensitive: ArtifactValidationSensitiveValues | undefined,
  bundle: ClientReportBundle,
): Promise<ArtifactManifestRecord> {
  assertPublishableClientReportBundle(bundle)
  const artifacts = await validateArtifactFiles(stagingRoot, identity, sensitive)
  return {
    ...identity,
    ...(identity.adoptedAssetIds === undefined ? {} : { adoptedAssetIds: [...identity.adoptedAssetIds] }),
    ...(identity.siteBoundaryIntegrityDigest === undefined ? {} : { siteBoundaryIntegrityDigest: identity.siteBoundaryIntegrityDigest }),
    artifacts,
  }
}

export function normalizeConditionalArtifactFormats(
  formats: readonly ArtifactRecord['format'][] = ['html'],
): readonly ArtifactRecord['format'][] {
  const supported: readonly ArtifactRecord['format'][] = ['html', 'pptx', 'pdf']
  if (!Array.isArray(formats) || formats.length === 0 || formats.some(format => !supported.includes(format))) {
    throw new Error('REPORT_FORMATS_INVALID')
  }
  return supported.filter(format => formats.includes(format))
}

/** Check a stored package against its own identity, without applying a new composition's content rules. */
export async function assertConditionalArtifactIntegrity(
  root: string,
  manifest: ArtifactManifestRecord,
): Promise<void> {
  const formats = normalizeConditionalArtifactFormats(manifest.artifacts.map(artifact => artifact.format))
  const actual = await validateArtifactFiles(root, manifest, undefined, formats)
  if (manifest.artifacts.length !== actual.length || actual.some(artifact => !manifest.artifacts.some(expected =>
    expected.format === artifact.format && expected.fileName === artifact.fileName
    && expected.sha256 === artifact.sha256 && expected.bytes === artifact.bytes))) {
    throw new Error('REPORT_ARTIFACT_CHANGED')
  }
}

export async function validateAndHashConditionalArtifacts(
  stagingRoot: string,
  identity: ArtifactManifestIdentity,
  bundle: ConditionalReportBundle,
  requestedFormats: readonly ArtifactRecord['format'][] = ['html'],
): Promise<ArtifactManifestRecord> {
  assertConditionalBundle(bundle)
  assertIdentity('conditional bundle', bundle.identity, identity)
  const formats = normalizeConditionalArtifactFormats(requestedFormats)
  const artifacts = await validateArtifactFiles(stagingRoot, identity, undefined, formats)
  const visibleTexts: string[] = []
  if (formats.includes('html')) visibleTexts.push(visibleHtmlText(await readFile(join(stagingRoot, 'html', 'index.html'), 'utf8')))
  if (formats.includes('pdf')) visibleTexts.push(visibleHtmlText(await readFile(join(stagingRoot, 'print', 'index.html'), 'utf8')))
  if (formats.includes('pptx')) visibleTexts.push((await inspectPptxArtifact(join(stagingRoot, 'report.pptx'))).visibleText)
  const authored = bundle.report.chapters.some(chapter => chapter.blocks.some(block => block.type === 'planning-page'))
  for (const text of visibleTexts) {
    if (!authored && !text.replace(/\s+/gu, '').includes('条件式策划成果')) throw new Error('CONDITIONAL_REPORT_DISCLOSURE_MISSING')
    if (authored && MATERIAL_EXPLANATION.test(text.replace(/\s+/gu, ''))) throw new Error('CLIENT_MATERIAL_EXPLANATION_FORBIDDEN')
  }
  return { ...identity, deliveryMode: 'conditional', publishable: false, artifacts }
}

export async function validateAndHashResearchPreviewArtifacts(
  stagingRoot: string,
  identity: ResearchPreviewEvidenceIdentity,
  bundle: ClientResearchPreviewBundle,
  formats: readonly ArtifactRecord['format'][] = ['html'],
): Promise<ResearchPreviewEvidence> {
  if (!isAuthenticClientResearchPreviewBundle(bundle)) {
    throw new Error('SITE_BOUNDARY_RESEARCH_PREVIEW_CONFLICT：研究预览证据必须来自受控 preview projection。')
  }
  if (identity.projectId !== bundle.identity.projectId || identity.sourceRevision !== bundle.identity.sourceRevision) {
    throw new Error('SITE_BOUNDARY_RESEARCH_PREVIEW_CONFLICT：研究预览证据与冻结项目身份不一致。')
  }
  const expected: ArtifactManifestIdentity = {
    manifestId: 'research-preview-evidence',
    packageId: 'research-preview-evidence',
    ...identity,
    recommendationId: bundle.identity.recommendationId,
    adoptedAssetIds: bundle.identity.adoptedAssetIds,
  }
  const artifacts = await validateArtifactFiles(stagingRoot, expected, undefined, formats)
  return {
    kind: 'research_preview_evidence',
    publishable: false,
    ...identity,
    recommendationId: bundle.identity.recommendationId,
    adoptedAssetIds: [...bundle.identity.adoptedAssetIds],
    researchBoundary: { ...bundle.researchBoundary },
    artifacts,
  }
}
