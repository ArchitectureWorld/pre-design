import { describe, expect, it } from 'vitest'
import { GovernanceContractRegistry } from '../src/governance/contracts.ts'
import { siteBoundaryFixture } from './site-boundary-fixture.ts'

const contractRoot = new URL('../contracts/v0.7/', import.meta.url)
const now = '2026-08-28T08:00:00.000Z'
const canonicalAcknowledgement = '该图是本项目采用的总平图或红线图，且图中明确表达项目边界'

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
  it('loads all nine governance schemas and validates the authorization boundary', async () => {
    const registry = await GovernanceContractRegistry.open(contractRoot)

    expect(registry.schemaIds()).toEqual([
      'artifact-manifest',
      'automation-authorization',
      'gate-decision',
      'project-policy',
      'report-package',
      'site-boundary',
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

  it('fails closed for synthetic formal boundaries and geometry maps without lineage', async () => {
    const registry = await GovernanceContractRegistry.open(contractRoot)
    const syntheticConfirmed = siteBoundaryFixture({
      origin: 'synthetic',
      submissionChannel: 'synthetic_fixture',
      status: 'confirmed_formal_boundary',
      confirmedBy: { actorId: 'owner-1', name: '项目负责人', role: 'decision_owner' },
      confirmedAt: '2026-08-30T10:05:00.000Z',
      confirmedRevision: 4,
      confirmationChannel: 'dsh_human_command',
      confirmationStatement: '项目负责人确认采用当前边界表达',
    })
    const geometryAssetWithoutLineage = {
      assetId: 'geometry-map-1', taskId: 'site-boundary-geometry', projectId: 'project-1',
      kind: 'deterministic', required: true, status: 'candidate', mimeType: 'image/svg+xml',
      fileName: 'project-1/deterministic/geometry-map-1.svg', sha256: 'b'.repeat(64),
      width: 1600, height: 1000, createdAt: '2026-08-30T10:00:00.000Z',
    }

    expect(registry.schemaIds()).toContain('site-boundary')
    expect(registry.validate('site-boundary', siteBoundaryFixture()).valid).toBe(true)
    expect(registry.validate('site-boundary', syntheticConfirmed).valid).toBe(false)
    expect(registry.validate('visual-asset-manifest', geometryAssetWithoutLineage).valid).toBe(false)
  })

  it('rejects site-boundary records that mix image and geometry payload branches', async () => {
    const registry = await GovernanceContractRegistry.open(contractRoot)
    const geometry = {
      crs: 'EPSG:4490', coordinates: [[114, 30], [114.01, 30], [114, 30.01], [114, 30]] as const,
      sha256: 'c'.repeat(64), derivedAssetId: 'derived-boundary-map-1',
      derivedFileName: 'project-1/deterministic/derived-boundary-map-1.svg', derivedSha256: 'd'.repeat(64),
    }

    expect(registry.validate('site-boundary', siteBoundaryFixture({ geometry })).valid).toBe(false)
    expect(registry.validate('site-boundary', siteBoundaryFixture({
      origin: 'user_coordinates', source: 'closed_coordinates', geometry,
    })).valid).toBe(false)
  })

  it('v0.7 以互斥分支接受真实 synthetic PNG/geometry，拒绝 synthetic confirmed 与混合载荷', async () => {
    const registry = await GovernanceContractRegistry.open(contractRoot)
    const geometry = {
      crs: 'EPSG:4490', coordinates: [[114, 30], [114.01, 30], [114, 30.01], [114, 30]] as const,
      sha256: 'c'.repeat(64), derivedAssetId: 'derived-boundary-map-1',
      derivedFileName: 'project-1/deterministic/derived-boundary-map-1.svg', derivedSha256: 'd'.repeat(64),
    }
    const syntheticImage = siteBoundaryFixture({ origin: 'synthetic', submissionChannel: 'synthetic_fixture' })
    const syntheticGeometry = siteBoundaryFixture({
      origin: 'synthetic', submissionChannel: 'synthetic_fixture', source: 'closed_coordinates',
      sourceAsset: undefined, geometry,
    })

    expect(registry.validate('site-boundary', syntheticImage)).toEqual({ valid: true, errors: [] })
    expect(registry.validate('site-boundary', syntheticGeometry)).toEqual({ valid: true, errors: [] })
    expect(registry.validate('site-boundary', {
      ...syntheticImage, status: 'confirmed_formal_boundary', confirmedBy: { actorId: 'owner-1', name: '项目负责人', role: 'decision_owner' },
      confirmedAt: now, confirmedRevision: 7, confirmationChannel: 'dsh_human_command',
      confirmationStatement: canonicalAcknowledgement,
    }).valid).toBe(false)
    expect(registry.validate('site-boundary', { ...syntheticImage, geometry }).valid).toBe(false)
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
