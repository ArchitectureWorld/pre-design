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
import { WorkflowRuntime } from '../src/runtime/workflow-runtime.ts'

const contractRoot = new URL('../contracts/v0.6/', import.meta.url)
const roots: string[] = []
const contexts: Context[] = []
const now = '2026-08-28T08:00:00.000Z'

async function openRuntime() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-preplanning-runtime-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const governance = await GovernanceRepository.open(ctx.storage.domain)
  const registry = await ContractRegistry.open(contractRoot)
  return new WorkflowRuntime(registry, governance, () => now)
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('WorkflowRuntime', () => {
  it('initializes the persisted 57-item graph with one ready item and eight chapter summaries', async () => {
    const runtime = await openRuntime()

    await runtime.initializeProject('project-1')
    const snapshot = runtime.snapshot('project-1')

    expect(snapshot.runs).toHaveLength(57)
    expect(snapshot.chapters).toHaveLength(8)
    expect(snapshot.chapters.map(chapter => chapter.total)).toEqual([7, 8, 6, 6, 7, 7, 8, 8])
    expect(snapshot.runs.filter(run => run.status === 'ready')).toHaveLength(1)
    expect(runtime.nextReady('project-1')?.workflowId).toBe('preplan.wf.01.01')
  })

  it('unlocks downstream work from confirmed objects and persists blockers', async () => {
    const runtime = await openRuntime()
    await runtime.initializeProject('project-1')

    await runtime.transition('project-1', 'preplan.wf.01.01', { to: 'running' })
    await runtime.transition('project-1', 'preplan.wf.01.01', { to: 'confirmed', revision: 1 })

    expect(runtime.nextReady('project-1')?.workflowId).toBe('preplan.wf.01.02')
    await runtime.transition('project-1', 'preplan.wf.01.02', {
      to: 'blocked',
      reason: '缺少权属文件',
    })
    expect(runtime.snapshot('project-1').blocked).toEqual([
      expect.objectContaining({
        workflowId: 'preplan.wf.01.02',
        status: 'blocked',
        blockedReason: '缺少权属文件',
      }),
    ])
  })

  it('fails closed on illegal transitions and missing required transition data', async () => {
    const runtime = await openRuntime()
    await runtime.initializeProject('project-1')

    await expect(runtime.transition('project-1', 'preplan.wf.01.01', { to: 'blocked' }))
      .rejects.toThrow('blocked transition requires a reason')
    expect(runtime.snapshot('project-1').runs[0]?.status).toBe('ready')

    await runtime.transition('project-1', 'preplan.wf.01.01', {
      to: 'blocked',
      reason: '等待项目任务书',
    })
    await expect(runtime.transition('project-1', 'preplan.wf.01.01', { to: 'confirmed', revision: 1 }))
      .rejects.toThrow("illegal workflow transition 'blocked' -> 'confirmed'")
    expect(runtime.snapshot('project-1').runs[0]?.status).toBe('blocked')
  })
})
