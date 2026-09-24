import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
import { requireModule } from './catalog.ts'
import { evaluate, freeze, normalizeFlags, topologicalWaves } from './graph.ts'
import type { PlanningCatalog, ResearchFlags, ResearchPlan, PlanningEdge, UnresolvedDependency } from './types.ts'

export function projectResearchPlan(catalog: PlanningCatalog, input: ResearchFlags): ResearchPlan {
  const flags = normalizeFlags(input), activeModuleIds: string[] = [], inactiveModuleIds: string[] = [], pendingModuleIds: string[] = []
  for (const mod of catalog.modules) {
    const state = evaluate(mod.when,flags)
    ;(state === true ? activeModuleIds : state === false ? inactiveModuleIds : pendingModuleIds).push(mod.id)
  }
  const edges: PlanningEdge[] = [], unresolved: UnresolvedDependency[] = []
  const active = new Set(activeModuleIds), blocked = new Set<string>()
  const groups = new Map<string,PlanningEdge[]>()
  for (const edge of catalog.edges.filter(e => active.has(e.target))) groups.set(edge.groupId,[...(groups.get(edge.groupId) ?? []),edge])
  for (const [groupId,choices] of groups) {
    const selected = choices.filter(e => evaluate(e.requiredWhen,flags) === true)
    const unknown = choices.some(e => evaluate(e.requiredWhen,flags) === 'unknown')
    if (unknown || selected.length !== 1 || !active.has(selected[0].source)) {
      unresolved.push({groupId,target:choices[0].target,reason:unknown ? 'condition_unknown' : 'source_unavailable'})
      blocked.add(choices[0].target)
    } else edges.push(selected[0])
  }
  let changed = true
  while (changed) { changed = false; for (const e of edges) if (blocked.has(e.source) && !blocked.has(e.target)) { blocked.add(e.target); changed=true } }
  const routable = activeModuleIds.filter(id => !blocked.has(id))
  const waves = topologicalWaves(routable,edges.filter(e => !blocked.has(e.source) && !blocked.has(e.target)))
  const core = {execution:'planning_only' as const,catalogHash:catalog.hash,flags,activeModuleIds,inactiveModuleIds,pendingModuleIds,
    edges,unresolved,blockedModuleIds:[...blocked].sort(),waves}
  return freeze({...core,hash:sha256CanonicalJson(core)})
}
function isObject(v: unknown): v is Record<string,unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v) }
function strings(v: unknown): v is string[] { return Array.isArray(v) && v.every(s => typeof s === 'string' && s.trim() !== '') }
function validDate(v: unknown): boolean { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v }

/** A readiness check is not a scientific verification or a grant of publication permission. */
export function assessResearchInputs(catalog: PlanningCatalog, plan: ResearchPlan, targetId: string,
  sourceResults: readonly unknown[], snapshotId: string, stage: 'draft'|'formal') {
  requireModule(catalog,targetId)
  const { hash: suppliedHash, ...planBody } = plan
  if (sha256CanonicalJson(planBody) !== suppliedHash || plan.catalogHash !== catalog.hash || plan.hash !== projectResearchPlan(catalog,plan.flags).hash) throw new Error('PLAN_IDENTITY_MISMATCH')
  if (!snapshotId.trim() || !['draft','formal'].includes(stage)) throw new Error('INPUT_CONTEXT_INVALID')
  sha256CanonicalJson(sourceResults)
  const issues: {edgeId:string;reason:string}[] = [], limitations: string[] = []
  if (!plan.activeModuleIds.includes(targetId) || plan.blockedModuleIds.includes(targetId)) {
    return freeze({ready:false,issues:[{edgeId:targetId,reason:'module_inactive_or_unresolved'}],limitations})
  }
  for (const e of plan.edges.filter(e => e.target === targetId)) {
    const found = sourceResults.filter(r => isObject(r) && r.moduleId === e.moduleId) as Record<string,unknown>[]
    let reason: string | undefined
    if (found.length !== 1) reason = found.length ? 'ambiguous_source_revision' : 'missing_source'
    else {
      const row = found[0], port = e.selector.slice('/outputs/'.length)
      if (row.snapshotId !== snapshotId || row.lifecycle !== 'current') reason = 'stale_or_wrong_snapshot'
      else if (!isObject(row.outputs) || !Object.hasOwn(row.outputs,port)) reason = 'missing_selected_port'
      else {
        const v = row.outputs[port]
        if (!isObject(v) || v.type !== e.type) reason = 'wrong_port_type'
        else if (typeof v.quality !== 'string' || !e.minimumState[stage].includes(v.quality)) reason = 'quality_not_allowed'
        else if (!Array.isArray(v.records) || !strings(v.claimRefs) || !v.claimRefs.length || !strings(v.limitations)
          || typeof v.scope !== 'string' || !v.scope.trim() || !validDate(v.asOf)) reason = 'port_envelope_incomplete'
        else if (v.quality === 'limited' && v.limitations.length === 0) reason = 'limited_without_limitations'
        else limitations.push(...v.limitations)
      }
    }
    if (reason) issues.push({edgeId:e.edgeId,reason})
  }
  return freeze({ready:issues.length === 0,issues,limitations:[...new Set(limitations)]})
}
export function candidateDeliverables(catalog: PlanningCatalog, itemId: string) {
  const mod = requireModule(catalog,itemId)
  return freeze([...mod.figures,mod.table])
}
