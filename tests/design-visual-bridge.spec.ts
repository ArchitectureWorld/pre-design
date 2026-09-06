import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectRepository } from '../src/state/repository.ts'
import { GovernanceRepository } from '../src/governance/repository.ts'
import { ContractRegistry } from '../src/contracts/registry.ts'
import { PresentationBindingRepository } from '../src/presentation/binding-repository.ts'
import { PresentationStandardProjectService } from '../src/presentation/standard-project-service.ts'
import { PageVisualFillService } from '../src/presentation/page-visual-fill.ts'
import { VisualAgentService } from '../src/visual/agent.ts'
import { VisualAssetStore } from '../src/visual/asset-store.ts'
import { SessionImageCollector } from '../src/visual/session-image-collector.ts'
import { createFrozenProjectInput } from '../src/report/source.ts'
import { readPageVisualState } from '../src/presentation/page-visual-state.ts'
import { preparePresentationMaterials } from '../src/presentation/material-registry.ts'
import { adoptedPresentationAssets } from '../src/presentation/runtime-integration.ts'
import { registerPreplanningTools } from '../src/tools/register.ts'
import type { ToolDefinition, JsonValue } from '@deepseek-ai/dsh-tools'
import { verifiedRasterImageDimensions } from '../src/governance/site-boundary-asset-store.ts'
import { buildPresentationStandardProject } from '../src/presentation/standard-project-adapter.ts'
import { publishPresentationStandardProjectIntoWorkspace } from '../src/presentation/workspace-project-writer.ts'
import { snapshotFiles } from './helpers/shared-workspace-fixture.ts'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const now = () => '2026-09-06T00:00:00.000Z'
const parent = { id: 'session-1', session: { id: 'session-1' } } as never
const input = { runId: 'run-1', studioProjectId: 'project_00000000-0000-7000-8000-000000000001', pageId: 'merged-page', sourceStateHash: 'a'.repeat(64), requestId: 'request-1', prompt: '公共空间概念示意' }

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pre-design-visual-bridge-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(Storage); await ctx.plugin(StorageJson, { root: join(root, 'db') }); await ctx.plugin(StorageDomain, { backend: 'json' })
  const repository = await ProjectRepository.open(ctx.storage.domain)
  const governance = await GovernanceRepository.open(ctx.storage.domain)
  const bindings = await PresentationBindingRepository.open(ctx.storage.domain)
  cleanups.push(async () => { await repository.close(); await governance.close(); await bindings.close() })
  const registry = await ContractRegistry.open(new URL('../contracts/v0.6/', import.meta.url))
  const owner = { actorId: 'owner', name: '负责人', role: 'decision_owner' }
  await repository.createProject({ projectId: 'pre-test', name: '校园更新', sessionId: 'session-1', createdAt: now(), actor: owner })
  await repository.saveProposal({ proposalId: 'p1', projectId: 'pre-test', expectedRevision: 0, idempotencyKey: 'p1', createdAt: now(), envelope: { target_object_id: 'PS01' } })
  await repository.confirmProposal({ proposalId: 'p1', actor: owner, confirmedAt: now(), eventId: 'e1', stateObject: { objectId: 'PS01', value: { object_id: 'PS01', project_id: 'pre-test', chapter_id: '01', work_item_id: '01-01', revision: 1, data: { canonical_name: '校园更新', start_reason: '改善公共空间' } } } })
  const workspace = join(root, 'workspace'); await mkdir(workspace)
  await bindings.put({ preDesignProjectId: 'pre-test', presentationProjectId: input.studioProjectId, workspaceRoot: workspace, directoryRoot: workspace,
    projectSlug: 'test', standardVersion: '0.1.0', state: 'ready', stableIds: {}, lastExportedObjectHashes: {}, lastExportedFileHashes: {}, createdAt: now(), updatedAt: now() })
  await writeFile(join(workspace, 'studio-owned.json'), '{"manual":"keep"}')
  const store = new VisualAssetStore(join(root, 'visuals'))
  const jpeg = await readFile(new URL('./fixtures/golden-project/assets/concept-01.jpg', import.meta.url))
  let paidCalls = 0
  let paidAction = async () => {}
  const sessions = new Map<string, { seq: number; events: unknown[] }>()
  const visual = new VisualAgentService({ governance, store, now,
    llm: { listModels: async () => [] },
    subagents: { startContinuable: async (spec: { childId: string }) => {
      paidCalls++; await paidAction()
      sessions.set(spec.childId, { seq: 2, events: [{ seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `data:image/jpeg;base64,${jpeg.toString('base64')}` }] } } }, { seq: 2, type: 'turn/end', data: {} }] })
      return { childId: spec.childId, messageId: 'image-message' }
    }, interrupt: () => {} } as never,
    collector: new SessionImageCollector({ sessions: { get: id => sessions.get(id) as never }, attachments: { readImage: async () => { throw new Error('unexpected attachment') } }, waitForEvent: async () => { throw new Error('missing paid response') } }),
  })
  const fill = new PageVisualFillService({ visual, governance, resolveAsset: name => store.resolveAsset(name) })
  const source = (id: string, revision: number) => createFrozenProjectInput(id, revision, { repository, governance, registry, visualStore: store })
  const dependencies = { repository, registry, standardProjects: new PresentationStandardProjectService({ bindings, workspaceRoot: workspace }), source, pageVisualFill: fill, now }
  const module = await import('../src/presentation/design-visual-bridge.ts')
  const bridge = module.createDesignVisualBridge(dependencies)
  const resolved = { preDesignProjectId: 'pre-test', studioProjectId: input.studioProjectId, pageId: input.pageId, workspaceRoot: workspace, studioProjectRevision: 1, sourceStateHash: input.sourceStateHash, sourceObjectIds: ['PS01'], title: '合并后的新页', keyMessage: '改善公共空间', grant: { runId: input.runId, sessionId: 'session-1', allowVisualGeneration: true, allowApply: true, expiresAt: '2026-09-07T00:00:00.000Z' } }
  const resolver = { protocol: 'pre-design.page-visual.v1' as const, resolve: async () => structuredClone(resolved) }
  const dispose = bridge.bindStudioResolver(resolver)
  return { root, workspace, repository, governance, store, source, bridge, dependencies, module, resolved, resolver, dispose, jpeg, paidCalls: () => paidCalls, paidAction: (fn: typeof paidAction) => { paidAction = fn } }
}

