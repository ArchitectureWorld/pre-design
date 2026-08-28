import { describe, expect, it } from 'vitest'
import { GovernanceContractRegistry } from '../src/governance/contracts.ts'

const contractRoot = new URL('../contracts/v0.7/', import.meta.url)
const now = '2026-08-28T08:00:00.000Z'

const validAuthorization = {
  authorizationId: 'auth-project-1-001',
  projectId: 'project-1',
  grantedBy: {
    actorId: 'user-1',
    name: '策划负责人',
    role: 'decision_owner',
  },
  startingRevision: 0,
  scope: {
    chapterIds: ['01', '02'],
    workflowIds: ['preplan.wf.01.01'],
    gateIds: ['G1'],
    maxVisualGenerations: 20,
    maxModelTurns: 120,
    stopOnBlocking: true,
  },
  status: 'active',
  grantedAt: now,
  expiresAt: '2026-09-28T08:00:00.000Z',
}

const validGate = {
  decisionId: 'gate-project-1-G1-r7',
  projectId: 'project-1',
  gateId: 'G1',
  revision: 7,
  decision: 'approved',
  source: 'human_review',
  decidedBy: {
    actorId: 'user-1',
    name: '策划负责人',
    role: 'decision_owner',
  },
  decidedAt: now,
}

describe('GovernanceContractRegistry', () => {
  it('loads all eight governance schemas and validates the authorization boundary', async () => {
    const registry = await GovernanceContractRegistry.open(contractRoot)

    expect(registry.schemaIds()).toEqual([
      'artifact-manifest',
      'automation-authorization',
      'gate-decision',
      'project-policy',
      'report-package',
      'visual-asset-manifest',
      'visual-generation-policy',
      'workflow-run',
    ])
    expect(registry.validate('automation-authorization', validAuthorization)).toEqual({
      valid: true,
      errors: [],
    })
    expect(registry.validate('gate-decision', validGate)).toEqual({
      valid: true,
      errors: [],
    })
  })

  it('rejects an unregistered gate decision source and unknown schema id', async () => {
    const registry = await GovernanceContractRegistry.open(contractRoot)

    const invalid = registry.validate('gate-decision', { ...validGate, source: 'human' })
    expect(invalid.valid).toBe(false)
    expect(invalid.errors.join('\n')).toContain('must be equal to one of the allowed values')
    expect(() => registry.validate('not-registered', {})).toThrow(
      "unknown governance contract: not-registered",
    )
  })
})
