import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectRepository } from '../src/state/repository.ts'

const roots: string[] = [], contexts: Context[] = []
const actor = { actorId: 'automation', name: 'Automation', role: 'system_service' }
const at = '2026-09-28T06:17:58.353Z'
const input = { proposalId: 'proposal-1', actor, committedAt: at, eventId: 'event-1',
  eventType: 'proposal.confirmed' as const, status: 'confirmed' as const,
  resolveOpenQuestions: true, stateObject: { objectId: 'PS07', value: { result: 'original native submission' } } }
async function open(root: string) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage); await ctx.plugin(StorageJson, { root }); await ctx.plugin(StorageDomain, { backend: 'json' })
  return { ctx, repository: await ProjectRepository.open(ctx.storage.domain) }
}
async function interrupted(status: 'confirmed' | 'provisionally_committed' = 'confirmed') {
  const root = await mkdtemp(join(tmpdir(), 'pre-commit-recovery-')); roots.push(root)
  const { ctx, repository } = await open(root)
  const project = await repository.createProject({ projectId: 'p1', name: 'Recovery', sessionId: 's1', createdAt: at, actor })
  await repository.saveProposal({ proposalId: input.proposalId, projectId: 'p1', expectedRevision: 0,
    idempotencyKey: 'commit-key-1', envelope: { target_object_id: 'PS07' }, createdAt: at })
  await repository.commitProposal({ ...input, status, eventType: `proposal.${status}`, resolveOpenQuestions: status === 'confirmed' })
  await repository.close(); await ctx.fiber.dispose(); contexts.splice(contexts.indexOf(ctx), 1)
  const file = join(root, 'preplanning_agent.json')
  const data = JSON.parse(await readFile(file, 'utf8'))
  data.tables.projects.p1 = project
  delete data.tables.idempotency['p1:commit-key-1']
  return { root, file, data, save: () => writeFile(file, JSON.stringify(data)) }
}
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
describe('durable confirmed commit recovery', () => {
  it.each(['confirmed', 'provisionally_committed'] as const)('recovers a persisted %s commit without creating a new decision or version', async status => {
    const f = await interrupted(status); await f.save()
    const { repository } = await open(f.root)
    const context = repository.readContext('s1')
    expect(context.project.currentRevision).toBe(1)
    expect(context.stateObjects).toMatchObject([{ objectId: 'PS07', value: input.stateObject.value }])
    expect(context.proposals[0].status).toBe(status)
    expect(context.events.filter(event => event.eventType === 'repository.commit_recovered')).toHaveLength(1)
    expect(await repository.commitProposal(input)).toMatchObject({ revision: 1, replayed: true })
    expect(repository.readContext('s1').revisions).toHaveLength(2)
  })
  it('repairs the idempotency receipt when the project pointer was already saved', async () => {
    const f = await interrupted(); f.data.tables.projects.p1.currentRevision = 1; await f.save()
    const { repository } = await open(f.root)
    expect(await repository.commitProposal(input)).toMatchObject({ revision: 1, replayed: true })
  })
  it.each(['pending', 'event-missing', 'event-actor', 'snapshot', 'state', 'idempotency', 'event-key', 'proposal-key', 'revision-id', 'parent-id', 'state-key', 'recovery-key'] as const)('does not promote an unverifiable %s record', async fault => {
    const f = await interrupted()
    if (fault === 'pending') f.data.tables.proposals['proposal-1'].status = 'pending_review'
    if (fault === 'event-missing') delete f.data.tables.events['event-1']
    if (fault === 'event-actor') f.data.tables.events['event-1'].actor.actorId = 'someone-else'
    if (fault === 'snapshot') f.data.tables.revisions['p1:1'].stateSnapshot.EXTRA = { forged: true }
    if (fault === 'state') f.data.tables.state_objects['p1:PS07'].value = { changed: true }
    if (fault === 'event-key') { f.data.tables.events['wrong-key'] = f.data.tables.events['event-1']; delete f.data.tables.events['event-1'] }
    if (fault === 'proposal-key') { f.data.tables.proposals['wrong-key'] = f.data.tables.proposals['proposal-1']; delete f.data.tables.proposals['proposal-1'] }
    if (fault === 'revision-id') f.data.tables.revisions['p1:1'].revisionId = 'wrong-key'
    if (fault === 'parent-id') f.data.tables.revisions['p1:0'].revisionId = 'wrong-key'
    if (fault === 'state-key') f.data.tables.state_objects['wrong-key'] = f.data.tables.state_objects['p1:PS07']
    if (fault === 'recovery-key') f.data.tables.events['p1:1:commit-recovered'] = {
      eventId: 'wrong-key', projectId: 'p1', revision: 1, eventType: 'repository.commit_recovered', actor, occurredAt: at,
      payload: { proposalId: 'proposal-1', originalEventId: 'event-1' } }
    if (fault === 'idempotency') f.data.tables.idempotency['p1:commit-key-1'] = {
      projectId: 'p1', idempotencyKey: 'commit-key-1', proposalId: 'other', eventId: 'other', revision: 1, createdAt: at }
    await f.save()
    const { repository } = await open(f.root)
    expect(repository.readContext('s1').project.currentRevision).toBe(0)
    expect(repository.readContext('s1').events.some(event => event.eventType === 'repository.commit_recovered')).toBe(false)
  })
  it('never uses a miskeyed project record to overwrite the canonical project', async () => {
    const f = await interrupted()
    f.data.tables.projects['wrong-key'] = structuredClone(f.data.tables.projects.p1)
    f.data.tables.projects.p1.currentRevision = 3
    await f.save()
    const { repository } = await open(f.root)
    expect(repository.readContext('s1').project.currentRevision).toBe(3)
  })
})
