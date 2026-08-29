import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArtifactManifestRecord, ArtifactRecord } from '../governance/types.ts'
import type { ArtifactIdentity } from './client-types.ts'
import { inspectPptxArtifact } from './inspect-pptx.ts'

const FORBIDDEN_VISIBLE = /\b(?:Gate|Workflow|Revision)\b|工作项|完成度|artifact-manifest|[A-Z]:[\\/]/iu

export interface ArtifactManifestIdentity {
  readonly manifestId: string
  readonly packageId: string
  readonly projectId: string
  readonly sourceRevision: number
  readonly createdAt: string
  readonly recommendationId?: string
  readonly adoptedAssetIds?: readonly string[]
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
  return {
    projectId: requiredMeta(html, 'preplan-project-id'),
    sourceRevision,
    recommendationId: requiredMeta(html, 'preplan-recommendation-id'),
    adoptedAssetIds: requiredMeta(html, 'preplan-adopted-assets').split(',').filter(Boolean).sort(),
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

function assertVisiblePolicy(label: string, text: string): void {
  const match = text.match(FORBIDDEN_VISIBLE)
  if (match !== null) throw new Error(`${label} contains forbidden client-visible term ${match[0]}`)
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

export async function validateAndHashReportArtifacts(
  stagingRoot: string,
  identity: ArtifactManifestIdentity,
): Promise<ArtifactManifestRecord> {
  if (!Number.isInteger(identity.sourceRevision) || identity.sourceRevision < 0) {
    throw new Error('report source revision must be a non-negative integer')
  }
  const htmlPath = join(stagingRoot, 'html', 'index.html')
  const htmlText = await readFile(htmlPath, 'utf8')
  const isClientReport = htmlText.includes('preplan-project-id')
  if (isClientReport) {
    assertIdentity('HTML artifact', readHtmlArtifactIdentity(htmlText), identity)
    assertVisiblePolicy('HTML artifact', visibleHtmlText(htmlText))
    const printPath = join(stagingRoot, 'print', 'index.html')
    if (!await exists(printPath)) throw new Error('print HTML artifact is missing')
    const printHtml = await readFile(printPath, 'utf8')
    assertIdentity('print HTML artifact', readHtmlArtifactIdentity(printHtml), identity)
    assertVisiblePolicy('print HTML artifact', visibleHtmlText(printHtml))

    const pptx = await inspectPptxArtifact(join(stagingRoot, 'report.pptx'))
    if (pptx.identity === undefined) throw new Error('PPTX artifact identity is missing')
    assertIdentity('PPTX artifact', pptx.identity, identity)
    assertVisiblePolicy('PPTX artifact', pptx.visibleText)

    const pdfContent = await readFile(join(stagingRoot, 'report.pdf'))
    const pdfIdentity = readPdfIdentity(pdfContent)
    if (pdfIdentity === undefined) throw new Error('PDF artifact identity is missing')
    assertIdentity('PDF artifact', pdfIdentity, identity)
  } else {
    const revision = htmlText.match(/data-report-revision=["'](\d+)["']/u)?.[1]
    if (revision !== String(identity.sourceRevision)) {
      throw new Error(`HTML report revision ${revision ?? 'missing'} does not match frozen revision ${identity.sourceRevision}`)
    }
  }

  const artifacts = await Promise.all([
    artifact(stagingRoot, 'html', 'html/index.html'),
    artifact(stagingRoot, 'pptx', 'report.pptx', Buffer.from('PK')),
    artifact(stagingRoot, 'pdf', 'report.pdf', Buffer.from('%PDF-')),
  ])
  return {
    ...identity,
    ...(identity.adoptedAssetIds === undefined ? {} : { adoptedAssetIds: [...identity.adoptedAssetIds] }),
    artifacts,
  }
}
