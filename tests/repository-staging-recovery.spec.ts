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
const at = '2026-09-28T09:06:30.615Z'
const payload = { object_id: 'OP04', data: { basis: 'Original native result' }, status: 'provisional',
  revision: 1, updated_at: at, approval: { status: 'pending', approver: null, approved_at: null } }
async function open(root: string) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage); await ctx.plugin(StorageJson, { root }); await ctx.plugin(StorageDomain, { backend: 'json' })
  return { ctx, repository: await ProjectRepository.open(ctx.storage.domain) }
}
async function interrupted() {
  const root = await mkdtemp(join(tmpdir(), 'pre-staging-recovery-')); roots.push(root)
  const { ctx, repository } = await open(root)
  const project = await repository.createProject({ projectId: 'p1', name: 'Recovery', sessionId: 's1', createdAt: at, actor })
  const proposal = await repository.saveProposal({ proposalId: 'proposal-1', projectId: 'p1', expectedRevision: 0,
    idempotencyKey: 'commit-key-1', envelope: { project_id: 'p1', proposal_id: 'proposal-1', expected_revision: 0,
      target_object_id: 'OP04', change_set: { operation: 'create', payload } }, createdAt: at })
  await repository.commitProposal({ proposalId: 'proposal-1', actor, committedAt: at, eventId: 'event-1',
    eventType: 'proposal.confirmed', status: 'confirmed', resolveOpenQuestions: false,
    stateObject: { objectId: 'OP04', value: { ...payload, status: 'confirmed', approval: {
      status: 'approved', approver: actor, approved_at: at } } } })
  await repository.close(); await ctx.fiber.dispose(); contexts.splice(contexts.indexOf(ctx), 1)
  const file = join(root, 'preplanning_agent.json'), data = JSON.parse(await readFile(file, 'utf8'))
  data.tables.projects.p1 = project; data.tables.proposals['proposal-1'] = proposal
  delete data.tables.events['event-1']; delete data.tables.idempotency['p1:commit-key-1']
  return { root, file, data, save: () => writeFile(file, JSON.stringify(data)) }
}
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
describe('unconfirmed new-object staging recovery', () => {
  it('archives incomplete writes without approving them, allowing a fresh native proposal at the same head', async () => {
    const f = await interrupted(); await f.save()
    const staged = structuredClone(f.data.tables.revisions['p1:1'])
    const { repository } = await open(f.root)
    const context = repository.readContext('s1')
    expect(context.project.currentRevision).toBe(0)
    expect(context.proposals[0].status).toBe('pending_review')
    expect(context.stateObjects).toHaveLength(0)
    expect(context.events.find(e => e.eventType === 'repository.staging_aborted')?.payload).toMatchObject({ stagedRevision: staged })
    await repository.saveProposal({ proposalId: 'proposal-2', projectId: 'p1', expectedRevision: 0,
      idempotencyKey: 'fresh-key-2', envelope: {}, createdAt: at })
    expect(await repository.commitProposal({ proposalId: 'proposal-2', actor, committedAt: at, eventId: 'event-2',
      eventType: 'proposal.confirmed', status: 'confirmed', resolveOpenQuestions: false,
      stateObject: { objectId: 'OP04', value: { fresh: 'A separately reviewed native result' } } })).toMatchObject({ revision: 1 })
  })
  it.each(['event', 'receipt', 'confirmed', 'wrong-payload', 'snapshot', 'other-state', 'other-revision', 'wrong-key', 'ambiguous', 'replace'] as const)('does not discard uncertain %s staging', async fault => {
    const f = await interrupted()
    if (fault === 'event') f.data.tables.events['unknown'] = { eventId: 'unknown', projectId: 'p1', eventType: 'proposal.confirmed', revision: 1, actor, occurredAt: at, payload: {} }
    if (fault === 'receipt') f.data.tables.idempotency['p1:commit-key-1'] = { projectId: 'p1', proposalId: 'proposal-1', idempotencyKey: 'commit-key-1', eventId: 'event-1', revision: 1, createdAt: at }
    if (fault === 'confirmed') f.data.tables.proposals['proposal-1'].status = 'confirmed'
    if (fault === 'wrong-payload') f.data.tables.proposals['proposal-1'].envelope.change_set.payload.data.basis = 'Different'
    if (fault === 'snapshot') f.data.tables.revisions['p1:1'].stateSnapshot.EXTRA = {}
    if (fault === 'other-state') f.data.tables.state_objects['p1:EXTRA'] = { ...f.data.tables.state_objects['p1:OP04'], objectId: 'EXTRA' }
    if (fault === 'other-revision') f.data.tables.revisions['p1:2'] = { ...f.data.tables.revisions['p1:1'], revision: 2, revisionId: 'p1:2' }
    if (fault === 'wrong-key') { f.data.tables.state_objects.wrong = f.data.tables.state_objects['p1:OP04']; delete f.data.tables.state_objects['p1:OP04'] }
    if (fault === 'ambiguous') f.data.tables.proposals['proposal-2'] = { ...f.data.tables.proposals['proposal-1'], proposalId: 'proposal-2', envelope: { ...f.data.tables.proposals['proposal-1'].envelope, proposal_id: 'proposal-2' } }
    if (fault === 'replace') f.data.tables.proposals['proposal-1'].envelope.change_set.operation = 'replace'
    await f.save(); const { repository } = await open(f.root)
    expect(repository.readProjectRevision('p1', 1).revision.stateSnapshot.OP04).toBeDefined()
    expect(repository.readContext('s1').events.some(e => e.eventType === 'repository.staging_aborted')).toBe(false)
  })
  it.each(['archive', 'state-deleted', 'revision-deleted'] as const)('resumes an interrupted %s rollback without losing its original evidence', async phase => {
    const f = await interrupted(); await f.save()
    const { ctx, repository } = await open(f.root)
    await repository.close(); await ctx.fiber.dispose(); contexts.splice(contexts.indexOf(ctx), 1)
    const recovered = JSON.parse(await readFile(f.file, 'utf8'))
    const archive = Object.values(recovered.tables.events).find((e: any) => e.eventType === 'repository.staging_aborted') as any
    expect(archive).toBeDefined()
    f.data.tables.events[archive.eventId] = archive
    if (phase !== 'archive') delete f.data.tables.state_objects['p1:OP04']
    if (phase === 'revision-deleted') delete f.data.tables.revisions['p1:1']
    await f.save(); const reopened = await open(f.root)
    expect(reopened.repository.readContext('s1').project.currentRevision).toBe(0)
    const persisted = JSON.parse(await readFile(f.file, 'utf8'))
    expect(persisted.tables.revisions['p1:1']).toBeUndefined()
    expect(persisted.tables.events[archive.eventId]).toEqual(archive)
  })
  it.each(['state', 'revision', 'archive-event'] as const)('never overwrites or deletes a conflicting canonical %s key', async fault => {
    const f = await interrupted(); await f.save()
    const { ctx, repository } = await open(f.root)
    await repository.close(); await ctx.fiber.dispose(); contexts.splice(contexts.indexOf(ctx), 1)
    const recovered = JSON.parse(await readFile(f.file, 'utf8'))
    const archive = Object.values(recovered.tables.events).find((e: any) => e.eventType === 'repository.staging_aborted') as any
    f.data.tables.events[archive.eventId] = archive
    if (fault === 'state') f.data.tables.state_objects['p1:OP04'].projectId = 'foreign'
    if (fault === 'revision') f.data.tables.revisions['p1:1'].projectId = 'foreign'
    if (fault === 'archive-event') f.data.tables.events[archive.eventId] = { ...archive, projectId: 'foreign', eventType: 'important.original' }
    await f.save(); const exactBefore = await readFile(f.file, 'utf8')
    await open(f.root)
    expect(await readFile(f.file, 'utf8')).toBe(exactBefore)
  })
})
