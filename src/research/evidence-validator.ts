import type { ResearchRegistry } from './registry.ts'
import type { EvidenceRecord, ResearchReliabilityGrade, ResearchSourcePriority } from './types.ts'

export interface WorkflowEvidenceValidation {
  readonly valid: boolean
  readonly coverage: number
  readonly missingDataPointIds: readonly string[]
  readonly staleEvidenceIds: readonly string[]
  readonly rejectedEvidenceIds: readonly string[]
  readonly acceptedEvidenceIds: readonly string[]
  readonly highAuthorityCount: number
  readonly independentSourceCount: number
  readonly gradeACount: number
  readonly errors: readonly string[]
}

const HIGH_AUTHORITY_PRIORITIES = new Set<ResearchSourcePriority>(['P0', 'P1', 'P2'])
const RELIABILITY_ORDER: Record<ResearchReliabilityGrade, number> = {
  A: 4,
  B: 3,
  C: 2,
  D: 1,
  inference: 0,
}

function ageDays(capturedAt: string, now: string): number {
  const captured = Date.parse(capturedAt)
  const current = Date.parse(now)
  if (!Number.isFinite(captured) || !Number.isFinite(current)) return Number.POSITIVE_INFINITY
  return Math.max(0, (current - captured) / 86_400_000)
}

function sourceSupportsDataKind(sourceKinds: readonly string[], dataKind: string): boolean {
  return sourceKinds.includes(dataKind) || sourceKinds.includes('*')
}

export function validateWorkflowEvidence(
  registry: ResearchRegistry,
  workflowId: string,
  records: readonly EvidenceRecord[],
  now: string = new Date().toISOString(),
): WorkflowEvidenceValidation {
  const spec = registry.workflow(workflowId)
  const dataPoints = new Map([...spec.requiredDataPoints, ...spec.optionalDataPoints]
    .map(point => [point.dataPointId, point] as const))
  const accepted: EvidenceRecord[] = []
  const staleEvidenceIds: string[] = []
  const rejectedEvidenceIds: string[] = []
  const errors: string[] = []

  for (const record of records) {
    const structural = registry.validateEvidenceRecord(record)
    if (!structural.valid) {
      rejectedEvidenceIds.push(record.evidenceId)
      errors.push(...structural.errors.map(error => `${record.evidenceId}: ${error}`))
      continue
    }
    if (record.workflowId !== workflowId) {
      rejectedEvidenceIds.push(record.evidenceId)
      errors.push(`${record.evidenceId}: workflow '${record.workflowId}' does not match '${workflowId}'`)
      continue
    }
    const dataPoint = dataPoints.get(record.dataPointId)
    if (dataPoint === undefined) {
      rejectedEvidenceIds.push(record.evidenceId)
      errors.push(`${record.evidenceId}: unknown data point '${record.dataPointId}' for '${workflowId}'`)
      continue
    }
    const source = registry.source(record.sourceId)
    if (!sourceSupportsDataKind(source.supportedDataKinds, dataPoint.dataKind)) {
      rejectedEvidenceIds.push(record.evidenceId)
      errors.push(`${record.evidenceId}: source '${record.sourceId}' does not support data kind '${dataPoint.dataKind}'`)
      continue
    }
    if (RELIABILITY_ORDER[record.reliability] > RELIABILITY_ORDER[source.reliabilityGrade]) {
      rejectedEvidenceIds.push(record.evidenceId)
      errors.push(`${record.evidenceId}: evidence reliability '${record.reliability}' exceeds source grade '${source.reliabilityGrade}'`)
      continue
    }
    const maxAgeDays = source.freshnessPolicy.maxAgeDays
    if (maxAgeDays !== null && ageDays(record.capturedAt, now) > maxAgeDays) {
      staleEvidenceIds.push(record.evidenceId)
      errors.push(`${record.evidenceId}: evidence is stale for source '${record.sourceId}'`)
      continue
    }
    if (record.claimClass === 'missing') {
      rejectedEvidenceIds.push(record.evidenceId)
      errors.push(`${record.evidenceId}: missing evidence cannot satisfy a data point`)
      continue
    }
    accepted.push(record)
  }

  const acceptedDataPoints = new Set(accepted.map(record => record.dataPointId))
  const missingDataPointIds = spec.requiredDataPoints
    .map(point => point.dataPointId)
    .filter(dataPointId => !acceptedDataPoints.has(dataPointId))
  const coverage = spec.requiredDataPoints.length === 0
    ? 1
    : (spec.requiredDataPoints.length - missingDataPointIds.length) / spec.requiredDataPoints.length

  const independentSources = new Set(accepted.map(record => record.sourceId))
  const highAuthoritySources = new Set(accepted
    .filter(record => HIGH_AUTHORITY_PRIORITIES.has(registry.source(record.sourceId).priority))
    .map(record => record.sourceId))
  const gradeASources = new Set(accepted
    .filter(record => record.reliability === 'A')
    .map(record => record.sourceId))
  const minimum = spec.minimumEvidence

  if (missingDataPointIds.length > 0) {
    errors.push(`missing required data points: ${missingDataPointIds.join(', ')}`)
  }
  if (highAuthoritySources.size < minimum.minHighAuthority) {
    errors.push(`high-authority source count ${highAuthoritySources.size} is below required ${minimum.minHighAuthority}`)
  }
  if (independentSources.size < minimum.minIndependentSources) {
    errors.push(`independent source count ${independentSources.size} is below required ${minimum.minIndependentSources}`)
  }
  if (minimum.highRiskRequiresGradeA && gradeASources.size === 0) {
    errors.push('high-risk workflow requires at least one grade A evidence source')
  }

  return Object.freeze({
    valid: errors.length === 0,
    coverage: Number(coverage.toFixed(4)),
    missingDataPointIds: Object.freeze(missingDataPointIds),
    staleEvidenceIds: Object.freeze(staleEvidenceIds),
    rejectedEvidenceIds: Object.freeze(rejectedEvidenceIds),
    acceptedEvidenceIds: Object.freeze(accepted.map(record => record.evidenceId)),
    highAuthorityCount: highAuthoritySources.size,
    independentSourceCount: independentSources.size,
    gradeACount: gradeASources.size,
    errors: Object.freeze(errors),
  })
}
