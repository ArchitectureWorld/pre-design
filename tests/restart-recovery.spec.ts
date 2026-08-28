import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectRepository } from '../src/state/repository.ts'

const roots: string[] = []
const contexts: Context[] = []

async function openAt(root: string) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const repository = await ProjectRepository.open(ctx.storage.domain)
  return { ctx, repository }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('真实 StorageJson 重启恢复', () => {
  it('重开相同 JSON root 后恢复项目、绑定、问题和 revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-preplanning-restart-'))
    roots.push(root)
    const first = await openAt(root)
    await first.repository.createProject({
      projectId: 'project-restart',
      name: '重启恢复验收项目',
      sessionId: 'session-restart',
      createdAt: '2026-08-27T15:00:00.000Z',
      actor: { actorId: 'user-1', name: '策划负责人', role: 'decision_owner' },
    })
    await first.repository.saveProposal({
      proposalId: 'proposal-restart',
      projectId: 'project-restart',
      expectedRevision: 0,
      idempotencyKey: 'idempotency-restart',
      envelope: { target_object_id: 'PS01' },
      createdAt: '2026-08-27T15:01:00.000Z',
    })
    await first.repository.confirmProposal({
      proposalId: 'proposal-restart',
      actor: { actorId: 'user-1', name: '策划负责人', role: 'decision_owner' },
      confirmedAt: '2026-08-27T15:02:00.000Z',
      eventId: 'event-restart',
      stateObject: { objectId: 'PS01', value: { object_id: 'PS01', revision: 1 } },
    })

    const beforeRestart = first.repository.readContext('session-restart')
    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)

    const second = await openAt(root)
    expect(second.repository.readContext('session-restart')).toEqual(beforeRestart)
    expect(second.repository.readContext('session-restart')).toMatchObject({
      project: { projectId: 'project-restart', currentRevision: 1 },
      binding: { sessionId: 'session-restart', projectId: 'project-restart' },
      questions: [expect.objectContaining({ priority: 100, status: 'resolved' })],
      stateObjects: [expect.objectContaining({ objectId: 'PS01', revision: 1 })],
    })
  })
})
