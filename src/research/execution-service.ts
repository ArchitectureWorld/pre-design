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
