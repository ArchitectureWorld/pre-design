import { access, readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ArtifactManifestRecord, ArtifactRecord } from '../src/governance/types.ts'
import type { ArtifactIdentity } from '../src/report/client-types.ts'
import { inspectPptxArtifact } from '../src/report/inspect-pptx.ts'
import { readHtmlArtifactIdentity } from '../src/report/validate-artifacts.ts'

const FORBIDDEN = /\b(?:Gate|Workflow|Revision|SHA(?:-?256)?|attachment\s*ID|asset\s*ID|boundary\s*ID)\b|附件\s*ID|内部资产\s*ID|边界\s*ID|确认日志|工作项|完成度|artifact-manifest|[A-Z]:[\\/]/giu

function visibleHtml(html: string): string {
  return (html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/iu)?.[1] ?? '')
    .replace(/<script\b[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&amp;/gu, '&')
}

function count(value: string, needle: string): number {
  return needle === '' ? 0 : value.split(needle).length - 1
}

function countSemanticOccurrences(value: string, needle: string): number {
  return count(value.replace(/\s+/gu, ''), needle.replace(/\s+/gu, ''))
}

function pdfIdentity(buffer: Buffer): ArtifactIdentity {
  const encoded = buffer.toString('latin1').split('%PREPLAN-METADATA:').at(-1)?.split(/\r?\n/u)[0]?.trim()
  if (encoded === undefined || encoded === '') throw new Error('PDF artifact identity is missing')
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ArtifactIdentity
}

function sameIdentity(left: ArtifactIdentity, right: ArtifactIdentity): boolean {
  return left.projectId === right.projectId
    && left.sourceRevision === right.sourceRevision
    && left.recommendationId === right.recommendationId
    && JSON.stringify([...left.adoptedAssetIds].sort()) === JSON.stringify([...right.adoptedAssetIds].sort())
    && left.siteBoundaryIntegrityDigest === right.siteBoundaryIntegrityDigest
}

async function assetExists(root: string, assetId: string): Promise<boolean> {
  for (const extension of ['.jpg', '.jpeg', '.png', '.webp', '.svg']) {
    try {
      await access(join(root, `${assetId}${extension}`))
      return true
    } catch {
      // Try the next supported extension.
    }
  }
  return false
}

export interface ClientArtifactInspection {
  readonly identitiesEqual: boolean
  readonly coreValue: string
  readonly coreValueOccurrences: Readonly<{ html: number; pptx: number; pdfSource: number }>
  readonly missingAssetIds: readonly string[]
  readonly forbiddenTermHits: readonly string[]
  readonly htmlPages: number
  readonly pptxPages: number
  readonly pdfSourcePages: number
  readonly professionalVisualPages: Readonly<{ html: number; pptx: number; pdfSource: number }>
}

export async function inspectClientArtifacts(
  outputRoot: string,
  options: { readonly evidencePath?: string } = {},
): Promise<ClientArtifactInspection> {
  const [html, manifest] = await Promise.all([
    readFile(join(outputRoot, 'html', 'index.html'), 'utf8'),
    readFile(join(outputRoot, options.evidencePath ?? 'artifact-manifest.json'), 'utf8').then(value => JSON.parse(value) as ArtifactManifestRecord),
  ])
  const formats = new Set((manifest.artifacts ?? []).map(artifact => artifact.format) as ArtifactRecord['format'][])
  if (!formats.has('html')) throw new Error('HTML artifact evidence is missing')
  const [printHtml, pptx, pdf] = await Promise.all([
    formats.has('pdf') ? readFile(join(outputRoot, 'print', 'index.html'), 'utf8') : undefined,
    formats.has('pptx') ? inspectPptxArtifact(join(outputRoot, 'report.pptx')) : undefined,
    formats.has('pdf') ? readFile(join(outputRoot, 'report.pdf')) : undefined,
  ])
  if (pptx !== undefined && pptx.identity === undefined) throw new Error('PPTX artifact identity is missing')
  const htmlIdentity = readHtmlArtifactIdentity(html)
  const identities = [
    htmlIdentity,
    ...(printHtml === undefined ? [] : [readHtmlArtifactIdentity(printHtml)]),
    ...(pptx?.identity === undefined ? [] : [pptx.identity]),
    ...(pdf === undefined ? [] : [pdfIdentity(pdf)]),
  ]
  const openingValue = html.match(/id="opening-value"[\s\S]*?<p class="claim-focus">([\s\S]*?)<\/p>/u)?.[1]
    ?.replace(/<[^>]+>/gu, '').trim()
  if (openingValue === undefined || openingValue === '') throw new Error('client core value is missing')
  const adopted = [...(manifest.adoptedAssetIds ?? [])]
  const htmlAssets = await Promise.all(adopted.map(id => assetExists(join(outputRoot, 'html', 'assets', 'images'), id)))
  const printAssets = printHtml === undefined
    ? []
    : await Promise.all(adopted.map(id => assetExists(join(outputRoot, 'print', 'assets', 'images'), id)))
  const missingAssetIds = adopted.filter((_, index) => !htmlAssets[index] || (printHtml !== undefined && !printAssets[index]))
  if (pptx !== undefined && pptx.mediaNames.length < adopted.length) {
    missingAssetIds.push(...adopted.slice(pptx.mediaNames.length))
  }
  const visible = {
    html: visibleHtml(html),
    pptx: pptx?.visibleText ?? '',
    pdfSource: printHtml === undefined ? '' : visibleHtml(printHtml),
  }
  const forbiddenTermHits = Object.entries(visible).flatMap(([format, value]) =>
    [...value.matchAll(FORBIDDEN)].map(match => `${format}:${match[0]}`))
  return {
    identitiesEqual: identities.every(identity => sameIdentity(identity, htmlIdentity)),
    coreValue: openingValue,
    coreValueOccurrences: {
      html: countSemanticOccurrences(visible.html, openingValue),
      pptx: countSemanticOccurrences(visible.pptx, openingValue),
      pdfSource: countSemanticOccurrences(visible.pdfSource, openingValue),
    },
    missingAssetIds: [...new Set(missingAssetIds)],
    forbiddenTermHits,
    htmlPages: html.match(/class="report-page /gu)?.length ?? 0,
    pptxPages: pptx?.slideCount ?? 0,
    pdfSourcePages: printHtml?.match(/class="print-page/gu)?.length ?? 0,
    professionalVisualPages: {
      html: html.match(/data-page-kind="visual-evidence"/gu)?.length ?? 0,
      pptx: pptx?.notesText.match(/\[PageKind\]visual-evidence/gu)?.length ?? 0,
      pdfSource: printHtml?.match(/data-page-kind="visual-evidence"/gu)?.length ?? 0,
    },
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? '.')
  inspectClientArtifacts(root).then(result => {
    process.stdout.write(`${JSON.stringify({ outputRoot: root, name: basename(root), ...result }, null, 2)}\n`)
  }).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    process.exitCode = 1
  })
}