it('uses real current-page sources and persists one paid candidate across duplicate calls, restart and unrelated revisions', async () => {
  const f = await fixture()
  const [one, two] = await Promise.all([f.bridge.generate(parent, input), f.bridge.generate(parent, input)])
  expect(one.assetId).toBe(two.assetId)
  expect(one.target).toMatchObject({ kind: 'studio_current_page', pageId: 'merged-page', sourceObjectIds: ['PS01'] })
  expect(one.image.bytes).toEqual(f.jpeg)
  expect(f.governance.readProject('pre-test').visualTasks[0]).toMatchObject({ workItemId: '01-01', status: 'candidate_ready', attempts: 1 })
  f.resolved.studioProjectRevision++
  const restored = f.module.createDesignVisualBridge(f.dependencies); restored.bindStudioResolver(f.resolver)
  expect(await restored.generate(parent, input)).toMatchObject({ assetId: one.assetId, reused: true })
  expect(f.paidCalls()).toBe(1)
  const state = await readPageVisualState(f.workspace, 'pre-test')
  expect(state.requests[0]).not.toHaveProperty('findingId')
  await expect(restored.generate(parent, { ...input, prompt: '另一提示词' })).rejects.toThrow('REQUEST_CONFLICT')
  expect(f.paidCalls()).toBe(1)
})

it.each(['project', 'page', 'hash', 'source', 'session', 'expired', 'generation-denied', 'workspace'] as const)('rejects %s mismatch before generation', async mode => {
  const f = await fixture()
  if (mode === 'project') f.resolved.preDesignProjectId = 'other'
  if (mode === 'page') f.resolved.pageId = 'other'
  if (mode === 'hash') f.resolved.sourceStateHash = 'b'.repeat(64)
  if (mode === 'source') f.resolved.sourceObjectIds = ['NONEXISTENT']
  if (mode === 'session') f.resolved.grant.sessionId = 'other'
  if (mode === 'expired') f.resolved.grant.expiresAt = now()
  if (mode === 'generation-denied') f.resolved.grant.allowVisualGeneration = false
  if (mode === 'workspace') f.resolved.workspaceRoot = f.root
  await expect(f.bridge.generate(parent, input)).rejects.toThrow(/DESIGN_VISUAL_/)
  expect(f.paidCalls()).toBe(0)
  expect(f.governance.readProject('pre-test').visualAssets).toHaveLength(0)
})

