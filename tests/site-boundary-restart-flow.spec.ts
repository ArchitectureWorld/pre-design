import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { ImageBlock } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SiteBoundaryService } from '../src/governance/site-boundary-service.ts'
import * as SyntheticHost from './fixtures/synthetic-boundary-host.ts'

const roots: string[] = []
const contexts: Context[] = []
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const imageBlock: ImageBlock = {
  type: 'image',
  attachment: {
    attachmentId: 'restart-flow-redline' as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes: png.length,
    width: 1,
    height: 1,
    name: 'restart-flow-redline.png',
    originalDimensions: { width: 1, height: 1 },
  },
}

interface SyntheticHostModule {
  readonly apply: (ctx: Context, config?: { readonly fixtureRoot?: string }) => Promise<void>
  readonly name: string
}

interface RunningHost {
  readonly ctx: Context
  readonly commands: CommandDefinition[]
}

async function boot(storageRoot: string, fixtureRoot: string, host: SyntheticHostModule): Promise<RunningHost> {
  const ctx = new Context()
  contexts.push(ctx)
  const commands: CommandDefinition[] = []
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: storageRoot })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  ctx.provide('commands', {
    register: (definition: CommandDefinition) => { commands.push(definition); return () => undefined },
  } as never)
  ctx.provide('tools', { register: (_definition: ToolDefinition) => () => undefined } as never)
  ctx.provide('attachments', {
    readImage: async (ref: ImageAttachmentRef) => {
      if (String(ref.attachmentId) !== String(imageBlock.attachment.attachmentId)) throw new Error('unexpected attachment')
      return { ref: imageBlock.attachment, data: png }
    },
  } as never)
  ctx.provide('llm', { listModels: vi.fn(async () => []) } as never)
  ctx.provide('sessions', { get: vi.fn() } as never)
  ctx.provide('subagents', { listChildren: vi.fn(async () => []), startContinuable: vi.fn(), followup: vi.fn() } as never)
  ctx.provide('systemPrompt', { section: () => () => undefined } as never)
  ctx.provide('webServer', { register: () => () => undefined } as never)
  await ctx.plugin(host as never, { fixtureRoot } as never)
  await vi.waitFor(() => expect(ctx.get('preplanning')).toBeDefined())
  return { ctx, commands }
}

function command(host: RunningHost, name: string): CommandDefinition {
  const definition = host.commands.find(candidate => candidate.name === name)
  if (definition === undefined) throw new Error(`missing command: ${name}`)
  return definition
}

async function invoke(host: RunningHost, name: string, rawInput = '', extra: Record<string, unknown> = {}) {
  return command(host, name).handler({
    rawInput,
    agent: { id: 'restart-session', session: { header: { version: 0, id: 'restart-session', createdAt: 1, delegationDepth: 0 } } },
    ...extra,
  } as never)
}

