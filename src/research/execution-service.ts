import { validateWorkflowEvidence, type WorkflowEvidenceValidation } from './evidence-validator.ts'
import type { ResearchRequest } from './provider.ts'
import type { ResearchRegistry } from './registry.ts'
import type { ResearchProviderRouter } from './router.ts'
import type { EvidenceRecord } from './types.ts'

export interface ResearchAcquisition {
  readonly sourceId: string
  readonly request: ResearchRequest
}

export interface ResearchExecutionResult {
  readonly records: readonly EvidenceRecord[]
  readonly validation: WorkflowEvidenceValidation
  /** Issued only by the central runtime, never inferred from model output. */
  readonly continuation?: ResearchContinuation
}

export interface ResearchContinuation {
  readonly mode: 'conditional'
  readonly workflowId: string
  readonly policy: 'v2.0.1-research-fallback'
  readonly missingDataPointIds: readonly string[]
  readonly limitations: readonly string[]
}

export function researchAllowsAnalysis(result: ResearchExecutionResult, workflowId: string): boolean {
  if (result.validation.valid) return true
  const continuation = result.continuation
  return workflowId !== 'preplan.wf.01.01'
    && result.validation.integrityValid === true
    && result.validation.staleEvidenceIds.length === 0
    && result.validation.rejectedEvidenceIds.length === 0
    && continuation?.mode === 'conditional'
    && continuation.workflowId === workflowId
    && continuation.policy === 'v2.0.1-research-fallback'
    && continuation.limitations.length > 0
    && JSON.stringify([...continuation.missingDataPointIds].sort()) === JSON.stringify([...result.validation.missingDataPointIds].sort())
}

function assertIdentity(
  sourceId: string,
  request: ResearchRequest,
  record: EvidenceRecord,
): void {
  if (record.workflowId !== request.workflowId
    || record.dataPointId !== request.dataPointId
    || record.sourceId !== sourceId
    || record.sourceType !== request.mode) {
    throw new Error(
      `research provider output identity mismatch: expected ${request.workflowId}/${request.dataPointId}/${sourceId}/${request.mode}, got ${record.workflowId}/${record.dataPointId}/${record.sourceId}/${record.sourceType}`,
    )
  }
}

export class ResearchExecutionService {
  constructor(
    private readonly registry: ResearchRegistry,
    private readonly router: ResearchProviderRouter,
  ) {}

  async execute(
    workflowId: string,
    acquisitions: readonly ResearchAcquisition[],
    now: string = new Date().toISOString(),
    signal?: AbortSignal,
  ): Promise<ResearchExecutionResult> {
    this.registry.workflow(workflowId)
    const records: EvidenceRecord[] = []

    for (const acquisition of acquisitions) {
      if (signal?.aborted === true) {
        throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
      }
      if (acquisition.request.workflowId !== workflowId) {
        throw new Error(
          `research acquisition workflow mismatch: request '${acquisition.request.workflowId}' does not match '${workflowId}'`,
        )
      }
      const source = this.registry.source(acquisition.sourceId)
      const result = await this.router.execute(source, acquisition.request, signal)
      for (const record of result.records) {
        assertIdentity(acquisition.sourceId, acquisition.request, record)
        const validation = this.registry.validateEvidenceRecord(record)
        if (!validation.valid) {
          throw new Error(`research provider returned invalid EvidenceRecord '${record.evidenceId}': ${validation.errors.join('; ')}`)
        }
        records.push(Object.freeze(structuredClone(record)))
      }
    }

    const frozenRecords = Object.freeze(records)
    return Object.freeze({
      records: frozenRecords,
      validation: validateWorkflowEvidence(this.registry, workflowId, frozenRecords, now),
    })
  }
}
