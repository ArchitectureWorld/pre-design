import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import { ContractRegistry } from '../src/contracts/registry.ts'
import type { WorkflowDescriptor } from '../src/contracts/types.ts'
import { GovernanceRepository } from '../src/governance/repository.ts'
import { ProposalGateway } from '../src/proposals/gateway.ts'
import { ProjectRepository } from '../src/state/repository.ts'

const contractRoot = new URL('../contracts/v0.6/', import.meta.url)
const roots: string[] = []
const contexts: Context[] = []
const projectId = 'project-all-workflows'
const sessionId = 'session-all-workflows'
const agentActor = {
  actor_id: 'agent-1',
  name: '前期策划智能体',
  role: 'agent',
  organization: null,
  authority_scope: ['propose'],
  contact_ref: null,
}

async function openHarness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-preplanning-all-workflows-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const repository = await ProjectRepository.open(ctx.storage.domain)
  const governance = await GovernanceRepository.open(ctx.storage.domain)
  await repository.createProject({
    projectId,
    name: '57 项合同矩阵验收项目',
    sessionId,
    createdAt: '2026-08-28T08:00:00.000Z',
    actor: { actorId: 'user-1', name: '策划负责人', role: 'decision_owner' },
  })
  const registry = await ContractRegistry.open(contractRoot)
  const gateway = new ProposalGateway(
    repository,
    registry,
    () => '2026-08-28T08:10:00.000Z',
    governance,
  )
  return { gateway, governance, registry, repository }
}

