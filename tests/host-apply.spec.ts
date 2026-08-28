import { mkdtemp, rm } from 'node:fs/promises'
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
import { ReportPackageService } from '../src/report/package-service.ts'
import { VisualAgentService } from '../src/visual/agent.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Host apply composition', () => {
  it('在真实 Storage Domain 上提供全流程 Host、十三命令、两工具和系统提示', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-preplanning-host-'))
    roots.push(root)
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
      register: (definition: ToolDefinition) => { tools.push(definition); return () => undefined },
    } as never)
    ctx.provide('attachments', { readImage: vi.fn() } as never)
    ctx.provide('llm', { listModels: vi.fn(async () => []) } as never)
    ctx.provide('sessions', { get: vi.fn() } as never)
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
    expect(routes).toEqual([expect.objectContaining({ kind: 'prefix', path: '/preplan-export' })])

    expect(commands.map(definition => definition.name)).toEqual([
      'preplan-new', 'preplan-open', 'preplan-list', 'preplan-status', 'preplan-confirm',
      'preplan-mode', 'preplan-run', 'preplan-pause', 'preplan-gate', 'preplan-revise',
      'preplan-visual', 'preplan-visual-adopt', 'preplan-export',
    ])
    expect(tools.map(definition => definition.name)).toEqual([
      'preplanning_get_context', 'preplanning_apply_commands',
    ])
    expect(promptSections).toHaveLength(1)
    expect(promptSections[0]).toMatchObject({
      name: 'preplanning-agent',
      text: PREPLANNING_SYSTEM_PROMPT,
    })
    expect(PREPLANNING_SYSTEM_PROMPT).toContain('每轮只提交该 workflow 的一个 ProposalEnvelope')

    const created = await commands.find(definition => definition.name === 'preplan-new')?.handler({
      rawInput: '鄂州体育中心项目', agent: { id: 'session-1' },
    } as never)
    expect(created?.kind).toBe('success')
    if (created?.kind !== 'success') throw new Error('preplan-new did not create the test project')
    const envelope = createD1ProposalExample({
      projectId: 'preplan-test-project',
      projectName: '鄂州体育中心项目',
      statement: '新建鄂州体育中心项目并完成 01-01 身份校准',
      createdAt: '2026-08-28T02:30:00.000Z',
    })
    const actualProjectId = (created.text?.match(/（([^）]+)）/u) ?? [])[1]
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
  })
})
