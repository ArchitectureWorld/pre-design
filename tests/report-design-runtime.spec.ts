import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { afterEach, expect, it, vi } from 'vitest'
import * as HostPlugin from '../src/index.ts'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.unstubAllEnvs() })

it('publishes the frozen bridge and isolates every default host artifact root beneath DSH_HOME', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pre-report-runtime-')); cleanups.push(() => rm(root, { recursive: true, force: true }))
  vi.stubEnv('DSH_HOME', join(root, 'isolated-home')); vi.stubEnv('PRE_DESIGN_PRESENTATION_PROJECT_ROOT', '')
  const ctx = new Context(); cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(Storage); await ctx.plugin(StorageJson, { root: join(root, 'db') }); await ctx.plugin(StorageDomain, { backend: 'json' })
  const definitions: ToolDefinition[] = []
  const promptSections: string[] = []
  ctx.provide('commands', { register: () => () => {} } as never)
  ctx.provide('tools', { register: (definition: ToolDefinition) => { definitions.push(definition); return () => {} } } as never)
  ctx.provide('attachments', {} as never); ctx.provide('llm', {} as never); ctx.provide('sessions', {} as never); ctx.provide('subagents', {} as never)
  ctx.provide('systemPrompt', { section: (section: {text:string}) => {promptSections.push(section.text);return () => {}} } as never); ctx.provide('webServer', { register: () => () => {} } as never)
  await ctx.plugin(HostPlugin); await vi.waitFor(() => expect(ctx.get('preplanning')).toBeDefined())
  const host = ctx.preplanning
  expect(host.presentationProjectRoot).toBe(join(root, 'isolated-home', 'presentation-projects'))
  expect(host.designVisualBridge.protocol).toBe('pre-design.page-visual.v1')
  expect(Object.isFrozen(host.designVisualBridge)).toBe(true)
  await expect(host.designVisualBridge.generate({ id: 'session' } as never, { runId: 'run', studioProjectId: 'studio', pageId: 'page', sourceStateHash: 'a'.repeat(64), requestId: 'request', prompt: '概念图' })).rejects.toThrow('RESOLVER_UNAVAILABLE')
  expect(definitions.some(tool => tool.name === 'preplanning_generate_page_visual')).toBe(true)
  const prompt = promptSections.join('\n')
  expect(prompt).toContain('studio_generate_design_visual')
  expect(prompt).toContain('studio_adopt_design_visual')
  expect(prompt).toContain('proposalId')
  expect(prompt).toContain('同一 requestId')
  expect(prompt).toContain('不重复付费')
  expect(prompt).not.toContain('明确请求补图时使用 preplanning_generate_page_visual')
  // These are the actual service destinations that perform writes, not a separate test-only path calculator.
  expect(Reflect.get(Reflect.get(host.visual, 'dependencies').store, 'root')).toBe(join(root, 'isolated-home', 'preplanning-agent', 'visual-assets'))
  expect(Reflect.get(host.reports, 'options').packageRoot).toBe(join(root, 'isolated-home', 'preplanning-agent', 'report-packages'))
})
