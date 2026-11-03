import { isDeepStrictEqual as equal } from 'node:util'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { preplanningDomainSpec } from './domain.ts'
import type { AuditEventRecord, RevisionRecord, StateObjectRecord } from './types.ts'

type ProjectDomain = Domain<typeof preplanningDomainSpec>
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
// Only these fields are replaced by ProposalGateway when committing. The actual
// business payload, citations, original author and creation time must still match.
function businessPayload(value: unknown): unknown {
  if (!record(value) || !record(value.approval)) return undefined
  const { status, revision, updated_at, approval, ...rest } = value
  const { status: approvalStatus, approver, approved_at, ...approvalRest } = approval
  return { ...rest, approval: approvalRest }
}

/** Abort only an unconfirmed CREATE staged immediately beyond the visible head.
 * This is not decision recovery: the proposal stays pending and normal execution
 * must obtain a fresh valid result. Uncertain or replacement writes stay blocked.
 * Full staged records are archived before removal, including across interruption.
 */
export async function recoverUnconfirmedNewObjectStaging(domain: ProjectDomain): Promise<void> {
  const values = <N extends Parameters<ProjectDomain['table']>[0]>(name: N) => [...domain.table(name).entries()]
  for (const [projectKey, project] of values('projects')) {
    if (projectKey !== project.projectId) continue
    const head = project.currentRevision, next = head + 1, id = project.projectId
    const parent = domain.table('revisions').get(`${id}:${head}`)
    if (!parent || parent.projectId !== id || parent.revisionId !== `${id}:${head}` || parent.revision !== head) continue
    const journals = values('events').filter(([, e]) => e.projectId === id && e.revision === head
      && e.eventType === 'repository.staging_aborted' && !domain.table('events').get(`${e.eventId}:complete`))
    if (journals.length > 1) continue
    const journal = journals[0]?.[1]
    if (journal && journals[0][0] !== journal.eventId) continue
    const archive = journal?.payload
    if (journal && (!record(archive) || !record(archive.stagedRevision) || !record(archive.stagedState))) continue
    const stagedRevision = (record(archive) ? archive.stagedRevision : domain.table('revisions').get(`${id}:${next}`)) as RevisionRecord | undefined
    const stagedState = (record(archive) ? archive.stagedState : values('state_objects')
      .find(([, state]) => state.projectId === id && state.revision === next)?.[1]) as StateObjectRecord | undefined
    if (!stagedRevision || !stagedState || stagedRevision.projectId !== id || stagedRevision.revision !== next
      || stagedRevision.revisionId !== `${id}:${next}` || stagedRevision.parentRevision !== head
      || stagedState.projectId !== id || stagedState.revision !== next
      || stagedState.updatedAt !== stagedRevision.committedAt || !record(stagedState.value)
      || stagedState.value.object_id !== stagedState.objectId || Object.hasOwn(parent.stateSnapshot, stagedState.objectId)
      || !equal(stagedRevision.stateSnapshot, { ...parent.stateSnapshot, [stagedState.objectId]: stagedState.value })) continue
    const proposals = values('proposals').filter(([key, p]) => {
      const e = p.envelope
      return key === p.proposalId && p.projectId === id && p.status === 'pending_review' && p.expectedRevision === head
        && p.committedAt === undefined && p.committedRevision === undefined && p.confirmedAt === undefined
        && p.committedBy === undefined && p.confirmedBy === undefined
        && record(e) && e.project_id === id && e.proposal_id === p.proposalId && e.expected_revision === head
        && e.target_object_id === stagedState.objectId && record(e.change_set) && e.change_set.operation === 'create'
        && businessPayload(e.change_set.payload) !== undefined
        && equal(businessPayload(e.change_set.payload), businessPayload(stagedState.value))
    })
    if (proposals.length !== 1) continue
    const proposal = proposals[0][1], eventId = `${proposal.proposalId}:staging-aborted`
    if (journal && (journal.eventId !== eventId || !record(archive) || archive.proposalId !== proposal.proposalId)) continue
    const currentState = domain.table('state_objects').get(`${id}:${stagedState.objectId}`)
    const currentRevision = domain.table('revisions').get(`${id}:${next}`)
    const currentArchive = domain.table('events').get(eventId)
    if ((currentState && !equal(currentState, stagedState))
      || (currentRevision && !equal(currentRevision, stagedRevision))
      || (currentArchive && !equal(currentArchive, journal))) continue
    // No durable decision or other future work can be discarded by this path.
    if (values('events').some(([, e]) => e.projectId === id && e.revision > head)
      || values('idempotency').some(([, receipt]) => receipt.projectId === id && receipt.revision > head)
      || values('proposals').some(([, p]) => p.projectId === id && (p.committedRevision ?? -1) > head)) continue
    const states = values('state_objects').filter(([, state]) => state.projectId === id)
    if (states.some(([key, state]) => key !== `${id}:${state.objectId}` || (state.revision > head && !equal(state, stagedState)))) continue
    const visible = Object.fromEntries(states.filter(([, state]) => state.revision <= head).map(([, state]) => [state.objectId, state.value]))
    if (!equal(visible, parent.stateSnapshot)) continue
    const future = values('revisions').filter(([, revision]) => revision.projectId === id && revision.revision > head)
    if (future.some(([key, revision]) => key !== `${id}:${next}` || !equal(revision, stagedRevision))) continue
    if (!journal && (future.length !== 1 || !domain.table('state_objects').get(`${id}:${stagedState.objectId}`))) continue
    if (domain.table('events').get(`${eventId}:complete`)) continue
    const trace: AuditEventRecord = journal ?? { eventId, projectId: id, revision: head,
      eventType: 'repository.staging_aborted', actor: { actorId: 'preplanning-recovery', name: '前期策划暂存恢复', role: 'system_service' },
      occurredAt: new Date().toISOString(), payload: JSON.parse(JSON.stringify({ proposalId: proposal.proposalId,
        reason: 'unconfirmed_create_without_decision', stagedRevision, stagedState })) }
    await domain.table('events').put(eventId, trace)
    await domain.table('state_objects').delete(`${id}:${stagedState.objectId}`)
    await domain.table('revisions').delete(`${id}:${next}`)
    await domain.table('events').put(`${eventId}:complete`, { ...trace, eventId: `${eventId}:complete`,
      eventType: 'repository.staging_abort_completed', payload: { archiveEventId: eventId, proposalId: proposal.proposalId } })
  }
}
