import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { registerPresentationRuntime } from '../src/presentation/runtime-integration.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'

const frozenProject: FrozenProjectInput = {
  projectId: 'preplan-workspace-project',
  projectName: '武汉站综合枢纽',
  revision: 4,
  generatedAt: '2026-09-04T03:00:00.000Z',
  recommendation: '站城一体。',
  decisionItems: [],
  stateObjects: [],
  gates: [],
  visualAssets: [],
  adoptedAssetIds: [],
  siteBoundary: { status: 'not_provided' },
}

function runtimeContext(commands: CommandDefinition[], tools: ToolDefinition[]): Context {
  return {
    commands: { register: (definition: CommandDefinition) => { commands.push(definition); return () => undefined } },
    tools: { register: (definition: ToolDefinition) => { tools.push(definition); return () => undefined } },
  } as unknown as Context
}

function invocation(rawInput: string, cwd = 'C:\\Projects\\武汉站') {
  return {
    rawInput,
    agent: {
      id: 'session-2',
      session: { header: { cwd } },
    },
  } as never
}

function projectContext() {
  return {
    project: {
      projectId: frozenProject.projectId,
      name: frozenProject.projectName,
      currentRevision: frozenProject.revision,
    },
  }
}

describe('Workspace-aware Presentation runtime', () => {
  it('probes the Workspace, binds another Session to the existing Pre project, and exports into the Workspace root', async () => {
    const commands: CommandDefinition[] = []
    const tools: ToolDefinition[] = []
    const bindSession = vi.fn(async () => undefined)
    const exportProject = vi.fn(async () => ({
      directoryRoot: 'C:\\Projects\\武汉站',
      projectId: 'project_01992a80-0000-7000-8000-000000000001',
      projectSlug: 'wuhan-station',
      standardVersion: '0.1.0' as const,
      replacedExisting: true,
      fileHashes: {},
      validation: { valid: true, errors: [] },
      stableIds: {},
    }))
    const findByWorkspaceRoot = vi.fn(() => ({
      preDesignProjectId: frozenProject.projectId,
      workspaceRoot: 'C:\\Projects\\武汉站',
      directoryRoot: 'C:\\Projects\\武汉站',
      state: 'ready',
    }))

    registerPresentationRuntime(runtimeContext(commands, tools), {
      repository: {
        bindSession,
        readContext: vi.fn(projectContext),
      } as never,
      standardProjects: { exportProject, findByWorkspaceRoot } as never,
      source: vi.fn(async () => frozenProject),
      resolveWorkspaceRoot: vi.fn(async () => 'C:\\Projects\\武汉站'),
      openDirectory: vi.fn(async () => undefined),
    })

    expect(commands.map(command => command.name)).toEqual([
      'preplan-presentation-sync',
      'preplan-open-project-folder',
    ])

    const probe = await commands[0]?.handler(invocation('--probe'))
    expect(probe).toMatchObject({
      kind: 'success',
      text: expect.stringContaining('PRE_DESIGN_WORKSPACE_PROJECT_ATTACHED'),
    })
    expect(bindSession).toHaveBeenCalledWith('session-2', frozenProject.projectId, expect.any(String))
    expect(exportProject).not.toHaveBeenCalled()

    const sync = await commands[0]?.handler(invocation(''))
    expect(sync).toMatchObject({
      kind: 'success',
      text: expect.stringContaining('PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS'),
    })
    expect(exportProject).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: 'C:\\Projects\\武汉站',
      frozenProject,
    }))
  })

  it('recognizes a legacy Session-bound Pre project before the first Workspace export', async () => {
    const commands: CommandDefinition[] = []
    const tools: ToolDefinition[] = []
    const bindSession = vi.fn(async () => undefined)
    const readContext = vi.fn(projectContext)
    registerPresentationRuntime(runtimeContext(commands, tools), {
      repository: { bindSession, readContext } as never,
      standardProjects: {
        exportProject: vi.fn(),
        findByWorkspaceRoot: vi.fn(() => undefined),
      } as never,
      source: vi.fn(async () => frozenProject),
      resolveWorkspaceRoot: vi.fn(async () => 'C:\\Projects\\武汉站'),
      openDirectory: vi.fn(async () => undefined),
    })

    const probe = await commands[0]?.handler(invocation('--probe'))
    expect(probe).toMatchObject({
      kind: 'success',
      text: expect.stringContaining('PRE_DESIGN_WORKSPACE_PROJECT_ATTACHED'),
    })
    expect(probe?.kind === 'success' ? probe.text : '').toContain(frozenProject.projectId)
    expect(readContext).toHaveBeenCalledWith('session-2')
    expect(bindSession).not.toHaveBeenCalled()
  })

  it('opens the current Workspace even before a Pre binding has been published', async () => {
    const commands: CommandDefinition[] = []
    const tools: ToolDefinition[] = []
    const openDirectory = vi.fn(async () => undefined)
    registerPresentationRuntime(runtimeContext(commands, tools), {
      repository: {
        bindSession: vi.fn(async () => undefined),
        readContext: vi.fn(() => { throw Object.assign(new Error('not bound'), { code: 'session-not-bound' }) }),
      } as never,
      standardProjects: {
        exportProject: vi.fn(),
        findByWorkspaceRoot: vi.fn(() => undefined),
      } as never,
      source: vi.fn(async () => frozenProject),
      resolveWorkspaceRoot: vi.fn(async () => 'C:\\Projects\\武汉站'),
      openDirectory,
    })

    const result = await commands[1]?.handler(invocation(''))
    expect(result).toMatchObject({ kind: 'success', text: expect.stringContaining('C:\\Projects\\武汉站') })
    expect(openDirectory).toHaveBeenCalledWith('C:\\Projects\\武汉站')
  })
})
