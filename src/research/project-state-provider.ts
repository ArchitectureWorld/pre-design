import { createHash } from 'node:crypto'
import { validateResearchRequest, type ResearchProvider, type ResearchProviderResult, type ResearchRequest } from './provider.ts'
import { applyResearchSelector } from './selector.ts'
import type { DataSourceDefinition, EvidenceRecord } from './types.ts'
import type { StateObjectRecord } from '../state/types.ts'

export interface ProjectStateResearchProviderOptions {
  readonly projectId: string
  readonly stateObjects: readonly StateObjectRecord[]
  readonly clock?: () => Date
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown): string {
  return JSON.stringify(value)
}

export class ProjectStateResearchProvider implements ResearchProvider {
  readonly providerId = 'project-state-research-provider'
  readonly accessModes = ['project_state'] as const

  private readonly projectId: string
  private readonly stateById: ReadonlyMap<string, StateObjectRecord>
  private readonly clock: () => Date

  constructor(options: ProjectStateResearchProviderOptions) {
    const projectId = options.projectId.normalize('NFC').trim()
    if (projectId === '') throw new Error('Project State provider projectId must be non-empty')
    const rows = options.stateObjects.filter(record => record.projectId === projectId)
    const byId = new Map<string, StateObjectRecord>()
    for (const record of rows) {
      const current = byId.get(record.objectId)
      if (current === undefined || current.revision < record.revision) byId.set(record.objectId, record)
    }
    this.projectId = projectId
    this.stateById = byId
    this.clock = options.clock ?? (() => new Date())
  }

  async readProjectState(
    source: DataSourceDefinition,
    request: ResearchRequest,
    signal?: AbortSignal,
  ): Promise<ResearchProviderResult> {
    if (signal?.aborted === true) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
    const validation = validateResearchRequest(source, request)
    if (!validation.valid) throw new Error(`invalid research request: ${validation.errors.join('; ')}`)
    if (request.mode !== 'project_state') throw new Error(`Project State provider cannot handle access mode '${request.mode}'`)

    const objectId = request.locator.normalize('NFC').trim()
    const state = this.stateById.get(objectId)
    if (state === undefined) throw new Error(`Project State object '${objectId}' is unavailable for project '${this.projectId}'`)
    const serialized = stableJson(state.value)
    const selection = applyResearchSelector(serialized, state.value, request.selector)
    const contentHash = sha256(serialized)
    const fragmentHash = sha256(stableJson(selection.rawValue))
    const selectorIdentity = JSON.stringify(selection.locator)
    const evidenceId = `ev-${sha256(`${request.workflowId}\n${request.dataPointId}\n${source.sourceId}\n${objectId}\n${state.revision}\n${selectorIdentity}\n${contentHash}`).slice(0, 32)}`

    const record: EvidenceRecord = {
      evidenceId,
      workflowId: request.workflowId,
      dataPointId: request.dataPointId,
      sourceId: source.sourceId,
      sourceType: 'project_state',
      sourceUri: `state://${encodeURIComponent(this.projectId)}/${encodeURIComponent(objectId)}?revision=${state.revision}`,
      sourceTitle: `${objectId} @ revision ${state.revision}`,
      publisher: source.publisher,
      publishedAt: null,
      capturedAt: this.clock().toISOString(),
      asOf: state.updatedAt,
      locator: {
        objectId,
        revision: state.revision,
        updatedAt: state.updatedAt,
        ...selection.locator,
        fragmentHash,
      },
      rawValue: selection.rawValue,
      normalizedValue: selection.normalizedValue,
      unit: null,
      contentHash,
      reliability: source.reliabilityGrade,
      claimClass: 'source_conclusion',
      notes: 'Confirmed upstream Project State field. It remains a source conclusion; downstream Runtime must not upgrade upstream inference to a new external fact.',
    }
    return { records: Object.freeze([Object.freeze(record)]) }
  }
}
