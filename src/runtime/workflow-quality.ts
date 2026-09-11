import type { WorkflowDescriptor } from '../contracts/types.ts'

export type WorkflowQualityDisposition =
  | 'auto_pass'
  | 'auto_revise'
  | 'needs_human'
  | 'blocked_external'

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
  if (evidence.blockers.some(blocker => blocker.kind === 'conflict')) reasons.push('存在需要人工裁决的证据或结论冲突')
  return reasons
}

export function evaluateWorkflowQuality(
  descriptor: WorkflowDescriptor,
  evidence: WorkflowQualityEvidence,
  options: WorkflowQualityOptions,
): WorkflowQualityReport {
  const attempt = Math.max(1, Math.trunc(options.attempt))
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? 3))
  const minimumConfidence = clamp(options.minimumConfidence ?? 0.72)
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
  } else if (descriptor.risk.toUpperCase() === 'H') {
    disposition = 'needs_human'
    reasons.unshift('高风险工作项需要局部人工审核')
  } else if (conflict.length > 0) {
    disposition = 'needs_human'
  } else {
    const qualityPass = completionCoverage === 1
      && evidenceCoverage === 1
      && confidence >= minimumConfidence
      && qualityBlockers.length === 0
    if (qualityPass) disposition = 'auto_pass'
    else if (attempt >= maxAttempts) {
      disposition = 'needs_human'
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
