import type { ContractRegistry } from '../contracts/registry.ts'
import type { ActorRef } from '../state/types.ts'
import type { WorkflowRuntime } from './workflow-runtime.ts'

export interface RevisionReopenRequest {
  readonly requestId: string
  readonly reason: string
  readonly actor: ActorRef
  readonly includeSource?: boolean
}

export class RevisionService {
  constructor(
    private readonly registry: ContractRegistry,
    private readonly runtime: WorkflowRuntime,
  ) {}

  async reopen(
    projectId: string,
    changedObjectIds: readonly string[],
    request: RevisionReopenRequest,
  ): Promise<readonly string[]> {
    if (request.actor.role !== 'decision_owner') throw new Error('revision reopen requires decision_owner')
    if (request.requestId.trim() === '' || request.reason.trim() === '') {
      throw new Error('revision reopen requires request id and reason')
    }
    if (changedObjectIds.length === 0) throw new Error('revision reopen requires source objects')
    for (const objectId of changedObjectIds) this.registry.stateSchema(objectId)
    const affected = [...new Set([
      ...(request.includeSource ? changedObjectIds : []),
      ...changedObjectIds.flatMap(objectId => this.registry.dependents(objectId)),
    ])].sort()
    await this.runtime.reopenObjects(projectId, affected, {
      requestId: request.requestId, reason: request.reason, actor: request.actor,
      rootObjectIds: [...new Set(changedObjectIds)],
    })
    return Object.freeze(affected)
  }
}
