import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContractRegistry } from '../src/contracts/registry.ts'
import { GovernanceRepository } from '../src/governance/repository.ts'
import { RevisionService } from '../src/runtime/revision-service.ts'
import { WorkflowRuntime } from '../src/runtime/workflow-runtime.ts'
import { ProjectRepository } from '../src/state/repository.ts'
import { ProposalGateway } from '../src/proposals/gateway.ts'
import { AutomationService } from '../src/runtime/automation-service.ts'
import { AutomationWorkflowCommitter } from '../src/runtime/automation-workflow-committer.ts'

const roots: string[] = []
const contexts: Context[] = []
const contractRoot = new URL('../contracts/v0.6/', import.meta.url)

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-revision-replay-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const governance = await GovernanceRepository.open(ctx.storage.domain)
  const registry = await ContractRegistry.open(contractRoot)
  const runtime = new WorkflowRuntime(registry, governance)
  await runtime.initializeProject('p')
  for (const run of runtime.snapshot('p').runs) {
    await governance.putWorkflowRun({ ...run, status: 'confirmed', confirmedRevision: 57, proposalId: 'old',
      quality: { workflowId: run.workflowId, targetObjectId: run.targetObjectId, disposition: 'auto_pass',
        score: 1, completionCoverage: 1, evidenceCoverage: 1, confidence: 1, attempt: 1,
        maxAttempts: 3, reasons: [], blockers: [], assumptions: [] } })
  }
  return { ctx, registry, governance, runtime, revisions: new RevisionService(registry, runtime) }
}