it('fails closed when resolver unbound, unsupported or already owned; disposer cannot unbind a successor', async () => {
  const f = await fixture()
  expect(() => f.bridge.bindStudioResolver(f.resolver)).toThrow('RESOLVER_BOUND')
  f.dispose()
  await expect(f.bridge.generate(parent, input)).rejects.toThrow('RESOLVER_UNAVAILABLE')
  expect(() => f.bridge.bindStudioResolver({ ...f.resolver, protocol: 'other' } as never)).toThrow('RESOLVER_UNAVAILABLE')
  f.bridge.bindStudioResolver(f.resolver); f.dispose()
  expect(await f.bridge.generate(parent, input)).toMatchObject({ status: 'candidate' })
  expect(Object.isFrozen(f.bridge)).toBe(true)
})

it('adopts only with refreshed apply grant and returns durable adopted_unlinked without touching Studio files', async () => {
  const f = await fixture()
  const candidate = await f.bridge.generate(parent, input)
  const adoptInput = { ...input, assetId: candidate.assetId }
  f.resolved.grant.allowApply = false
  await expect(f.bridge.adopt(parent, adoptInput)).rejects.toThrow('GRANT')
  expect(f.governance.readProject('pre-test').visualAssets[0]?.status).toBe('candidate')
  f.resolved.grant.allowApply = true
  const adopted = await f.bridge.adopt(parent, adoptInput)
  expect(adopted).toMatchObject({ status: 'adopted_unlinked', requestId: 'request-1', assetId: candidate.assetId, provenance: { sourceObjectIds: ['PS01'], declarations: ['AI 概念示意（非现场实拍）'] } })
  expect(adopted.image.bytes).toEqual(f.jpeg)
  expect(await f.bridge.adopt(parent, adoptInput)).toMatchObject({ assetId: candidate.assetId, reused: true, status: 'adopted_unlinked' })
  expect(f.paidCalls()).toBe(1)
  expect(await readFile(join(f.workspace, 'studio-owned.json'), 'utf8')).toBe('{"manual":"keep"}')
  const frozen = await f.source('pre-test', 1)
  const materials = await preparePresentationMaterials({ frozenProject: frozen, workspaceRoot: f.workspace, assets: adoptedPresentationAssets(frozen) })
  expect(materials.assets.some(asset => asset.pageBindings?.some(binding => binding.findingId === undefined))).toBe(false)
  expect(materials.assets.find(asset => asset.sourceKey === candidate.assetId)).toBeUndefined()
})

it('retains a late cancelled candidate for recovery but never adopts the cancelled request', async () => {
  const f = await fixture(); const controller = new AbortController()
  f.paidAction(async () => { controller.abort(new Error('cancelled')) })
  await expect(f.bridge.generate(parent, input, controller.signal)).rejects.toThrow('cancelled')
  await expect(f.bridge.adopt(parent, { ...input, assetId: 'unknown' }, controller.signal)).rejects.toThrow('cancelled')
  f.paidAction(async () => {})
  const candidate = await f.bridge.generate(parent, input)
  expect(candidate.status).toBe('candidate')
  expect(f.paidCalls()).toBe(1)
})

it('keeps failed generation off the page and rejects stale page changes after paid output', async () => {
  const f = await fixture()
  f.paidAction(async () => { throw new Error('provider unavailable') })
  await expect(f.bridge.generate(parent, input)).rejects.toThrow()
  expect(f.governance.readProject('pre-test').visualAssets).toHaveLength(0)
  expect(await readFile(join(f.workspace, 'studio-owned.json'), 'utf8')).toBe('{"manual":"keep"}')
  f.paidAction(async () => { f.resolved.sourceStateHash = 'b'.repeat(64) })
  await expect(f.bridge.generate(parent, { ...input, requestId: 'request-2' })).rejects.toThrow('CONTEXT')
  expect(f.governance.readProject('pre-test').visualAssets[0]?.status).toBe('candidate')
})

it('only grants exact persisted candidate adoption; fake candidates never reach the host grant resolver', async () => {
  const f = await fixture(); const candidate = await f.bridge.generate(parent, input)
  f.dispose()
  let acceptedAssetId = 'another-proposal-asset'
  const checked: string[] = []
  f.bridge.bindStudioResolver({ protocol: 'pre-design.page-visual.v1', resolve: async request => {
    const context = structuredClone(f.resolved)
    context.grant.allowApply = false
    if (request.operation === 'adopt') {
      checked.push(request.candidate!.assetId)
      context.grant.allowApply = request.candidate?.requestId === input.requestId && request.candidate.assetId === acceptedAssetId
    }
    return context
  } })
  await expect(f.bridge.adopt(parent, { ...input, assetId: 'forged' })).rejects.toThrow('CANDIDATE_MISMATCH')
  expect(checked).toEqual([])
  await expect(f.bridge.adopt(parent, { ...input, assetId: candidate.assetId })).rejects.toThrow('GRANT')
  acceptedAssetId = candidate.assetId
  expect(await f.bridge.adopt(parent, { ...input, assetId: candidate.assetId })).toMatchObject({ status: 'adopted_unlinked' })
})

