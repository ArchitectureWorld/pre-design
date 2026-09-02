import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SiteBoundaryAssetStore } from '../src/governance/site-boundary-asset-store.ts'
import { SiteBoundaryService } from '../src/governance/site-boundary-service.ts'
import type { SiteBoundaryRecord, VisualAssetRecord } from '../src/governance/types.ts'
import { assertClientReportPolicy } from '../src/report/client-policy.ts'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import type { ClientProjectProfile } from '../src/report/client-types.ts'
import { planClientPages } from '../src/report/page-plan.ts'
import { ReportPackageService } from '../src/report/package-service.ts'
import { createFrozenProjectInput } from '../src/report/source.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'
import type { ArtifactValidationSensitiveValues } from '../src/report/validate-artifacts.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

const roots: string[] = []
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const formalBoundary = {
  boundaryId: 'boundary-1', projectId: 'golden-project', submittedRevision: 3,
  status: 'confirmed_formal_boundary' as const, source: 'approved_redline' as const,
  origin: 'user_image' as const, submissionChannel: 'dsh_human_command' as const,
  sourceAsset: {
    assetId: 'redline-1', fileName: 'golden-project/evidence/redline-1.png', sha256: 'd'.repeat(64),
    attachment: {
      origin: 'user_image' as const, attachmentId: 'attachment-1', mediaType: 'image/png' as const,
      displayName: 'redline.png', bytes: 68, width: 1, height: 1, storageSha256: 'd'.repeat(64),
      submittedBy: { actorId: 'owner-1', name: '负责人', role: 'decision_owner' as const }, submittedRevision: 3,
    },
  },
  submittedBy: { actorId: 'owner-1', name: '负责人', role: 'decision_owner' as const }, submittedAt: '2026-08-28T08:00:00.000Z',
  confirmedBy: { actorId: 'owner-1', name: '负责人', role: 'decision_owner' as const }, confirmedAt: '2026-08-28T09:00:00.000Z', confirmedRevision: 3,
  confirmationChannel: 'dsh_human_command' as const,
  confirmationStatement: '该图是本项目采用的总平图或红线图，且图中明确表达项目边界',
  confirmationSourceSha256: 'd'.repeat(64),
}
const formalInput = {
  boundaryId: formalBoundary.boundaryId, assetId: formalBoundary.sourceAsset.assetId,
  status: 'confirmed' as const, confirmedRevision: formalBoundary.confirmedRevision,
  source: formalBoundary.source, sourceSha256: formalBoundary.sourceAsset.sha256,
  assetSha256: formalBoundary.sourceAsset.sha256,
  integrityDigest: createHash('sha256').update(JSON.stringify({
    boundaryId: formalBoundary.boundaryId, confirmedRevision: formalBoundary.confirmedRevision,
    source: formalBoundary.source, sourceSha256: formalBoundary.sourceAsset.sha256, geometrySha256: undefined,
  })).digest('hex'),
}
const formalReportAsset = {
  assetId: formalBoundary.sourceAsset.assetId,
  chapterId: '07',
  kind: 'evidence' as const,
  caption: '项目红线图',
  sourcePath: 'C:/fixtures/redline-1.png',
  mimeType: 'image/png' as const,
  sha256: formalBoundary.sourceAsset.sha256,
  width: 1,
  height: 1,
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function serializedProfessionalFixtureData() {
  const chapter = CLIENT_PROFILE.chapters[1]!
  const roles = Array.from({ length: 12 }, (_, index) =>
    (['map', 'chart', 'diagram'] as const)[index % 3]!)
  const visualAssets = roles.map((role, index) => ({
    ...REPORT_INPUT.visualAssets[0]!,
    assetId: `serialized-professional-${index + 1}`,
    caption: `序列化专业图件 ${index + 1}`,
  }))
  const assetBindings = roles.map((role, index) => ({
    assetId: visualAssets[index]!.assetId,
    role,
    chapterId: chapter.id,
    sha256: String(index + 1).padStart(64, '0'),
    width: 1920,
    height: 1080,
  }))
  return {
    input: {
      ...REPORT_INPUT,
      visualAssets: [...REPORT_INPUT.visualAssets, ...visualAssets],
      adoptedAssetIds: [...(REPORT_INPUT.adoptedAssetIds ?? []), ...visualAssets.map(asset => asset.assetId)],
    },
    profile: {
      ...CLIENT_PROFILE,
      chapters: CLIENT_PROFILE.chapters.map(candidate => candidate.id !== chapter.id
        ? candidate
        : {
            ...candidate,
            blocks: visualAssets.map((asset, index) => ({
              type: 'evidence' as const,
              headline: `序列化专业判断 ${index + 1}`,
              evidenceIds: [CLIENT_PROFILE.evidence[index % CLIENT_PROFILE.evidence.length]!.evidenceId],
              assetIds: [asset.assetId],
            })),
          }),
      assetBindings: [...CLIENT_PROFILE.assetBindings, ...assetBindings],
      requiredVisualRoles: [...CLIENT_PROFILE.requiredVisualRoles, 'map', 'chart', 'diagram'] as const,
    },
  }
}

function fixture(root: string, options: {
  requiredVisualPending?: boolean
  pdfError?: Error
  serializedProfessionalPlans?: boolean
  siteBoundary?: 'confirmed' | 'pending' | 'missing' | 'malformed' | 'future'
  researchInput?: boolean
  projection?: (input: FrozenProjectInput, profile: ClientProjectProfile) => unknown
} = {}) {
  const reportPackages: unknown[] = []
  const governance = {
    readProject: vi.fn(() => ({
      visualTasks: options.requiredVisualPending
        ? [{ taskId: 'required-1', required: true, status: 'candidate_ready' }]
        : [],
      visualAssets: [{
        ...formalReportAsset,
        taskId: formalReportAsset.assetId,
        projectId: formalBoundary.projectId,
        required: true,
        status: 'adopted' as const,
        adoptedRevision: formalBoundary.confirmedRevision,
        fileName: formalBoundary.sourceAsset.fileName,
        createdAt: '2026-08-28T08:00:00.000Z',
      }],
      siteBoundaries: options.siteBoundary === 'missing' ? [] : [options.siteBoundary === 'pending'
        ? { ...formalBoundary, status: 'pending_confirmation' as const, confirmedBy: undefined, confirmedAt: undefined, confirmedRevision: undefined }
        : options.siteBoundary === 'malformed'
          ? { ...formalBoundary, confirmedBy: undefined, confirmedAt: undefined }
          : options.siteBoundary === 'future'
            ? { ...formalBoundary, confirmedRevision: 58 }
            : formalBoundary],
      reportPackages,
    })),
    putReportPackage: vi.fn(async (record) => { reportPackages.push(record); return record }),
  }
  const renderers = {
    html: vi.fn(async (_context, staging: string) => {
      await mkdir(join(staging, 'html'), { recursive: true })
      await writeFile(join(staging, 'html', 'index.html'), '<html><head></head><body>成果</body></html>')
    }),
    printHtml: vi.fn(async (_context, staging: string) => {
      await mkdir(join(staging, 'print'), { recursive: true })
      const path = join(staging, 'print', 'index.html')
      await writeFile(path, '<html><head></head><body>打印成果</body></html>')
      return path
    }),
    pptx: vi.fn(async (_context, output: string) => writeFile(output, Buffer.from('PK ppt/slides/slide1.xml'))),
    pdf: options.pdfError === undefined
      ? vi.fn(async (_html, output: string) => writeFile(output, Buffer.from('%PDF-1.7\n%%EOF')))
      : vi.fn(async () => { throw options.pdfError }),
  }
  const validate = vi.fn(async (
    _staging: string,
    identity,
    _sensitive?: ArtifactValidationSensitiveValues,
  ) => ({
    ...identity,
    artifacts: [
      { format: 'html' as const, fileName: 'html/index.html', sha256: 'a'.repeat(64), bytes: 42 },
      { format: 'pptx' as const, fileName: 'report.pptx', sha256: 'b'.repeat(64), bytes: 42 },
      { format: 'pdf' as const, fileName: 'report.pdf', sha256: 'c'.repeat(64), bytes: 42 },
    ],
  }))
  const policy = vi.fn(assertClientReportPolicy)
  const professional = options.serializedProfessionalPlans ? serializedProfessionalFixtureData() : undefined
  const planner = vi.fn(options.serializedProfessionalPlans
    ? (report, medium) => JSON.parse(JSON.stringify(planClientPages(report, medium)))
    : planClientPages)
  const profile = vi.fn(async () => professional?.profile ?? CLIENT_PROFILE)
  const baseInput = professional?.input ?? REPORT_INPUT
  const source = vi.fn(async () => options.researchInput
    ? { ...baseInput, siteBoundary: { boundaryId: 'research-1', status: 'synthetic_research' as const, source: 'approved_redline' as const, declarations: ['研究范围（待核）', '非法定红线', '非测绘成果'] as const } }
    : {
        ...baseInput,
        visualAssets: [...baseInput.visualAssets, formalReportAsset],
        adoptedAssetIds: [...(baseInput.adoptedAssetIds ?? []), formalReportAsset.assetId],
        siteBoundary: formalInput,
      })
  const assertFormalBoundaryIntegrity = vi.fn(async () => ({
      record: formalBoundary,
      asset: {
        assetId: formalBoundary.sourceAsset.assetId,
        taskId: formalBoundary.sourceAsset.assetId,
        projectId: formalBoundary.projectId,
        kind: 'evidence' as const,
        required: true,
        status: 'adopted' as const,
        adoptedRevision: formalBoundary.confirmedRevision,
        fileName: formalBoundary.sourceAsset.fileName,
        mimeType: 'image/png' as const,
        sha256: formalBoundary.sourceAsset.sha256,
        width: 1,
        height: 1,
        createdAt: '2026-08-28T08:00:00.000Z',
      },
      integrityDigest: formalInput.integrityDigest,
    }))
  const boundaryIntegrity = {
    assertFormalBoundaryIntegrity,
    captureFormalBoundarySnapshot: vi.fn(async (...args: Parameters<typeof assertFormalBoundaryIntegrity>) => ({
      ...await assertFormalBoundaryIntegrity(...args),
      bytes: png,
    })),
  }
  const service = new ReportPackageService({
    governance: governance as never,
    boundaryIntegrity,
    packageRoot: root,
    browserExecutable: 'fake-edge.exe',
    source,
    profile,
    policy,
    planner,
    renderers,
    validate,
    createId: () => 'package-1',
    now: () => '2026-08-28T10:00:00.000Z',
    ...(options.projection === undefined ? {} : { projection: options.projection }),
  } as never)
  return { service, governance, boundaryIntegrity, renderers, validate, policy, planner, profile, source }
}

async function realBoundaryPackageFixture(parent: string, kind: 'image' | 'geometry' = 'image') {
  const records: SiteBoundaryRecord[] = []
  const assets: VisualAssetRecord[] = []
  const reportPackages: unknown[] = []
  const owner = { actorId: 'owner-1', name: '项目负责人', role: 'decision_owner' as const }
  const attachment = {
    attachmentId: 'attachment-1', mediaType: 'image/png', bytes: png.length,
    width: 1, height: 1, name: 'redline.png', originalDimensions: { width: 1, height: 1 },
  }
  const governance = {
    readProject: (projectId: string) => ({
      projectId, gateDecisions: [], visualTasks: [], reportPackages,
      visualAssets: assets.filter(asset => asset.projectId === projectId),
      siteBoundaries: records.filter(record => record.projectId === projectId),
    }),
    putVisualAsset: vi.fn(async (asset: VisualAssetRecord) => { assets.push(asset); return asset }),
    putSiteBoundary: vi.fn(async (record: SiteBoundaryRecord) => { records.push(record); return record }),
    putPendingSiteBoundary: vi.fn(async (record: SiteBoundaryRecord, asset?: VisualAssetRecord) => {
      const existing = records.find(candidate => candidate.boundaryId === record.boundaryId)
      if (existing !== undefined) return existing
      if (asset !== undefined && !assets.some(candidate => candidate.assetId === asset.assetId)) assets.push(asset)
      records.push(record)
      return record
    }),
    confirmSiteBoundary: vi.fn(async (input: { readonly formal: SiteBoundaryRecord; readonly adopted: VisualAssetRecord }) => {
      const recordIndex = records.findIndex(record => record.boundaryId === input.formal.boundaryId)
      records[recordIndex] = input.formal
      const assetIndex = assets.findIndex(asset => asset.assetId === input.adopted.assetId)
      assets[assetIndex] = input.adopted
      return input.formal
    }),
    putReportPackage: vi.fn(async record => { reportPackages.push(record); return record }),
  }
  const assetStore = new SiteBoundaryAssetStore(join(parent, 'boundary-assets'), {
    readImage: vi.fn(async () => ({ ref: attachment, data: png })),
  } as never, () => '2026-08-30T12:00:00.000Z')
  let sequence = 0
  const boundaries = new SiteBoundaryService(governance as never, assetStore, () => '2026-08-30T12:00:00.000Z', () => `boundary-${++sequence}`)
  const pending = kind === 'image'
    ? await boundaries.registerImageAttachment('golden-project', {
        source: 'approved_redline', block: { type: 'image', attachment } as never,
        submittedRevision: 57, signal: AbortSignal.timeout(1_000),
      }, { actor: owner, channel: 'dsh_human_command' })
    : await boundaries.registerGeometry('golden-project', {
        crs: 'EPSG:4490', payload: [[0, 0], [4, 0], [0, 3], [0, 0]], submittedRevision: 57,
        projectName: REPORT_INPUT.projectName,
      }, { actor: owner, channel: 'dsh_human_command' })
  await boundaries.confirm('golden-project', pending.boundaryId, 57, {
    boundaryId: pending.boundaryId,
    submittedRevision: pending.submittedRevision,
    contentSha256: pending.sourceAsset?.sha256 ?? pending.geometry!.sha256,
    statement: '该图是本项目采用的总平图或红线图，且图中明确表达项目边界',
  }, { actor: owner, channel: 'dsh_human_command' })
  const source = vi.fn(async (projectId: string, revision: number) => createFrozenProjectInput(projectId, revision, {
    repository: { readProjectRevision: vi.fn(() => ({
      project: { projectId, name: REPORT_INPUT.projectName },
      revision: { revision, committedAt: REPORT_INPUT.generatedAt },
      stateSnapshot: Object.fromEntries(REPORT_INPUT.stateObjects.map(object => [object.objectId, { title: object.title, summary: object.summary }])),
    })) } as never,
    governance: governance as never,
    registry: { workflows: vi.fn(() => REPORT_INPUT.stateObjects.map(object => ({
      targetObjectId: object.objectId, chapterId: object.chapterId, title: object.title,
    }))) } as never,
    visualStore: assetStore as never,
  }))
  const profile = vi.fn(async () => ({ ...CLIENT_PROFILE, requiredVisualRoles: ['product-scene' as const, 'map' as const] }))
  const renderers = {
    html: vi.fn(), printHtml: vi.fn(), pptx: vi.fn(), pdf: vi.fn(),
  }
  const validate = vi.fn(async (_staging: string, identity) => ({
    ...identity,
    artifacts: [
      { format: 'html' as const, fileName: 'html/index.html', sha256: 'a'.repeat(64), bytes: 42 },
      { format: 'pptx' as const, fileName: 'report.pptx', sha256: 'b'.repeat(64), bytes: 42 },
      { format: 'pdf' as const, fileName: 'report.pdf', sha256: 'c'.repeat(64), bytes: 42 },
    ],
  }))
  const packageRoot = join(parent, 'packages')
  const service = new ReportPackageService({
    governance: governance as never, boundaryIntegrity: boundaries, packageRoot,
    browserExecutable: 'fake-edge.exe', source, profile, renderers: renderers as never, validate,
    createId: () => 'package-1',
  })
  return { assetStore, assets, boundaries, governance, packageRoot, profile, records, renderers, reportPackages, service, source, validate }
}

describe('ReportPackageService', () => {
  it('rejects a research-preview projection before policy, package root, staging, or manifest creation', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'preplan-preview-package-'))
    roots.push(parent)
    const packageRoot = join(parent, 'packages')
    const ports = fixture(packageRoot, {
      projection: (input, profile) => ({
        ...createClientReportBundle(input, profile),
        kind: 'research_preview' as const,
        publishable: false as const,
        researchBoundary: {
          boundaryId: 'research-boundary-1', assetId: formalBoundary.sourceAsset.assetId,
          assetSha256: formalBoundary.sourceAsset.sha256,
        },
      }),
    })

    await expect(ports.service.publish('golden-project', 57))
      .rejects.toThrow('SITE_BOUNDARY_RESEARCH_PREVIEW_NOT_PUBLISHABLE')
    expect(ports.policy).not.toHaveBeenCalled()
    expect(ports.planner).not.toHaveBeenCalled()
    expect(ports.renderers.html).not.toHaveBeenCalled()
    expect(ports.validate).not.toHaveBeenCalled()
    expect(ports.governance.putReportPackage).not.toHaveBeenCalled()
    await expect(access(packageRoot)).rejects.toThrow()
  })

  it.each(['image', 'geometry'] as const)(
    'rechecks a formal %s boundary after rendering and removes every publication side effect when bytes drift',
    async kind => {
      const parent = await mkdtemp(join(tmpdir(), `preplan-boundary-${kind}-toctou-`))
      roots.push(parent)
      const ports = await realBoundaryPackageFixture(parent, kind)
      const integrity = vi.spyOn(ports.boundaries, 'assertFormalBoundaryIntegrity')
      const capture = vi.spyOn(ports.boundaries, 'captureFormalBoundarySnapshot')
      const frozenSource = ports.source.getMockImplementation()!
      ports.source.mockImplementation(async (projectId: string, revision: number) => {
        const frozen = await frozenSource(projectId, revision)
        return {
          ...frozen,
          visualAssets: [...REPORT_INPUT.visualAssets, ...frozen.visualAssets],
          adoptedAssetIds: [...(REPORT_INPUT.adoptedAssetIds ?? []), ...(frozen.adoptedAssetIds ?? [])],
        }
      })
      ports.renderers.html.mockImplementation(async (_context, staging: string) => {
        await mkdir(join(staging, 'html'), { recursive: true })
        await writeFile(join(staging, 'html', 'index.html'), '<html data-report-revision="57"></html>')
        const asset = ports.assets.find(candidate => candidate.status === 'adopted')!
        await writeFile(ports.assetStore.resolveAsset(asset.fileName), `renderer drift: ${kind}`)
      })
      ports.renderers.printHtml.mockImplementation(async (_context, staging: string) => {
        await mkdir(join(staging, 'print'), { recursive: true })
        const output = join(staging, 'print', 'index.html')
        await writeFile(output, '<html data-report-revision="57"></html>')
        return output
      })
      ports.renderers.pptx.mockImplementation(async (_context, output: string) => writeFile(output, 'PK report'))
      ports.renderers.pdf.mockImplementation(async (_html, output: string) => writeFile(output, '%PDF-1.7\n%%EOF'))

      await expect(ports.service.publish('golden-project', 57)).rejects.toThrow('SITE_BOUNDARY_FILE_SHA_MISMATCH')
      expect(capture).toHaveBeenCalledTimes(2)
      expect(integrity).toHaveBeenCalledOnce()
      expect(ports.validate).not.toHaveBeenCalled()
      expect(ports.reportPackages).toEqual([])
      expect(ports.governance.putReportPackage).not.toHaveBeenCalled()
      await expect(access(join(ports.packageRoot, 'package-1', 'artifact-manifest.json'))).rejects.toThrow()
      expect(await readdir(ports.packageRoot)).toEqual([])
    },
  )

  it.each([
    ['SITE_BOUNDARY_FILE_MISSING', async (ports: Awaited<ReturnType<typeof realBoundaryPackageFixture>>) => {
      await unlink(ports.assetStore.resolveAsset(ports.assets[0]!.fileName))
    }],
    ['SITE_BOUNDARY_FILE_SHA_MISMATCH', async (ports: Awaited<ReturnType<typeof realBoundaryPackageFixture>>) => {
      await writeFile(ports.assetStore.resolveAsset(ports.assets[0]!.fileName), 'drifted')
    }],
    ['SITE_BOUNDARY_LINEAGE_MISMATCH', async (ports: Awaited<ReturnType<typeof realBoundaryPackageFixture>>) => {
      ports.assets[0] = { ...ports.assets[0]!, boundaryEvidence: { ...ports.assets[0]!.boundaryEvidence!, storageSha256: 'f'.repeat(64) } }
    }],
  ])('real governance/source preflight preserves %s before creating package root or staging', async (code, mutate) => {
    const parent = await mkdtemp(join(tmpdir(), 'preplan-real-boundary-preflight-'))
    roots.push(parent)
    const ports = await realBoundaryPackageFixture(parent)
    await mutate(ports)

    await expect(ports.service.publish('golden-project', 57)).rejects.toThrow(code)
    expect(ports.source).not.toHaveBeenCalled()
    expect(ports.profile).not.toHaveBeenCalled()
    expect(ports.renderers.html).not.toHaveBeenCalled()
    await expect(access(ports.packageRoot)).rejects.toThrow()
    expect((await readdir(parent)).filter(name => name.startsWith('.staging-'))).toEqual([])
  })

  it('real source freezes a newer synthetic research boundary and rejects it before profile or package root creation', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'preplan-real-boundary-source-'))
    roots.push(parent)
    const ports = await realBoundaryPackageFixture(parent)
    await ports.boundaries.registerGeometry('golden-project', {
      crs: 'EPSG:4490', payload: [[0, 0], [4, 0], [0, 3], [0, 0]], submittedRevision: 57,
      projectName: REPORT_INPUT.projectName,
    }, { actor: { actorId: 'fixture-owner', name: 'fixture', role: 'decision_owner' }, channel: 'synthetic_fixture' })

    await expect(ports.service.publish('golden-project', 57)).rejects.toThrow('SITE_BOUNDARY_CONFIRMATION_REQUIRED')
    expect(ports.source).toHaveBeenCalledOnce()
    expect(ports.profile).not.toHaveBeenCalled()
    await expect(access(ports.packageRoot)).rejects.toThrow()
  })

  it.each([
    'SITE_BOUNDARY_FILE_MISSING',
    'SITE_BOUNDARY_FILE_SHA_MISMATCH',
    'SITE_BOUNDARY_LINEAGE_MISMATCH',
  ])('preserves %s from governance preflight before source, package root, or staging creation', async (code) => {
    const parent = await mkdtemp(join(tmpdir(), 'preplan-package-preflight-parent-'))
    roots.push(parent)
    const packageRoot = join(parent, 'packages')
    const ports = fixture(packageRoot)
    ports.boundaryIntegrity.assertFormalBoundaryIntegrity.mockRejectedValueOnce(new Error(`${code}：场地边界完整性校验失败，请重新提交。`))

    await expect(ports.service.publish('golden-project', 57)).rejects.toThrow(code)
    expect(ports.boundaryIntegrity.assertFormalBoundaryIntegrity).toHaveBeenCalledWith('golden-project', 57)
    expect(ports.source).not.toHaveBeenCalled()
    expect(ports.profile).not.toHaveBeenCalled()
    expect(ports.renderers.html).not.toHaveBeenCalled()
    await expect(access(packageRoot)).rejects.toThrow()
    expect((await readdir(parent)).filter(name => name.startsWith('.staging-'))).toEqual([])
  })

  it.each([
    ['missing frozen boundary', (input: typeof formalInput) => undefined, 'SITE_BOUNDARY_CONFIRMATION_REQUIRED'],
    ['stale confirmation revision', (input: typeof formalInput) => ({ ...input, confirmedRevision: 2 }), 'SITE_BOUNDARY_SOURCE_MISMATCH'],
    ['wrong formal source', (input: typeof formalInput) => ({ ...input, source: 'closed_coordinates' as const, sourceSha256: undefined, geometrySha256: 'e'.repeat(64) }), 'SITE_BOUNDARY_SOURCE_MISMATCH'],
    ['forged digest', (input: typeof formalInput) => ({ ...input, integrityDigest: 'f'.repeat(64) }), 'SITE_BOUNDARY_SOURCE_MISMATCH'],
  ])('rejects %s before profile, planner, staging, or renderer work', async (_label, mutate, expectedCode) => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-package-boundary-bind-'))
    roots.push(root)
    const ports = fixture(root)
    ports.source.mockImplementation(async () => ({ ...REPORT_INPUT, siteBoundary: mutate(formalInput) }) as never)

    await expect(ports.service.publish('golden-project', 57)).rejects.toThrow(expectedCode)
    expect(ports.profile).not.toHaveBeenCalled()
    expect(ports.planner).not.toHaveBeenCalled()
    expect(ports.renderers.html).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', { siteBoundary: 'missing' as const }],
    ['pending', { siteBoundary: 'pending' as const }],
    ['research', { researchInput: true }],
  ])('rejects %s site boundaries before staging or renderer execution', async (_label, options) => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-package-boundary-'))
    roots.push(root)
    const ports = fixture(root, options)

    await expect(ports.service.publish('golden-project', 57)).rejects.toThrow('SITE_BOUNDARY_CONFIRMATION_REQUIRED')
    expect(ports.renderers.html).not.toHaveBeenCalled()
    await expect(access(join(root, 'package-1'))).rejects.toThrow()
  })

  it.each([
    ['a confirmed record without confirmation actor or time', { siteBoundary: 'malformed' as const }],
    ['a future-only confirmed record', { siteBoundary: 'future' as const }],
  ])('rejects %s before profile, staging, or renderer execution', async (_label, options) => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-package-boundary-malformed-'))
    roots.push(root)
    const ports = fixture(root, options)

    await expect(ports.service.publish('golden-project', 57)).rejects.toThrow('SITE_BOUNDARY_CONFIRMATION_REQUIRED')
    expect(ports.profile).not.toHaveBeenCalled()
    expect(ports.renderers.html).not.toHaveBeenCalled()
    await expect(access(join(root, 'package-1'))).rejects.toThrow()
  })

  it('publishes only after client policy, three page plans, renderers, and identity validation pass', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-package-'))
    roots.push(root)
    const ports = fixture(root)

    const manifest = await ports.service.publish('golden-project', 57)

    expect(manifest.artifacts.map(row => row.format).sort()).toEqual(['html', 'pdf', 'pptx'])
    expect(ports.policy).toHaveBeenCalledOnce()
    expect(ports.planner).toHaveBeenCalledWith(expect.anything(), 'html')
    expect(ports.planner).toHaveBeenCalledWith(expect.anything(), 'pptx')
    expect(ports.planner).toHaveBeenCalledWith(expect.anything(), 'pdf')
    expect(ports.profile).toHaveBeenCalledWith('golden-project', expect.objectContaining({ siteBoundary: formalInput }))
    expect(ports.policy.mock.invocationCallOrder[0]).toBeLessThan(ports.renderers.html.mock.invocationCallOrder[0]!)
    expect(ports.renderers.printHtml).toHaveBeenCalledBefore(ports.renderers.pdf)
    expect(ports.validate).toHaveBeenCalledAfter(ports.renderers.pdf)
    expect(ports.validate.mock.calls[0]?.[2]).toEqual({
      siteBoundary: { boundaryId: formalBoundary.boundaryId, assetId: formalBoundary.sourceAsset.assetId },
    })
    const publishedManifest = JSON.parse(await readFile(join(root, 'package-1', 'artifact-manifest.json'), 'utf8'))
    expect(publishedManifest).toMatchObject({ sourceRevision: 57, packageId: 'package-1' })
    expect(publishedManifest).not.toHaveProperty('siteBoundaryId')
    expect(publishedManifest).not.toHaveProperty('siteBoundaryAssetId')
  })

  it('validates serialized professional plans against the explicit bundle report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-package-serialized-plan-'))
    roots.push(root)
    const ports = fixture(root, { serializedProfessionalPlans: true })

    await expect(ports.service.publish('golden-project', 57)).resolves.toMatchObject({
      packageId: 'package-1',
    })
    expect(ports.renderers.html).toHaveBeenCalledOnce()
  })

  it('keeps existing packages and publishes nothing when policy validation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-package-'))
    roots.push(root)
    const existing = join(root, 'package-existing')
    await mkdir(existing, { recursive: true })
    await writeFile(join(existing, 'artifact-manifest.json'), '{}')
    const ports = fixture(root)
    ports.policy.mockImplementation(() => { throw new Error('CLIENT_FORBIDDEN_TERM') })

    await expect(ports.service.publish('golden-project', 57)).rejects.toThrow(/CLIENT_FORBIDDEN_TERM/u)
    await expect(access(join(existing, 'artifact-manifest.json'))).resolves.toBeUndefined()
    await expect(access(join(root, 'package-1'))).rejects.toThrow()
    expect(ports.renderers.html).not.toHaveBeenCalled()
  })

  it('rejects a visually incomplete page plan before any renderer runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-package-'))
    roots.push(root)
    const ports = fixture(root)
    ports.planner.mockImplementation((report, medium) => ({
      ...planClientPages(report, medium),
      visualContractVersion: 'architectural-v1' as const,
    }))

    await expect(ports.service.publish('golden-project', 57))
      .rejects.toThrow(/VISUAL_PAGE_COVERAGE_LOW/u)
    expect(ports.renderers.html).not.toHaveBeenCalled()
  })

  it('waits for concurrent renderers to settle before cleaning a failed staging package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-package-'))
    roots.push(root)
    let pptxFinished = false
    const ports = fixture(root, { pdfError: new Error('print failed') })
    ports.renderers.pptx.mockImplementation(async (_context, output) => {
      await new Promise(resolve => setTimeout(resolve, 50))
      await writeFile(output, Buffer.from('PK ppt/slides/slide1.xml'))
      pptxFinished = true
    })

    await expect(ports.service.publish('golden-project', 57)).rejects.toThrow(/print failed/u)
    expect(pptxFinished).toBe(true)
  })

  it('does not publish a partial directory when one renderer fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-package-'))
    roots.push(root)
    const ports = fixture(root, { pdfError: new Error('print failed') })

    await expect(ports.service.publish('golden-project', 57)).rejects.toThrow(/print failed/u)
    await expect(access(join(root, 'package-1'))).rejects.toThrow()
  })

  it('rejects publication while a required visual task is not adopted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-package-'))
    roots.push(root)
    await expect(fixture(root, { requiredVisualPending: true }).service.publish('golden-project', 57))
      .rejects.toThrow(/required visual asset/u)
  })
})
