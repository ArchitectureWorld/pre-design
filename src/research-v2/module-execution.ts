import { createHash, randomUUID } from 'node:crypto'
import {createModuleReuseProof,verifyModuleReuseProof,type ModuleReuseProof} from './module-input-dependencies.ts'
import type { MaterialCorpus } from '../materials/research-evidence.ts'
import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
import { loadPlanningCatalog, requireModule } from './catalog.ts'
import {moduleScopedUpstream} from './module-upstream-claim-scope.ts'
import { projectResearchPlan, assessResearchInputs } from './planning.ts'
import type { PlanningModule, ResearchFlags, ResearchPlan } from './types.ts'
import { readJsonPointer } from './regional-schema.ts'
import { validateModuleOutputs } from './module-contracts.ts'
import { assertMaterialCorpus, verifyModuleSourceValues, validateModuleClaims, type ModuleClaim, type ModuleSourceValue } from './module-claims.ts'
import { readResearchAuditBundle, saveResearchAuditBundle, type StoredResearchBundle, type StoredResearchManifest } from './run-store.ts'
import { freeze } from './graph.ts'
import { getResearchModuleSpec } from './specification.ts'
import { replayModuleAuthorProjection, MODULE_AUTHOR_PROJECTION_VERSION, MODULE_AUTHOR_PROJECTION_JSON_VERSION,
  type ModuleProjectionV1Audit, type ModuleProjectionJsonAudit } from './module-author-projection.ts'
import { replayModuleAuthorGroups, type ModuleAuthorGroupsAudit } from './module-author-groups.ts'
import {verifyModuleSynthesis,type ModuleSynthesisAudit} from './module-synthesis.ts'
import type {NativeModuleSubmissionWireAudit} from './native-submission-wire.ts'
import { assertModuleAcquisition } from './module-web-acquisition.ts'
import { assertModuleInputReferencesCurrent } from './module-input-identity.ts'
import { BOUNDARY_AUDIT_VERSION, boundaryReviewCriteria, buildBoundaryResearchAudit, verifyModuleBoundaryAudit, type BoundaryResearchAudit } from './boundary-audit.ts'
import {verifyProjectTaskAudit,projectTaskHandoffReplayAllowed,type ProjectTaskAudit,type ProjectTaskConfigurationInput} from './project-task-audit.ts'
import { verifyPeerProductArtifacts, type PeerProductArtifactAudit } from './peer-product-artifacts.ts'
import {newResearchProgress,recordResearchStep,progressReviewReason,createProgressReviewRequest,verifyProgressReview,verifyResearchProgress,reuseResearchProgressForBaseline,
  controlledResearchReady,progressBlockedModuleIds,moduleResearchRestrictions,researchRestrictionCriteria,unverifiedResearchRestrictionCriteria,type ModuleResearchRestrictions,
  type ResearchProgress,type ProgressReviewRequest,type ProgressReviewReceipt,type ProgressReviewReason} from './module-progress-review.ts'
export { buildPeerProductArtifacts, verifyPeerProductArtifacts } from './peer-product-artifacts.ts'

export type { ModuleClaim, ModuleSourceValue } from './module-claims.ts'
export const MODULE_EXECUTION_METHOD = 'planning-modules-62.v1'
interface Identity { readonly projectId: string; readonly snapshotId: string; readonly catalogHash: string; readonly specSha256: string; readonly snapshotHash: string; readonly planHash: string }
export interface ModuleInputReference {
  readonly reuseProof?: ModuleReuseProof
  readonly edgeId: string; readonly moduleId: string; readonly selector: string; readonly type: string; readonly bundleRunId: string
  readonly resultHash: string; readonly valueHash: string; readonly claimRefs: readonly string[]
}
export interface ModuleNativeExecutionReceipt {
    readonly executionId: string; readonly childId: string; readonly actualModel: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }; readonly stopReason: string
    readonly nativeSubmissionWire?:NativeModuleSubmissionWireAudit
}
interface ModuleExecutionTrace {
    readonly researchRestrictions?:ModuleResearchRestrictions
    readonly synthesis?:ModuleSynthesisAudit
    readonly projectTaskAudit?:ProjectTaskAudit
    readonly boundaryAudit?: BoundaryResearchAudit
    readonly peerProductArtifacts?: PeerProductArtifactAudit
    readonly steps?: readonly { readonly step: number; readonly status: 'completed' | 'limited'; readonly summary: string; readonly claimRefs: readonly string[]; readonly limitations: readonly string[] }[]
    readonly reviewReceipts?: readonly { readonly executionId: string; readonly childId: string; readonly actualModel: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }; readonly stopReason: string
      readonly synthesisHash?:string
      readonly progressRestrictionsHash?:string
      readonly verdict?:'pass'|'limited'|'fail'
      readonly candidateHash?: string; readonly authorGroupsHash?: string; readonly boundaryAuditHash?: string; readonly peerProductArtifactsHash?: string; readonly projectTaskAuditHash?:string; readonly checks: readonly { readonly criterion: string; readonly status: 'pass' | 'limited' | 'fail'; readonly rationale: string; readonly claimRefs?: readonly string[] }[]; readonly limitations: readonly string[] }[]
    readonly attempts?: readonly unknown[]
}
export type ModuleAuthorExecution = ModuleNativeExecutionReceipt & ModuleExecutionTrace & (
  { readonly kind?: 'full-candidate-v1'; readonly authorProjection?: never; readonly authorGroups?: never }
  | { readonly kind: 'author-projection-v1'; readonly authorProjection: ModuleProjectionV1Audit; readonly authorGroups?: never }
  | { readonly kind: 'author-projection-json-v2'; readonly authorProjection: ModuleProjectionJsonAudit; readonly authorGroups?: never }
  | { readonly kind: 'author-field-groups-v3'; readonly authorProjection?: never; readonly authorGroups: ModuleAuthorGroupsAudit }
)
export interface ModuleAnalysis {
  readonly outputs: Record<string, unknown>; readonly claims: readonly ModuleClaim[]; readonly limitations: readonly string[]
  readonly sourceValues?: readonly ModuleSourceValue[]
  readonly execution?: ModuleAuthorExecution
}
export interface ModuleExecutionResult extends Identity {
  readonly reviewOnlyReuse?: { readonly version:'module-review-reuse.v1'; readonly sourceBundleRunId:string; readonly sourceResultHash:string; readonly candidateHash:string }
  readonly runId: string; readonly itemId: string; readonly moduleId: string; readonly methodVersion: typeof MODULE_EXECUTION_METHOD
  readonly inputRefs: readonly ModuleInputReference[]; readonly lifecycle: 'current'; readonly outputs: Record<string, unknown>
  readonly claims: readonly ModuleClaim[]; readonly sourceValues: readonly ModuleSourceValue[]; readonly limitations: readonly string[]
  readonly qualityChecks: readonly { readonly check: string; readonly passed: true }[]; readonly execution?: ModuleAnalysis['execution']
  readonly reviewedCandidate?: { readonly outputs: Record<string, unknown>; readonly claims: readonly ModuleClaim[]; readonly sourceValues: readonly ModuleSourceValue[]
    readonly limitations: readonly string[]; readonly steps: NonNullable<ModuleAnalysis['execution']>['steps'] }
}
export interface ModuleAnalysisContext extends Identity {
  /** Same-input candidate loaded and strictly replayed from an immutable bundle. */
  readonly reviewOnlyCandidate?: ModuleExecutionResult
  readonly researchRestrictions?:ModuleResearchRestrictions
  readonly runId: string; readonly module: PlanningModule; readonly corpus: MaterialCorpus; readonly sourceValues: readonly ModuleSourceValue[]
  /** User research task, never a factual source or a numeric operand. */
  readonly taskBrief?: string
  readonly taskConfiguration?:ProjectTaskConfigurationInput
  /** One-time missing program handoff, not a waiver for author defects. */
  readonly projectTaskHandoffReplay?:ProjectTaskAudit
  /** Unfinished author evidence only; the native runtime must replay it before reuse. */
  readonly resumeExecutionAudit?: NonNullable<ModuleRunEntry['executionAudit']>
  /** Central rejection from the same immutable checkpoint and exact inputs;
   * diagnostic only, never evidence or a reusable author submission. */
  readonly resumeExecutionError?: string
  /** Verified old review, diagnostic only; never a reusable author or current acceptance. */
  readonly priorModuleReview?: PriorModuleReview
  readonly inputRefs: readonly ModuleInputReference[]; readonly upstream: readonly ModuleExecutionResult[]; readonly signal: AbortSignal
}
export interface PriorModuleReview {
  readonly bundleRunId: string; readonly snapshotId: string; readonly resultHash: string
  readonly reviewReceipts: NonNullable<ModuleAuthorExecution['reviewReceipts']>
}
export interface ModuleExecutionRequest {
  readonly reviewOnly?: boolean
  /** Web selection never authorizes model work for unselected dependencies. */
  readonly strictModuleSelection?: boolean
  readonly workspaceRoot: string; readonly projectId: string; readonly snapshotId: string; readonly corpus: MaterialCorpus
  readonly sourceValues?: readonly ModuleSourceValue[]; readonly flags: ResearchFlags; readonly moduleIds?: readonly string[]
  readonly resumeRunIds?: readonly string[]; readonly signal?: AbortSignal
  /** Reauthor selected modules while preserving the full frozen continuation. */
  readonly reviseModuleIds?: readonly string[]
  /** Explicit source migration only; default recovery still requires exact snapshot identity. */
  readonly allowInputReuse?: boolean
  readonly taskBrief?: string
}
export interface ModuleRunEntry {
  readonly reuseProof?: ModuleReuseProof
  readonly priorModuleReview?: PriorModuleReview
  readonly itemId: string; readonly status: 'completed' | 'limited' | 'failed' | 'blocked' | 'cancelled'; readonly bundleRunId?: string; readonly resultHash?: string; readonly error?: string
  readonly executionAudit?: { readonly attempts: readonly unknown[]; readonly reviewReceipts: readonly unknown[];
    /** Earlier independent review for correction only; never a review of this run's candidate. */
    readonly priorReviewReceipts?: readonly unknown[] }
}
/** Conditional proposals can pass QA. An explicit limited QA verdict is unfinished research, even when execution ended normally. */
export function moduleCompletionStatus(result: ModuleExecutionResult, corpus?: MaterialCorpus): 'completed' | 'limited' {
  if (corpus?.acquisition) { try { assertModuleAcquisition(corpus, [result.itemId]) } catch { return 'limited' } }
  if (result.itemId === '1.02' && result.execution && !result.execution.boundaryAudit) return 'limited'
  return result.execution?.reviewReceipts?.at(-1)?.checks.some(check => check.status !== 'pass') ? 'limited' : 'completed'
}
/** Historical status remains replayable; reuse/delivery additionally requires the current review contract. */
export function moduleReviewIsCurrent(result: ModuleExecutionResult): boolean {
  // Preserve immutable historical statuses. Native task results need the new
  // candidate-bound audit before reuse or customer report acceptance.
  if (result.itemId === '1.01' && result.execution) return result.execution.projectTaskAudit?.version === 'project-task-audit.v1'
  if (result.itemId === '3.05') return result.execution?.peerProductArtifacts?.version === 'native-peer-product-artifacts.v1'
  return result.itemId !== '1.02' || result.execution?.boundaryAudit?.version === BOUNDARY_AUDIT_VERSION
}
export interface ModuleExecutionSummary extends Identity {
  readonly runId: string; readonly methodVersion: typeof MODULE_EXECUTION_METHOD; readonly status: 'completed' | 'partial' | 'cancelled'
  readonly plan: ResearchPlan
  readonly selectedModuleIds: readonly string[]
  readonly moduleRuns: readonly ModuleRunEntry[]; readonly results: readonly ModuleExecutionResult[]; readonly limitations: readonly string[]
  readonly manifestRunId: string
  readonly researchProgress?: ResearchProgress
}
export interface ModuleExecutionDependencies {
  readonly analyze: (context: ModuleAnalysisContext) => Promise<ModuleAnalysis>
  /** Trusted integration seam for the versioned professional schema; never model-provided. */
  readonly validateOutputs?: (itemId: string, outputs: unknown) => void | { readonly valid: boolean; readonly errors?: readonly string[] }
  readonly now?: () => string; readonly assertCurrent?: () => void | Promise<void>
  readonly onProgress?: (entry: ModuleRunEntry) => void | Promise<void>
  readonly reviewProgress?: (request: ProgressReviewRequest, context: ModuleAnalysisContext) => Promise<ProgressReviewReceipt>
  readonly onProgressReview?: (receipt: ProgressReviewReceipt) => void | Promise<void>
}
type Validator = Pick<ModuleExecutionDependencies, 'validateOutputs'>
interface Snapshot { readonly corpus: MaterialCorpus; readonly sourceValues: readonly ModuleSourceValue[]; readonly flags: ResearchFlags; readonly taskBrief?: string }
interface ModuleBundleManifest extends StoredResearchManifest, Identity { readonly schemaVersion: 'research-module-bundle.v1' | 'research-module-run.v1'; readonly methodVersion: typeof MODULE_EXECUTION_METHOD }
interface ModuleBundle extends StoredResearchBundle { readonly manifest: ModuleBundleManifest }
interface Loaded { readonly result: ModuleExecutionResult; readonly snapshot: Snapshot; readonly bundleRunId: string }
interface ReviewReuseSource {readonly row:Loaded;readonly upstream:readonly Loaded[]}
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
const fail = (code: string, detail = ''): never => { throw new Error(`${code}${detail ? ': ' + detail : ''}`) }
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 4000)
function failureAudit(error: unknown): ModuleRunEntry['executionAudit'] {
  if (!error || typeof error !== 'object') return undefined
  const audit = Object.getOwnPropertyDescriptor(error, 'moduleExecutionAudit')?.value as ModuleRunEntry['executionAudit']
  if (!audit || !Array.isArray(audit.attempts) || !Array.isArray(audit.reviewReceipts)
    || audit.priorReviewReceipts !== undefined && !Array.isArray(audit.priorReviewReceipts)) return undefined
  // Only the trusted native adapter supplies this field. It is evidence of a
  // failed attempt, never a substitute for semantic validation or completion.
  sha256CanonicalJson(audit)
  if (Buffer.byteLength(JSON.stringify(audit)) > 1024 * 1024) fail('MODULE_EXECUTION_AUDIT_TOO_LARGE')
  return structuredClone(audit)
}