it('returns native image blocks from saved attachments, honors request-header route and fails explicit no-image capability', async () => {
  const f = await fixture(); const definitions: ToolDefinition[] = []
  let modalities = ['text']
  const routes: string[] = []
  const attachments = {
    saveImage: async (image: { data: Uint8Array; mediaType: 'image/jpeg' }) => {
      const dimensions = verifiedRasterImageDimensions(image.mediaType, Buffer.from(image.data))
      await writeFile(join(f.root, 'native-attachment.jpg'), image.data)
      return { attachmentId: 'attachment-native', mediaType: image.mediaType, bytes: image.data.byteLength, ...dimensions }
    },
  }
  registerPreplanningTools({ tools: { register: (tool: ToolDefinition) => { definitions.push(tool) } }, attachments,
    llm: { resolveModelInfo: async (provider: string, model: string) => { routes.push(`${provider}/${model}`); return { provider, id: model, name: model, inputModalities: modalities } } } } as never,
    { repository: f.repository, registry: f.dependencies.registry, governance: f.governance, gateway: {} as never, runtime: {} as never, designVisualBridge: f.bridge })
  const tool = definitions.find(tool => tool.name === 'preplanning_generate_page_visual')
  expect(tool, 'main Agent visual request tool must be registered').toBeDefined()
  const agent = { id: 'session-1', options: { provider: 'fallback', model: 'fallback' }, session: { id: 'session-1', requestHeader: () => ({ config: { provider: 'current', model: 'vision-current' } }) } }
  const exec = { agent, signal: new AbortController().signal } as never
  await expect(tool!.execute(input, exec)).rejects.toThrow('VISUAL_TEST_FAILED')
  expect(f.paidCalls()).toBe(0)
  modalities = ['text', 'image']
  const value = await tool!.execute(input, exec) as JsonValue
  const blocks = tool!.output.render(input, value)
  expect(blocks).toEqual([expect.objectContaining({ type: 'text' }), { type: 'image', attachment: { attachmentId: 'attachment-native', mediaType: 'image/jpeg', bytes: f.jpeg.length, ...verifiedRasterImageDimensions('image/jpeg', f.jpeg) } }])
  expect(await readFile(join(f.root, 'native-attachment.jpg'))).toEqual(f.jpeg)
  expect(JSON.stringify(value)).not.toContain('base64')
  expect(routes).toEqual(['current/vision-current', 'current/vision-current'])
  expect(f.governance.readProject('pre-test').visualAssets[0]?.status).toBe('candidate')
})

it('rejects forged session identity and model-supplied authority without a paid call', async () => {
  const f = await fixture()
  await expect(f.bridge.generate({ id: 'session-1', session: { id: 'other' } } as never, input)).rejects.toThrow('SESSION')
  await expect(f.bridge.generate(parent, { ...input, approved: true, workspaceRoot: f.workspace } as never)).rejects.toThrow('INPUT')
  expect(f.paidCalls()).toBe(0)
})

it('rejects tampered persisted image bytes before adoption and preserves candidate status', async () => {
  const f = await fixture(); const candidate = await f.bridge.generate(parent, input)
  const asset = f.governance.readProject('pre-test').visualAssets[0]!
  await writeFile(f.store.resolveAsset(asset.fileName), Buffer.from('changed bytes'))
  await expect(f.bridge.adopt(parent, { ...input, assetId: candidate.assetId })).rejects.toThrow('ASSET_UNAVAILABLE')
  expect(f.governance.readProject('pre-test').visualAssets[0]?.status).toBe('candidate')
  expect(f.paidCalls()).toBe(1)
})

it('fails closed on lost governance after a durable request, without charging or downgrading the sidecar', async () => {
  const f = await fixture(); const candidate = await f.bridge.generate(parent, input)
  const statePath = join(f.workspace, '.pre-design', 'page-visual-fill.json')
  const before = await readFile(statePath, 'utf8')
  const asset = f.governance.readProject('pre-test').visualAssets[0]!
  await f.governance.putVisualAsset({ ...asset, status: 'rejected' })
  await expect(f.bridge.generate(parent, input)).rejects.toThrow('RECOVERY_REQUIRED')
  expect(await readFile(statePath, 'utf8')).toBe(before)
  expect(f.paidCalls()).toBe(1)
  expect(candidate.assetId).toBe(asset.assetId)
})

