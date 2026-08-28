import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import { ContractRegistry } from '../src/contracts/registry.ts'
import { buildControlledContext } from '../src/context/build-context.ts'
import { ProposalGateway } from '../src/proposals/gateway.ts'
import { ProjectRepository } from '../src/state/repository.ts'

const roots: string[] = []
const contexts: Context[] = []
const contractRoot = new URL('../contracts/v0.6/', import.meta.url)
const agentActor = {
  actor_id: 'agent-1',
  name: '前期策划智能体',
  role: 'agent',
  organization: null,
  authority_scope: ['propose'],
  contact_ref: null,
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-preplanning-gateway-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const repository = await ProjectRepository.open(ctx.storage.domain)
  await repository.createProject({
    projectId: 'project-1',
    name: '鄂州城市更新前期策划',
    sessionId: 'session-1',
    createdAt: '2026-08-27T16:00:00.000Z',
    actor: { actorId: 'user-1', name: '策划负责人', role: 'decision_owner' },
  })
  const registry = await ContractRegistry.open(contractRoot)
  const gateway = new ProposalGateway(repository, registry, () => '2026-08-27T16:10:00.000Z')
  return { gateway, repository }
}

async function validEnvelope() {
  const value = JSON.parse(await readFile(new URL('tests/fixtures/valid/PS01.json', contractRoot), 'utf8'))
  value.project_id = 'project-1'
  value.data.project_id = 'project-1'
  return {
    proposal_id: 'proposal-1',
    project_id: 'project-1',
    workflow_id: 'preplan.wf.01.01',
    target_object_id: 'PS01',
    target_schema_id: 'urn:preplan:v0.6:state:PS01',
    expected_revision: 0,
    actor: agentActor,
    created_at: '2026-08-27T16:05:00.000Z',
    change_set: { operation: 'create', payload: value, semantic_paths: ['/data'] },
    evidence_refs: [],
    assumptions: [],
    validation_intent: 'human_review',
    requested_state: 'pending_review',
    idempotency_key: 'idempotency-gateway-1',
  }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('ProposalGateway', () => {
  it('无 SessionBinding 时失败关闭', async () => {
    const { gateway } = await harness()
    await expect(gateway.submitProposal(await validEnvelope(), 'session-missing'))
      .rejects.toThrow("session 'session-missing' is not bound")
  })

  it('拒绝 actor 冒充和无效 PS01，且 Project State 不变', async () => {
    const { gateway, repository } = await harness()
    const spoofed = await validEnvelope()
    spoofed.actor = { ...agentActor, role: 'decision_owner' }
    await expect(gateway.submitProposal(spoofed, 'session-1')).rejects.toThrow('actor role must be agent')

    const invalid = await validEnvelope()
    delete invalid.change_set.payload.project_id
    await expect(gateway.submitProposal(invalid, 'session-1')).rejects.toThrow('PS01 validation failed')

    const wrongSchema = await validEnvelope()
    wrongSchema.target_schema_id = 'urn:preplan:v0.6:state:PS02'
    await expect(gateway.submitProposal(wrongSchema, 'session-1')).rejects.toThrow('target schema must be PS01')
    expect(repository.readContext('session-1').project.currentRevision).toBe(0)
  })

  it('只保存 pending_review 提案，幂等重放不新增提案或 revision', async () => {
    const { gateway, repository } = await harness()
    const envelope = await validEnvelope()
    const first = await gateway.submitProposal(envelope, 'session-1')
    const replay = await gateway.submitProposal(envelope, 'session-1')
    expect(first.status).toBe('pending_review')
    expect(replay).toEqual(first)
    const changedReplay = await validEnvelope()
    changedReplay.change_set.payload.data.canonical_name = '被篡改的项目名称'
    await expect(gateway.submitProposal(changedReplay, 'session-1'))
      .rejects.toThrow('idempotency replay payload differs from the original proposal')
    expect(repository.readContext('session-1')).toMatchObject({
      project: { currentRevision: 0 },
      proposals: [{ proposalId: 'proposal-1', status: 'pending_review' }],
    })
  })

  it('仅 decision_owner 可确认，且 revision 冲突时不写入', async () => {
    const { gateway, repository } = await harness()
    const first = await validEnvelope()
    await gateway.submitProposal(first, 'session-1')
    const stale = { ...await validEnvelope(), proposal_id: 'proposal-stale', idempotency_key: 'idempotency-gateway-2' }
    await gateway.submitProposal(stale, 'session-1')

    await expect(gateway.confirmProposal('proposal-1', { actorId: 'agent-1', name: '智能体', role: 'agent' }, 'session-1'))
      .rejects.toThrow('human decision_owner required')
    await gateway.confirmProposal('proposal-1', { actorId: 'user-1', name: '策划负责人', role: 'decision_owner' }, 'session-1')
    const beforeConflict = repository.readContext('session-1')
    await expect(gateway.confirmProposal('proposal-stale', { actorId: 'user-1', name: '策划负责人', role: 'decision_owner' }, 'session-1'))
      .rejects.toThrow('expected revision 0, current revision is 1')
    expect(repository.readContext('session-1')).toEqual(beforeConflict)
  })

  it('人工确认时将 PS01 提升为 confirmed 和 approved 后再落库', async () => {
    const { gateway, repository } = await harness()
    const envelope = await validEnvelope()
    envelope.change_set.payload.status = 'pending_review'
    envelope.change_set.payload.data.status = 'pending_review'
    envelope.change_set.payload.approval.status = 'pending'
    envelope.change_set.payload.approval.approver = null
    envelope.change_set.payload.approval.approved_at = null
    await gateway.submitProposal(envelope, 'session-1')

    await gateway.confirmProposal(
      'proposal-1',
      { actorId: 'user-1', name: '策划负责人', role: 'decision_owner' },
      'session-1',
    )

    const confirmed = repository.readContext('session-1').stateObjects[0]
    expect(confirmed).toMatchObject({
      objectId: 'PS01',
      revision: 1,
      updatedAt: '2026-08-27T16:10:00.000Z',
      value: {
        status: 'confirmed',
        revision: 1,
        updated_at: '2026-08-27T16:10:00.000Z',
        data: { status: 'confirmed' },
        approval: {
          status: 'approved',
          approver: {
            actor_id: 'user-1',
            name: '策划负责人',
            role: 'decision_owner',
          },
          approved_at: '2026-08-27T16:10:00.000Z',
        },
      },
    })
    expect((await ContractRegistry.open(contractRoot)).validateStateObject('PS01', confirmed?.value)).toEqual({
      valid: true,
      errors: [],
    })
  })

  it('受控上下文提供确认提案与 proposal.confirmed 审计摘要', async () => {
    const { gateway, repository } = await harness()
    await gateway.submitProposal(await validEnvelope(), 'session-1')
    await gateway.confirmProposal(
      'proposal-1',
      { actorId: 'user-1', name: '策划负责人', role: 'decision_owner' },
      'session-1',
    )

    const controlled = buildControlledContext(repository, 'session-1')
    expect(controlled.pendingProposals).toEqual([])
    expect(controlled.confirmedProposals).toEqual([{
      proposalId: 'proposal-1',
      committedRevision: 1,
      confirmedAt: '2026-08-27T16:10:00.000Z',
      confirmedBy: { actorId: 'user-1', name: '策划负责人', role: 'decision_owner' },
    }])
    expect(controlled.auditEvents).toEqual([{
      eventId: 'proposal-1:confirmed',
      eventType: 'proposal.confirmed',
      revision: 1,
      actor: { actorId: 'user-1', name: '策划负责人', role: 'decision_owner' },
      occurredAt: '2026-08-27T16:10:00.000Z',
      payload: { proposalId: 'proposal-1', objectId: 'PS01' },
    }])
  })
})
