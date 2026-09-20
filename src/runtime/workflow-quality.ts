import { effectiveWorkflowAutomationPolicy } from '../contracts/automation-policy.ts'
import type { WorkflowDescriptor } from '../contracts/types.ts'
import { researchAllowsAnalysis, type ResearchExecutionResult } from '../research/execution-service.ts'

export type WorkflowQualityDisposition =
  | 'auto_pass'
  | 'auto_revise'
  | 'needs_human'
  | 'blocked_external'
  | 'quality_unresolved'
  | 'evidence_conflict'

export type WorkflowQualityCheckStatus = 'pass' | 'gap' | 'block'

export interface WorkflowQualityCheck {
  readonly criterion: string
  readonly status: WorkflowQualityCheckStatus
  readonly rationale: string
}

export interface WorkflowEvidenceCheck {
  readonly policy: string
  readonly status: WorkflowQualityCheckStatus
  readonly rationale: string
}

export interface WorkflowQualityBlocker {
  readonly code: string
  readonly kind: 'external' | 'quality' | 'conflict'
  readonly message: string
  readonly scope?: 'current_workflow' | 'later_implementation'
  readonly criterion?: string
  readonly evidenceIds?: readonly string[]
  readonly dataPointIds?: readonly string[]
}

export interface WorkflowQualityEvidence {
  readonly completionChecks: readonly WorkflowQualityCheck[]
  readonly evidenceChecks: readonly WorkflowEvidenceCheck[]
  readonly assumptions: readonly string[]
  readonly blockers: readonly WorkflowQualityBlocker[]
  readonly confidence: number
}

export interface WorkflowQualityOptions {
  readonly attempt: number
  readonly maxAttempts?: number
  readonly minimumConfidence?: number
  readonly research?: ResearchExecutionResult
}

function groundedEvidence(descriptor: WorkflowDescriptor, evidence: WorkflowQualityEvidence, research?: ResearchExecutionResult): WorkflowQualityEvidence {
  if (!research || !researchAllowsAnalysis(research, descriptor.workflowId)) return evidence
  const accepted = new Set(research.records.map(record => record.evidenceId)
    .filter(id => research.validation.acceptedEvidenceIds.includes(id)))
  const allowedGaps = new Set(research.continuation?.missingDataPointIds ?? [])
  const criteria = new Set([...(descriptor.completionCriteria ?? []), ...(descriptor.evidencePolicy ?? [])])
  const blockers = evidence.blockers.map(blocker => {
    if (blocker.kind === 'quality') return blocker
    const ids = Array.isArray(blocker.evidenceIds) ? [...new Set(blocker.evidenceIds)] : []
    const gaps = Array.isArray(blocker.dataPointIds) ? blocker.dataPointIds : []
    let issue: string | undefined
    if (blocker.scope !== 'current_workflow' || !criteria.has(blocker.criterion ?? '')) {
      issue = '阻断理由必须对应本工作项的有效完成条件或证据规则；后续实施条件应记录为限制，不能提前阻断当前问题界定。'
    } else if (blocker.kind === 'conflict' && (ids.length < 2 || ids.some(id => !accepted.has(id)))) {
      issue = '证据冲突必须引用至少两条已接受的实际证据及互相矛盾的具体结论；旧资料的现行适用性未知属于时效限制，不自动构成冲突。'
    } else if (blocker.kind === 'external' && gaps.length > 0 && gaps.every(id => allowedGaps.has(id))) {
      issue = '这些资料缺口已由中央条件式研究策略接纳；请按允许的研究深度形成有限结论并记录未知，不得把已知缺口重新当成人工确认前置。'
    } else if (blocker.kind === 'external' && (ids.length === 0 || ids.some(id => !accepted.has(id)))) {
      issue = '外部阻断须说明实际证据证明的当前不可满足条件；无根据的外部依赖应修订，真实采集或工具故障由中央Runtime保留。'
    }
    return issue === undefined ? blocker : Object.freeze({ ...blocker, kind: 'quality' as const,
      message: `阻断依据待纠正：${issue} 原始${blocker.kind}说明：${blocker.message}` })
  })
  return Object.freeze({ ...evidence, blockers: Object.freeze(blockers) })
}