const repairRequest = { requestId: 'audit-1', reason: 'Remove unsupported dam distance; keep legal boundary unknown.',
  actor: { actorId: 'user', name: '策划负责人', role: 'decision_owner' }, includeSource: true }

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('RevisionService', () => {
  it('replaces a corrected object through the real Gateway and preserves the prior revision and authorization', async () => {
    const h = await setup()
    const repository = await ProjectRepository.open(h.ctx.storage.domain)
    await repository.createProject({ projectId: 'p', sessionId: 's', name: '修订验证', createdAt: '2026-09-17T00:00:00Z', actor: repairRequest.actor })
    const automation = new AutomationService(h.governance, h.registry)
    const auth = await automation.authorize('p', { baseRevision: 0, workflowIds: h.registry.workflowIds(), gateIds: ['G1'], maxImages: 0, maxModelTurns: 120, stopOnBlocking: true, reportDepth: 'standard' }, repairRequest.actor)
    const gateway = new ProposalGateway(repository, h.registry, undefined, h.governance)
    const committer = new AutomationWorkflowCommitter({ repository, registry: h.registry, governance: h.governance, gateway })
    const descriptor = h.registry.workflow('preplan.wf.01.01')
    const quality = { workflowId: descriptor.workflowId, targetObjectId: 'PS01', disposition: 'auto_pass' as const, score: 1, completionCoverage: 1, evidenceCoverage: 1, confidence: 1, attempt: 1, maxAttempts: 3, reasons: [], blockers: [], assumptions: [] }
    const payload = structuredClone(h.registry.stateExample('PS01'))
    const first = await committer.commit({ id: 's' } as never, 'p', descriptor, { payload }, quality)
    const original = structuredClone(repository.readContext('s').stateObjects[0]?.value)
    await h.revisions.reopen('p', ['PS01'], repairRequest)
    await h.runtime.transition('p', descriptor.workflowId, { to: 'running' })
    await expect(committer.commit({ id: 's' } as never, 'p', descriptor, { payload })).rejects.toThrow(/quality/)
    const corrected = { ...payload, data: { ...(payload.data as Record<string, unknown>), canonical_name: '修订后的项目名称' } }
    const second = await committer.commit({ id: 's' } as never, 'p', descriptor, { payload: corrected }, quality)
    await h.runtime.transition('p', descriptor.workflowId, { to: 'confirmed', revision: second.revision, proposalId: second.proposalId, quality })
    expect([first.revision, second.revision]).toEqual([1, 2])
    expect(repository.readProjectRevision('p', 1).stateSnapshot.PS01).toEqual(original)
    expect(repository.readProjectRevision('p', 2).stateSnapshot.PS01).toMatchObject({ data: { canonical_name: '修订后的项目名称' } })
    expect(repository.readContext('s').proposals.find(row => row.proposalId === second.proposalId)?.envelope).toMatchObject({ expected_revision: 1, change_set: { operation: 'replace' } })
    expect(h.governance.readProject('p').policy?.automationAuthorizationId).toBe(auth.authorizationId)
    expect(h.governance.readProject('p').authorizations[0]?.scope.maxModelTurns).toBe(120)
  })
  it('reopens faulty sources and downstream in dependency order with durable feedback and no stale quality', async () => {
    const h = await setup()
    const affected = await h.revisions.reopen('p', ['BL01', 'PG06'], repairRequest)
    expect(affected).toContain('BL01')
    expect(affected).toContain('PG06')
    expect(affected).toContain('SP07')
    const runs = h.runtime.snapshot('p').runs
    expect(runs.find(r => r.targetObjectId === 'PS01')?.status).toBe('confirmed')
    expect(runs.find(r => r.targetObjectId === 'BL01')?.status).toBe('ready')
    expect(runs.find(r => r.targetObjectId === 'PG06')?.status).toBe('superseded')
    for (const run of runs.filter(r => affected.includes(r.targetObjectId))) {
      expect(run.quality).toBeUndefined()
      expect(run.proposalId).toBeUndefined()
      expect(run.confirmedRevision).toBeUndefined()
      expect(run.revisionRequest).toMatchObject({ requestId: 'audit-1', reason: repairRequest.reason })
    }
    await h.governance.close()
    const restarted = new WorkflowRuntime(h.registry, await GovernanceRepository.open(h.ctx.storage.domain))
    await restarted.initializeProject('p')
    expect(restarted.snapshot('p').runs.find(r => r.targetObjectId === 'SP07')?.revisionRequest?.reason).toBe(repairRequest.reason)
    await restarted.transition('p', 'preplan.wf.02.01', { to: 'running' })
    await restarted.transition('p', 'preplan.wf.02.01', { to: 'confirmed', revision: 58 })
    expect(restarted.ready('p').map(r => r.targetObjectId)).toContain('DG01')
    expect(restarted.ready('p').map(r => r.targetObjectId)).not.toContain('SP07')
  })

  it('rejects active or unknown targets before invalidating any work', async () => {
    const h = await setup()
    const before = h.runtime.snapshot('p')
    await expect(h.revisions.reopen('p', ['BL01', 'BOGUS'], repairRequest)).rejects.toThrow()
    expect(h.runtime.snapshot('p')).toEqual(before)
    const run = before.runs.find(r => r.targetObjectId === 'SP07')!
    await h.governance.putWorkflowRun({ ...run, status: 'running' })
    const active = h.runtime.snapshot('p')
    await expect(h.revisions.reopen('p', ['BL01'], repairRequest)).rejects.toThrow(/running|active/i)
    expect(h.runtime.snapshot('p')).toEqual(active)
  })

  it('rejects reopen while a workflow transition write is still in flight', async () => {
    const h = await setup()
    const run = h.runtime.snapshot('p').runs.find(r => r.targetObjectId === 'BL01')!
    await h.governance.putWorkflowRun({ ...run, status: 'ready' })
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const original = h.governance.putWorkflowRun.bind(h.governance)
    vi.spyOn(h.governance, 'putWorkflowRun').mockImplementationOnce(async record => { await waiting; return original(record) })
    const transition = h.runtime.transition('p', run.workflowId, { to: 'running' })
    try {
      await expect(h.revisions.reopen('p', ['BL01'], repairRequest)).rejects.toThrow(/active|running/i)
      expect(h.governance.readProject('p').workflowRevisions).toEqual([])
    } finally { release(); await transition }
  })

  it('keeps partial invalidation undispatchable and completes it on restart without losing the audit reason', async () => {
    const h = await setup()
    const original = h.governance.putWorkflowRun.bind(h.governance)
    let writes = 0
    const spy = vi.spyOn(h.governance, 'putWorkflowRun').mockImplementation(async record => {
      if (++writes === 2) throw new Error('simulated interrupted write')
      return original(record)
    })
    await expect(h.revisions.reopen('p', ['BL01'], repairRequest)).rejects.toThrow('interrupted write')
    expect(h.runtime.ready('p')).toEqual([])
    spy.mockRestore()
    const restarted = new WorkflowRuntime(h.registry, h.governance)
    await restarted.initializeProject('p')
    expect(restarted.ready('p').map(r => r.targetObjectId)).toEqual(['BL01'])
    expect(restarted.snapshot('p').runs.find(r => r.targetObjectId === 'SP07')).toMatchObject({ status: 'superseded', revisionRequest: { requestId: 'audit-1' } })
    expect(h.governance.readProject('p').workflowRevisions).toEqual([expect.objectContaining({ status: 'applied', reason: repairRequest.reason })])
  })

  it('supersedes only the transitive downstream closure and preserves unrelated confirmed work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-preplanning-revision-'))
    roots.push(root)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    const governance = await GovernanceRepository.open(ctx.storage.domain)
    const registry = await ContractRegistry.open(contractRoot)
    const runtime = new WorkflowRuntime(registry, governance, () => '2026-08-28T09:00:00.000Z')
    await runtime.initializeProject('project-1')
    for (const run of runtime.snapshot('project-1').runs) {
      await governance.putWorkflowRun({ ...run, status: 'confirmed', confirmedRevision: 57 })
    }
    const revisions = new RevisionService(registry, runtime)

    const reopened = await revisions.reopen('project-1', ['PS04'], {
      requestId: 'revision-request-1',
      reason: '甲方调整研究边界',
      actor: { actorId: 'user-1', name: '策划负责人', role: 'decision_owner' },
    })

    expect(reopened).toEqual(registry.dependents('PS04'))
    expect(runtime.snapshot('project-1').runs.find(run => run.targetObjectId === 'PS01')?.status).toBe('confirmed')
    expect(runtime.snapshot('project-1').runs.find(run => run.targetObjectId === 'PS04')?.status).toBe('confirmed')
    expect(runtime.snapshot('project-1').runs.filter(run => reopened.includes(run.targetObjectId)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ status: 'superseded' })]))
  })
})
