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
import { GateService } from '../src/runtime/gate-service.ts'
import { WorkflowRuntime } from '../src/runtime/workflow-runtime.ts'

const roots: string[] = []
const contexts: Context[] = []
const contractRoot = new URL('../contracts/v0.6/', import.meta.url)
const now = '2026-08-28T08:00:00.000Z'
const owner = { actorId: 'user-1', name: '策划负责人', role: 'decision_owner' }
const system = { actorId: 'system-1', name: '前期策划运行时', role: 'system_service' }

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-preplanning-gates-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const governance = await GovernanceRepository.open(ctx.storage.domain)
  const registry = await ContractRegistry.open(contractRoot)
  const runtime = new WorkflowRuntime(registry, governance, () => now)
  const automation = new AutomationService(governance, registry, () => now)
  return { automation, gates: new GateService(registry, governance, runtime, automation, () => now), governance, registry, runtime }
}

async function completeGate(projectId: string, gateId: string, fixture: Awaited<ReturnType<typeof harness>>) {
  await fixture.runtime.initializeProject(projectId)
  for (const descriptor of fixture.registry.workflows().filter(row => row.gateId === gateId)) {
    const run = fixture.governance.readProject(projectId).workflowRuns.find(row => row.workflowId === descriptor.workflowId)!
    await fixture.governance.putWorkflowRun({ ...run, status: 'confirmed', confirmedRevision: 8, updatedAt: now })
  }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('GateService', () => {
  it('requires a decision owner for human review and persists the complete gate snapshot', async () => {
    const fixture = await harness()
    await completeGate('project-1', 'G1', fixture)

    expect(fixture.gates.evaluateGate('project-1', 'G1')).toMatchObject({ ready: true, completed: 7, total: 7 })
    await expect(fixture.gates.decideGate('project-1', 'G1', {
      source: 'human_review',
      decision: 'approved',
      actor: { actorId: 'agent-1', name: '智能体', role: 'agent' },
    })).rejects.toThrow('decision_owner')

    const decision = await fixture.gates.decideGate('project-1', 'G1', {
      source: 'human_review',
      decision: 'approved_with_conditions',
      actor: owner,
    })
    expect(decision).toMatchObject({ source: 'human_review', gateId: 'G1', revision: 8, decision: 'approved_with_conditions' })
    expect(fixture.governance.readProject('project-1').gateDecisions).toHaveLength(1)
  })

  it('records the exact authorization source for an automatic gate decision', async () => {
    const fixture = await harness()
    await completeGate('project-2', 'G1', fixture)
    const authorization = await fixture.automation.authorize('project-2', {
      baseRevision: 0,
      workflowIds: fixture.registry.workflowIds(),
      gateIds: fixture.registry.gates().map(gate => gate.gateId),
      maxImages: 20,
      maxModelTurns: 120,
      stopOnBlocking: true,
      reportDepth: 'standard',
    }, owner)

    const decision = await fixture.gates.decideGate('project-2', 'G1', {
      source: 'automation_authorization',
      authorizationId: authorization.authorizationId,
      decision: 'approved',
      actor: system,
    })
    expect(decision).toMatchObject({
      source: 'automation_authorization',
      authorizationId: authorization.authorizationId,
      decidedBy: system,
    })
  })
})