export interface WorkflowQualityReport {
  readonly workflowId: string
  readonly targetObjectId: string
  readonly disposition: WorkflowQualityDisposition
  readonly score: number
  readonly completionCoverage: number
  readonly evidenceCoverage: number
  readonly confidence: number
  readonly attempt: number
  readonly maxAttempts: number
  readonly reasons: readonly string[]
  readonly blockers: readonly WorkflowQualityBlocker[]
  readonly assumptions: readonly string[]
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function coverage(
  required: readonly string[],
  checks: readonly { readonly status: WorkflowQualityCheckStatus }[],
  keyOf: (check: any) => string,
): number {
  if (required.length === 0) return 1
  const byKey = new Map(checks.map(check => [keyOf(check).normalize('NFC').trim(), check]))
  const passed = required.filter(item => byKey.get(item.normalize('NFC').trim())?.status === 'pass').length
  return passed / required.length
}

function reasonList(
  completionCoverage: number,
  evidenceCoverage: number,
  confidence: number,
  minimumConfidence: number,
  evidence: WorkflowQualityEvidence,
): string[] {
  const reasons: string[] = []
  if (completionCoverage < 1) reasons.push(`完成条件覆盖不足：${Math.round(completionCoverage * 100)}%`)
  if (evidenceCoverage < 1) reasons.push(`证据规则覆盖不足：${Math.round(evidenceCoverage * 100)}%`)
  if (confidence < minimumConfidence) reasons.push(`分析置信度不足：${confidence.toFixed(2)} < ${minimumConfidence.toFixed(2)}`)
  if (evidence.blockers.some(blocker => blocker.kind === 'quality')) reasons.push('仍存在需要自动修订的质量问题')
  if (evidence.blockers.some(blocker => blocker.kind === 'conflict')) reasons.push('存在尚未解决的证据或结论冲突')
  return reasons
}

export function evaluateWorkflowQuality(
  descriptor: WorkflowDescriptor,
  rawEvidence: WorkflowQualityEvidence,
  options: WorkflowQualityOptions,
): WorkflowQualityReport {
  const evidence = groundedEvidence(descriptor, rawEvidence, options.research)
  const policy = descriptor.automationPolicy ?? effectiveWorkflowAutomationPolicy(descriptor.risk)
  const attempt = Math.max(1, Math.trunc(options.attempt))
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? policy.maxAutomaticAttempts))
  const minimumConfidence = clamp(options.minimumConfidence ?? policy.minimumConfidence)
  const confidence = clamp(evidence.confidence)
  const completionCriteria = descriptor.completionCriteria ?? []
  const evidencePolicy = descriptor.evidencePolicy ?? []
  const completionCoverage = coverage(completionCriteria, evidence.completionChecks, check => check.criterion)
  const evidenceCoverage = coverage(evidencePolicy, evidence.evidenceChecks, check => check.policy)
  const reasons = reasonList(completionCoverage, evidenceCoverage, confidence, minimumConfidence, evidence)
  const external = evidence.blockers.filter(blocker => blocker.kind === 'external')
  const conflict = evidence.blockers.filter(blocker => blocker.kind === 'conflict')
  const qualityBlockers = evidence.blockers.filter(blocker => blocker.kind === 'quality')

  let disposition: WorkflowQualityDisposition
  if (external.length > 0) {
    disposition = 'blocked_external'
    reasons.unshift(`存在外部阻断：${external.map(blocker => blocker.message).join('；')}`)
  } else if (conflict.length > 0) {
    disposition = 'evidence_conflict'
    reasons.unshift(`存在证据冲突：${conflict.map(blocker => blocker.message).join('；')}`)
  } else {
    const qualityPass = completionCoverage === 1
      && evidenceCoverage === 1
      && confidence >= minimumConfidence
      && qualityBlockers.length === 0
    if (qualityPass) disposition = 'auto_pass'
    else if (attempt >= maxAttempts) {
      disposition = 'quality_unresolved'
      reasons.unshift(`已达到自动修订上限：${attempt}/${maxAttempts}`)
    } else disposition = 'auto_revise'
  }

  const rawScore = completionCoverage * 0.4 + evidenceCoverage * 0.35 + confidence * 0.25
  const score = Number(Math.max(0, rawScore - Math.min(0.25, qualityBlockers.length * 0.05)).toFixed(4))

  return Object.freeze({
    workflowId: descriptor.workflowId,
    targetObjectId: descriptor.targetObjectId,
    disposition,
    score,
    completionCoverage: Number(completionCoverage.toFixed(4)),
    evidenceCoverage: Number(evidenceCoverage.toFixed(4)),
    confidence,
    attempt,
    maxAttempts,
    reasons: Object.freeze(reasons),
    blockers: Object.freeze([...evidence.blockers]),
    assumptions: Object.freeze([...evidence.assumptions]),
  })
}
