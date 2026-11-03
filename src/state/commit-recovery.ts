import { isDeepStrictEqual as equal } from 'node:util'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { preplanningDomainSpec } from './domain.ts'
import type { AuditEventRecord, IdempotencyRecord, ProjectRecord } from './types.ts'

type ProjectDomain = Domain<typeof preplanningDomainSpec>
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Recover only the final index writes of a commit whose decision is already durable.
 * Earlier/inconsistent partial writes remain blocked; no approval is inferred.
 */
export async function recoverConfirmedCommitHeads(domain: ProjectDomain): Promise<void> {
  async function recover(project: ProjectRecord, number: number): Promise<boolean> {
    if (number < 1) return false
    const proposals = [...domain.table('proposals').entries()].map(([, value]) => value)
      .filter(value => value.projectId === project.projectId && value.committedRevision === number
        && (value.status === 'confirmed' || value.status === 'provisionally_committed'))
    if (proposals.length !== 1) return false
    const proposal = proposals[0], key = `${project.projectId}:${proposal.idempotencyKey}`
    if (!equal(domain.table('proposals').get(proposal.proposalId), proposal)) return false
    const priorReceipt = domain.table('idempotency').get(key)
    if (number === project.currentRevision && priorReceipt) return false
    const revision = domain.table('revisions').get(`${project.projectId}:${number}`)
    const parent = domain.table('revisions').get(`${project.projectId}:${number - 1}`)
    if (!revision || !parent || revision.projectId !== project.projectId || revision.revision !== number
      || revision.revisionId !== `${project.projectId}:${number}` || parent.revisionId !== `${project.projectId}:${number - 1}`
      || parent.projectId !== project.projectId || parent.revision !== number - 1
      || revision.parentRevision !== number - 1 || proposal.expectedRevision !== number - 1
      || proposal.committedAt !== revision.committedAt || !equal(proposal.committedBy, revision.committedBy)) return false
    if (proposal.status === 'confirmed' && (proposal.confirmedAt !== revision.committedAt
      || !equal(proposal.confirmedBy, revision.committedBy))) return false
    const events = [...domain.table('events').entries()].map(([, value]) => value)
      .filter(value => value.projectId === project.projectId && value.revision === number
        && value.eventType === `proposal.${proposal.status}`)
    if (events.length !== 1) return false
    const event = events[0], payload = event.payload
    if (!equal(domain.table('events').get(event.eventId), event)) return false
    if (!record(payload) || payload.proposalId !== proposal.proposalId || typeof payload.objectId !== 'string'
      || event.occurredAt !== revision.committedAt || !equal(event.actor, revision.committedBy)) return false
    const object = domain.table('state_objects').get(`${project.projectId}:${payload.objectId}`)
    if (!object || object.projectId !== project.projectId || object.objectId !== payload.objectId
      || object.revision !== number || object.updatedAt !== revision.committedAt
      || !equal(revision.stateSnapshot, { ...parent.stateSnapshot, [object.objectId]: object.value })) return false
    const visibleEntries = [...domain.table('state_objects').entries()]
      .filter(([, value]) => value.projectId === project.projectId && value.revision <= number)
    if (visibleEntries.some(([key, value]) => key !== `${project.projectId}:${value.objectId}`)) return false
    const visible = Object.fromEntries(visibleEntries.map(([, value]) => [value.objectId, value.value]))
    if (!equal(visible, revision.stateSnapshot)) return false
    const receipt: IdempotencyRecord = { projectId: project.projectId, idempotencyKey: proposal.idempotencyKey,
      proposalId: proposal.proposalId, eventId: event.eventId, revision: number, createdAt: revision.committedAt }
    if (priorReceipt && !equal(priorReceipt, receipt)) return false
    const recoveryId = `${project.projectId}:${number}:commit-recovered`
    const existingRecovery = domain.table('events').get(recoveryId)
    const recovery: AuditEventRecord = existingRecovery ?? {
      eventId: recoveryId, projectId: project.projectId, revision: number, eventType: 'repository.commit_recovered',
      actor: { actorId: 'preplanning-recovery', name: '前期策划提交恢复', role: 'system_service' },
      occurredAt: new Date().toISOString(), payload: { proposalId: proposal.proposalId, originalEventId: event.eventId,
        fromRevision: project.currentRevision, toRevision: number, reason: 'durable_commit_index_recovery' },
    }
    if (existingRecovery && (existingRecovery.eventId !== recoveryId || existingRecovery.projectId !== project.projectId || existingRecovery.revision !== number
      || existingRecovery.eventType !== 'repository.commit_recovered' || !record(existingRecovery.payload)
      || existingRecovery.payload.proposalId !== proposal.proposalId || existingRecovery.payload.originalEventId !== event.eventId)) return false
    // Persist the trace and replay receipt before moving the visibility pointer.
    // Repeated interruption can safely run these same checks again on next open.
    await domain.table('events').put(recoveryId, recovery)
    await domain.table('idempotency').put(key, receipt)
    if (number > project.currentRevision) await domain.table('projects').put(project.projectId,
      { ...project, currentRevision: number, updatedAt: revision.committedAt })
    return number > project.currentRevision
  }
  for (const [key, original] of domain.table('projects').entries()) {
    if (key !== original.projectId) continue
    let project = original
    await recover(project, project.currentRevision)
    while (await recover(project, project.currentRevision + 1)) project = domain.table('projects').get(project.projectId)!
  }
}