function identity(projectId: string, snapshotId: string, snapshot: Snapshot): Identity {
  if (!projectId.trim() || !snapshotId.trim()) fail('MODULE_IDENTITY_REQUIRED')
  if (snapshot.taskBrief !== undefined && (typeof snapshot.taskBrief !== 'string' || !snapshot.taskBrief.trim() || snapshot.taskBrief.length > 20_000)) fail('MODULE_TASK_BRIEF_INVALID')
  assertMaterialCorpus(snapshot.corpus)
  verifyModuleSourceValues(snapshot.corpus, snapshot.sourceValues)
  const catalog = loadPlanningCatalog(), plan = projectResearchPlan(catalog, snapshot.flags)
  return { projectId, snapshotId, catalogHash: catalog.hash, specSha256: catalog.sourceSha256, snapshotHash: sha256CanonicalJson(snapshot), planHash: plan.hash }
}
function sameIdentity(actual: Identity, expected: Identity): void {
  for (const key of ['projectId', 'snapshotId', 'catalogHash', 'specSha256', 'snapshotHash', 'planHash'] as const) {
    if (actual[key] !== expected[key]) fail('MODULE_SNAPSHOT_IDENTITY_MISMATCH', key)
  }
}
function mergeSources(...groups: readonly (readonly ModuleSourceValue[])[]): ModuleSourceValue[] {
  const values = new Map<string, ModuleSourceValue>()
  for (const source of groups.flat()) {
    const previous = values.get(source.sourceId)
    if (previous && sha256CanonicalJson(previous) !== sha256CanonicalJson(source)) fail('MODULE_SOURCE_VALUE_CONFLICT', source.sourceId)
    values.set(source.sourceId, source)
  }
  return [...values.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId))
}
function checkOutputs(itemId: string, outputs: Record<string, unknown>, deps: Validator): void {
  const outcome = (deps.validateOutputs ?? validateModuleOutputs)(itemId, outputs)
  if (outcome && !outcome.valid) fail('MODULE_OUTPUT_SCHEMA_INVALID', outcome.errors?.join('; '))
  const module = requireModule(loadPlanningCatalog(), itemId)
  if (Object.keys(outputs).sort().join('|') !== module.ports.map(p => p.name).sort().join('|')) fail('MODULE_OUTPUT_PORT_SET', itemId)
  for (const port of module.ports) {
    const value = outputs[port.name] as Record<string, unknown>
    if (!value || value.type !== port.type || !['accepted', 'limited'].includes(String(value.quality))
      || !Array.isArray(value.records) || !Array.isArray(value.claimRefs) || !Array.isArray(value.limitations)
      || typeof value.scope !== 'string' || !value.scope.trim() || typeof value.asOf !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/.test(value.asOf) || !Number.isFinite(Date.parse(value.asOf))) fail('MODULE_OUTPUT_ENVELOPE', port.name)
    if (value.quality === 'limited' && !(value.limitations as unknown[]).length) fail('MODULE_OUTPUT_LIMITATIONS_REQUIRED', port.name)
  }
}
/** Shared pre-review validation; native adapters call this before marking their child successful. */
export function validateModuleCandidate(context: ModuleAnalysisContext, candidate: ModuleAnalysis, deps: Validator = {}) {
  sha256CanonicalJson(candidate)
  if (!Array.isArray(candidate.limitations) || candidate.limitations.some(l => typeof l !== 'string')) fail('MODULE_LIMITATIONS_INVALID')
  const sourceValues = verifyModuleSourceValues(context.corpus, mergeSources(context.sourceValues, candidate.sourceValues ?? []))
  checkOutputs(context.module.id, candidate.outputs, deps)
  if (context.module.id === '1.02') {
    const invalid = buildBoundaryResearchAudit(candidate.outputs).boundaries.filter(row => row.status === 'invalid')
    if (invalid.length) fail('MODULE_BOUNDARY_GEOMETRY_INVALID', invalid.map(row => `${row.recordId}: ${row.limitations.join('; ')}`).join('; '))
  }
  const upstream = moduleScopedUpstream(context.upstream,context.inputRefs).map(({moduleId,claims})=>({moduleId,claims}))
  const checked = validateModuleClaims({ outputs: candidate.outputs, claims: candidate.claims, sourceValues, moduleId: context.module.moduleId, upstream })
  return { sourceValues, claims: checked.claims, limitations: [...new Set([...context.corpus.limitations, ...candidate.limitations, ...checked.limitations])] }
}
/** Only QA metadata may differ: the frozen task, candidate and original native work stay identical. */
function sameReviewedResearch(a:ModuleExecutionResult,b:ModuleExecutionResult):boolean {
  if(!a.execution?.reviewReceipts?.length||!b.execution?.reviewReceipts?.length||!a.reviewedCandidate||!b.reviewedCandidate)return false
  const core=(r:ModuleExecutionResult)=>{
    const {reviewReceipts:_reviews,attempts:_attempts,researchRestrictions:_restrictions,...original}=r.execution!
    return {projectId:r.projectId,itemId:r.itemId,moduleId:r.moduleId,snapshotId:r.snapshotId,snapshotHash:r.snapshotHash,
      catalogHash:r.catalogHash,specSha256:r.specSha256,planHash:r.planHash,methodVersion:r.methodVersion,
      inputs:r.inputRefs.map(({edgeId,moduleId,selector,type,valueHash,claimRefs})=>({edgeId,moduleId,selector,type,valueHash,claimRefs})),
      outputs:r.outputs,claims:r.claims,sourceValues:r.sourceValues,reviewedCandidate:r.reviewedCandidate,original}
  }
  return sha256CanonicalJson(core(a))===sha256CanonicalJson(core(b))
}
function assertReviewOnlyInputs(source:ReviewReuseSource,currentRefs:readonly ModuleInputReference[],upstream:readonly Loaded[]):void {
  const original=source.row.result.inputRefs
  if(original.length!==currentRefs.length)fail('MODULE_REVIEW_INPUT_CHANGED')
  for(const ref of currentRefs){
    const before=original.find(row=>row.edgeId===ref.edgeId)
    if(!before)throw new Error('MODULE_REVIEW_INPUT_CHANGED')
    if((['edgeId','moduleId','selector','type','valueHash'] as const).some(key=>before[key]!==ref[key])
      ||sha256CanonicalJson(before.claimRefs)!==sha256CanonicalJson(ref.claimRefs))fail('MODULE_REVIEW_INPUT_CHANGED')
    if(before.bundleRunId===ref.bundleRunId&&before.resultHash===ref.resultHash)continue
    const old=source.upstream.find(row=>row.bundleRunId===before.bundleRunId),now=upstream.find(row=>row.bundleRunId===ref.bundleRunId)
    if(!old||!now||sha256CanonicalJson(old.result)!==before.resultHash||sha256CanonicalJson(now.result)!==ref.resultHash
      ||!sameReviewedResearch(old.result,now.result))fail('MODULE_REVIEW_INPUT_CHANGED')
  }
}
function verifyReviewOnlyReuse(result:ModuleExecutionResult,source:ReviewReuseSource|undefined,upstream:readonly Loaded[]):void {
  const proof=result.reviewOnlyReuse
  if(!proof)return
  if(!source)throw new Error('MODULE_REVIEW_REUSE_INVALID')
  if(proof.version!=='module-review-reuse.v1'||proof.sourceBundleRunId!==source.row.bundleRunId
    ||proof.sourceResultHash!==sha256CanonicalJson(source.row.result)||proof.candidateHash!==sha256CanonicalJson(source.row.result.reviewedCandidate)
    ||!sameReviewedResearch(result,source.row.result))fail('MODULE_REVIEW_REUSE_INVALID')
  const review=result.execution!.reviewReceipts!.at(-1)!
  if(source.row.result.execution!.reviewReceipts!.some(row=>row.executionId===review.executionId||row.childId===review.childId))fail('MODULE_REVIEW_NOT_INDEPENDENT')
  assertReviewOnlyInputs(source,result.inputRefs,upstream)
}
function inputReferences(itemId: string, plan: ResearchPlan, upstream: readonly Loaded[], target?: Identity, snapshot?: Snapshot): ModuleInputReference[] {
  const catalog = loadPlanningCatalog()
  const proofs = new Map(upstream.filter(row=>target && row.result.snapshotId!==target.snapshotId).map(row=>[row.bundleRunId,createModuleReuseProof(row.result,row.snapshot,target!,snapshot!,row.bundleRunId)]))
  const readiness = assessResearchInputs(catalog, plan, itemId, upstream.map(row => row.result), target?.snapshotId ?? upstream[0]?.result.snapshotId ?? 'no-upstream', 'draft',new Map(upstream.filter(row=>proofs.has(row.bundleRunId)).map(row=>[row.result.moduleId,row.result.snapshotId])))
  if (!readiness.ready) fail('MODULE_DEPENDENCIES_NOT_VERIFIED', readiness.issues.map(i => `${i.edgeId}/${i.reason}`).join('; '))
  return plan.edges.filter(e => e.target === itemId).map(edge => {
    const row = upstream.find(u => u.result.moduleId === edge.moduleId)
    if (!row) fail('MODULE_DEPENDENCY_MISSING', edge.edgeId)
    const value = readJsonPointer(row!.result, edge.selector) as { claimRefs: string[] }
    return { edgeId: edge.edgeId, moduleId: edge.moduleId, selector: edge.selector, type: edge.type, bundleRunId: row!.bundleRunId,
      resultHash: sha256CanonicalJson(row!.result), valueHash: sha256CanonicalJson(value), claimRefs: [...value.claimRefs], ...(proofs.has(row!.bundleRunId)?{reuseProof:proofs.get(row!.bundleRunId)}:{}) }
  })
}
function validateResult(result: ModuleExecutionResult, snapshot: Snapshot, upstream: readonly Loaded[], deps: Validator, reviewSource?:ReviewReuseSource): void {
  sha256CanonicalJson(result)
  sameIdentity(result, identity(result.projectId, result.snapshotId, snapshot))
  const catalog = loadPlanningCatalog(), module = requireModule(catalog, result.itemId), plan = projectResearchPlan(catalog, snapshot.flags)
  if (!/^RUN-[a-f0-9-]{36}$/.test(result.runId) || result.moduleId !== module.moduleId || result.methodVersion !== MODULE_EXECUTION_METHOD || result.lifecycle !== 'current') fail('MODULE_RESULT_IDENTITY')
  const expectedRefs = inputReferences(result.itemId, plan, upstream, result, snapshot)
  assertModuleInputReferencesCurrent(result.inputRefs, expectedRefs)
  verifyReviewOnlyReuse(result,reviewSource,upstream)
  for (const row of upstream) if (row.result.snapshotId === result.snapshotId) sameIdentity(row.result, result)
  checkOutputs(result.itemId, result.outputs, deps)
  const sources = verifyModuleSourceValues(snapshot.corpus, result.sourceValues)
  const selectedUpstream = moduleScopedUpstream(upstream.map(row=>row.result),expectedRefs).map(({moduleId,claims})=>({moduleId,claims}))
  const verified = validateModuleClaims({ outputs: result.outputs, claims: result.claims, sourceValues: sources, moduleId: result.moduleId, upstream: selectedUpstream })
  if (verified.limitations.some(l => !result.limitations.includes(l)) || snapshot.corpus.limitations.some(l => !result.limitations.includes(l))) fail('MODULE_LIMITATIONS_NOT_PRESERVED')
  const required = ['professional-output-schema', 'frozen-source-bindings', 'claim-values-and-calculations', 'dependency-selectors']
  if (result.qualityChecks.length !== required.length || required.some(check => !result.qualityChecks.some(q => q.check === check && q.passed === true))) fail('MODULE_QUALITY_CHECKS_INVALID')
  if (result.execution && (!result.execution.executionId?.trim() || !result.execution.childId?.trim()
    || !result.execution.actualModel?.provider?.trim() || !result.execution.actualModel?.model?.trim() || result.execution.stopReason !== 'completed')) fail('MODULE_NATIVE_EXECUTION_INCOMPLETE')
  if (result.execution) {
    verifyModuleBoundaryAudit(result.itemId, result.outputs, result.execution)
    if (result.execution.kind !== undefined && !['full-candidate-v1', 'author-projection-v1', 'author-projection-json-v2', 'author-field-groups-v3'].includes(result.execution.kind)) fail('MODULE_PROJECTION_EXECUTION_KIND')
    if (result.execution.kind === 'author-field-groups-v3') {
      if (result.execution.authorProjection !== undefined) fail('MODULE_PROJECTION_EXECUTION_KIND')
      const audit = result.execution.authorGroups, compiled = replayModuleAuthorGroups(result.itemId, snapshot.corpus, audit)
      if (!result.reviewedCandidate || sha256CanonicalJson(compiled) !== sha256CanonicalJson(result.reviewedCandidate)) fail('MODULE_GROUP_CANDIDATE_MISMATCH')
      const primary = audit.groups[0].receipt
      if (result.execution.executionId !== primary.executionId || result.execution.childId !== primary.childId
        || sha256CanonicalJson(result.execution.actualModel) !== sha256CanonicalJson(primary.actualModel)) fail('MODULE_GROUP_PRIMARY_RECEIPT')
      const authors = result.execution.attempts?.filter((attempt): attempt is Record<string, unknown> => !!attempt && typeof attempt === 'object'
        && (attempt as Record<string, unknown>).classId === 'text' && (attempt as Record<string, unknown>).status === 'completed')
      if (!authors || authors.length !== audit.groups.length+(result.execution.synthesis?1:0)) fail('MODULE_GROUP_ATTEMPTS')
      for (const group of audit.groups) {
        const matching = authors!.filter(a => a.executionId === group.receipt.executionId && a.childId === group.receipt.childId)
        if (matching.length !== 1 || matching[0].groupId !== group.raw.groupId || matching[0].stopReason !== 'completed'
          || matching[0].structuredHash !== group.projectionHash || matching[0].outputsJsonHash !== group.outputsJsonHash
          || sha256CanonicalJson(matching[0].actualModel) !== sha256CanonicalJson(group.receipt.actualModel)
          || !matching[0].structuredOutput || sha256CanonicalJson(matching[0].structuredOutput) !== group.projectionHash
          || (matching[0].structuredOutput as { outputsJson?: unknown }).outputsJson !== group.raw.outputsJson) fail('MODULE_GROUP_ATTEMPT_MISMATCH')
      }
    } else if (result.execution.authorGroups !== undefined) fail('MODULE_PROJECTION_EXECUTION_KIND')
    if (result.execution.kind === 'author-projection-v1' || result.execution.kind === 'author-projection-json-v2') {
      const version = result.execution.kind === 'author-projection-v1' ? MODULE_AUTHOR_PROJECTION_VERSION : MODULE_AUTHOR_PROJECTION_JSON_VERSION
      if (result.execution.authorProjection?.version !== version || result.execution.authorProjection.raw?.projectionVersion !== version) fail('MODULE_PROJECTION_EXECUTION_KIND')
      const compiled = replayModuleAuthorProjection(result.itemId, snapshot.corpus, result.execution.authorProjection, result.execution)
      if (!result.reviewedCandidate || sha256CanonicalJson(compiled) !== sha256CanonicalJson(result.reviewedCandidate)) fail('MODULE_PROJECTION_CANDIDATE_MISMATCH')
      const successfulAuthor = result.execution.attempts?.filter((attempt): attempt is Record<string, unknown> => !!attempt && typeof attempt === 'object'
        && (attempt as Record<string, unknown>).classId === 'text' && (attempt as Record<string, unknown>).status === 'completed'
        && (attempt as Record<string, unknown>).executionId === result.execution!.executionId
        && (attempt as Record<string, unknown>).childId === result.execution!.childId)
      if (successfulAuthor?.length !== 1 || successfulAuthor[0].structuredHash !== result.execution.authorProjection.projectionHash
        || successfulAuthor[0].stopReason !== 'completed' || sha256CanonicalJson(successfulAuthor[0].actualModel) !== sha256CanonicalJson(result.execution.actualModel)) fail('MODULE_PROJECTION_ATTEMPT_MISMATCH')
      if (successfulAuthor![0].outputsJsonHash !== result.execution.authorProjection.outputsJsonHash) fail('MODULE_PROJECTION_ATTEMPT_TEXT_MISMATCH')
    } else if (result.execution.authorProjection !== undefined) fail('MODULE_PROJECTION_EXECUTION_KIND')
    const receipts = result.execution.reviewReceipts, steps = result.execution.steps, spec = getResearchModuleSpec(result.itemId)
    if (!Array.isArray(steps) || steps.length !== 4 || new Set(steps.map(s => s.step)).size !== 4 || steps.some(s => ![1, 2, 3, 4].includes(s.step)
      || !['completed', 'limited'].includes(s.status) || !s.summary?.trim() || !Array.isArray(s.claimRefs)
      || s.claimRefs.some((id: string) => !result.claims.some(c => c.claimId === id)) || !Array.isArray(s.limitations)
      || s.status === 'limited' && !s.limitations.length)) fail('MODULE_NATIVE_STEPS_INCOMPLETE')
    if (!Array.isArray(receipts) || !receipts.length) fail('MODULE_REVIEW_REQUIRED')
    const review = receipts!.at(-1)!, restrictionCriteria=researchRestrictionCriteria(result.execution.researchRestrictions),
      criteria = [...boundaryReviewCriteria(spec.qa, result.execution.boundaryAudit),...restrictionCriteria]
    if(result.execution.researchRestrictions){
      if(review.progressRestrictionsHash!==result.execution.researchRestrictions.hash
        ||unverifiedResearchRestrictionCriteria(result.execution.researchRestrictions,review.checks).length)fail('MODULE_RESTRICTION_REVIEW_BINDING')
    }else if(review.progressRestrictionsHash)fail('MODULE_RESTRICTION_REVIEW_BINDING')
    if (result.execution.kind === 'author-field-groups-v3'
      && (review.authorGroupsHash !== result.execution.authorGroups.bindingHash
        || result.execution.authorGroups.groups.some(g => g.receipt.childId === review.childId || g.receipt.executionId === review.executionId))) fail('MODULE_REVIEW_GROUP_BINDING')
    if (result.execution.kind === 'author-field-groups-v3') {
      const reviews = result.execution.attempts?.filter((attempt): attempt is Record<string, unknown> => !!attempt && typeof attempt === 'object'
        && (attempt as Record<string, unknown>).classId === 'review' && (attempt as Record<string, unknown>).status === 'completed'
        && (attempt as Record<string, unknown>).executionId === review.executionId && (attempt as Record<string, unknown>).childId === review.childId)
      const verdict = (review as { verdict?: unknown }).verdict
      if (!['pass', 'limited'].includes(String(verdict)) || reviews?.length !== 1) fail('MODULE_REVIEW_ATTEMPT_BINDING')
      const expected = sha256CanonicalJson({ verdict, checks: review.checks, limitations: review.limitations,
        ...(review.synthesisHash?{synthesisHash:review.synthesisHash}:{}),
        ...(review.progressRestrictionsHash?{progressRestrictionsHash:review.progressRestrictionsHash}:{}),
        ...(review.boundaryAuditHash ? {boundaryAuditHash:review.boundaryAuditHash} : {}),
        ...(review.projectTaskAuditHash?{projectTaskAuditHash:review.projectTaskAuditHash}:{}),
        ...(review.peerProductArtifactsHash ? {peerProductArtifactsHash:review.peerProductArtifactsHash} : {}) })
      if (reviews![0].stopReason !== 'completed' || reviews![0].structuredHash !== expected || !reviews![0].structuredOutput
        || sha256CanonicalJson(reviews![0].structuredOutput) !== expected || sha256CanonicalJson(reviews![0].actualModel) !== sha256CanonicalJson(review.actualModel)) fail('MODULE_REVIEW_ATTEMPT_BINDING')
    }
    const candidate = result.reviewedCandidate
    if(result.execution.synthesis){
      if(!candidate)fail('MODULE_SYNTHESIS_BINDING')
      verifyModuleSynthesis(candidate as Parameters<typeof verifyModuleSynthesis>[0],result.execution.synthesis)
      const synthesis=result.execution.synthesis,submitted=result.execution.attempts?.filter((a):a is Record<string,unknown>=>Boolean(a)&&typeof a==='object'
        &&(a as Record<string,unknown>).executionId===synthesis.execution.executionId)
      if(review.synthesisHash!==synthesis.hash||submitted?.length!==1||submitted[0].classId!=='text'||submitted[0].groupId!=='module-synthesis'
        ||submitted[0].status!=='completed'||submitted[0].childId!==synthesis.execution.childId||submitted[0].structuredHash!==sha256CanonicalJson(synthesis.judgment)
        ||sha256CanonicalJson(submitted[0].structuredOutput)!==sha256CanonicalJson(synthesis.judgment)
        ||synthesis.execution.childId===review.childId||synthesis.execution.executionId===review.executionId
        ||result.execution.kind==='author-field-groups-v3'&&result.execution.authorGroups.groups.some(g=>g.receipt.childId===synthesis.execution.childId
          ||g.receipt.executionId===synthesis.execution.executionId))fail('MODULE_SYNTHESIS_BINDING')
    }else if(review.synthesisHash)fail('MODULE_SYNTHESIS_BINDING')
    if(result.execution.projectTaskAudit){
      if(result.itemId!=='1.01'||!candidate)fail('MODULE_PROJECT_TASK_AUDIT_MISMATCH')
      verifyProjectTaskAudit(candidate!,snapshot.taskBrief,result.execution.projectTaskAudit,
        {projectId:result.projectId,snapshotId:result.snapshotId,planHash:plan.hash,flags:snapshot.flags})
      if(review.projectTaskAuditHash!==sha256CanonicalJson(result.execution.projectTaskAudit))fail('MODULE_PROJECT_TASK_REVIEW_BINDING')
    }else if(review.projectTaskAuditHash)fail('MODULE_PROJECT_TASK_REVIEW_BINDING')
    if (result.execution.peerProductArtifacts) {
      if (result.itemId !== '3.05' || !candidate) fail('MODULE_PEER_ARTIFACT_MISMATCH')
      verifyPeerProductArtifacts(candidate!, result.execution.peerProductArtifacts)
      if (review.peerProductArtifactsHash !== sha256CanonicalJson(result.execution.peerProductArtifacts)) fail('MODULE_PEER_ARTIFACT_REVIEW_BINDING')
    } else if (review.peerProductArtifactsHash) fail('MODULE_PEER_ARTIFACT_REVIEW_BINDING')
    if (!candidate || review.candidateHash !== sha256CanonicalJson(candidate)
      || sha256CanonicalJson(candidate.outputs) !== sha256CanonicalJson(result.outputs)
      || sha256CanonicalJson(candidate.claims) !== sha256CanonicalJson(result.claims)
      || sha256CanonicalJson(candidate.steps) !== sha256CanonicalJson(steps)
      || candidate.sourceValues.some(source => !result.sourceValues.some(s => sha256CanonicalJson(s) === sha256CanonicalJson(source)))
      || candidate.limitations.some(l => !result.limitations.includes(l))) fail('MODULE_REVIEW_CANDIDATE_MISMATCH')
    if (!review.executionId?.trim() || !review.childId?.trim() || review.childId === result.execution.childId || review.executionId === result.execution.executionId
      || !review.actualModel?.provider?.trim() || !review.actualModel?.model?.trim() || review.stopReason !== 'completed'
      || !Array.isArray(review.checks) || review.checks.length !== criteria.length
      || new Set(review.checks.map(q => q.criterion)).size !== criteria.length || criteria.some(q => !review.checks.some(c => c.criterion === q))
      || review.checks.some(c => !['pass', 'limited'].includes(c.status) || !c.rationale?.trim())
      || !Array.isArray(review.limitations) || review.checks.some(c => c.status === 'limited') && !review.limitations.length) fail('MODULE_REVIEW_NOT_VERIFIED')
    if (review.limitations.some(l => !result.limitations.includes(l))) fail('MODULE_REVIEW_LIMITATIONS_NOT_PRESERVED')
  }
}
function bundle(files: Record<string, string>, context: Identity, kind: ModuleBundleManifest['schemaVersion']): ModuleBundle {
  const core = { ...context, schemaVersion: kind, methodVersion: MODULE_EXECUTION_METHOD as typeof MODULE_EXECUTION_METHOD,
    files: Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => ({ path, sha256: digest(content), sizeBytes: Buffer.byteLength(content) })) }
  return { manifest: { ...core, manifestHash: sha256CanonicalJson(core) }, files }
}
function verifyBundle(value: ModuleBundle): void {
  const { manifestHash, ...core } = value.manifest
  if (!['research-module-bundle.v1', 'research-module-run.v1'].includes(core.schemaVersion) || core.methodVersion !== MODULE_EXECUTION_METHOD
    || sha256CanonicalJson(core) !== manifestHash) fail('MODULE_BUNDLE_MANIFEST_HASH')
  const expected = core.schemaVersion === 'research-module-bundle.v1' ? ['result.json', 'snapshot.json'] : ['run.json', 'snapshot.json']
  if (core.schemaVersion === 'research-module-bundle.v1' && value.files['result.json']) {
    const result = JSON.parse(value.files['result.json']) as ModuleExecutionResult, artifacts = result.execution?.peerProductArtifacts
    if (artifacts) {
      if (result.itemId !== '3.05' || !result.reviewedCandidate) fail('MODULE_PEER_ARTIFACT_MISMATCH')
      verifyPeerProductArtifacts(result.reviewedCandidate!, artifacts)
      for (const [path, content] of Object.entries(artifacts.files)) {
        expected.push(path)
        if (value.files[path] !== content) fail('MODULE_PEER_ARTIFACT_FILE_MISMATCH')
      }
    }
  }
  if (Object.keys(value.files).sort().join('|') !== expected.sort().join('|') || core.files.length !== expected.length
    || new Set(core.files.map(file=>file.path)).size !== expected.length) fail('MODULE_BUNDLE_FILE_SET')
  for (const entry of core.files) if (typeof value.files[entry.path] !== 'string' || digest(value.files[entry.path]) !== entry.sha256 || Buffer.byteLength(value.files[entry.path]) !== entry.sizeBytes) fail('MODULE_BUNDLE_FILE_HASH_MISMATCH')
}
async function loadModule(root: string, runId: string, deps: Validator, cache: Map<string, Loaded>, active: Set<string>): Promise<Loaded> {
  if (cache.has(runId)) return cache.get(runId)!
  if (active.has(runId)) fail('MODULE_BUNDLE_DEPENDENCY_CYCLE')
  active.add(runId)
  try {
    const value = await readResearchAuditBundle<ModuleBundle>(root, runId, verifyBundle)
    if (value.manifest.schemaVersion !== 'research-module-bundle.v1') fail('MODULE_BUNDLE_EXPECTED')
    const result = JSON.parse(value.files['result.json']) as ModuleExecutionResult, snapshot = JSON.parse(value.files['snapshot.json']) as Snapshot
    sameIdentity(result, value.manifest)
    const upstream = await Promise.all([...new Set(result.inputRefs.map(ref => ref.bundleRunId))].map(id => loadModule(root, id, deps, cache, new Set(active))))
    let reviewSource:ReviewReuseSource|undefined
    if(result.reviewOnlyReuse){
      const source=await loadModule(root,result.reviewOnlyReuse.sourceBundleRunId,deps,cache,new Set(active))
      reviewSource={row:source,upstream:source.result.inputRefs.map(ref=>cache.get(ref.bundleRunId)!)}
    }
    validateResult(result, snapshot, upstream, deps,reviewSource)
    const loaded = { result: freeze(result), snapshot, bundleRunId: runId }; cache.set(runId, loaded); return loaded
  } finally { active.delete(runId) }
}
export async function readModuleExecutionResult(root: string, runId: string, deps: Validator = {}): Promise<ModuleExecutionResult> {
  return (await loadModule(root, runId, deps, new Map(), new Set())).result
}