async function envelopeFor(descriptor: WorkflowDescriptor, expectedRevision = 0) {
  const payload = JSON.parse(await readFile(
    new URL(`tests/fixtures/valid/${descriptor.targetObjectId}.json`, contractRoot),
    'utf8',
  ))
  payload.project_id = projectId
  if (Object.hasOwn(payload.data, 'project_id')) payload.data.project_id = projectId
  return {
    proposal_id: `proposal-${descriptor.targetObjectId}`,
    project_id: projectId,
    workflow_id: descriptor.workflowId,
    target_object_id: descriptor.targetObjectId,
    target_schema_id: descriptor.targetSchemaId,
    expected_revision: expectedRevision,
    actor: agentActor,
    created_at: '2026-08-28T08:05:00.000Z',
    change_set: { operation: 'create', payload, semantic_paths: ['/data'] },
    evidence_refs: [],
    assumptions: [],
    validation_intent: 'human_review',
    requested_state: 'pending_review',
    idempotency_key: `idempotency-${descriptor.targetObjectId}`,
  }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('ProposalGateway 57-item matrix', () => {
  it('accepts a schema-valid governed proposal for every canonical workflow target', async () => {
    const { gateway, registry, repository } = await openHarness()

    for (const descriptor of registry.workflows()) {
      await expect(gateway.submitProposal(await envelopeFor(descriptor), sessionId)).resolves.toMatchObject({
        projectId,
        status: 'pending_review',
      })
    }

    const context = repository.readContext(sessionId)
    expect(context.proposals).toHaveLength(57)
    expect(context.stateObjects).toHaveLength(0)
    expect(context.project.currentRevision).toBe(0)
  })

  it('commits manual workflow output as provisional and leaves chapter approval pending', async () => {
    const { gateway, registry, repository } = await openHarness()
    const descriptor = registry.workflow('preplan.wf.01.01')
    await gateway.submitProposal(await envelopeFor(descriptor), sessionId)

    const result = await gateway.commitProposal('proposal-PS01', {
      source: 'manual_workflow',
      actor: { actorId: 'system-1', name: '前期策划运行时', role: 'system_service' },
    }, sessionId)

    expect(result).toMatchObject({ revision: 1, status: 'provisionally_committed' })
    expect(repository.readContext(sessionId)).toMatchObject({
      project: { currentRevision: 1 },
      proposals: [{ proposalId: 'proposal-PS01', status: 'provisionally_committed' }],
      stateObjects: [{
        objectId: 'PS01',
        revision: 1,
        value: {
          status: 'provisional',
          revision: 1,
          data: { status: 'provisional' },
          approval: { status: 'pending' },
        },
      }],
    })
  })

  it('rejects automatic confirmation without a matching active authorization', async () => {
    const { gateway, governance, registry, repository } = await openHarness()
    await governance.createPolicy({
      projectId,
      mode: 'automatic',
      reportDepth: 'standard',
      automationAuthorizationId: 'authorization-missing',
      updatedAt: '2026-08-28T08:00:00.000Z',
    })
    await gateway.submitProposal(await envelopeFor(registry.workflow('preplan.wf.01.01')), sessionId)

    await expect(gateway.commitProposal('proposal-PS01', {
      source: 'automation_authorization',
      authorizationId: 'authorization-missing',
      actor: { actorId: 'system-1', name: '前期策划运行时', role: 'system_service' },
    }, sessionId)).rejects.toMatchObject({ code: 'authorization-invalid' })
    expect(repository.readContext(sessionId)).toMatchObject({
      project: { currentRevision: 0 },
      proposals: [{ status: 'pending_review' }],
      stateObjects: [],
    })
  })

  it('uses the signed decision owner authorization when automatic mode confirms state', async () => {
    const { gateway, governance, registry, repository } = await openHarness()
    await governance.createPolicy({
      projectId,
      mode: 'automatic',
      reportDepth: 'standard',
      automationAuthorizationId: 'authorization-1',
      updatedAt: '2026-08-28T08:00:00.000Z',
    })
    await governance.putAuthorization({
      authorizationId: 'authorization-1',
      projectId,
      grantedBy: { actorId: 'user-1', name: '策划负责人', role: 'decision_owner' },
      startingRevision: 0,
      scope: {
        chapterIds: ['01'],
        workflowIds: ['preplan.wf.01.01'],
        gateIds: ['G1'],
        maxVisualGenerations: 20,
        maxModelTurns: 120,
        stopOnBlocking: true,
      },
      status: 'active',
      grantedAt: '2026-08-28T08:00:00.000Z',
    })
    await gateway.submitProposal(await envelopeFor(registry.workflow('preplan.wf.01.01')), sessionId)

    const result = await gateway.commitProposal('proposal-PS01', {
      source: 'automation_authorization',
      authorizationId: 'authorization-1',
      actor: { actorId: 'system-1', name: '前期策划运行时', role: 'system_service' },
    }, sessionId)

    expect(result).toMatchObject({ revision: 1, status: 'confirmed' })
    expect(repository.readContext(sessionId).stateObjects[0]).toMatchObject({
      objectId: 'PS01',
      value: {
        status: 'confirmed',
        data: { status: 'provisional' },
        approval: {
          status: 'approved',
          approver: {
            actor_id: 'user-1',
            name: '策划负责人',
            role: 'decision_owner',
          },
        },
      },
    })
  })

  it('automatically commits every schema-valid workflow payload without injecting unsupported data fields', async () => {
    const { gateway, governance, registry, repository } = await openHarness()
    await governance.createPolicy({
      projectId,
      mode: 'automatic',
      reportDepth: 'standard',
      automationAuthorizationId: 'authorization-all',
      updatedAt: '2026-08-28T08:00:00.000Z',
    })
    await governance.putAuthorization({
      authorizationId: 'authorization-all',
      projectId,
      grantedBy: { actorId: 'user-1', name: '策划负责人', role: 'decision_owner' },
      startingRevision: 0,
      scope: {
        chapterIds: registry.gates().map(gate => gate.chapterId),
        workflowIds: registry.workflowIds(),
        gateIds: registry.gates().map(gate => gate.gateId),
        maxVisualGenerations: 20,
        maxModelTurns: 120,
        stopOnBlocking: true,
      },
      status: 'active',
      grantedAt: '2026-08-28T08:00:00.000Z',
    })

    let revision = 0
    for (const descriptor of registry.workflows()) {
      const envelope = await envelopeFor(descriptor, revision)
      await gateway.submitProposal(envelope, sessionId)
      const result = await gateway.commitProposal(envelope.proposal_id, {
        source: 'automation_authorization',
        authorizationId: 'authorization-all',
        actor: { actorId: 'system-1', name: '前期策划运行时', role: 'system_service' },
      }, sessionId)
      revision += 1
      expect(result.revision, descriptor.targetObjectId).toBe(revision)
      const committed = repository.readContext(sessionId).stateObjects
        .find(row => row.objectId === descriptor.targetObjectId)
      expect(registry.validateStateObject(descriptor.targetObjectId, committed?.value), descriptor.targetObjectId)
        .toEqual({ valid: true, errors: [] })
    }
  }, 30_000)
})
