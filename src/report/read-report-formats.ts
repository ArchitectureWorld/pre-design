import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { sha256CanonicalJson as hash } from '../presentation/canonical-json.ts'
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
    if(record.acceptanceState==='passed'){
      const root=realpathSync(join(packageRoot,record.packageId)),receipt=JSON.parse(readFileSync(join(root,'report-acceptance.json'),'utf8'))
      const {integrityHash,...body}=receipt
      if(!record.acceptanceHash||record.acceptanceHash!==integrityHash||manifest.acceptanceHash!==integrityHash||hash(body)!==integrityHash
        ||receipt.status!=='passed'||receipt.version!=='report-acceptance.v1'||receipt.contractVersion!==record.deliveryContractVersion
        ||manifest.deliveryContractVersion!==record.deliveryContractVersion||!Array.isArray(receipt.resources)||!receipt.resources.length)return undefined
      for(const resource of receipt.resources){
        if(typeof resource.path!=='string'||resource.path.split(/[\\/]/u).some((part:string)=>!part||part==='.'||part==='..')||isAbsolute(resource.path))return undefined
        const path=realpathSync(join(root,resource.path)),rel=relative(root,path)
        if(isAbsolute(rel)||rel.startsWith('..'))return undefined
        const bytes=readFileSync(path)
        if(bytes.length!==resource.bytes||createHash('sha256').update(bytes).digest('hex')!==resource.sha256)return undefined
      }
    }
    return REPORT_FORMATS.filter(format => formats.includes(format))
  } catch {
    return undefined
  }
}
