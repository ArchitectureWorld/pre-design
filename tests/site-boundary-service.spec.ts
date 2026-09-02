import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ImageBlock } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SiteBoundaryAssetStore } from '../src/governance/site-boundary-asset-store.ts'
import { SiteBoundaryService, selectConfirmedSiteBoundary } from '../src/governance/site-boundary-service.ts'
import type { SiteBoundaryAcknowledgement } from '../src/governance/site-boundary-service.ts'
import type { SiteBoundaryRecord, VisualAssetRecord } from '../src/governance/types.ts'
import { syntheticBoundaryContext } from './support/synthetic-boundary-context.ts'

const roots: string[] = []
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const now = () => '2026-08-30T12:00:00.000Z'
const owner = { actorId: 'owner-1', name: '项目负责人', role: 'decision_owner' as const }
const humanContext = { actor: owner, channel: 'dsh_human_command' as const }
const canonicalAcknowledgement = '该图是本项目采用的总平图或红线图，且图中明确表达项目边界'

function boundaryAcknowledgement(
  record: SiteBoundaryRecord,
  overrides: Partial<SiteBoundaryAcknowledgement> = {},
): SiteBoundaryAcknowledgement {
  const contentSha256 = record.sourceAsset?.sha256 ?? record.geometry?.sha256
  if (!contentSha256) throw new Error('test boundary acknowledgement requires source content')
  return {
    boundaryId: record.boundaryId,
    submittedRevision: record.submittedRevision,
    contentSha256,
    statement: canonicalAcknowledgement,
    ...overrides,
  }
}

function confirmWithAcknowledgement(
  service: SiteBoundaryService,
  projectId: string,
  record: SiteBoundaryRecord,
  context = humanContext,
) {
  return (service as unknown as { confirm(
    projectId: string, boundaryId: string, revision: number, acknowledgement: ReturnType<typeof boundaryAcknowledgement>, context: typeof humanContext,
  ): Promise<SiteBoundaryRecord> }).confirm(projectId, record.boundaryId, record.submittedRevision, boundaryAcknowledgement(record), context)
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function block(): ImageBlock {
  return {
    type: 'image',
    attachment: {
      attachmentId: 'attachment-1' as ImageAttachmentRef['attachmentId'], mediaType: 'image/png', bytes: png.length,
      width: 1, height: 1, name: 'redline.png', originalDimensions: { width: 1, height: 1 },
    },
  }
}

async function harness(readImage?: (ref: unknown, signal: AbortSignal) => Promise<unknown>) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-boundary-service-'))
  roots.push(root)
  const assets: VisualAssetRecord[] = []
  const records: SiteBoundaryRecord[] = []
  const assetStore = new SiteBoundaryAssetStore(root, {
    readImage: readImage ?? vi.fn(async () => ({ ref: block().attachment, data: png })),
  } as never, now)
  const findSyntheticBoundaryByFingerprint = vi.fn((fingerprint: { readonly storageSha256?: string; readonly geometrySha256?: string }) => records.find(record => record.origin === 'synthetic'
    && (fingerprint.storageSha256 !== undefined
      ? record.sourceAsset?.attachment?.storageSha256 === fingerprint.storageSha256
      : record.geometry?.sha256 === fingerprint.geometrySha256)))
  const governance = {
    readProject: (projectId: string) => ({ projectId, visualAssets: assets.filter(asset => asset.projectId === projectId), siteBoundaries: records.filter(record => record.projectId === projectId) }),
    findSyntheticBoundaryByFingerprint,
    putVisualAsset: vi.fn(async (asset: VisualAssetRecord) => {
      const index = assets.findIndex(candidate => candidate.assetId === asset.assetId)
      if (index >= 0) assets[index] = asset
      else assets.push(asset)
      return asset
    }),
    putSiteBoundary: vi.fn(async (record: SiteBoundaryRecord) => {
      const index = records.findIndex(candidate => candidate.boundaryId === record.boundaryId)
      if (index >= 0) records[index] = record
      else records.push(record)
      return record
    }),
    putPendingSiteBoundary: vi.fn(async (record: SiteBoundaryRecord, asset?: VisualAssetRecord) => {
      const fingerprint = record.sourceAsset?.attachment?.storageSha256 === undefined
        ? { geometrySha256: record.geometry?.sha256 }
        : { storageSha256: record.sourceAsset.attachment.storageSha256 }
      const syntheticReplay = findSyntheticBoundaryByFingerprint(fingerprint)
      if (syntheticReplay !== undefined
        && (record.origin !== 'synthetic' || syntheticReplay.boundaryId !== record.boundaryId)) {
        throw new Error('SITE_BOUNDARY_SYNTHETIC_REPLAY_FORBIDDEN')
      }
      const existing = records.find(candidate => candidate.boundaryId === record.boundaryId)
      if (existing !== undefined) return existing
      if (asset !== undefined) {
        const assetIndex = assets.findIndex(candidate => candidate.assetId === asset.assetId)
        if (assetIndex < 0) assets.push(asset)
        else if (assets[assetIndex]?.status !== 'adopted') assets[assetIndex] = asset
      }
      records.push(record)
      return record
    }),
    confirmSiteBoundary: vi.fn(async (input: { readonly formal: SiteBoundaryRecord; readonly candidate: VisualAssetRecord; readonly adopted: VisualAssetRecord }) => {
      const assetIndex = assets.findIndex(candidate => candidate.assetId === input.adopted.assetId)
      if (assetIndex >= 0) assets[assetIndex] = input.adopted
      const boundaryIndex = records.findIndex(candidate => candidate.boundaryId === input.formal.boundaryId)
      if (boundaryIndex >= 0) records[boundaryIndex] = input.formal
      return input.formal
    }),
  }
  let sequence = 0
  return {
    root, assetStore, assets, records, governance,
    service: new SiteBoundaryService(governance as never, assetStore, now, () => `boundary-${++sequence}`),
  }
}

