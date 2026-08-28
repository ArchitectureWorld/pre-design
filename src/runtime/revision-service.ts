import type { ContractRegistry } from '../contracts/registry.ts'
import type { ActorRef } from '../state/types.ts'
import type { WorkflowRuntime } from './workflow-runtime.ts'

export interface RevisionReopenRequest {
  readonly requestId: string
  readonly reason: string
  readonly actor: ActorRef
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
    const affected = [...new Set(changedObjectIds.flatMap(objectId => this.registry.dependents(objectId)))].sort()
    for (const objectId of affected) await this.runtime.supersedeByObject(projectId, objectId)
    return Object.freeze(affected)
  }
}