/** Independently replays every completed module and proves run coverage and status. */
export async function readModuleExecutionSummary(root: string, manifestRunId: string, deps: Validator = {}): Promise<ModuleExecutionSummary> {
  const stored = await readResearchAuditBundle<ModuleBundle>(root, manifestRunId, verifyBundle)
  if (stored.manifest.schemaVersion !== 'research-module-run.v1') fail('MODULE_RUN_MANIFEST_EXPECTED')
  const value = JSON.parse(stored.files['run.json']) as Omit<ModuleExecutionSummary, 'results' | 'manifestRunId'>
  const snapshot = JSON.parse(stored.files['snapshot.json']) as Snapshot
  sameIdentity(value, stored.manifest); sameIdentity(value, identity(value.projectId, value.snapshotId, snapshot))
  if (!/^RUN-[a-f0-9-]{36}$/.test(value.runId) || value.methodVersion !== MODULE_EXECUTION_METHOD) fail('MODULE_RUN_IDENTITY')
  const catalog = loadPlanningCatalog(), plan = projectResearchPlan(catalog, snapshot.flags)
  if (sha256CanonicalJson(value.plan) !== sha256CanonicalJson(plan)) fail('MODULE_RUN_PLAN_MISMATCH')
  if (!Array.isArray(value.selectedModuleIds) || !value.selectedModuleIds.length || new Set(value.selectedModuleIds).size !== value.selectedModuleIds.length
    || !Array.isArray(value.moduleRuns) || value.moduleRuns.length !== value.selectedModuleIds.length
    || new Set(value.moduleRuns.map(row => row.itemId)).size !== value.moduleRuns.length
    || value.selectedModuleIds.some(id => !value.moduleRuns.some(row => row.itemId === id))) fail('MODULE_RUN_COVERAGE')
  for (const id of value.selectedModuleIds) requireModule(catalog, id)
  if (plan.edges.some(edge => value.selectedModuleIds.includes(edge.target) && !value.selectedModuleIds.includes(edge.source))) fail('MODULE_RUN_COVERAGE_DEPENDENCIES')
  const cache = new Map<string, Loaded>(), results: ModuleExecutionResult[] = []
  for (const entry of value.moduleRuns) {
    if(entry.priorModuleReview) {
      const origin=await loadModule(root,entry.priorModuleReview.bundleRunId,deps,cache,new Set())
      if(origin.result.itemId!==entry.itemId || origin.result.projectId!==value.projectId || entry.priorModuleReview.snapshotId!==origin.result.snapshotId
        || entry.priorModuleReview.resultHash!==sha256CanonicalJson(origin.result)
        || sha256CanonicalJson(entry.priorModuleReview.reviewReceipts)!==sha256CanonicalJson(origin.result.execution?.reviewReceipts??[])) fail('MODULE_REVIEW_FEEDBACK_IDENTITY')
    }
    if (!['completed', 'limited', 'failed', 'blocked', 'cancelled'].includes(entry.status)) fail('MODULE_RUN_STATUS')
    if (entry.status === 'completed' || entry.status === 'limited') {
      if (!entry.bundleRunId || !entry.resultHash || entry.error || !plan.activeModuleIds.includes(entry.itemId) || plan.blockedModuleIds.includes(entry.itemId)) fail('MODULE_RUN_COMPLETION_INVALID')
      const loaded = await loadModule(root, entry.bundleRunId!, deps, cache, new Set())
      if(loaded.result.snapshotId === value.snapshotId) sameIdentity(loaded.result,value)
      else verifyModuleReuseProof(entry.reuseProof,loaded.result,loaded.snapshot,value,snapshot,entry.bundleRunId!)
      if (loaded.result.itemId !== entry.itemId || sha256CanonicalJson(loaded.result) !== entry.resultHash) fail('MODULE_RUN_RESULT_IDENTITY')
      if (entry.status !== moduleCompletionStatus(loaded.result, snapshot.corpus)) fail('MODULE_RUN_COMPLETION_INVALID')
      results.push(loaded.result)
    } else if (!entry.error?.trim() || entry.bundleRunId || entry.resultHash) fail('MODULE_RUN_FAILURE_INVALID')
  }
  for (const result of results) for (const ref of result.inputRefs) {
    const entry = value.moduleRuns.find(row => row.bundleRunId === ref.bundleRunId)
    if (!entry || !['completed', 'limited'].includes(entry.status) || entry.resultHash !== ref.resultHash) fail('MODULE_RUN_COVERAGE_DEPENDENCIES')
  }
  if(value.researchProgress)verifyResearchProgress(value.researchProgress,results,{...value,taskBrief:snapshot.taskBrief})
  for(const result of results)if(result.runId===value.runId&&result.execution?.researchRestrictions){
    const receipt=value.researchProgress?.reviews.find(row=>row.hash===result.execution!.researchRestrictions!.reviewHash)
    if(!receipt||sha256CanonicalJson(moduleResearchRestrictions(receipt,result.execution.researchRestrictions.version))!==sha256CanonicalJson(result.execution.researchRestrictions))fail('MODULE_RESTRICTION_ORIGIN')
  }
  const expectedStatus = value.moduleRuns.some(row => row.status === 'cancelled')||value.researchProgress?.cancelled ? 'cancelled'
    : value.moduleRuns.every(row => row.status === 'completed') && (!value.researchProgress||controlledResearchReady({...value,results})) ? 'completed' : 'partial'
  if (value.status !== expectedStatus) fail('MODULE_RUN_STATUS')
  if (!Array.isArray(value.limitations) || [...snapshot.corpus.limitations, ...results.flatMap(r => r.limitations),
    ...value.moduleRuns.flatMap(row => row.error ? [row.error] : [])].some(l => !value.limitations.includes(l))) fail('MODULE_RUN_LIMITATIONS')
  return freeze({ ...value, results, manifestRunId })
}