describe('SiteBoundaryService', () => {
  it('将恰好一张人工附件写为 candidate evidence，再登记待确认边界', async () => {
    const { service, assets } = await harness()

    await expect(service.registerImageAttachment('project-1', {
      source: 'approved_redline', block: block(), submittedRevision: 7, signal: AbortSignal.timeout(1_000),
    }, humanContext)).resolves.toMatchObject({
      status: 'pending_confirmation', origin: 'user_image', submissionChannel: 'dsh_human_command',
      sourceAsset: { attachment: { attachmentId: 'attachment-1', submittedRevision: 7 } },
    })
    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({ kind: 'evidence', status: 'candidate' })
    expect(assets[0]?.provider).toBeUndefined()
    expect(assets[0]?.model).toBeUndefined()
    await expect(service.registerImageAttachment('project-1', {
      source: 'approved_redline',
      block: { ...block(), attachment: { ...block().attachment, mediaType: 'image/gif' } } as never,
      submittedRevision: 7, signal: AbortSignal.timeout(1_000),
    }, humanContext)).rejects.toThrow('SITE_BOUNDARY_ATTACHMENT_INVALID')
  })

  it('synthetic 研究边界不可被正式确认，而人工上下文会写完整确认契约并采用资产', async () => {
    const { service, assets } = await harness()
    const synthetic = await service.registerGeometry('project-1', {
      crs: 'EPSG:4490', payload: [[0, 0], [4, 0], [0, 3], [0, 0]], submittedRevision: 7, projectName: '测试项目',
    }, syntheticBoundaryContext())
    await expect(service.confirm('project-1', synthetic.boundaryId, 7, syntheticBoundaryContext())).rejects.toThrow('SITE_BOUNDARY_SYNTHETIC_NOT_CONFIRMABLE')

    const pending = await service.registerImageAttachment('project-1', {
      source: 'approved_site_plan', block: block(), submittedRevision: 7, signal: AbortSignal.timeout(1_000),
    }, humanContext)
    await expect(confirmWithAcknowledgement(service, 'project-1', pending)).resolves.toMatchObject({
      status: 'confirmed_formal_boundary', confirmationChannel: 'dsh_human_command',
      confirmationStatement: canonicalAcknowledgement, confirmedBy: owner,
    })
    expect(assets.find(asset => asset.assetId === pending.sourceAsset?.assetId)).toMatchObject({ status: 'adopted', adoptedRevision: 7 })
  })

  it('service 不得自行伪造确认声明，且显式声明必须绑定当前 pending identity', async () => {
    const { service, assets, records } = await harness()
    const pending = await service.registerImageAttachment('project-1', {
      source: 'approved_site_plan', block: block(), submittedRevision: 7, signal: AbortSignal.timeout(1_000),
    }, humanContext)

    await expect(service.confirm('project-1', pending.boundaryId, 7, humanContext))
      .rejects.toThrow('SITE_BOUNDARY_CONFIRMATION_ACKNOWLEDGEMENT_REQUIRED')
    const futureConfirm = service as unknown as { confirm(
      projectId: string, boundaryId: string, revision: number, acknowledgement: ReturnType<typeof boundaryAcknowledgement>, context: typeof humanContext,
    ): Promise<SiteBoundaryRecord> }
    for (const invalid of [
      boundaryAcknowledgement(pending, { statement: '我确认边界' }),
      boundaryAcknowledgement(pending, { boundaryId: 'boundary-other' }),
      boundaryAcknowledgement(pending, { submittedRevision: 8 }),
      boundaryAcknowledgement(pending, { contentSha256: 'f'.repeat(64) }),
    ]) {
      await expect(futureConfirm.confirm('project-1', pending.boundaryId, 7, invalid, humanContext))
        .rejects.toThrow('SITE_BOUNDARY_CONFIRMATION_ACKNOWLEDGEMENT_INVALID')
    }
    expect(records[0]).toMatchObject({ status: 'pending_confirmation' })
    expect(assets[0]).toMatchObject({ status: 'candidate' })

    await expect(confirmWithAcknowledgement(service, 'project-1', pending)).resolves.toMatchObject({
      status: 'confirmed_formal_boundary', confirmationStatement: canonicalAcknowledgement,
      confirmationSourceSha256: pending.sourceAsset?.sha256,
    })
  })

  it('拒绝 synthetic 同内容重传、legacy 重登记和借此产生的人工正式确认', async () => {
    const { service, assets, records } = await harness()
    const synthetic = await service.registerImageAttachment('project-1', {
      source: 'approved_redline', block: block(), submittedRevision: 7, signal: AbortSignal.timeout(1_000),
    }, syntheticBoundaryContext())

    await expect(service.registerImageAttachment('project-1', {
      source: 'approved_redline', block: block(), submittedRevision: 7, signal: AbortSignal.timeout(1_000),
    }, humanContext)).rejects.toThrow('SITE_BOUNDARY_SYNTHETIC_REPLAY_FORBIDDEN')
    assets[0] = { ...assets[0]!, status: 'adopted', adoptedRevision: 7 }
    await expect(service.registerLegacyAsset('project-1', {
      source: 'approved_redline', assetId: assets[0]!.assetId, submittedRevision: 7,
    }, humanContext)).rejects.toThrow('SITE_BOUNDARY_SYNTHETIC_REPLAY_FORBIDDEN')
    await expect(service.confirm('project-1', synthetic.boundaryId, 7, humanContext)).rejects.toThrow('SITE_BOUNDARY_SYNTHETIC_NOT_CONFIRMABLE')
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ origin: 'synthetic', status: 'pending_confirmation' })
  })

  it('拒绝 synthetic 图片跨 source 标签重传为人工资料', async () => {
    const { service, records } = await harness()
    await service.registerImageAttachment('project-1', {
      source: 'approved_redline', block: block(), submittedRevision: 7, signal: AbortSignal.timeout(1_000),
    }, syntheticBoundaryContext())

    await expect(service.registerImageAttachment('project-1', {
      source: 'approved_site_plan', block: block(), submittedRevision: 7, signal: AbortSignal.timeout(1_000),
    }, humanContext)).rejects.toThrow('SITE_BOUNDARY_SYNTHETIC_REPLAY_FORBIDDEN')
    expect(records).toHaveLength(1)
  })

  it('拒绝 synthetic 几何跨 closed_coordinates/geojson source 标签重传', async () => {
    const { service, records } = await harness()
    const square = [[114, 30], [114.01, 30], [114, 30.01], [114, 30]]
    await service.registerGeometry('project-1', {
      crs: 'EPSG:4490', payload: square, submittedRevision: 7, projectName: '测试项目',
    }, syntheticBoundaryContext())

    await expect(service.registerGeometry('project-1', {
      crs: 'EPSG:4490', payload: { type: 'Polygon', coordinates: [square] }, submittedRevision: 7, projectName: '测试项目',
    }, humanContext)).rejects.toThrow('SITE_BOUNDARY_SYNTHETIC_REPLAY_FORBIDDEN')
    expect(records).toHaveLength(1)
  })

  it('全局拒绝项目 A synthetic 图片在项目 B 跨 source 重放且项目 B 零治理写入', async () => {
    const { service, assets, records, governance } = await harness()
    await service.registerImageAttachment('project-A', {
      source: 'approved_redline', block: block(), submittedRevision: 7, signal: AbortSignal.timeout(1_000),
    }, syntheticBoundaryContext())
    const before = { assets: assets.length, records: records.length }

    await expect(service.registerImageAttachment('project-B', {
      source: 'approved_site_plan', block: block(), submittedRevision: 7, signal: AbortSignal.timeout(1_000),
    }, humanContext)).rejects.toThrow('SITE_BOUNDARY_SYNTHETIC_REPLAY_FORBIDDEN')
    expect(governance.findSyntheticBoundaryByFingerprint).toHaveBeenCalledWith({ storageSha256: expect.stringMatching(/^[a-f0-9]{64}$/u) })
    expect(assets).toHaveLength(before.assets)
    expect(records).toHaveLength(before.records)
    expect(records.filter(record => record.projectId === 'project-B')).toEqual([])
    expect(assets.filter(asset => asset.projectId === 'project-B')).toEqual([])
  })

  it('全局拒绝项目 A synthetic coordinates 在项目 B 以等价 GeoJSON 重放', async () => {
    const { service, assets, records, governance } = await harness()
    const square = [[114, 30], [114.01, 30], [114, 30.01], [114, 30]]
    await service.registerGeometry('project-A', {
      crs: 'EPSG:4490', payload: square, submittedRevision: 7, projectName: '项目 A',
    }, syntheticBoundaryContext())
    const before = { assets: assets.length, records: records.length }

    await expect(service.registerGeometry('project-B', {
      crs: 'EPSG:4490', payload: { type: 'Polygon', coordinates: [square] }, submittedRevision: 7, projectName: '项目 B',
    }, humanContext)).rejects.toThrow('SITE_BOUNDARY_SYNTHETIC_REPLAY_FORBIDDEN')
    expect(governance.findSyntheticBoundaryByFingerprint).toHaveBeenCalledWith({ geometrySha256: expect.stringMatching(/^[a-f0-9]{64}$/u) })
    expect(assets).toHaveLength(before.assets)
    expect(records).toHaveLength(before.records)
    expect(records.filter(record => record.projectId === 'project-B')).toEqual([])
  })

  it('相同图片顺序/并发重试稳定复用一个 pending boundary 与一个 asset，确认后不得降级', async () => {
    const { service, assets, records } = await harness()
    const input = { source: 'approved_redline' as const, block: block(), submittedRevision: 7, signal: AbortSignal.timeout(1_000) }
    const [first, concurrent] = await Promise.all([
      service.registerImageAttachment('project-1', input, humanContext),
      service.registerImageAttachment('project-1', input, humanContext),
    ])
    const retry = await service.registerImageAttachment('project-1', input, humanContext)
    expect([first.boundaryId, concurrent.boundaryId, retry.boundaryId]).toEqual([first.boundaryId, first.boundaryId, first.boundaryId])
    expect(records).toHaveLength(1)
    expect(assets).toHaveLength(1)

    const confirmed = await confirmWithAcknowledgement(service, 'project-1', first)
    const afterConfirm = await service.registerImageAttachment('project-1', input, humanContext)
    expect(afterConfirm).toEqual(confirmed)
    expect(records).toEqual([confirmed])
    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({ status: 'adopted', adoptedRevision: 7 })
  })

  it.each([
    ['coordinates', [[114, 30], [114.01, 30], [114, 30.01], [114, 30]]],
    ['GeoJSON', { type: 'Polygon', coordinates: [[[114, 30], [114.01, 30], [114, 30.01], [114, 30]]] }],
  ])('相同 %s 顺序与并发重试稳定复用一个 pending boundary 与一个 asset', async (_label, payload) => {
    const { service, assets, records } = await harness()
    const input = { crs: 'EPSG:4490', payload, submittedRevision: 7, projectName: '项目 A' }
    const [first, concurrent] = await Promise.all([
      service.registerGeometry('project-1', input, humanContext),
      service.registerGeometry('project-1', input, humanContext),
    ])
    const retry = await service.registerGeometry('project-1', input, humanContext)
    expect([first.boundaryId, concurrent.boundaryId, retry.boundaryId]).toEqual([first.boundaryId, first.boundaryId, first.boundaryId])
    expect(records).toHaveLength(1)
    expect(assets).toHaveLength(1)
  })

  it('ingest 途中用户取消时返回取消错误且零写入', async () => {
    let listening!: () => void
    const listenerReady = new Promise<void>(resolve => { listening = resolve })
    const { service, assets, records } = await harness((_ref, signal) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      listening()
    }))
    const controller = new AbortController()
    const submitted = service.registerImageAttachment('project-1', {
      source: 'approved_redline', block: block(), submittedRevision: 7, signal: controller.signal,
    }, humanContext)
    await listenerReady
    controller.abort(new DOMException('用户取消', 'AbortError'))

    await expect(submitted).rejects.toThrow('SITE_BOUNDARY_OPERATION_ABORTED')
    expect(assets).toEqual([])
    expect(records).toEqual([])
  })

  it('已中止的 timeout signal 被稳定分类为取消且零写入，不等待 30 秒', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('timeout', 'AbortError')))
    const { service, assets, records } = await harness(async (_ref, signal) => {
      if (signal.aborted) throw signal.reason
      throw new Error('unexpected read')
    })
    const signal = AbortSignal.timeout(30_000)

    await expect(service.registerImageAttachment('project-1', {
      source: 'approved_redline', block: block(), submittedRevision: 7, signal,
    }, humanContext)).rejects.toThrow('SITE_BOUNDARY_OPERATION_ABORTED')
    timeout.mockRestore()
    expect(assets).toEqual([])
    expect(records).toEqual([])
  })

  it('readImage 返回后已取消时不写治理 candidate 或边界记录', async () => {
    const controller = new AbortController()
    const { service, assets, records } = await harness(async () => {
      controller.abort(new DOMException('cancelled after read', 'AbortError'))
      return { ref: block().attachment, data: png }
    })

    await expect(service.registerImageAttachment('project-1', {
      source: 'approved_redline', block: block(), submittedRevision: 7, signal: controller.signal,
    }, humanContext)).rejects.toThrow('SITE_BOUNDARY_OPERATION_ABORTED')
    expect(assets).toEqual([])
    expect(records).toEqual([])
  })

  it('provisional formal 与 adopted asset 的中断残留不可被 legacy 消费', async () => {
    const { service, assets, records } = await harness()
    const pending = await service.registerImageAttachment('project-1', {
      source: 'approved_redline', block: block(), submittedRevision: 7, signal: AbortSignal.timeout(1_000),
    }, humanContext)
    assets[0] = { ...assets[0]!, status: 'adopted', adoptedRevision: 7 }
    records[0] = {
      ...pending, status: 'confirmed_formal_boundary', confirmedBy: owner, confirmedAt: now(), confirmedRevision: Number.MAX_SAFE_INTEGER,
      confirmationChannel: 'dsh_human_command', confirmationStatement: canonicalAcknowledgement,
      confirmationSourceSha256: pending.sourceAsset!.sha256,
    }

    await expect(service.registerLegacyAsset('project-1', {
      source: 'approved_redline', assetId: assets[0]!.assetId, submittedRevision: 7,
    }, humanContext)).rejects.toThrow('SITE_BOUNDARY_INTEGRITY_FAILED')
    expect(selectConfirmedSiteBoundary(records, 7)).toBeUndefined()
  })

  it('规范化闭合坐标与 GeoJSON，并为两者保存可校验的确定性 SVG', async () => {
    const { service, assets } = await harness()
    const coordinates = await service.registerGeometry('project-1', {
      crs: 'EPSG:4490', payload: [[114, 30], [114.01, 30], [114, 30.01], [114, 30]], submittedRevision: 7, projectName: '项目 A',
    }, humanContext)
    const geojson = await service.registerGeometry('project-1', {
      crs: 'EPSG:4490', payload: { type: 'Polygon', coordinates: [[[114, 30], [114.01, 30], [114, 30.01], [114, 30]]]}, submittedRevision: 7, projectName: '项目 A',
    }, humanContext)

    expect(coordinates).toMatchObject({ source: 'closed_coordinates', origin: 'user_coordinates', geometry: { derivedAssetId: expect.any(String), derivedSha256: expect.stringMatching(/^[a-f0-9]{64}$/u) } })
    expect(geojson).toMatchObject({ source: 'geojson', origin: 'user_geojson', geometry: { derivedFileName: expect.stringContaining('.svg') } })
    expect(assets).toHaveLength(2)
    await expect(service.registerGeometry('project-1', {
      crs: 'WGS84', payload: [[0, 0], [4, 0], [0, 3], [0, 0]], submittedRevision: 7, projectName: '项目 A',
    }, humanContext)).rejects.toThrow('SITE_BOUNDARY_CRS_INVALID：场地边界坐标或 GeoJSON 不符合要求')
  })

  it('legacy 仅接受已采用且带不可变人工附件血缘的同项目 evidence', async () => {
    const { service, assets } = await harness()
    const pending = await service.registerImageAttachment('project-1', {
      source: 'approved_redline', block: block(), submittedRevision: 7, signal: AbortSignal.timeout(1_000),
    }, humanContext)
    const candidate = assets[0]!
    assets[0] = { ...candidate, status: 'adopted', adoptedRevision: 7 }

    await expect(service.registerLegacyAsset('project-1', {
      source: 'approved_redline', assetId: candidate.assetId, submittedRevision: 7,
    }, humanContext)).resolves.toMatchObject({ sourceAsset: { assetId: candidate.assetId }, origin: 'user_image' })
    await expect(service.registerLegacyAsset('project-2', {
      source: 'approved_redline', assetId: candidate.assetId, submittedRevision: 7,
    }, humanContext)).rejects.toThrow('SITE_BOUNDARY_LEGACY_ASSET_INVALID')
    for (const invalid of [
      { ...assets[0]!, status: 'candidate' as const },
      { ...assets[0]!, kind: 'concept' as const },
      { ...assets[0]!, kind: 'deterministic' as const },
      { ...assets[0]!, provider: 'provider', model: 'model', promptSummary: '模型提示' },
      { ...assets[0]!, boundaryEvidence: undefined },
    ]) {
      assets[0] = invalid as VisualAssetRecord
      await expect(service.registerLegacyAsset('project-1', {
        source: 'approved_redline', assetId: candidate.assetId, submittedRevision: 7,
      }, humanContext)).rejects.toThrow('SITE_BOUNDARY_LEGACY_ASSET_INVALID')
    }
    await expect(service.registerLegacyAsset('project-1', {
      source: 'approved_redline', assetId: candidate.assetId, submittedRevision: 7,
    }, syntheticBoundaryContext())).rejects.toThrow('SITE_BOUNDARY_CONTEXT_INVALID')
    expect(pending.status).toBe('pending_confirmation')
  })

  it.each([
    ['mediaType', (pending: SiteBoundaryRecord) => ({ ...pending, sourceAsset: { ...pending.sourceAsset!, attachment: { ...pending.sourceAsset!.attachment!, mediaType: 'image/jpeg' as const } } })],
    ['bytes', (pending: SiteBoundaryRecord) => ({ ...pending, sourceAsset: { ...pending.sourceAsset!, attachment: { ...pending.sourceAsset!.attachment!, bytes: pending.sourceAsset!.attachment!.bytes + 1 } } })],
    ['width', (pending: SiteBoundaryRecord) => ({ ...pending, sourceAsset: { ...pending.sourceAsset!, attachment: { ...pending.sourceAsset!.attachment!, width: pending.sourceAsset!.attachment!.width + 1 } } })],
    ['height', (pending: SiteBoundaryRecord) => ({ ...pending, sourceAsset: { ...pending.sourceAsset!, attachment: { ...pending.sourceAsset!.attachment!, height: pending.sourceAsset!.attachment!.height + 1 } } })],
    ['附件 submittedBy', (pending: SiteBoundaryRecord) => ({ ...pending, sourceAsset: { ...pending.sourceAsset!, attachment: { ...pending.sourceAsset!.attachment!, submittedBy: { ...owner, actorId: 'other-owner' } } } })],
    ['附件 submittedRevision', (pending: SiteBoundaryRecord) => ({ ...pending, sourceAsset: { ...pending.sourceAsset!, attachment: { ...pending.sourceAsset!.attachment!, submittedRevision: 6 } } })],
    ['顶层 submittedBy', (pending: SiteBoundaryRecord) => ({ ...pending, submittedBy: { ...owner, actorId: 'other-owner' } })],
    ['顶层 submittedRevision', (pending: SiteBoundaryRecord) => ({ ...pending, submittedRevision: 6 })],
  ])('确认前完整比对不可变 evidence：%s 漂移零写入', async (_label, mutate) => {
    const { service, assets, records } = await harness()
    const pending = await service.registerImageAttachment('project-1', {
      source: 'approved_redline', block: block(), submittedRevision: 7, signal: AbortSignal.timeout(1_000),
    }, humanContext)
    records[0] = mutate(pending)

    await expect(service.confirm('project-1', pending.boundaryId, records[0]!.submittedRevision, boundaryAcknowledgement(records[0]!), humanContext)).rejects.toThrow('SITE_BOUNDARY_INTEGRITY_FAILED')
    expect(records).toEqual([records[0]])
    expect(assets).toMatchObject([{ status: 'candidate' }])
  })

  it('确认与导出完整性会拒绝未来 revision 与跨项目读取', async () => {
    const { service, assetStore, root, assets } = await harness()
    const pending = await service.registerImageAttachment('project-1', {
      source: 'approved_redline', block: block(), submittedRevision: 7, signal: AbortSignal.timeout(1_000),
    }, humanContext)
    await expect(service.confirm('project-1', pending.boundaryId, 8, boundaryAcknowledgement(pending), humanContext)).rejects.toThrow('SITE_BOUNDARY_REVISION_INVALID')
    const confirmed = await confirmWithAcknowledgement(service, 'project-1', pending)
    await expect(service.assertFormalBoundaryIntegrity('project-2', 7)).rejects.toThrow('SITE_BOUNDARY_FORMAL_NOT_FOUND')
    await expect(service.assertFormalBoundaryIntegrity('project-1', 7)).resolves.toMatchObject({ record: { boundaryId: confirmed.boundaryId }, integrityDigest: expect.stringMatching(/^[a-f0-9]{64}$/u) })

    expect(assetStore.resolveAsset(assets[0]!.fileName)).toContain(root)
  })

  it('导出 preflight 将实际文件 SHA 漂移分类为 SITE_BOUNDARY_FILE_SHA_MISMATCH', async () => {
    const { service, assetStore, assets } = await harness()
    const pending = await service.registerImageAttachment('project-1', {
      source: 'approved_redline', block: block(), submittedRevision: 7, signal: AbortSignal.timeout(1_000),
    }, humanContext)
    await confirmWithAcknowledgement(service, 'project-1', pending)

    await writeFile(assetStore.resolveAsset(assets[0]!.fileName), 'drifted')
    await expect(service.assertFormalBoundaryIntegrity('project-1', 7))
      .rejects.toThrow('SITE_BOUNDARY_FILE_SHA_MISMATCH')
  })

  it('导出 preflight 将资产文件丢失分类为 SITE_BOUNDARY_FILE_MISSING', async () => {
    const { service, assetStore, assets } = await harness()
    const pending = await service.registerImageAttachment('project-1', {
      source: 'approved_redline', block: block(), submittedRevision: 7, signal: AbortSignal.timeout(1_000),
    }, humanContext)
    await confirmWithAcknowledgement(service, 'project-1', pending)

    await unlink(assetStore.resolveAsset(assets[0]!.fileName))
    await expect(service.assertFormalBoundaryIntegrity('project-1', 7))
      .rejects.toThrow('SITE_BOUNDARY_FILE_MISSING')
  })

  it('导出 preflight 将 canonical sidecar 丢失分类为 SITE_BOUNDARY_FILE_MISSING', async () => {
    const { service, assetStore, assets } = await harness()
    const pending = await service.registerImageAttachment('project-1', {
      source: 'approved_redline', block: block(), submittedRevision: 7, signal: AbortSignal.timeout(1_000),
    }, humanContext)
    await confirmWithAcknowledgement(service, 'project-1', pending)

    await unlink(assetStore.resolveAsset(`${assets[0]!.fileName}.record.json`))
    await expect(service.assertFormalBoundaryIntegrity('project-1', 7))
      .rejects.toThrow('SITE_BOUNDARY_FILE_MISSING')
  })

  it('导出 preflight 将 record/asset geometry lineage 漂移分类为 SITE_BOUNDARY_LINEAGE_MISMATCH', async () => {
    const { service, assets } = await harness()
    const pending = await service.registerGeometry('project-1', {
      crs: 'EPSG:4490', payload: [[0, 0], [4, 0], [0, 3], [0, 0]], submittedRevision: 7, projectName: '测试项目',
    }, humanContext)
    await confirmWithAcknowledgement(service, 'project-1', pending)
    assets[0] = { ...assets[0]!, boundaryGeometrySha256: 'f'.repeat(64) }

    await expect(service.assertFormalBoundaryIntegrity('project-1', 7))
      .rejects.toThrow('SITE_BOUNDARY_LINEAGE_MISMATCH')
  })
})
