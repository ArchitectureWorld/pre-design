import type { ClaimUpstream } from './module-claims.ts'

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Report unavailable original addresses, never supply replacement claims or source values. */
export function moduleUpstreamReferenceDiagnostics(projections: readonly unknown[], upstream: readonly ClaimUpstream[], groupId?: string): string[] {
  const errors: string[] = []
  for (const projection of projections) {
    if (!object(projection) || groupId !== undefined && projection.groupId !== groupId || !Array.isArray(projection.evidence)) continue
    for (const [index, entry] of projection.evidence.entries()) {
      if (!object(entry)) continue
      const calculation = object(entry.calculation) ? entry.calculation : undefined
      for (const [path, refs] of [['inputRefs', entry.inputRefs], ['calculation/operands', calculation?.operands], ['calculation/weights', calculation?.weights]] as const) {
        if (!Array.isArray(refs)) continue
        for (const [refIndex, ref] of refs.entries()) {
          if (!object(ref) || !object(ref.upstream)) continue
          const address = ref.upstream
          if (typeof address.moduleId !== 'string' || typeof address.claimId !== 'string') continue
          const module = upstream.find(row => row.moduleId === address.moduleId), claim = module?.claims.find(row => row.claimId === address.claimId)
          if (claim && claim.kind !== 'missing') continue
          const reason = !module ? 'module is not present in the frozen upstream inputs' : !claim ? 'claimId is not present in the frozen upstream module' : 'claim is marked missing and cannot support an inference or calculation'
          errors.push(`MODULE_CLAIM_UPSTREAM_MISSING: ${typeof projection.groupId === 'string' ? `group=${projection.groupId}; ` : ''}/evidence/${index}/${path}/${refIndex}/upstream target=${JSON.stringify(address)}: ${reason}; inspect the original upstream claims and revise the owning field; do not invent claim IDs or reclassify missing evidence`)
          if (errors.length >= 12) return [...errors, 'Additional upstream references may remain invalid; omitted references are not accepted.']
        }
      }
    }
  }
  return errors
}
