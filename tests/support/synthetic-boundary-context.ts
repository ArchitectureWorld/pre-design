import type { SiteBoundaryExecutionContext } from '../../src/governance/site-boundary-service.ts'

export function syntheticBoundaryContext(): SiteBoundaryExecutionContext {
  return {
    actor: { actorId: 'synthetic-fixture', name: '合成测试夹具', role: 'decision_owner' },
    channel: 'synthetic_fixture',
  }
}
