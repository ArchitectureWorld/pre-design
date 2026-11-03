import { sha256CanonicalJson } from '../../presentation/canonical-json.ts'
import { getModuleFieldContracts } from '../../research-v2/module-contracts.ts'
import { getModuleAuthorFieldGroups } from '../../research-v2/module-author-groups.ts'
import { readJsonPointer } from '../../research-v2/regional-schema.ts'
import type { ModuleClaim, ModuleExecutionResult, ModuleNativeExecutionReceipt, ModuleSourceValue } from '../../research-v2/module-execution.ts'
import type { FrozenModuleResearch } from '../module-source.ts'
import {controlledResearchReady} from '../../research-v2/module-progress-review.ts'
import type { PlanningChapterId, PlanningManuscriptSource } from './types.ts'
import type { MaterialCorpusDocument } from '../../materials/research-evidence.ts'

export interface ModuleSourceLineage {
  readonly itemId: string; readonly moduleId: string; readonly bundleRunId: string; readonly resultHash: string
  readonly port: string; readonly recordId: string; readonly fieldName: string; readonly selector: string; readonly valueHash: string
  readonly claimRefs: readonly string[]; readonly claimClass: string; readonly limitations: readonly string[]
  readonly claims: readonly { readonly moduleId: string; readonly bundleRunId: string; readonly resultHash: string; readonly claim: ModuleClaim }[]
  readonly sources: readonly { readonly moduleId: string; readonly source: ModuleSourceValue; readonly provenance?: MaterialCorpusDocument['provenance'] }[]
  readonly nativeEvidence: readonly { readonly moduleId: string; readonly receipt: ModuleNativeExecutionReceipt; readonly evidence?: unknown
    readonly projectionHash?: string; readonly outputsJsonHash?: string }[]
}
const CHAPTER_MODULES: Record<PlanningChapterId, readonly string[]> = {
  opportunity: ['1.01', '1.06', '2.06', '3.01', '3.02', '3.03', '3.04', '3.05', '3.06', '3.07', '3.08', '4.02'],
  site: ['1.02', '1.03', '1.04', '1.05', '1.06', '1.07', '1.08', '2.01', '2.02', '2.03', '2.04', '2.05', '2.06'],
  positioning: ['4.01', '4.02', '4.03', '4.04', '4.05', '4.06', '4.07'],
  products: ['5.01', '5.02', '5.03', '5.04', '5.05', '5.06', '5.07', '5.08', '5.09'],
  spatial: ['6.01', '6.02', '6.03', '6.04', '6.05', '6.06', '6.07', '6.08'],
  launch: ['6.09', '7.06', '8.01', '8.05', '8.06'],
  operation: ['7.01', '7.02', '7.03', '7.04', '7.05', '7.06', '7.07', '8.02', '8.03', '8.04', '8.07', '8.08'],
}
export function moduleReportChapters(itemId: string): PlanningChapterId[] {
  return (Object.keys(CHAPTER_MODULES) as PlanningChapterId[]).filter(chapter => CHAPTER_MODULES[chapter].includes(itemId))
}
const escapePointer = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1')
const fail = (detail: string): never => { throw new Error(`REPORT_MODULE_FIELD_LINEAGE: ${detail}`) }
const unique = <T>(values: readonly T[]): T[] => [...new Map(values.map(value => [sha256CanonicalJson(value), value])).values()]
function valueText(value: unknown): string {
  if (value === null) return '未获可靠资料'
  if (Array.isArray(value)) return value.map(valueText).join('；')
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.value === 'number' && typeof record.unit === 'string') return `${record.value} ${record.unit}`
    return Object.entries(record).map(([key, entry]) => `${key}：${valueText(entry)}`).join('；')
  }
  return String(value)
}
function nativeEvidence(result: ModuleExecutionResult, port: string, recordId: string, field: string): ModuleSourceLineage['nativeEvidence'] {
  const execution = result.execution
  if (!execution) return fail(result.moduleId + ': native execution missing')
  const receipt = (value: ModuleNativeExecutionReceipt): ModuleNativeExecutionReceipt => ({ executionId: value.executionId, childId: value.childId, actualModel: value.actualModel, stopReason: value.stopReason })
  if (execution.kind === 'author-field-groups-v3') {
    // Use the same version and recorded anchors as strict audit replay. A field
    // can belong to different native authors for different record slices.
    const owner = getModuleAuthorFieldGroups(result.itemId, execution.authorGroups.version, execution.authorGroups.groups.map(group => group.raw))
      .find(group => group.port === port && group.fields.includes(field) && (!group.recordIds || group.recordIds.includes(recordId)))
    const group = execution.authorGroups.groups.find(group => group.raw.groupId === owner?.groupId)
    if (!group) return fail(`${result.itemId}/${port}/${field}: native author group missing`)
    const evidence = group.raw.evidence.filter(e => e.target.port === port && e.target.recordId === recordId && e.target.field === field)
    const binding = { moduleId: result.moduleId, receipt: receipt(group.receipt), projectionHash: group.projectionHash, outputsJsonHash: group.outputsJsonHash }
    return evidence.length ? evidence.map(evidence => ({ ...binding, evidence })) : [binding]
  }
  if (execution.kind === 'author-projection-v1' || execution.kind === 'author-projection-json-v2') return execution.authorProjection.raw.evidence
    .filter(e => e.target.port === port && e.target.recordId === recordId && e.target.field === field)
    .map(evidence => ({ moduleId: result.moduleId, receipt: receipt(execution), evidence, projectionHash: execution.authorProjection.projectionHash,
      ...(execution.authorProjection.outputsJsonHash ? { outputsJsonHash: execution.authorProjection.outputsJsonHash } : {}) }))
  return [{ moduleId: result.moduleId, receipt: receipt(execution) }]
}
export function makeModuleManuscriptSources(research: FrozenModuleResearch): readonly PlanningManuscriptSource[] {
  const controlled=controlledResearchReady({...research,selectedModuleIds:research.expectedModuleIds})
  const byModule = new Map(research.results.map(result => [result.moduleId, result]))
  const sources: PlanningManuscriptSource[] = []
  const runFor = (result: ModuleExecutionResult) => {
    const run = research.moduleRuns.find(run => run.itemId === result.itemId)
    if (!run?.bundleRunId || !run.resultHash || run.status !== 'completed'&&!(controlled&&run.status==='limited')) return fail(result.itemId + ': result run missing')
    return { bundleRunId: run.bundleRunId, resultHash: run.resultHash }
  }
  for (const result of research.results) {
    const contract = getModuleFieldContracts(result.itemId), run = runFor(result)
    for (const [portName, definition] of Object.entries(contract.ports)) {
      const port = result.outputs[portName] as { records: readonly Record<string, unknown>[]; limitations: readonly string[] } | undefined
      if (!port) continue
      for (const [recordIndex, record] of port.records.entries()) for (const field of definition.fields) {
        const wrapper = record[field.name] as { value: unknown; claimRefs: readonly string[]; claimClass: string; limitations: readonly string[] } | undefined
        if (!wrapper) return fail(`${result.itemId}/${portName}/${field.name}`)
        const recordId = String(record.recordId), selector = `/outputs/${escapePointer(portName)}/records/${recordIndex}/${escapePointer(field.name)}/value`
        if (sha256CanonicalJson(readJsonPointer(result, selector)) !== sha256CanonicalJson(wrapper.value)) return fail(selector)
        const claims: ModuleSourceLineage['claims'][number][] = [], originalSources: ModuleSourceLineage['sources'][number][] = []
        const native: ModuleSourceLineage['nativeEvidence'][number][] = [...nativeEvidence(result, portName, recordId, field.name)]
        const visited = new Set<string>()
        function addSource(owner: ModuleExecutionResult, sourceId: string) {
          const source = owner.sourceValues.find(source => source.sourceId === sourceId)
          if (!source) return fail(`${owner.moduleId}/${sourceId}`)
          const provenance = research.documents?.find(document => document.path === source.path && document.contentHash === source.contentHash)?.provenance
          originalSources.push({ moduleId: owner.moduleId, source, ...(provenance ? { provenance } : {}) })
        }
        function visit(owner: ModuleExecutionResult, claimId: string) {
          const key = `${owner.moduleId}\0${claimId}`
          if (visited.has(key)) return
          visited.add(key)
          const claim = owner.claims.find(claim => claim.claimId === claimId)
          if (!claim) return fail(key)
          claims.push({ moduleId: owner.moduleId, ...runFor(owner), claim })
          if (claim.sourceId) addSource(owner, claim.sourceId)
          const match = /^\/outputs\/([^/]+)\/records\/(\d+)\/([^/]+)\/value(?:\/|$)/u.exec(claim.selector)
          if (match) {
            const decode = (value: string) => value.replaceAll('~1', '/').replaceAll('~0', '~')
            const original = (owner.outputs[decode(match[1]!)] as { records: readonly Record<string, unknown>[] })?.records[Number(match[2])]
            if (!original) return fail(claim.selector)
            native.push(...nativeEvidence(owner, decode(match[1]!), String(original.recordId), decode(match[3]!)))
          }
          for (const ref of claim.inputRefs ?? []) {
            const upstream = byModule.get(ref.moduleId)
            if (!upstream) return fail(`${ref.moduleId}/${ref.claimId}`)
            visit(upstream, ref.claimId)
          }
          for (const operand of [...claim.calculation?.operands ?? [], ...claim.calculation?.weights ?? []]) {
            if ('sourceId' in operand) addSource(owner, operand.sourceId)
            else if('scenarioAssumption' in operand){
              // The complete authored operand is already kept in claims and
              // nativeEvidence. It is a conditional parameter, never a source.
              if(claim.calculation?.basis!=='scenario')return fail(`${owner.moduleId}/${claimId}: unmarked scenario operand`)
            }
            else {
              const upstream = operand.moduleId ? byModule.get(operand.moduleId) : owner
              if (!upstream) return fail(`${operand.moduleId}/${operand.claimId}`)
              visit(upstream, operand.claimId)
            }
          }
        }
        for (const claimId of wrapper.claimRefs) visit(result, claimId)
        const permissions=research.researchProgress?.reviews.at(-1)?.decision.conditions.filter(c=>c.itemId===result.itemId)??[]
        const scopes=[...permissions.filter(c=>c.scope?.kind==='conclusions').map(c=>c.scope!),...(result.execution?.researchRestrictions?.conditions.map(c=>c.scope)??[])]
        const limitations = unique([...result.limitations, ...port.limitations, ...wrapper.limitations,...permissions.map(c=>`${c.criterion}：${c.reason}；复核触发：${c.verification}`),
          ...scopes.map(s=>`允许继续的研究：${s.allowedUses.join('；')}。暂停用途：${s.heldUses.join('；')}。推进${s.reviewAfterModules}个实质模块后再次独立回看。`)])
        const moduleLineage: ModuleSourceLineage = { itemId: result.itemId, moduleId: result.moduleId, ...run, port: portName, recordId,
          fieldName: field.name, selector, valueHash: sha256CanonicalJson(wrapper.value), claimRefs: wrapper.claimRefs, claimClass: wrapper.claimClass,
          limitations, claims: unique(claims), sources: unique(originalSources), nativeEvidence: unique(native) }
        const sourceId = `source:module:${result.itemId}:${sha256CanonicalJson({ ...run, portName, recordId, field: field.name }).slice(0, 20)}`
        const evidenceIds = moduleLineage.sources.map(row => `module-evidence:${sha256CanonicalJson(row).slice(0, 24)}`)
        const basisParts = [wrapper.claimClass, ...moduleLineage.sources.map(row => `${row.source.path}${row.source.page === undefined ? '' : ` 第${row.source.page}页`}：${row.source.quote}${row.provenance ? `；原发页面 ${row.provenance.sourceUri}；获取 ${row.provenance.retrievedAt}；原始响应 SHA-256 ${row.provenance.rawHash}（网页记载，不自动视为当前已核事实）` : ''}`),
          ...claims.flatMap(row => [row.claim.rationale, row.claim.unit && `单位：${row.claim.unit}`].filter((value): value is string => !!value)),
          ...(result.execution?.synthesis?[`本模块综合判断：${result.execution.synthesis.judgment.conclusion}；依据：${result.execution.synthesis.judgment.analysis}`]:[]),
          ...(research.moduleRuns.find(r=>r.itemId===result.itemId)?.status==='limited'?['本项独审保留limited记录，经整体回看可用于允许范围内的策划。正文按本项目用户要求与已知条件表达拟议方案，不默认理想条件；人工确认及相关限制进入对应页notes与备注汇总，不能改写为已获批或已核事实。']:[]),...limitations]
        sources.push({ id: sourceId, objectId: `module:${result.moduleId}`, fieldPath: selector, text: `${field.sourceLabel}：${valueText(wrapper.value)}`, basis: basisParts.join('；'), basisParts,
          evidenceIds: unique(evidenceIds), moduleLineage })
      }
    }
  }
  return sources
}
