import type { ContractRegistry } from '../contracts/registry.ts'
import type { GovernanceRepository } from '../governance/repository.ts'
import type { GateService } from './gate-service.ts'

interface AutomaticGateApproverDependencies {
  readonly registry: Pick<ContractRegistry, 'gates'>
  readonly governance: Pick<GovernanceRepository, 'readProject'>
  readonly gates: Pick<GateService, 'evaluateGate' | 'decideGate'>
}

export class AutomaticGateApprover {
  constructor(private readonly dependencies: AutomaticGateApproverDependencies) {}

  async approveReady(projectId: string): Promise<number> {
    const governed = this.dependencies.governance.readProject(projectId)
    const authorizationId = governed.policy?.mode === 'automatic'
      ? governed.policy.automationAuthorizationId
      : undefined
    if (authorizationId === undefined) return 0

    let approved = 0
    for (const descriptor of this.dependencies.registry.gates()) {
      const evaluation = this.dependencies.gates.evaluateGate(projectId, descriptor.gateId)
      if (!evaluation.ready) continue
      const alreadyApproved = governed.gateDecisions.some(decision =>
        decision.gateId === descriptor.gateId
        && decision.revision >= evaluation.revision
        && (decision.decision === 'approved' || decision.decision === 'approved_with_conditions'))
      if (alreadyApproved) continue
      await this.dependencies.gates.decideGate(projectId, descriptor.gateId, {
        source: 'automation_authorization',
        authorizationId,
        decision: 'approved',
        actor: {
          actorId: 'preplanning-automation',
          name: '前期策划自动化服务',
          role: 'system_service',
        },
      })
      approved += 1
    }
    return approved
  }
}
