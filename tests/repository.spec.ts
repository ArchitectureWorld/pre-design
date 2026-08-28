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
const createdAt = '2026-08-27T14:00:00.000Z'
const humanActor = { actorId: 'user-1', name: '策划负责人', role: 'decision_owner' }

async function openRepository() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-preplanning-repository-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const repository = await ProjectRepository.open(ctx.storage.domain)
  return { repository, root }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('ProjectRepository', () => {
  it('创建 revision 0 项目并持久化 SessionBinding 与唯一最高优先级问题', async () => {
    const { repository } = await openRepository()

    await repository.createProject({
      projectId: 'project-1',
      name: '鄂州城市更新前期策划',
      sessionId: 'session-1',
      createdAt,
      actor: humanActor,
    })

    const context = repository.readContext('session-1')
    expect(context.project).toMatchObject({ projectId: 'project-1', currentRevision: 0 })
    expect(context.binding).toEqual({
      sessionId: 'session-1',
      projectId: 'project-1',
      boundAt: createdAt,
    })
    expect(context.revisions).toEqual([
      expect.objectContaining({ projectId: 'project-1', revision: 0, stateSnapshot: {} }),
    ])
    expect(context.questions).toEqual([
      expect.objectContaining({
        projectId: 'project-1',
        priority: 100,
        status: 'open',
      }),
    ])
    expect(repository.listProjects()).toEqual([
      expect.objectContaining({ projectId: 'project-1', name: '鄂州城市更新前期策划' }),
    ])
  })

  it('将新 Session 绑定到已存在项目并可从该 Session 读回上下文', async () => {
    const { repository } = await openRepository()
    await repository.createProject({
      projectId: 'project-1',
      name: '鄂州城市更新前期策划',
      sessionId: 'session-1',
      createdAt,
      actor: humanActor,
    })

    await repository.bindSession('session-2', 'project-1', '2026-08-27T14:00:30.000Z')

    expect(repository.readContext('session-2').binding).toEqual({
      sessionId: 'session-2',
      projectId: 'project-1',
      boundAt: '2026-08-27T14:00:30.000Z',
    })
  })

  it('使 revision 单调递增、拒绝重复审计事件，并在冲突或幂等重放时不产生新写入', async () => {
    const { repository } = await openRepository()
    await repository.createProject({
      projectId: 'project-1',
      name: '鄂州城市更新前期策划',
      sessionId: 'session-1',
      createdAt,
      actor: humanActor,
    })
    await repository.saveProposal({
      proposalId: 'proposal-1',
      projectId: 'project-1',
      expectedRevision: 0,
      idempotencyKey: 'idempotency-0001',
      envelope: { target_object_id: 'PS01' },
      createdAt: '2026-08-27T14:01:00.000Z',
    })
    await repository.saveProposal({
      proposalId: 'proposal-stale',
      projectId: 'project-1',
      expectedRevision: 0,
      idempotencyKey: 'idempotency-0002',
      envelope: { target_object_id: 'PS01' },
      createdAt: '2026-08-27T14:01:30.000Z',
    })

    const first = await repository.confirmProposal({
      proposalId: 'proposal-1',
      actor: humanActor,
      confirmedAt: '2026-08-27T14:02:00.000Z',
      eventId: 'event-confirm-1',
      stateObject: { objectId: 'PS01', value: { object_id: 'PS01', revision: 1 } },
    })
    expect(first).toEqual({
      projectId: 'project-1',
      proposalId: 'proposal-1',
      revision: 1,
      replayed: false,
    })

    const replay = await repository.confirmProposal({
      proposalId: 'proposal-1',
      actor: humanActor,
      confirmedAt: '2026-08-27T14:03:00.000Z',
      eventId: 'event-confirm-1',
      stateObject: { objectId: 'PS01', value: { object_id: 'PS01', revision: 1 } },
    })
    expect(replay).toEqual({ ...first, replayed: true })

    const beforeConflict = repository.readContext('session-1')
    await expect(repository.confirmProposal({
      proposalId: 'proposal-stale',
      actor: humanActor,
      confirmedAt: '2026-08-27T14:04:00.000Z',
      eventId: 'event-confirm-stale',
      stateObject: { objectId: 'PS01', value: { object_id: 'PS01', revision: 2 } },
    })).rejects.toThrow('expected revision 0, current revision is 1')
    expect(repository.readContext('session-1')).toEqual(beforeConflict)

    await repository.saveProposal({
      proposalId: 'proposal-duplicate-event',
      projectId: 'project-1',
      expectedRevision: 1,
      idempotencyKey: 'idempotency-0003',
      envelope: { target_object_id: 'PS01' },
      createdAt: '2026-08-27T14:05:00.000Z',
    })
    const beforeDuplicate = repository.readContext('session-1')
    await expect(repository.confirmProposal({
      proposalId: 'proposal-duplicate-event',
      actor: humanActor,
      confirmedAt: '2026-08-27T14:06:00.000Z',
      eventId: 'event-confirm-1',
      stateObject: { objectId: 'PS01', value: { object_id: 'PS01', revision: 2 } },
    })).rejects.toThrow("audit event 'event-confirm-1' already exists")
    expect(repository.readContext('session-1')).toEqual(beforeDuplicate)

    const context = repository.readContext('session-1')
    expect(context.project.currentRevision).toBe(1)
    expect(context.revisions.map(revision => revision.revision)).toEqual([0, 1])
    expect(context.events.filter(event => event.eventId === 'event-confirm-1')).toHaveLength(1)
  })

  it('按项目与 Revision 读取不可变快照供报告冻结', async () => {
    const { repository } = await openRepository()
    await repository.createProject({
      projectId: 'project-1', name: '冻结报告项目', sessionId: 'session-1', createdAt, actor: humanActor,
    })
    await repository.saveProposal({
      proposalId: 'proposal-1', projectId: 'project-1', expectedRevision: 0,
      idempotencyKey: 'report-freeze-1', envelope: { target_object_id: 'PS01' }, createdAt,
    })
    await repository.confirmProposal({
      proposalId: 'proposal-1', actor: humanActor, confirmedAt: '2026-08-27T14:02:00.000Z',
      eventId: 'event-report-1', stateObject: { objectId: 'PS01', value: { title: '项目身份', conclusion: '滨江文化活力区' } },
    })

    expect(repository.readProjectRevision('project-1', 0).stateSnapshot).toEqual({})
    expect(repository.readProjectRevision('project-1', 1)).toMatchObject({
      project: { projectId: 'project-1', name: '冻结报告项目' },
      revision: { revision: 1 },
      stateSnapshot: { PS01: { title: '项目身份', conclusion: '滨江文化活力区' } },
    })
  })
})
