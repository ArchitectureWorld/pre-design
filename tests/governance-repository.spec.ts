import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as GovernanceDomain from '../src/governance/domain.ts'
import { preplanningGovernanceDomainSpec } from '../src/governance/domain.ts'
import { GovernanceRepository } from '../src/governance/repository.ts'
import { selectConfirmedSiteBoundary } from '../src/governance/site-boundary-service.ts'
import type { SiteBoundaryRecord, VisualAssetRecord } from '../src/governance/types.ts'
import { preplanningDomainSpec } from '../src/state/domain.ts'
import { ProjectRepository } from '../src/state/repository.ts'
import { siteBoundaryFixture, siteBoundaryOwner } from './site-boundary-fixture.ts'

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
  it('persists a project/source-independent synthetic fingerprint and rejects a cross-project human replay before governance writes', async () => {
    const ctx = await openStorage()
    const governance = await GovernanceRepository.open(ctx.storage.domain)
    const synthetic = siteBoundaryFixture({
      boundaryId: 'synthetic-boundary-a', projectId: 'project-A', origin: 'synthetic',
      submissionChannel: 'synthetic_fixture', source: 'approved_redline',
    })
    const syntheticAsset: VisualAssetRecord = {
      assetId: synthetic.sourceAsset!.assetId, taskId: synthetic.sourceAsset!.assetId, projectId: 'project-A', kind: 'evidence', required: true,
      status: 'candidate', mimeType: 'image/png', fileName: synthetic.sourceAsset!.fileName, sha256: synthetic.sourceAsset!.sha256,
      width: 1, height: 1, boundaryEvidence: synthetic.sourceAsset!.attachment!, createdAt: now,
    }
    const futureRepository = governance as unknown as {
      putPendingSiteBoundary(record: typeof synthetic, asset?: VisualAssetRecord): Promise<typeof synthetic>
      findSyntheticBoundaryByFingerprint(input: { readonly storageSha256: string }): unknown
    }
    await futureRepository.putPendingSiteBoundary(synthetic, syntheticAsset)
    expect(futureRepository.findSyntheticBoundaryByFingerprint({ storageSha256: 'a'.repeat(64) })).toMatchObject({
      fingerprint: `image:${'a'.repeat(64)}`, boundaryId: synthetic.boundaryId,
    })
    await governance.close()

    const reopened = await GovernanceRepository.open(ctx.storage.domain)
    const futureReopened = reopened as unknown as typeof futureRepository
    expect(futureReopened.findSyntheticBoundaryByFingerprint({ storageSha256: 'a'.repeat(64) })).toMatchObject({
      fingerprint: `image:${'a'.repeat(64)}`, boundaryId: synthetic.boundaryId,
    })
    const human = siteBoundaryFixture({
      boundaryId: 'human-boundary-b', projectId: 'project-B', source: 'approved_site_plan',
      sourceAsset: {
        ...synthetic.sourceAsset!, assetId: 'human-asset-b', fileName: 'project-B/evidence/human-asset-b.png',
      },
    })
    const humanAsset = {
      ...syntheticAsset, assetId: 'human-asset-b', taskId: 'human-asset-b', projectId: 'project-B',
      fileName: 'project-B/evidence/human-asset-b.png', boundaryEvidence: human.sourceAsset!.attachment!,
    }
    await expect(futureReopened.putPendingSiteBoundary(human, humanAsset))
      .rejects.toThrow('SITE_BOUNDARY_SYNTHETIC_REPLAY_FORBIDDEN')
    expect(reopened.readProject('project-B')).toMatchObject({ visualAssets: [], siteBoundaries: [] })
  })

  it('serializes pending upserts, preserves confirmed/adopted state, and retains a synthetic claim when boundary persistence fails', async () => {
    const ctx = await openStorage()
    const governance = await GovernanceRepository.open(ctx.storage.domain)
    const pending = siteBoundaryFixture({ boundaryId: 'stable-boundary' })
    const candidate: VisualAssetRecord = {
      assetId: pending.sourceAsset!.assetId, taskId: pending.sourceAsset!.assetId, projectId: pending.projectId, kind: 'evidence', required: true,
      status: 'candidate', mimeType: 'image/png', fileName: pending.sourceAsset!.fileName, sha256: pending.sourceAsset!.sha256,
      width: 1, height: 1, boundaryEvidence: pending.sourceAsset!.attachment!, createdAt: now,
    }
    const future = governance as unknown as {
      putPendingSiteBoundary(record: SiteBoundaryRecord, asset?: VisualAssetRecord): Promise<SiteBoundaryRecord>
    }
    const [first, second] = await Promise.all([
      future.putPendingSiteBoundary(pending, candidate),
      future.putPendingSiteBoundary(pending, candidate),
    ])
    expect(first).toEqual(second)
    expect(governance.readProject('project-1')).toMatchObject({
      siteBoundaries: [pending], visualAssets: [candidate],
    })

    const formal = {
      ...pending, status: 'confirmed_formal_boundary' as const, confirmedBy: siteBoundaryOwner, confirmedAt: now,
      confirmedRevision: 4, confirmationChannel: 'dsh_human_command' as const,
      confirmationStatement: '该图是本项目采用的总平图或红线图，且图中明确表达项目边界',
      confirmationSourceSha256: pending.sourceAsset!.sha256,
    }
    const adopted = { ...candidate, status: 'adopted' as const, adoptedRevision: 4 }
    await governance.confirmSiteBoundary({ formal, candidate, adopted })
    await expect(future.putPendingSiteBoundary(pending, candidate)).resolves.toEqual(formal)
    expect(governance.readProject('project-1')).toMatchObject({
      siteBoundaries: [formal], visualAssets: [adopted],
    })

    const synthetic = siteBoundaryFixture({
      boundaryId: 'synthetic-interrupted', projectId: 'project-S', origin: 'synthetic', submissionChannel: 'synthetic_fixture',
      sourceAsset: {
        ...pending.sourceAsset!, assetId: 'synthetic-asset-s', fileName: 'project-S/evidence/synthetic-asset-s.png',
      },
    })
    const syntheticAsset = {
      ...candidate, assetId: synthetic.sourceAsset!.assetId, taskId: synthetic.sourceAsset!.assetId, projectId: 'project-S',
      fileName: synthetic.sourceAsset!.fileName, boundaryEvidence: synthetic.sourceAsset!.attachment!,
    }
    const repository = governance as unknown as { readonly domain: { table(name: 'site_boundaries'): { put(key: string, value: unknown): Promise<void> } } }
    vi.spyOn(repository.domain.table('site_boundaries'), 'put').mockRejectedValueOnce(new Error('injected pending-boundary failure'))
    await expect(future.putPendingSiteBoundary(synthetic, syntheticAsset)).rejects.toThrow('injected pending-boundary failure')
    const humanReplay = siteBoundaryFixture({
      boundaryId: 'human-after-interruption', projectId: 'project-H', source: 'approved_site_plan',
    })
    await expect(future.putPendingSiteBoundary(humanReplay, {
      ...candidate, projectId: 'project-H',
    })).rejects.toThrow('SITE_BOUNDARY_SYNTHETIC_REPLAY_FORBIDDEN')
    expect(governance.readProject('project-H')).toMatchObject({ visualAssets: [], siteBoundaries: [] })
  })

  it('确认最终边界 upsert 失败时补偿为不可选择的 formal 加 candidate，且可重试', async () => {
    const ctx = await openStorage()
    const governance = await GovernanceRepository.open(ctx.storage.domain)
    const pending = siteBoundaryFixture()
    const candidate: VisualAssetRecord = {
      assetId: pending.sourceAsset!.assetId, taskId: pending.sourceAsset!.assetId, projectId: 'project-1', kind: 'evidence', required: true,
      status: 'candidate', mimeType: 'image/png', fileName: pending.sourceAsset!.fileName, sha256: pending.sourceAsset!.sha256,
      width: 1, height: 1, boundaryEvidence: pending.sourceAsset!.attachment!, createdAt: now,
    }
    const formal = {
      ...pending, status: 'confirmed_formal_boundary' as const, confirmedBy: siteBoundaryOwner, confirmedAt: now, confirmedRevision: 4,
      confirmationChannel: 'dsh_human_command' as const,
      confirmationStatement: '该图是本项目采用的总平图或红线图，且图中明确表达项目边界',
      confirmationSourceSha256: pending.sourceAsset!.sha256,
    }
    const adopted = { ...candidate, status: 'adopted' as const, adoptedRevision: 4 }
    await governance.putSiteBoundary(pending)
    await governance.putVisualAsset(candidate)
    const repository = governance as unknown as { readonly domain: { table(name: 'site_boundaries'): { put(key: string, value: unknown): Promise<void> } } }
    const boundaries = repository.domain.table('site_boundaries')
    const realPut = boundaries.put.bind(boundaries)
    let writes = 0
    vi.spyOn(boundaries, 'put').mockImplementation(async (key, value) => {
      writes += 1
      if (writes === 2) throw new Error('injected final-boundary failure')
      await realPut(key, value)
    })

    await expect(governance.confirmSiteBoundary({ formal, candidate, adopted })).rejects.toThrow('injected final-boundary failure')
    const interrupted = governance.readProject('project-1')
    expect(interrupted.visualAssets).toEqual([expect.objectContaining({ assetId: candidate.assetId, status: 'candidate' })])
    expect(interrupted.siteBoundaries).toEqual([expect.objectContaining({ boundaryId: formal.boundaryId, confirmedRevision: Number.MAX_SAFE_INTEGER })])
    expect(selectConfirmedSiteBoundary(interrupted.siteBoundaries, 4)).toBeUndefined()
    await expect(governance.confirmSiteBoundary({ formal, candidate, adopted })).resolves.toEqual(formal)
    const repaired = governance.readProject('project-1')
    expect(repaired.visualAssets).toEqual([expect.objectContaining({ assetId: candidate.assetId, status: 'adopted', adoptedRevision: 4 })])
    expect(selectConfirmedSiteBoundary(repaired.siteBoundaries, 4)).toMatchObject({ boundaryId: formal.boundaryId })
  })

  it('确认中的采用 asset upsert 失败时保留 candidate 和不可选择 provisional', async () => {
    const ctx = await openStorage()
    const governance = await GovernanceRepository.open(ctx.storage.domain)
    const pending = siteBoundaryFixture()
    const candidate: VisualAssetRecord = {
      assetId: pending.sourceAsset!.assetId, taskId: pending.sourceAsset!.assetId, projectId: 'project-1', kind: 'evidence', required: true,
      status: 'candidate', mimeType: 'image/png', fileName: pending.sourceAsset!.fileName, sha256: pending.sourceAsset!.sha256,
      width: 1, height: 1, boundaryEvidence: pending.sourceAsset!.attachment!, createdAt: now,
    }
    const formal = {
      ...pending, status: 'confirmed_formal_boundary' as const, confirmedBy: siteBoundaryOwner, confirmedAt: now, confirmedRevision: 4,
      confirmationChannel: 'dsh_human_command' as const,
      confirmationStatement: '该图是本项目采用的总平图或红线图，且图中明确表达项目边界',
      confirmationSourceSha256: pending.sourceAsset!.sha256,
    }
    await governance.putSiteBoundary(pending)
    await governance.putVisualAsset(candidate)
    const repository = governance as unknown as { readonly domain: { table(name: 'visual_assets'): { put(key: string, value: unknown): Promise<void> } } }
    const assets = repository.domain.table('visual_assets')
    vi.spyOn(assets, 'put').mockRejectedValueOnce(new Error('injected adoption failure'))

    await expect(governance.confirmSiteBoundary({ formal, candidate, adopted: { ...candidate, status: 'adopted', adoptedRevision: 4 } })).rejects.toThrow('injected adoption failure')
    const interrupted = governance.readProject('project-1')
    expect(interrupted.visualAssets).toEqual([expect.objectContaining({ assetId: candidate.assetId, status: 'candidate' })])
    expect(selectConfirmedSiteBoundary(interrupted.siteBoundaries, 4)).toBeUndefined()
  })

  it('并发 confirm 的第二个 stale 写入不能把已完成 formal/adopted 回退', async () => {
    const ctx = await openStorage()
    const governance = await GovernanceRepository.open(ctx.storage.domain)
    const pending = siteBoundaryFixture()
    const candidate: VisualAssetRecord = {
      assetId: pending.sourceAsset!.assetId, taskId: pending.sourceAsset!.assetId, projectId: 'project-1', kind: 'evidence', required: true,
      status: 'candidate', mimeType: 'image/png', fileName: pending.sourceAsset!.fileName, sha256: pending.sourceAsset!.sha256,
      width: 1, height: 1, boundaryEvidence: pending.sourceAsset!.attachment!, createdAt: now,
    }
    const formal = {
      ...pending, status: 'confirmed_formal_boundary' as const, confirmedBy: siteBoundaryOwner, confirmedAt: now, confirmedRevision: 4,
      confirmationChannel: 'dsh_human_command' as const,
      confirmationStatement: '该图是本项目采用的总平图或红线图，且图中明确表达项目边界',
      confirmationSourceSha256: pending.sourceAsset!.sha256,
    }
    const adopted = { ...candidate, status: 'adopted' as const, adoptedRevision: 4 }
    await governance.putSiteBoundary(pending)
    await governance.putVisualAsset(candidate)
    const repository = governance as unknown as { readonly domain: { table(name: 'site_boundaries'): { put(key: string, value: unknown): Promise<void> } } }
    const boundaries = repository.domain.table('site_boundaries')
    const realPut = boundaries.put.bind(boundaries)
    let writes = 0
    let release!: () => void
    const released = new Promise<void>(resolve => { release = resolve })
    let entered!: () => void
    const firstWriteEntered = new Promise<void>(resolve => { entered = resolve })
    vi.spyOn(boundaries, 'put').mockImplementation(async (key, value) => {
      writes += 1
      if (writes === 1) {
        entered()
        await released
      }
      if (writes === 4) throw new Error('stale final write reached')
      await realPut(key, value)
    })

    const firstConfirmation = governance.confirmSiteBoundary({ formal, candidate, adopted })
    await firstWriteEntered
    const secondConfirmation = governance.confirmSiteBoundary({ formal, candidate, adopted })
    release()
    const [first, second] = await Promise.allSettled([firstConfirmation, secondConfirmation])
    expect(first).toMatchObject({ status: 'fulfilled', value: formal })
    expect(second).toMatchObject({ status: 'fulfilled', value: formal })
    const final = governance.readProject('project-1')
    expect(final.visualAssets).toEqual([expect.objectContaining({ status: 'adopted', adoptedRevision: 4 })])
    expect(selectConfirmedSiteBoundary(final.siteBoundaries, 4)).toMatchObject({ boundaryId: formal.boundaryId })
  })

  it('persists a confirmed site boundary and remains compatible when older projects have none', async () => {
    const ctx = await openStorage()
    const governance = await GovernanceRepository.open(ctx.storage.domain)
    await governance.putSiteBoundary({
      ...siteBoundaryFixture({
        status: 'confirmed_formal_boundary',
        confirmedBy: siteBoundaryOwner,
        confirmedAt: now,
        confirmedRevision: 4,
        confirmationChannel: 'dsh_human_command',
        confirmationStatement: '该图是本项目采用的总平图或红线图，且图中明确表达项目边界',
        confirmationSourceSha256: 'a'.repeat(64),
      }),
    })
    expect(governance.readProject('legacy-project').siteBoundaries).toEqual([])
    await governance.close()

    const reopened = await GovernanceRepository.open(ctx.storage.domain)
    expect(reopened.readProject('project-1').siteBoundaries).toEqual([
      expect.objectContaining({
        boundaryId: 'boundary-1',
        confirmedRevision: 4,
        source: 'approved_redline',
        sourceAsset: expect.objectContaining({
          attachment: expect.objectContaining({ attachmentId: 'attachment-1', storageSha256: 'a'.repeat(64) }),
        }),
      }),
    ])
  })

  it('keeps the legacy domain at v1 and persists the companion domain across reopen', async () => {
    const ctx = await openStorage()
    const projects = await ProjectRepository.open(ctx.storage.domain)
    const governance = await GovernanceRepository.open(ctx.storage.domain)

    expect(preplanningDomainSpec.version).toBe(1)
    expect(preplanningGovernanceDomainSpec).toMatchObject({
      name: 'preplanning_governance',
      version: 1,
    })
    expect((GovernanceDomain as unknown as {
      readonly preplanningSyntheticBoundaryFingerprintDomainSpec?: { readonly name: string; readonly version: number }
    }).preplanningSyntheticBoundaryFingerprintDomainSpec).toMatchObject({
      name: 'preplanning_synthetic_boundary_fingerprints', version: 1,
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
