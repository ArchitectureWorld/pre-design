import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import { preplanningGovernanceDomainSpec } from '../src/governance/domain.ts'
import { GovernanceRepository } from '../src/governance/repository.ts'
import { preplanningDomainSpec } from '../src/state/domain.ts'
import { ProjectRepository } from '../src/state/repository.ts'

const roots: string[] = []
const contexts: Context[] = []
const now = '2026-08-28T08:00:00.000Z'

async function openStorage() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-preplanning-governance-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  return ctx
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('GovernanceRepository', () => {
  it('keeps the legacy domain at v1 and persists the companion domain across reopen', async () => {
    const ctx = await openStorage()
    const projects = await ProjectRepository.open(ctx.storage.domain)
    const governance = await GovernanceRepository.open(ctx.storage.domain)

    expect(preplanningDomainSpec.version).toBe(1)
    expect(preplanningGovernanceDomainSpec).toMatchObject({
      name: 'preplanning_governance',
      version: 1,
    })

    await projects.createProject({
      projectId: 'project-1',
      name: '治理兼容验收项目',
      sessionId: 'session-1',
      createdAt: now,
      actor: { actorId: 'user-1', name: '策划负责人', role: 'decision_owner' },
    })
    await governance.createPolicy({
      projectId: 'project-1',
      mode: 'manual',
      reportDepth: 'standard',
      visualPolicyId: 'visual-policy-1',
      updatedAt: now,
    })
    await governance.putWorkflowRun({
      runId: 'project-1:preplan.wf.01.01',
      projectId: 'project-1',
      workflowId: 'preplan.wf.01.01',
      chapterId: '01',
      workItemId: '01-01',
      targetObjectId: 'PS01',
      status: 'ready',
      attempt: 0,
      updatedAt: now,
    })

    await governance.close()
    await projects.close()

    const reopenedProjects = await ProjectRepository.open(ctx.storage.domain)
    const reopenedGovernance = await GovernanceRepository.open(ctx.storage.domain)
    expect(reopenedProjects.readContext('session-1').project).toMatchObject({
      projectId: 'project-1',
      currentRevision: 0,
    })
    expect(reopenedGovernance.readProject('project-1')).toMatchObject({
      policy: { mode: 'manual', reportDepth: 'standard' },
      workflowRuns: [
        {
          workflowId: 'preplan.wf.01.01',
          status: 'ready',
        },
      ],
    })
  })

  it('stores typed authorization, gate, visual and report records in one project snapshot', async () => {
    const ctx = await openStorage()
    const governance = await GovernanceRepository.open(ctx.storage.domain)

    await governance.putAuthorization({
      authorizationId: 'auth-1',
      projectId: 'project-1',
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
      grantedAt: now,
    })
    await governance.putGateDecision({
      decisionId: 'decision-1',
      projectId: 'project-1',
      gateId: 'G1',
      revision: 1,
      decision: 'approved',
      source: 'automation_authorization',
      authorizationId: 'auth-1',
      decidedBy: { actorId: 'user-1', name: '策划负责人', role: 'decision_owner' },
      decidedAt: now,
    })
    await governance.putVisualTask({
      taskId: 'visual-task-1',
      projectId: 'project-1',
      chapterId: '04',
      workItemId: '04-01',
      kind: 'concept',
      required: true,
      status: 'queued',
      attempts: 0,
      updatedAt: now,
    })
    await governance.putVisualAsset({
      assetId: 'visual-asset-1',
      taskId: 'visual-task-1',
      projectId: 'project-1',
      kind: 'concept',
      required: true,
      status: 'candidate',
      provider: 'antigravity',
      model: 'gemini-3.1-flash-image',
      promptSummary: '滨水公共空间概念表现',
      mimeType: 'image/png',
      fileName: 'visual-asset-1.png',
      sha256: 'a'.repeat(64),
      width: 2048,
      height: 1152,
      createdAt: now,
    })
    await governance.putReportPackage({
      packageId: 'report-package-1',
      projectId: 'project-1',
      sourceRevision: 57,
      status: 'staging',
      sectionIds: ['executive-summary'],
      adoptedAssetIds: [],
      warnings: [],
      createdAt: now,
    })

    const snapshot = governance.readProject('project-1')
    expect(snapshot.authorizations).toHaveLength(1)
    expect(snapshot.gateDecisions).toEqual([
      expect.objectContaining({ source: 'automation_authorization', authorizationId: 'auth-1' }),
    ])
    expect(snapshot.visualTasks).toEqual([expect.objectContaining({ status: 'queued' })])
    expect(snapshot.visualAssets).toEqual([
      expect.objectContaining({ model: 'gemini-3.1-flash-image', status: 'candidate' }),
    ])
    expect(snapshot.reportPackages).toEqual([
      expect.objectContaining({ sourceRevision: 57, status: 'staging' }),
    ])
  })
})
