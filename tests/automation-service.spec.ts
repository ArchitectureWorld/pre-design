import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import { ContractRegistry } from '../src/contracts/registry.ts'
import { GovernanceRepository } from '../src/governance/repository.ts'
import { AutomationService } from '../src/runtime/automation-service.ts'

const roots: string[] = []
const contexts: Context[] = []
const contractRoot = new URL('../contracts/v0.6/', import.meta.url)
const owner = { actorId: 'user-1', name: '策划负责人', role: 'decision_owner' }

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-preplanning-automation-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const governance = await GovernanceRepository.open(ctx.storage.domain)
  const registry = await ContractRegistry.open(contractRoot)
  return {
    automation: new AutomationService(governance, registry, () => '2026-08-28T08:00:00.000Z'),
    governance,
    registry,
  }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('AutomationService', () => {
  it('authorizes explicit workflow and gate scope, remains valid across revisions, then revokes', async () => {
    const { automation, governance, registry } = await harness()
    const workflowIds = registry.workflowIds()
    const gateIds = registry.gates().map(gate => gate.gateId)

    const authorization = await automation.authorize('project-1', {
      baseRevision: 0,
      workflowIds,
      gateIds,
      maxImages: 20,
      maxModelTurns: 120,
      stopOnBlocking: true,
      reportDepth: 'standard',
    }, owner)

    expect(automation.requireValid('project-1', 12).authorizationId).toBe(authorization.authorizationId)
    expect(governance.readProject('project-1').policy).toMatchObject({
      mode: 'automatic',
      automationAuthorizationId: authorization.authorizationId,
    })
    await automation.revoke('project-1', authorization.authorizationId, owner, '甲方切换回人工确认')
    expect(() => automation.requireValid('project-1', 13)).toThrow('no valid automation authorization')
    expect(governance.readProject('project-1').policy?.mode).toBe('manual')
  })

  it('rejects non-owner authorization and out-of-scope workflow use', async () => {
    const { automation } = await harness()
    await expect(automation.authorize('project-1', {
      baseRevision: 0,
      workflowIds: ['preplan.wf.01.01'],
      gateIds: ['G1'],
      maxImages: 12,
      maxModelTurns: 20,
      stopOnBlocking: true,
      reportDepth: 'standard',
    }, { actorId: 'agent-1', name: '智能体', role: 'agent' })).rejects.toThrow('decision_owner')

    await automation.authorize('project-1', {
      baseRevision: 0,
      workflowIds: ['preplan.wf.01.01'],
      gateIds: ['G1'],
      maxImages: 12,
      maxModelTurns: 20,
      stopOnBlocking: true,
      reportDepth: 'standard',
    }, owner)
    expect(() => automation.requireValid('project-1', 1, 'preplan.wf.02.01')).toThrow('out of scope')
  })
})
