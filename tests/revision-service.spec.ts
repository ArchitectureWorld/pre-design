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
import { RevisionService } from '../src/runtime/revision-service.ts'
import { WorkflowRuntime } from '../src/runtime/workflow-runtime.ts'

const roots: string[] = []
const contexts: Context[] = []
const contractRoot = new URL('../contracts/v0.6/', import.meta.url)

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('RevisionService', () => {
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
