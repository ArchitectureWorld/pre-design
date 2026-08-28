import { randomUUID } from 'node:crypto'
import type { ContractRegistry } from '../contracts/registry.ts'
import type { GovernanceRepository } from '../governance/repository.ts'
import type { AutomationAuthorizationRecord, ReportDepth } from '../governance/types.ts'
import type { ActorRef } from '../state/types.ts'

export interface AutomationAuthorizationInput {
  readonly baseRevision: number
  readonly workflowIds: readonly string[]
  readonly gateIds: readonly string[]
  readonly maxImages: number
  readonly maxModelTurns: number
  readonly stopOnBlocking: boolean
  readonly reportDepth: ReportDepth
  readonly expiresAt?: string
}

export class AutomationService {
  constructor(
    private readonly governance: GovernanceRepository,
    private readonly registry: ContractRegistry,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async authorize(
    projectId: string,
    input: AutomationAuthorizationInput,
    actor: ActorRef,
  ): Promise<AutomationAuthorizationRecord> {
    this.requireOwner(actor)
    const workflowIds = [...new Set(input.workflowIds)]
    const gateIds = [...new Set(input.gateIds)]
    const descriptors = workflowIds.map(workflowId => this.registry.workflow(workflowId))
    for (const gateId of gateIds) this.registry.gate(gateId)
    const chapterIds = [...new Set(descriptors.map(descriptor => descriptor.chapterId))].sort()
    const grantedAt = this.now()
    const authorization: AutomationAuthorizationRecord = {
      authorizationId: `authorization-${randomUUID()}`,
      projectId,
      grantedBy: actor,
      startingRevision: input.baseRevision,
      scope: {
        chapterIds,
        workflowIds,
        gateIds,
        maxVisualGenerations: input.maxImages,
        maxModelTurns: input.maxModelTurns,
        stopOnBlocking: input.stopOnBlocking,
      },
      status: 'active',
      grantedAt,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    }
    await this.governance.putAuthorization(authorization)
    await this.governance.putPolicy({
      projectId,
      mode: 'automatic',
      reportDepth: input.reportDepth,
      automationAuthorizationId: authorization.authorizationId,
      updatedAt: grantedAt,
    })
    return authorization
  }

  async revoke(
    projectId: string,
    authorizationId: string,
    actor: ActorRef,
    reason: string,
  ): Promise<AutomationAuthorizationRecord> {
    this.requireOwner(actor)
    const context = this.governance.readProject(projectId)
    const authorization = context.authorizations.find(row => row.authorizationId === authorizationId)
    if (authorization === undefined || authorization.status !== 'active') {
      throw new Error(`active automation authorization '${authorizationId}' not found`)
    }
    const revokedAt = this.now()
    const revoked: AutomationAuthorizationRecord = {
      ...authorization,
      status: 'revoked',
      revokedAt,
      revokedBy: actor,
      revocationReason: reason,
    }
    await this.governance.putAuthorization(revoked)
    await this.governance.putPolicy({
      projectId,
      mode: 'manual',
      reportDepth: context.policy?.reportDepth ?? 'standard',
      visualPolicyId: context.policy?.visualPolicyId,
      updatedAt: revokedAt,
    })
    return revoked
  }

  requireValid(
    projectId: string,
    revision: number,
    workflowId?: string,
    gateId?: string,
  ): AutomationAuthorizationRecord {
    const now = this.now()
    const context = this.governance.readProject(projectId)
    const authorization = context.authorizations.find(row =>
      row.status === 'active'
      && row.startingRevision <= revision
      && (row.expiresAt === undefined || row.expiresAt > now)
      && (context.policy?.automationAuthorizationId === undefined
        || context.policy.automationAuthorizationId === row.authorizationId))
    if (context.policy?.mode !== 'automatic' || authorization === undefined) {
      throw new Error(`no valid automation authorization for project '${projectId}'`)
    }
    if (workflowId !== undefined && !authorization.scope.workflowIds.includes(workflowId)) {
      throw new Error(`workflow '${workflowId}' is out of scope for automation authorization`)
    }
    if (gateId !== undefined && !authorization.scope.gateIds.includes(gateId)) {
      throw new Error(`gate '${gateId}' is out of scope for automation authorization`)
    }
    return authorization
  }

  private requireOwner(actor: ActorRef): void {
    if (actor.role !== 'decision_owner') throw new Error('automation authorization requires decision_owner')
  }
}