it('keeps Studio asset references and layouts unchanged when later canonical sync requires external-change review', async () => {
  const f = await fixture()
  const frozen = await f.source('pre-test', 1)
  const build = await buildPresentationStandardProject({ frozenProject: frozen, presentationProjectId: input.studioProjectId as never })
  const initial = await publishPresentationStandardProjectIntoWorkspace({ directoryRoot: f.workspace, build, operationId: 'studio-initial' })
  const candidate = await f.bridge.generate(parent, input)
  const asset = f.governance.readProject('pre-test').visualAssets[0]!
  const broadAsset = { sourceKey: asset.assetId, sourcePath: f.store.resolveAsset(asset.fileName), displayName: 'AI 概念示意', originalFileName: 'studio.jpg', mimeType: asset.mimeType,
    semanticRole: 'concept_visual', widthPx: asset.width, heightPx: asset.height, createdAt: asset.createdAt, adoptedAt: asset.createdAt,
    objectIds: ['PS01'], evidenceIds: [], origin: { type: 'generated_by_plugin' as const, sourceMaterialKeys: [], parentAssetKeys: [], method: 'Studio adopted candidate', sourceTool: { name: 'report-studio', version: '1' } } }
  expect((await preparePresentationMaterials({ frozenProject: frozen, workspaceRoot: f.workspace, assets: [broadAsset] })).assets).toHaveLength(0)
  await f.bridge.adopt(parent, { ...input, assetId: candidate.assetId })
  const studioBuild = await buildPresentationStandardProject({ frozenProject: frozen, presentationProjectId: build.projectId, stableIds: build.stableIds, assets: [broadAsset] })
  const assetFile = studioBuild.managedFiles.find(file => file.domain === 'assets')!
  const target = join(f.workspace, assetFile.relativePath)
  await mkdir(join(target, '..'), { recursive: true }); await writeFile(target, f.jpeg)
  await writeFile(join(f.workspace, 'assets/manifest.json'), JSON.stringify(studioBuild.documents['assets/manifest.json']))
  const pages = (studioBuild.documents['pages/manifest.json'] as { pages: { draftPath: string }[] }).pages
  for (const page of pages) await writeFile(join(f.workspace, page.draftPath), JSON.stringify(studioBuild.documents[page.draftPath]))
  await mkdir(join(f.workspace, 'layouts'), { recursive: true }); await writeFile(join(f.workspace, 'layouts/manual.json'), '{"keep":"manual"}')
  const before = await snapshotFiles(f.workspace)
  const current = await f.source('pre-test', 1)
  const prepared = await preparePresentationMaterials({ frozenProject: current, workspaceRoot: f.workspace, assets: adoptedPresentationAssets(current), previous: { stableIds: build.stableIds, lastExportedFileHashes: initial.fileHashes } })
  expect(prepared.assets).toHaveLength(0)
  const next = await buildPresentationStandardProject({ frozenProject: current, presentationProjectId: build.projectId, stableIds: build.stableIds, ...prepared })
  await expect(publishPresentationStandardProjectIntoWorkspace({ directoryRoot: f.workspace, build: next, operationId: 'studio-later-sync', expectedExistingFileHashes: initial.fileHashes })).rejects.toMatchObject({ code: 'PRESENTATION_EXTERNAL_CHANGE_REVIEW_REQUIRED' })
  expect(await snapshotFiles(f.workspace)).toEqual(before)
})

it('rejects a tampered sidecar that rebinds a governed asset to a different page', async () => {
  const f = await fixture(); const candidate = await f.bridge.generate(parent, input)
  const statePath = join(f.workspace, '.pre-design', 'page-visual-fill.json')
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  const request = state.requests[0]
  request.target.pageId = 'forged-page'
  request.briefHash = sha256CanonicalJson({ target: request.target, requestId: request.requestId, prompt: request.prompt, style: request.style })
  await writeFile(statePath, JSON.stringify(state))
  f.resolved.pageId = 'forged-page'
  await expect(f.bridge.adopt(parent, { ...input, pageId: 'forged-page', assetId: candidate.assetId }).then(result => result.status)).rejects.toThrow('STATE_INVALID')
  expect(f.governance.readProject('pre-test').visualAssets[0]?.status).toBe('candidate')
})
