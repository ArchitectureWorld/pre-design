import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArtifactManifestRecord, ArtifactRecord } from '../governance/types.ts'

export interface ArtifactManifestIdentity {
  readonly manifestId: string
  readonly packageId: string
  readonly projectId: string
  readonly sourceRevision: number
  readonly createdAt: string
  readonly recommendationId?: string
  readonly adoptedAssetIds?: readonly string[]
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
  const revision = htmlText.match(/data-report-revision=["'](\d+)["']/u)?.[1]
  if (revision !== String(identity.sourceRevision)) {
    throw new Error(`HTML report revision ${revision ?? 'missing'} does not match frozen revision ${identity.sourceRevision}`)
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
