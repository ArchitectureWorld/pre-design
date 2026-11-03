import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
import { freeze } from './graph.ts'
import type { PlanningCatalog } from './types.ts'

/** No project is mutated. The old source must remain addressable at its original revision. */
export function planLegacyEvidence(catalog: PlanningCatalog, oldObjects: readonly unknown[]) {
  sha256CanonicalJson(oldObjects)
  const seen = new Set<string>()
  const references = oldObjects.flatMap(value => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('LEGACY_INVALID')
    const obj = value as Record<string,unknown>, id = obj.object_id
    if (typeof id !== 'string' || typeof obj.schema_version !== 'string' || !obj.schema_version.trim()
      || !Number.isSafeInteger(obj.revision) || Number(obj.revision) < 1 || !Object.hasOwn(obj,'data') || obj.data === null || typeof obj.data !== 'object' || Array.isArray(obj.data)) throw new Error('LEGACY_INVALID')
    if (obj.schema_version !== '0.6.0') throw new Error('LEGACY_SCHEMA_UNSUPPORTED')
    if (seen.has(id)) throw new Error(`LEGACY_DUPLICATE: ${id}`)
    seen.add(id)
    const mapping = catalog.legacy.find(m => m.objectId === id)
    if (!mapping) throw new Error(`LEGACY_UNKNOWN: ${id}`)
    const sourceSha256 = sha256CanonicalJson(value)
    return mapping.targets.map(targetId => ({targetId,targetSelector:'/candidateInputs/legacyEvidenceRefs',sourceObjectId:id,
      sourceSchemaVersion:obj.schema_version as string,sourceRevision:obj.revision as number,sourceSha256,
      hashKind:'canonical-json-sha256' as const,sourceSelector:'/data',status:'unreviewed' as const,migrationMode:'reference_only' as const}))
  })
  return freeze({mode:'reference_only' as const,catalogHash:catalog.hash,references})
}
