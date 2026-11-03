import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createD1ProposalExample, PREPLANNING_SYSTEM_PROMPT } from '../src/prompts/preplanning-system.ts'
import * as HostPlugin from '../src/index.ts'
import { SiteBoundaryService } from '../src/governance/site-boundary-service.ts'
import { PresentationAutoSyncService } from '../src/presentation/auto-sync.ts'
import { PresentationStandardProjectService } from '../src/presentation/standard-project-service.ts'
import { ParallelWorkflowExecutor } from '../src/runtime/parallel-workflow-executor.ts'
import { ReportPackageService } from '../src/report/package-service.ts'
import { VisualAgentService } from '../src/visual/agent.ts'
import { peerRequest } from './helpers/peer-research-fixture.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Host apply composition', () => {
  it('保留原执行器，在真实Host完成研究来源、生成、复算与标准项目发布', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-preplanning-host-'))
    roots.push(root)
    const presentationRoot = join(root, 'presentation-projects')
    vi.stubEnv('PRE_DESIGN_PRESENTATION_PROJECT_ROOT', presentationRoot)
    const ctx = new Context()
    contexts.push(ctx)
    const commands: CommandDefinition[] = []
    const tools: ToolDefinition[] = []
    const promptSections: unknown[] = []
    const routes: unknown[] = []
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    ctx.provide('commands', {
      register: (definition: CommandDefinition) => { commands.push(definition); return () => undefined },
    } as never)
    ctx.provide('tools', {
      guard: () => () => undefined,
      register: (definition: ToolDefinition) => { tools.push(definition); return () => undefined },
    } as never)
    ctx.provide('attachments', { readImage: vi.fn() } as never)
    ctx.provide('llm', {
      listProviders: () => [{ id: 'test', name: 'Test' }],
      listModels: vi.fn(async () => [{ provider: 'test', id: 'model', name: 'Model' }]),
    } as never)
    ctx.provide('sessions', { get: vi.fn() } as never)
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    ctx.provide('subagents', {
      listChildren: vi.fn(async () => []),
      startContinuable: vi.fn(),
      followup: vi.fn(),
    } as never)
    ctx.provide('systemPrompt', {
      section: (definition: unknown) => { promptSections.push(definition); return () => undefined },
    } as never)
    ctx.provide('webServer', {
      register: (definition: unknown) => { routes.push(definition); return () => undefined },
    } as never)

    await ctx.plugin(HostPlugin)
    await vi.waitFor(() => expect(ctx.get('preplanning')).toBeDefined())
    expect(ctx.get('preplanning')?.visual).toBeInstanceOf(VisualAgentService)
    expect(ctx.get('preplanning')?.reports).toBeInstanceOf(ReportPackageService)
    expect(ctx.get('preplanning')?.standardProjects).toBeInstanceOf(PresentationStandardProjectService)
    expect(ctx.get('preplanning')?.presentationSync).toBeInstanceOf(PresentationAutoSyncService)
    expect(ctx.get('preplanning')?.parallel).toBeInstanceOf(ParallelWorkflowExecutor)
    expect(ctx.get('preplanning')?.presentationProjectRoot).toBe(presentationRoot)
    const reportOptions = Reflect.get(ctx.get('preplanning')!.reports, 'options') as { readonly boundaryIntegrity?: unknown }
    expect(reportOptions.boundaryIntegrity).toBeInstanceOf(SiteBoundaryService)
    expect(routes).toEqual([
      expect.objectContaining({ kind: 'prefix', path: '/preplan-export' }),
      expect.objectContaining({ kind: 'exact', path: '/preplan-agent-classes' }),
      expect.objectContaining({ kind: 'exact', path: '/preplan-open-workspace' }),
    ])

    expect(commands.map(definition => definition.name)).toEqual([
      'preplan-research-run', 'preplan-research-status', 'preplan-research-cancel',
      'preplan-research-plan',
      'preplan-research-peers',
      'preplan-research-od',
      'preplan-new', 'preplan-open', 'preplan-list', 'preplan-status', 'preplan-confirm',
      'preplan-mode', 'preplan-run', 'preplan-pause', 'preplan-gate', 'preplan-revise',
      'preplan-visual-fill', 'preplan-visual-budget', 'preplan-visual-reject',
      'preplan-visual', 'preplan-visual-adopt', 'preplan-visual-replace',
      'preplan-boundary-asset', 'preplan-boundary-coordinates', 'preplan-boundary-confirm',
      'preplan-manuscript', 'preplan-export', 'preplan-presentation-sync', 'preplan-open-project-folder',
    ])
    expect(tools.map(definition => definition.name)).toEqual([
      'preplanning_read_research_source', 'preplanning_research_peers', 'preplanning_verify_peer_research',
      'preplanning_web_query',
      'preplanning_generate_page_visual',
      'preplanning_get_context', 'preplanning_read_material', 'preplanning_apply_commands',
      'preplanning_sync_presentation_project',
    ])
    expect(promptSections).toHaveLength(1)
    expect(promptSections[0]).toMatchObject({
      name: 'preplanning-agent',
      text: PREPLANNING_SYSTEM_PROMPT,
    })
    expect(PREPLANNING_SYSTEM_PROMPT).toContain('preplanning_sync_presentation_project')

    const created = await commands.find(definition => definition.name === 'preplan-new')?.handler({
      rawInput: '鄂州体育中心项目', agent: { id: 'session-1' },
    } as never)
    expect(created?.kind).toBe('success')
    if (created?.kind !== 'success') throw new Error('preplan-new did not create the test project')
    const createdText = created.text ?? ''
    expect(createdText).toContain('尚未提供场地边界')

    const synchronized = await commands.find(
      definition => definition.name === 'preplan-presentation-sync',
    )?.handler({ rawInput: '', agent: { id: 'session-1' } } as never)
    expect(synchronized?.kind).toBe('success')
    if (synchronized?.kind !== 'success') {
      throw new Error(`Presentation sync failed: ${synchronized?.text ?? 'missing result'}`)
    }
    const synchronizedText = synchronized.text ?? ''
    expect(synchronizedText).toContain('PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS')
    expect(synchronizedText).toContain('Presentation Project ID')
    const directoryRoot = synchronizedText.match(/^目录：(.+)$/mu)?.[1]
    expect(directoryRoot).toBeDefined()
    if (directoryRoot === undefined) throw new Error('sync did not report its directory')
    const projectDocument = JSON.parse(await readFile(join(directoryRoot, 'project.json'), 'utf8')) as {
      standardVersion?: string
      projectId?: string
    }
    expect(projectDocument.standardVersion).toBe('0.1.0')
    expect(projectDocument.projectId).toMatch(/^project_/u)

    const peerInput = peerRequest(), peerSource = peerInput.captures[0]
    const { content, sha256: _hash, schemaVersion: _schema, ...sourceMetadata } = peerSource
    await writeFile(join(directoryRoot, 'peer-source.json'), content)
    const researchExec = { agent: { id: 'session-1', session: { header: { cwd: directoryRoot } } }, signal: new AbortController().signal }
    const sourceRead = await tools.find(d => d.name === 'preplanning_read_research_source')!.execute(
      { document: { ...sourceMetadata, path: 'peer-source.json' } }, researchExec as never) as any
    const research = await tools.find(d => d.name === 'preplanning_research_peers')!.execute(
      { contextToken: sourceRead.contextToken, scope: peerInput.scope, asOf: peerInput.asOf, documents: [sourceRead.document], peers: peerInput.peers },
      researchExec as never) as any
    expect(research).toMatchObject({ publicationGranted: false, networkRequests: 0, summary: { total: 3 } })
    expect(await readFile(join(directoryRoot, research.reportPath), 'utf8')).toContain('合成邻里运动馆')
    expect(await tools.find(d => d.name === 'preplanning_verify_peer_research')!.execute(
      { runId: research.runId }, researchExec as never)).toMatchObject({ valid: true, replayed: true, checkedPeers: 3 })

    // Background export temporarily marks an established workspace as creating.
    // Research control must retain that identity, but never accept a first export
    // or a failed export as a usable binding.
    const bindingStore = ctx.get('preplanning')!.presentationBindings
    const researchProjectId = ctx.get('preplanning')!.repository.readContext('session-1').project.projectId
    const readyBinding = bindingStore.read(researchProjectId)!
    const researchStatus = commands.find(d => d.name === 'preplan-research-status')!
    const researchCancel = commands.find(d => d.name === 'preplan-research-cancel')!
    await bindingStore.put({ ...readyBinding, state: 'creating' })
    expect(await researchStatus.handler(researchExec as never)).toMatchObject({ kind: 'success' })
    expect(await researchCancel.handler(researchExec as never)).toMatchObject({ kind: 'success' })
    await writeFile(join(directoryRoot, 'project.json'), JSON.stringify({ ...projectDocument, projectId: 'different' }))
    expect(await researchStatus.handler(researchExec as never)).toMatchObject({ kind: 'error', text: 'RESEARCH_WORKSPACE_IDENTITY_MISMATCH' })
    await writeFile(join(directoryRoot, 'project.json'), JSON.stringify(projectDocument))
    await bindingStore.put({ ...readyBinding, state: 'creating', lastExportedAt: undefined,
      lastExportedPreDesignRevision: undefined, lastExportedFileHashes: {} })
    expect(await researchStatus.handler(researchExec as never)).toMatchObject({ kind: 'error', text: 'RESEARCH_WORKSPACE_BINDING_REQUIRED' })
    await bindingStore.put({ ...readyBinding, state: 'recovery_required' })
    expect(await researchStatus.handler(researchExec as never)).toMatchObject({ kind: 'error', text: 'RESEARCH_WORKSPACE_BINDING_REQUIRED' })
    await bindingStore.put(readyBinding)

    const envelope = createD1ProposalExample({
      projectId: 'preplan-test-project',
      projectName: '鄂州体育中心项目',
      statement: '新建鄂州体育中心项目并完成 01-01 身份校准',
      createdAt: '2026-08-28T02:30:00.000Z',
    })
    const actualProjectId = (createdText.match(/（([^）]+)）/u) ?? [])[1]
    if (actualProjectId === undefined) throw new Error('preplan-new did not return its project id')
    const acceptedEnvelope = {
      ...envelope,
      project_id: actualProjectId,
      change_set: {
        ...envelope.change_set,
        payload: {
          ...envelope.change_set.payload,
          project_id: actualProjectId,
          data: { ...envelope.change_set.payload.data, project_id: actualProjectId },
        },
      },
    }
    const result = await tools.find(definition => definition.name === 'preplanning_apply_commands')?.execute(
      { envelope: acceptedEnvelope },
      { agent: { id: 'session-1' } } as never,
    )
    expect(result).toMatchObject({ status: 'pending_review', expectedRevision: 0 })

    // The real host must connect persisted governance limits to class dispatch;
    // testing the class service alone would miss an omitted production callback.
    const host = ctx.get('preplanning')!
    await host.automation.authorize(actualProjectId, {
      baseRevision: 0, workflowIds: ['preplan.wf.01.01'], gateIds: [], maxImages: 0,
      maxModelTurns: 1, stopOnBlocking: true, reportDepth: 'standard',
    }, { actorId: 'test-owner', name: 'Test owner', role: 'decision_owner' })
    const route = { provider: 'test', model: 'model' }
    await host.agentClasses.save(0, { image: route, web: route, text: route })
    const parent = { id: 'session-1', options: route } as never
    await host.agentClasses.begin(actualProjectId, 'text', 'first model turn', parent)
    await expect(host.agentClasses.begin(actualProjectId, 'web', 'over budget', parent))
      .rejects.toThrow('PREPLANNING_MODEL_TURN_LIMIT')
  })
})