async function stagedDirectories(root: string): Promise<string[]> {
  if (!existsSync(root)) return []
  const entries = await readdir(root, { recursive: true })
  return entries.filter(entry => entry.split(/[\\/]/u).some(segment => segment.startsWith('.staging-')))
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('synthetic site-boundary restart flow', () => {
  it('persists PNG, coordinates and GeoJSON through real JSON Domain restart while confirm and export fail before staging', async () => {
    const host = SyntheticHost

    const root = await mkdtemp(join(tmpdir(), 'preplan-synthetic-restart-'))
    roots.push(root)
    const storageRoot = join(root, 'storage')
    const fixtureRoot = join(root, 'fixture-host')
    const packageRoot = join(fixtureRoot, 'report-packages')
    const first = await boot(storageRoot, fixtureRoot, host)
    const created = await invoke(first, 'preplan-new', 'Storage 重启链路工程夹具')
    expect(created).toMatchObject({ kind: 'success' })
    const projectId = created.kind === 'success' ? (created.text ?? '').match(/（([^）]+)）/u)?.[1] : undefined
    expect(projectId).toBeDefined()
    if (projectId === undefined) return

    await expect(invoke(first, 'preplan-boundary-asset', 'approved_redline', { attachments: [imageBlock] }))
      .resolves.toMatchObject({ kind: 'success' })
    await expect(invoke(first, 'preplan-boundary-coordinates', 'EPSG:4490 [[114.1,30.5],[114.2,30.5],[114.2,30.6],[114.1,30.6],[114.1,30.5]]'))
      .resolves.toMatchObject({ kind: 'success' })
    await expect(invoke(first, 'preplan-boundary-coordinates', 'EPSG:4490 {"type":"Polygon","coordinates":[[[114.3,30.5],[114.4,30.5],[114.4,30.6],[114.3,30.6],[114.3,30.5]]]}'))
      .resolves.toMatchObject({ kind: 'success' })

    const status = await invoke(first, 'preplan-status')
    expect(status).toMatchObject({ kind: 'success', text: expect.stringContaining('模拟研究范围（不可正式确认）') })
    const governanceBefore = first.ctx.preplanning.governance.readProject(projectId)
    const contextBefore = first.ctx.preplanning.repository.readContext('restart-session')
    expect(governanceBefore.siteBoundaries).toHaveLength(3)
    expect(governanceBefore.siteBoundaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'approved_redline', origin: 'synthetic', submissionChannel: 'synthetic_fixture', status: 'pending_confirmation' }),
      expect.objectContaining({ source: 'closed_coordinates', origin: 'synthetic', submissionChannel: 'synthetic_fixture', status: 'pending_confirmation' }),
      expect.objectContaining({ source: 'geojson', origin: 'synthetic', submissionChannel: 'synthetic_fixture', status: 'pending_confirmation' }),
    ]))
    const deterministic = governanceBefore.visualAssets.filter(asset => asset.kind === 'deterministic')
    expect(deterministic).toHaveLength(2)
    for (const asset of deterministic) {
      const svg = await readFile(join(fixtureRoot, 'visual-assets', ...asset.fileName.split('/')), 'utf8')
      expect(svg).toMatch(/^<svg[^>]+width="1600"[^>]+height="1000"/u)
      expect(asset.boundaryGeometrySha256).toMatch(/^[a-f0-9]{64}$/u)
    }

    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)
    const reopened = await boot(storageRoot, fixtureRoot, host)
    expect(reopened.ctx.preplanning.governance.readProject(projectId)).toEqual(governanceBefore)
    expect(reopened.ctx.preplanning.repository.readContext('restart-session')).toEqual(contextBefore)
    await expect(invoke(reopened, 'preplan-status')).resolves.toMatchObject({
      kind: 'success', text: expect.stringContaining('模拟研究范围（不可正式确认）'),
    })

    const reopenedGovernance = reopened.ctx.preplanning.governance
    const imageFingerprint = governanceBefore.siteBoundaries.find(record => record.sourceAsset !== undefined)!.sourceAsset!.sha256
    const geometryFingerprint = governanceBefore.siteBoundaries.find(record => record.geometry !== undefined)!.geometry!.sha256
    expect(reopenedGovernance.findSyntheticBoundaryByFingerprint({ storageSha256: imageFingerprint })).toMatchObject({
      fingerprint: `image:${imageFingerprint}`,
    })
    expect(reopenedGovernance.findSyntheticBoundaryByFingerprint({ geometrySha256: geometryFingerprint })).toMatchObject({
      fingerprint: `geometry:${geometryFingerprint}`,
    })
    await expect(invoke(reopened, 'preplan-boundary-asset', 'approved_redline', { attachments: [imageBlock] }))
      .resolves.toMatchObject({ kind: 'success' })
    await expect(invoke(reopened, 'preplan-boundary-coordinates', 'EPSG:4490 [[114.1,30.5],[114.2,30.5],[114.2,30.6],[114.1,30.6],[114.1,30.5]]'))
      .resolves.toMatchObject({ kind: 'success' })
    expect(reopenedGovernance.readProject(projectId).siteBoundaries).toEqual(governanceBefore.siteBoundaries)

    const humanBoundaries = new SiteBoundaryService(
      reopenedGovernance,
      reopened.ctx.preplanning.siteBoundaryAssets,
      () => '2026-08-31T00:00:00.000Z',
      () => 'unused-random-id',
    )
    const humanContext = {
      actor: { actorId: 'owner-1', name: '项目负责人', role: 'decision_owner' as const },
      channel: 'dsh_human_command' as const,
    }
    await expect(humanBoundaries.registerImageAttachment('project-B', {
      source: 'approved_site_plan', block: imageBlock, submittedRevision: 0, signal: AbortSignal.timeout(1_000),
    }, humanContext)).rejects.toThrow('SITE_BOUNDARY_SYNTHETIC_REPLAY_FORBIDDEN')
    await expect(humanBoundaries.registerGeometry('project-B', {
      crs: 'EPSG:4490', payload: { type: 'Polygon', coordinates: [[[114.1, 30.5], [114.2, 30.5], [114.2, 30.6], [114.1, 30.6], [114.1, 30.5]]] },
      submittedRevision: 0, projectName: '项目 B',
    }, humanContext)).rejects.toThrow('SITE_BOUNDARY_SYNTHETIC_REPLAY_FORBIDDEN')
    expect(reopenedGovernance.readProject('project-B')).toMatchObject({ visualAssets: [], siteBoundaries: [] })

    const boundaryId = governanceBefore.siteBoundaries[0]!.boundaryId
    const boundary = governanceBefore.siteBoundaries[0]!
    const boundarySha256 = boundary.sourceAsset?.sha256 ?? boundary.geometry!.sha256
    await expect(invoke(reopened, 'preplan-boundary-confirm', `${boundaryId} ${boundary.submittedRevision} ${boundarySha256} 该图是本项目采用的总平图或红线图，且图中明确表达项目边界`)).resolves.toMatchObject({
      kind: 'error', text: expect.stringContaining('SITE_BOUNDARY_SYNTHETIC_NOT_CONFIRMABLE'),
    })
    expect(existsSync(packageRoot)).toBe(false)
    await expect(invoke(reopened, 'preplan-export')).resolves.toMatchObject({
      kind: 'error', text: expect.stringContaining('SITE_BOUNDARY_CONFIRMATION_REQUIRED'),
    })
    expect(existsSync(packageRoot)).toBe(false)
    expect(await stagedDirectories(fixtureRoot)).toEqual([])
  })
})