/** Runs the approved 62-module DAG sequentially. Legacy 57-item statuses are never inputs. */
export async function runModuleExecution(request: ModuleExecutionRequest, deps: ModuleExecutionDependencies): Promise<ModuleExecutionSummary> {
  const snapshot = freeze(structuredClone({ corpus: request.corpus, sourceValues: request.sourceValues ?? [], flags: request.flags,
    ...(request.taskBrief === undefined ? {} : { taskBrief: request.taskBrief }) })) as Snapshot
  const context = identity(request.projectId, request.snapshotId, snapshot), catalog = loadPlanningCatalog(), plan = projectResearchPlan(catalog, snapshot.flags)
  const runId = `RUN-${randomUUID()}`, signal = request.signal ?? new AbortController().signal
  const requested = new Set(request.moduleIds ?? [...plan.activeModuleIds, ...plan.pendingModuleIds])
  // A full conditional continuation rechecks unchanged reviewed candidates in
  // a fresh native overall review. Explicit item corrections still reauthor.
  const conditionalContinuation=Boolean(deps.reviewProgress&&request.moduleIds===undefined)
  const selected = new Set(requested)
  if (!selected.size) fail('MODULE_SELECTION_EMPTY')
  for (const id of selected) requireModule(catalog, id)
  let adding = true
  while (adding) { adding = false; for (const edge of plan.edges) if (selected.has(edge.target) && !selected.has(edge.source)) { selected.add(edge.source); adding = true } }
  if(request.reviseModuleIds!==undefined&&(!Array.isArray(request.reviseModuleIds)||!request.reviseModuleIds.length
    ||new Set(request.reviseModuleIds).size!==request.reviseModuleIds.length||request.reviseModuleIds.some(id=>!selected.has(id))||request.reviewOnly))fail('MODULE_REVISION_TARGET_INVALID')
  const reviseModuleIds=new Set(request.reviseModuleIds??[])
  const loaded = new Map<string, Loaded>(), storeCache = new Map<string, Loaded>()
  const verifiedResumeReuseProofs = new Map<string, ModuleReuseProof>()
  const reviewEligibility = new Map<string, boolean>()
  const currentReviewLineage = (row: Loaded): boolean => {
    const cached = reviewEligibility.get(row.bundleRunId)
    if (cached !== undefined) return cached
    const status = moduleCompletionStatus(row.result, row.snapshot.corpus)
    // A bounded recovery may use an unchanged, independently reviewed limited
    // ancestor as conditional input, just as a fresh run does. Preserve its
    // status/receipt; explicit targets still need native revision and review.
    const limitedAncestor = status === 'limited' && (!requested.has(row.result.itemId)||conditionalContinuation) && !!row.result.execution?.reviewReceipts?.length
    const current = (status === 'completed' || limitedAncestor) && moduleReviewIsCurrent(row.result) && row.result.inputRefs.every(ref => {
      const ancestor = storeCache.get(ref.bundleRunId)
      return ancestor !== undefined && currentReviewLineage(ancestor)
    })
    reviewEligibility.set(row.bundleRunId, current)
    return current
  }
  const unfinished = new Map<string, { audit: NonNullable<ModuleRunEntry['executionAudit']>; inputRefs: readonly ModuleInputReference[] }>()
  const unfinishedErrors = new Map<string, string>()
  const limitedReviewOrigins = new Set<string>()
  const previousReviews = new Map<string, PriorModuleReview>()
  const reviewOrigins = new Map<string, ModuleExecutionResult>()
  const taskHandoffReplays=new Map<string,ProjectTaskAudit>()
  const rememberReview = (row: Loaded,feedback=true) => {
    if(!row.result.execution?.reviewReceipts?.length)return
    const current=reviewOrigins.get(row.result.itemId)
    if(current&&sha256CanonicalJson(current)!==sha256CanonicalJson(row.result)){
      if(!sameReviewedResearch(current,row.result))fail('MODULE_RESUME_AMBIGUOUS',row.result.itemId)
      return
    }
    reviewOrigins.set(row.result.itemId,row.result)
    if(!feedback)return
    previousReviews.set(row.result.itemId,{bundleRunId:row.bundleRunId,snapshotId:row.result.snapshotId,resultHash:sha256CanonicalJson(row.result),reviewReceipts:row.result.execution.reviewReceipts})
  }
  const rememberCheckpoint = (itemId: string, checkpoint: { audit: NonNullable<ModuleRunEntry['executionAudit']>; inputRefs: readonly ModuleInputReference[] }) => {
    const existing = unfinished.get(itemId)
    if (existing && sha256CanonicalJson(existing) !== sha256CanonicalJson(checkpoint)) {
      // An earlier verified limited result supplies review feedback to a later
      // author-only failure with exactly the same ancestor identities. Keep
      // only the later attempts; never combine different author candidates.
      if (!limitedReviewOrigins.has(itemId) || checkpoint.audit.reviewReceipts.length
        || sha256CanonicalJson(existing.inputRefs) !== sha256CanonicalJson(checkpoint.inputRefs)
        || checkpoint.audit.priorReviewReceipts && sha256CanonicalJson(checkpoint.audit.priorReviewReceipts) !== sha256CanonicalJson(existing.audit.reviewReceipts)) fail('MODULE_RESUME_AMBIGUOUS', itemId)
      checkpoint = { ...checkpoint, audit: { ...checkpoint.audit, priorReviewReceipts: structuredClone(existing.audit.reviewReceipts) } }
      limitedReviewOrigins.delete(itemId)
    }
    unfinished.set(itemId, structuredClone(checkpoint))
  }
  const rememberLimitedReview = (result: ModuleExecutionResult) => {
    if (!result.execution?.reviewReceipts?.length) return
    // Older limited QA from a source bundle must not replace the latest
    // checkpoint's verified review or collide with its rebound ancestors.
    const current=reviewOrigins.get(result.itemId)
    if(current&&sha256CanonicalJson(current)!==sha256CanonicalJson(result)){
      if(!sameReviewedResearch(current,result))fail('MODULE_RESUME_AMBIGUOUS',result.itemId)
      return
    }
    const pending=unfinished.get(result.itemId),prior=previousReviews.get(result.itemId)
    if(pending&&prior?.resultHash===sha256CanonicalJson(result)
      &&sha256CanonicalJson(prior.reviewReceipts)===sha256CanonicalJson(result.execution.reviewReceipts)){
      const values=(refs:readonly ModuleInputReference[])=>refs.map(({edgeId,moduleId,selector,type,valueHash,claimRefs})=>({edgeId,moduleId,selector,type,valueHash,claimRefs}))
      if(sha256CanonicalJson(values(pending.inputRefs))!==sha256CanonicalJson(values(result.inputRefs)))fail('MODULE_RESUME_AMBIGUOUS',result.itemId)
      // Keep the newer failed attempt, with its exact immutable prior draft
      // for feedback; the old limited receipt does not replace the rejection.
      return
    }
    if(result.itemId==='1.01'&&projectTaskHandoffReplayAllowed(result.execution.projectTaskAudit,result.execution.reviewReceipts))
      taskHandoffReplays.set(result.itemId,result.execution.projectTaskAudit!)
    limitedReviewOrigins.add(result.itemId)
    rememberCheckpoint(result.itemId, { inputRefs: result.inputRefs, audit: {
      attempts: result.execution.attempts ?? [], reviewReceipts: result.execution.reviewReceipts,
    } })
  }
  let resumeResearchProgress:ResearchProgress|undefined
  for (const priorId of request.resumeRunIds ?? []) {
    const prior = await readResearchAuditBundle<ModuleBundle>(request.workspaceRoot, priorId, verifyBundle)
    const crossSnapshot=prior.manifest.snapshotId!==context.snapshotId || prior.manifest.snapshotHash!==context.snapshotHash
    if(prior.manifest.snapshotId===context.snapshotId && prior.manifest.snapshotHash!==context.snapshotHash) sameIdentity(prior.manifest,context)
    if(crossSnapshot && !request.allowInputReuse) sameIdentity(prior.manifest,context)
    if(!crossSnapshot) sameIdentity(prior.manifest,context)
    else for(const key of ['projectId','catalogHash','specSha256','planHash'] as const)if(prior.manifest[key]!==context[key])fail('MODULE_INPUT_IDENTITY_CHANGED',key)
    const summary = prior.manifest.schemaVersion === 'research-module-bundle.v1' ? undefined : await readModuleExecutionSummary(request.workspaceRoot, priorId, deps)
    if(!crossSnapshot&&summary?.researchProgress&&!resumeResearchProgress)resumeResearchProgress=structuredClone(summary.researchProgress)
    for(const entry of summary?.moduleRuns??[]) {
      if(entry.priorModuleReview) previousReviews.set(entry.itemId,entry.priorModuleReview)
      if((entry.status==='limited'||entry.status==='completed') && entry.bundleRunId) rememberReview(await loadModule(request.workspaceRoot,entry.bundleRunId,deps,storeCache,new Set()),entry.status==='limited'||Boolean(request.reviewOnly&&requested.has(entry.itemId)))
    }
    if(!summary)rememberReview(await loadModule(request.workspaceRoot,priorId,deps,storeCache,new Set()))
    const ids = summary ? summary.moduleRuns.filter(row => row.status === 'completed'
      || row.status === 'limited' && (!requested.has(row.itemId)||conditionalContinuation)).map(row => row.bundleRunId!) : [priorId]
    // A limited native review is unfinished research, with an immutable result
    // bundle rather than a failure audit. Preserve its exact review for author
    // correction, never load it as completed or prime the fresh reviewer.
    for (const row of summary?.moduleRuns ?? []) if (!crossSnapshot && row.status === 'limited') {
      const result = summary!.results.find(result => result.itemId === row.itemId)!
      rememberLimitedReview(result)
    }
    for (const row of summary?.moduleRuns ?? []) {
      if (crossSnapshot || !['failed', 'cancelled'].includes(row.status) || !row.executionAudit) continue
      const dependencies = [...new Set(plan.edges.filter(edge => edge.target === row.itemId).map(edge => edge.source))]
      const ancestors: Loaded[] = []
      for (const id of dependencies) {
        const entry = summary!.moduleRuns.find(entry => entry.itemId === id && entry.bundleRunId)
        // Reuse this run's already verified immutable ancestors. A fresh cache
        // per failed dependency recursively replays the same historical DAG.
        if (entry?.bundleRunId) ancestors.push(await loadModule(request.workspaceRoot, entry.bundleRunId, deps, storeCache, new Set()))
      }
      if (ancestors.length !== dependencies.length) continue
      // The frozen coordinator can retain verified ancestors from older
      // snapshots. Reconstruct its failed attempt against that coordinator's
      // target identity and strict input proofs, not the first ancestor's ID.
      const checkpoint = { audit: structuredClone(row.executionAudit), inputRefs: inputReferences(row.itemId, plan, ancestors, context, snapshot) }
      rememberCheckpoint(row.itemId, checkpoint)
      if (row.error) unfinishedErrors.set(row.itemId, row.error)
    }
    for (const id of ids) {
      const supplied=await loadModule(request.workspaceRoot,id,deps,storeCache,new Set())
      // A supplied leaf bundle owns exact immutable ancestor references. Reuse
      // those ancestors too, never rebuild them under new IDs before the leaf.
      for (const row of [supplied,...storeCache.values()]) {
        const rowCurrent = row.result.snapshotId===context.snapshotId && row.result.snapshotHash===context.snapshotHash
        if(rowCurrent) sameIdentity(row.result,context)
        else if(!crossSnapshot) {
          const entry=summary?.moduleRuns.find(entry=>entry.bundleRunId===row.bundleRunId)
          // A same-snapshot leaf has no coordinator rows of its own. Preserve
          // the exact proof already verified against this target by the earlier
          // coordinator; replay it again rather than creating a new permission.
          const proof=summary?entry?.reuseProof:verifiedResumeReuseProofs.get(row.bundleRunId)
          verifyModuleReuseProof(proof,row.result,row.snapshot,context,snapshot,row.bundleRunId)
          verifiedResumeReuseProofs.set(row.bundleRunId,proof!)
        }
        else {try{verifiedResumeReuseProofs.set(row.bundleRunId,createModuleReuseProof(row.result,row.snapshot,context,snapshot,row.bundleRunId))}catch(error){if(error instanceof Error && /MODULE_INPUT_(CHANGED|COVERAGE_UNKNOWN)/u.test(error.message))continue;throw error}}
        if (rowCurrent && moduleCompletionStatus(row.result, row.snapshot.corpus) === 'limited') rememberLimitedReview(row.result)
        if (!currentReviewLineage(row)) continue
        const previous = loaded.get(row.result.itemId)
        if (previous && sha256CanonicalJson(previous.result) !== sha256CanonicalJson(row.result)) {
          // The first explicit checkpoint is authoritative. Older QA for the
          // same immutable work supplies origins, never replaces current QA.
          if(!sameReviewedResearch(previous.result,row.result))fail('MODULE_RESUME_AMBIGUOUS',row.result.itemId)
          const preferred=reviewOrigins.get(row.result.itemId)
          if(preferred&&sha256CanonicalJson(preferred)===sha256CanonicalJson(row.result))loaded.set(row.result.itemId,row)
          continue
        }
        loaded.set(row.result.itemId, row)
      }
    }
  }
  const moduleRuns: ModuleRunEntry[] = [], results: ModuleExecutionResult[] = [], progressErrors: string[] = []
  const researchProgress=deps.reviewProgress?newResearchProgress():undefined,progressBlocked=new Set<string>()
  let baselinePending=Boolean(request.resumeRunIds?.length)
  const reviewProgress=async(reason:ProgressReviewReason)=>{
    if(!researchProgress||!results.length||researchProgress.failure)return
    try{
      if(!researchProgress.reviews.length)reuseResearchProgressForBaseline(researchProgress,resumeResearchProgress,results,
        {...context,taskBrief:snapshot.taskBrief??'',selectedModuleIds:[...selected].sort()})
      const reviewRequest=createProgressReviewRequest({...context,taskBrief:snapshot.taskBrief??'',selectedModuleIds:[...selected].sort(),results,ledger:researchProgress,reason})
      const anchor=results.at(-1)!
      const reviewContext:ModuleAnalysisContext={...context,runId,module:requireModule(catalog,anchor.itemId),corpus:snapshot.corpus,
        sourceValues:anchor.sourceValues,inputRefs:anchor.inputRefs,upstream:results,taskBrief:snapshot.taskBrief,signal}
      await deps.assertCurrent?.();signal.throwIfAborted()
      const receipt=await deps.reviewProgress!(reviewRequest,reviewContext)
      await deps.assertCurrent?.();signal.throwIfAborted()
      verifyProgressReview(receipt,results)
      if(receipt.binding.requestHash!==reviewRequest.requestHash)fail('PROGRESS_REVIEW_BINDING')
      researchProgress.reviews.push(receipt)
      progressBlocked.clear()
      for(const id of progressBlockedModuleIds(receipt.decision))progressBlocked.add(id)
      for(let changed=true;changed;){changed=false;for(const e of plan.edges)if(progressBlocked.has(e.source)&&!progressBlocked.has(e.target)){progressBlocked.add(e.target);changed=true}}
      try{await deps.onProgressReview?.(receipt)}catch(error){progressErrors.push(`MODULE_PROGRESS_NOTIFICATION_FAILED: ${errorText(error)}`)}
    }catch(error){researchProgress.failure=errorText(error);if(signal.aborted)researchProgress.cancelled=true;throw error}
  }
  const record = async (entry: ModuleRunEntry) => {
    moduleRuns.push(entry)
    try { await deps.onProgress?.(entry) }
    catch (error) { progressErrors.push(`MODULE_PROGRESS_NOTIFICATION_FAILED: ${errorText(error)}`) }
  }
  const guard = async () => { signal.throwIfAborted(); await deps.assertCurrent?.(); signal.throwIfAborted() }
  let cancelled = signal.aborted
  const order = [...plan.waves.flat()].filter(id => selected.has(id))
  for (const itemId of [...selected].filter(id => !order.includes(id))) {
    await record({ itemId, status: cancelled ? 'cancelled' : 'blocked', error: cancelled ? 'MODULE_RUN_CANCELLED'
      : plan.inactiveModuleIds.includes(itemId) ? 'MODULE_INACTIVE' : 'MODULE_CONDITION_OR_DEPENDENCY_UNRESOLVED' })
  }
  for (const itemId of order) {
    if (cancelled || signal.aborted) { cancelled = true; await record({ itemId, status: 'cancelled', error: 'MODULE_RUN_CANCELLED' }); continue }
    let priorReviewReceipts: readonly unknown[] | undefined
    try {
      await guard()
      const reviewReason=researchProgress?progressReviewReason(researchProgress,itemId,false,results):undefined
      if(reviewReason)await reviewProgress(reviewReason)
      if(researchProgress?.failure||progressBlocked.has(itemId)){
        await record({itemId,status:'blocked',error:researchProgress?.failure?'MODULE_PROGRESS_REVIEW_UNAVAILABLE':'MODULE_PROGRESS_REVIEW_HOLD'});continue
      }
      let recovered = loaded.get(itemId)
      let metadataReview:Loaded|undefined
      if(reviseModuleIds.has(itemId)){loaded.delete(itemId);recovered=undefined}
      // A newer substantive rejection owns recovery. An older reviewed leaf
      // can supply immutable feedback, but a QA-only ancestor change must not
      // turn that rejection into another review of the unchanged candidate.
      // Explicit reviewOnly remains an intentional reviewer-only operation.
      if(unfinishedErrors.get(itemId)?.startsWith('MODULE_REVIEW_FAILED:')&&!(request.reviewOnly&&requested.has(itemId))){
        loaded.delete(itemId);recovered=undefined
      }
      if(recovered&&plan.edges.some(edge=>edge.target===itemId&&!loaded.has(edge.source))){loaded.delete(itemId);recovered=undefined}
      let reuseProof: ModuleReuseProof | undefined
      if(recovered && recovered.result.snapshotId!==context.snapshotId){
        const ids=[...new Set(plan.edges.filter(edge=>edge.target===itemId).map(edge=>edge.source))]
        try { if(ids.some(id=>!loaded.has(id)))throw Error('MODULE_INPUT_CHANGED');const refs=inputReferences(itemId,plan,ids.map(id=>loaded.get(id)!),context,snapshot);reuseProof=createModuleReuseProof(recovered.result,recovered.snapshot,context,snapshot,recovered.bundleRunId,refs) }
        catch(error){if(error instanceof Error && /MODULE_INPUT_(CHANGED|COVERAGE_UNKNOWN)/u.test(error.message)){loaded.delete(itemId);recovered=undefined}else throw error}
      }
      if(recovered&&!(request.reviewOnly&&requested.has(itemId))){
        const parents=[...new Set(plan.edges.filter(edge=>edge.target===itemId).map(edge=>edge.source))].map(id=>loaded.get(id)!)
        if(parents.every(Boolean)){
          const refs=inputReferences(itemId,plan,parents,context,snapshot)
          if(sha256CanonicalJson(recovered.result.inputRefs)!==sha256CanonicalJson(refs)){
            try{
              const source={row:recovered,upstream:recovered.result.inputRefs.map(ref=>storeCache.get(ref.bundleRunId)!)}
              sameIdentity(recovered.result,context);assertReviewOnlyInputs(source,refs,parents)
              if(!recovered.result.reviewedCandidate||!recovered.result.execution?.reviewReceipts?.length)fail('MODULE_REVIEW_INPUT_CHANGED')
              metadataReview=recovered;loaded.delete(itemId);recovered=undefined
            }catch(error){
              if(!(error instanceof Error&&/MODULE_REVIEW_INPUT_CHANGED|MODULE_SNAPSHOT_IDENTITY_MISMATCH/u.test(error.message)))throw error
              loaded.delete(itemId);recovered=undefined
            }
          }
        }
      }
      if (recovered && !(request.reviewOnly&&requested.has(itemId))) {
        results.push(recovered.result); await record({ itemId, status: moduleCompletionStatus(recovered.result, snapshot.corpus), bundleRunId: recovered.bundleRunId, resultHash: sha256CanonicalJson(recovered.result), ...(reuseProof?{reuseProof}:{}) }); continue
      }
      if (request.strictModuleSelection && !requested.has(itemId)) {
        await record({ itemId, status: 'blocked', error: `MODULE_DEPENDENCY_NOT_SELECTED: ${itemId}` }); continue
      }
      if(baselinePending&&results.length){await reviewProgress('baseline');baselinePending=false}
      if(researchProgress?.failure||progressBlocked.has(itemId)){
        await record({itemId,status:'blocked',error:researchProgress?.failure?'MODULE_PROGRESS_REVIEW_UNAVAILABLE':'MODULE_PROGRESS_REVIEW_HOLD'});continue
      }
      const dependencyIds = [...new Set(plan.edges.filter(e => e.target === itemId).map(e => e.source))]
      if (dependencyIds.some(id => !loaded.has(id))) {
        await record({ itemId, status: 'blocked', error: `MODULE_DEPENDENCY_FAILED: ${dependencyIds.filter(id => !loaded.has(id)).join(', ')}` }); continue
      }
      const upstream = dependencyIds.map(id => loaded.get(id)!), inputRefs = inputReferences(itemId, plan, upstream, context, snapshot)
      const checkpoint = unfinished.get(itemId)
      // A newly generated dependency invalidates partial author work just as it
      // invalidates a completed module. Do not splice different ancestor runs.
      const resumeExecutionAudit = !reviseModuleIds.has(itemId) && checkpoint && sha256CanonicalJson(checkpoint.inputRefs) === sha256CanonicalJson(inputRefs) ? checkpoint.audit : undefined
      priorReviewReceipts = resumeExecutionAudit?.reviewReceipts.length ? resumeExecutionAudit.reviewReceipts : resumeExecutionAudit?.priorReviewReceipts
      const sourceValues = mergeSources(snapshot.sourceValues, ...upstream.map(row => row.result.sourceValues))
      // AbortSignal is mutable platform state; freezing it prevents AbortController.abort().
      const researchRestrictions=moduleResearchRestrictions(researchProgress?.reviews.at(-1))
      let reviewOnlyCandidate:ModuleExecutionResult|undefined,reviewSource:ReviewReuseSource|undefined
      if(metadataReview||request.reviewOnly&&requested.has(itemId)){
        const prior=previousReviews.get(itemId)
        if(!metadataReview&&!prior)fail('MODULE_REVIEW_CANDIDATE_REQUIRED',itemId)
        const row=metadataReview??await loadModule(request.workspaceRoot,prior!.bundleRunId,deps,storeCache,new Set())
        sameIdentity(row.result,context)
        if(!metadataReview&&sha256CanonicalJson(row.result)!==prior!.resultHash)fail('MODULE_REVIEW_INPUT_CHANGED',itemId)
        reviewSource={row,upstream:row.result.inputRefs.map(ref=>storeCache.get(ref.bundleRunId)!)}
        assertReviewOnlyInputs(reviewSource,inputRefs,upstream)
        reviewOnlyCandidate=row.result
      }
      const analysisContext: ModuleAnalysisContext = { ...freeze({ ...context, runId, module: requireModule(catalog, itemId), corpus: snapshot.corpus,
        ...(reviewOnlyCandidate?{reviewOnlyCandidate}:{}),
        ...(researchRestrictions?{researchRestrictions}:{}),
        sourceValues, inputRefs, upstream: upstream.map(row => row.result), ...(snapshot.taskBrief === undefined ? {} : { taskBrief: snapshot.taskBrief }),
        ...(itemId==='1.01'?{taskConfiguration:{projectId:context.projectId,snapshotId:context.snapshotId,planHash:plan.hash,flags:snapshot.flags}}:{}),
        ...(resumeExecutionAudit&&taskHandoffReplays.has(itemId)?{projectTaskHandoffReplay:taskHandoffReplays.get(itemId)}:{}),
        ...(previousReviews.has(itemId)?{priorModuleReview:previousReviews.get(itemId)}:{}),
        ...(resumeExecutionAudit ? { resumeExecutionAudit } : {}) }), signal }
      const centralError = resumeExecutionAudit && unfinishedErrors.get(itemId)
      const recoveryContext = centralError ? { ...analysisContext, resumeExecutionError: centralError } : analysisContext
      const analysis = await deps.analyze(recoveryContext)
      await guard()
      if(researchRestrictions&&(!analysis.execution?.researchRestrictions||sha256CanonicalJson(analysis.execution.researchRestrictions)!==sha256CanonicalJson(researchRestrictions)))fail('MODULE_RESTRICTION_CONTEXT_MISSING')
      const checked = validateModuleCandidate(analysisContext, analysis, deps)
      const result: ModuleExecutionResult = freeze({ ...context, runId, itemId, moduleId: requireModule(catalog, itemId).moduleId,
        ...(reviewSource?{reviewOnlyReuse:{version:'module-review-reuse.v1' as const,sourceBundleRunId:reviewSource.row.bundleRunId,
          sourceResultHash:sha256CanonicalJson(reviewSource.row.result),candidateHash:sha256CanonicalJson(reviewSource.row.result.reviewedCandidate)}}:{}),
        methodVersion: MODULE_EXECUTION_METHOD, lifecycle: 'current', inputRefs, outputs: structuredClone(analysis.outputs), claims: structuredClone(analysis.claims), sourceValues: checked.sourceValues,
        qualityChecks: ['professional-output-schema', 'frozen-source-bindings', 'claim-values-and-calculations', 'dependency-selectors'].map(check => ({ check, passed: true as const })),
        limitations: [...new Set([...snapshot.corpus.limitations, ...upstream.flatMap(u => u.result.limitations), ...analysis.limitations, ...checked.limitations,
          ...(analysis.execution?.reviewReceipts?.at(-1)?.limitations ?? [])])],
        ...(analysis.execution ? { execution: analysis.execution, reviewedCandidate: {
          outputs: structuredClone(analysis.outputs), claims: structuredClone(analysis.claims), sourceValues: structuredClone(analysis.sourceValues ?? []),
          limitations: [...analysis.limitations], steps: analysis.execution.steps,
        } } : {}) })
      validateResult(result, snapshot, upstream, deps,reviewSource)
      const output = bundle({ 'result.json': json(result), 'snapshot.json': json(snapshot),
        ...(result.execution?.peerProductArtifacts?.files ?? {}) }, context, 'research-module-bundle.v1')
      const saved = await saveResearchAuditBundle(request.workspaceRoot, output, b => { verifyBundle(b); validateResult(result, snapshot, upstream, deps,reviewSource) }, { signal, beforeCommit: guard })
      loaded.set(itemId, { result, snapshot, bundleRunId: saved.runId }); results.push(result)
      if(researchProgress)recordResearchStep(researchProgress,result)
      await record({ itemId, status: moduleCompletionStatus(result, snapshot.corpus), bundleRunId: saved.runId, resultHash: sha256CanonicalJson(result) })
    } catch (error) {
      loaded.delete(itemId)
      cancelled = signal.aborted
      const originalAudit = failureAudit(error)
      const audit = priorReviewReceipts?.length ? failureAudit({ moduleExecutionAudit: {
        ...(originalAudit ?? { attempts: [], reviewReceipts: [] }), priorReviewReceipts,
      } }) : originalAudit
      await record({ itemId, status: cancelled ? 'cancelled' : 'failed', error: errorText(error), ...(audit ? { executionAudit: audit } : {}),
        ...(previousReviews.has(itemId)?{priorModuleReview:previousReviews.get(itemId)}:{}) })
    }
  }
  if(researchProgress&&results.length&&!signal.aborted&&!researchProgress.failure){
    try{await reviewProgress('phase-end')}catch(error){progressErrors.push(`MODULE_PROGRESS_REVIEW_FAILED: ${errorText(error)}`)}
  }
  cancelled ||= signal.aborted
  const status = cancelled ? 'cancelled' : moduleRuns.length > 0 && moduleRuns.every(row => row.status === 'completed')
    && (!researchProgress||controlledResearchReady({selectedModuleIds:[...selected],moduleRuns,results,researchProgress})) ? 'completed' : 'partial'
  const summary = { ...context, runId, methodVersion: MODULE_EXECUTION_METHOD, status, plan, selectedModuleIds: [...selected].sort(),
    moduleRuns, results, ...(researchProgress?{researchProgress}:{}),limitations: [...new Set([...snapshot.corpus.limitations, ...results.flatMap(r => r.limitations), ...moduleRuns.flatMap(row => row.error ? [row.error] : []), ...progressErrors])] }
  // A cancellation receipt is persisted without the cancelled work's signal; no in-flight module becomes complete.
  const compact = { ...summary, results: undefined, createdAt: (deps.now ?? (() => new Date().toISOString()))() }
  const finalBundle = bundle({ 'run.json': json(compact), 'snapshot.json': json(snapshot) }, context, 'research-module-run.v1')
  const saved = await saveResearchAuditBundle(request.workspaceRoot, finalBundle, verifyBundle)
  return freeze({ ...summary, manifestRunId: saved.runId }) as ModuleExecutionSummary
}
