import type { ContractRegistry } from '../contracts/registry.ts'
import type { GovernanceRepository } from '../governance/repository.ts'
import type { GateDecisionRecord } from '../governance/types.ts'
import type { ActorRef } from '../state/types.ts'
import type { AutomationService } from './automation-service.ts'
import type { WorkflowRuntime } from './workflow-runtime.ts'

export interface GateEvaluation {
  readonly projectId: string
  readonly gateId: string
  readonly ready: boolean
  readonly completed: number
  readonly total: number
  readonly blocked: number
  readonly revision: number
  readonly requiredObjectIds: readonly string[]
}

export type GateDecisionInput =
  | {
    readonly source: 'human_review'
    readonly decision: GateDecisionRecord['decision']
    readonly actor: ActorRef
    readonly reason?: string
  }
  | {
    readonly source: 'automation_authorization'
    readonly authorizationId: string
    readonly decision: GateDecisionRecord['decision']
    readonly actor: ActorRef
    readonly reason?: string
  }

export class GateService {
  constructor(
    private readonly registry: ContractRegistry,
    private readonly governance: GovernanceRepository,
    private readonly runtime: WorkflowRuntime,
    private readonly automation: AutomationService,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  evaluateGate(projectId: string, gateId: string): GateEvaluation {
    const gate = this.registry.gate(gateId)
    const required = new Set(gate.requiredObjectIds)
    const runs = this.runtime.snapshot(projectId).runs.filter(run => required.has(run.targetObjectId))
    const completed = runs.filter(run => run.status === 'confirmed' || run.status === 'not_applicable')
    const blocked = runs.filter(run => run.status === 'blocked').length
    const revision = Math.max(0, ...completed.map(run => run.confirmedRevision ?? 0))
    return {
      projectId,
      gateId,
      ready: runs.length === gate.requiredObjectIds.length && completed.length === runs.length && blocked === 0,
      completed: completed.length,
      total: gate.requiredObjectIds.length,
      blocked,
      revision,
      requiredObjectIds: gate.requiredObjectIds,
    }
  }

  async decideGate(projectId: string, gateId: string, input: GateDecisionInput): Promise<GateDecisionRecord> {
    const evaluation = this.evaluateGate(projectId, gateId)
    if ((input.decision === 'approved' || input.decision === 'approved_with_conditions') && !evaluation.ready) {
      throw new Error(`gate '${gateId}' is not ready for approval`)
    }
    let authorizationId: string | undefined
    if (input.source === 'human_review') {
      if (input.actor.role !== 'decision_owner') throw new Error('human gate review requires decision_owner')
    } else {
      if (input.actor.role !== 'system_service') throw new Error('automatic gate decision requires system_service')
      const authorization = this.automation.requireValid(projectId, evaluation.revision, undefined, gateId)
      if (authorization.authorizationId !== input.authorizationId) {
        throw new Error(`automation authorization '${input.authorizationId}' is not active for gate '${gateId}'`)
      }
      authorizationId = input.authorizationId
    }
    const record: GateDecisionRecord = {
      decisionId: `${projectId}:${gateId}:r${evaluation.revision}:${input.source}`,
      projectId,
      gateId,
      revision: evaluation.revision,
      decision: input.decision,
      source: input.source,
      ...(authorizationId === undefined ? {} : { authorizationId }),
      decidedBy: input.actor,
      decidedAt: this.now(),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      snapshot: {
        completed: evaluation.completed,
        total: evaluation.total,
        blocked: evaluation.blocked,
        requiredObjectIds: [...evaluation.requiredObjectIds],
      },
    }
    await this.governance.putGateDecision(record)
    return record
  }
}
