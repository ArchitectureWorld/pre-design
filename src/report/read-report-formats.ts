import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPORT_FORMATS } from '../client/report-links.ts'
import type { ArtifactManifestRecord, ArtifactRecord, ReportPackageRecord } from '../governance/types.ts'

/** Status snapshots are synchronous; read the small manifest rather than guessing files from package status. */
export function readReportFormats(packageRoot: string, record: ReportPackageRecord): readonly ArtifactRecord['format'][] | undefined {
  if (!/^[A-Za-z0-9._-]+$/u.test(record.packageId) || record.packageId === '.' || record.packageId === '..') return undefined
  try {
    const manifest = JSON.parse(readFileSync(join(packageRoot, record.packageId, 'artifact-manifest.json'), 'utf8')) as ArtifactManifestRecord
    if (manifest.packageId !== record.packageId || manifest.projectId !== record.projectId
      || manifest.sourceRevision !== record.sourceRevision || typeof record.artifactManifestId !== 'string'
      || manifest.manifestId !== record.artifactManifestId || !Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) return undefined
    if (record.status === 'generated_conditional' && (manifest.deliveryMode !== 'conditional' || manifest.publishable !== false)) return undefined
    const formats = manifest.artifacts.map(artifact => artifact.format)
    if (formats.some(format => !REPORT_FORMATS.includes(format)) || new Set(formats).size !== formats.length) return undefined
    if (manifest.artifacts.some(artifact => artifact.fileName !== (artifact.format === 'html' ? 'html/index.html' : `report.${artifact.format}`))) return undefined
    return REPORT_FORMATS.filter(format => formats.includes(format))
  } catch {
    return undefined
  }
}
