import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import {
  adoptedPresentationAssets,
  registerPresentationRuntime,
} from '../src/presentation/runtime-integration.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'

const frozenProject: FrozenProjectInput = {
  projectId: 'preplan-project-1',
  projectName: '滨江文化活力区',
  revision: 7,
  generatedAt: '2026-09-03T08:00:00.000Z',
  recommendation: '形成连续公共体验体系。',
  decisionItems: [],
  stateObjects: [{
    objectId: 'DG05',
    chapterId: '03',
    workItemId: '03-05',
    title: '机会判断',
    summary: '滨江资源具备公共空间整合机会。',
    facts: [],
  }],
  gates: [],
  visualAssets: [{
    assetId: 'asset-1',
    taskId: 'task-1',
    chapterId: '03',
    workItemId: '03-05',
    kind: 'concept',
    caption: '滨江公共空间概念图',
    sourcePath: '/tmp/asset-1.png',
    mimeType: 'image/png',
    width: 1600,
    height: 900,
  }],
  adoptedAssetIds: ['asset-1'],
  siteBoundary: { status: 'not_provided' },
}

function runtimeContext(commands: CommandDefinition[], tools: ToolDefinition[]): Context {
  return {
    commands: {
      register: (definition: CommandDefinition) => {
        commands.push(definition)
        return () => undefined
      },
    },
    tools: {
      register: (definition: ToolDefinition) => {
        tools.push(definition)
        return () => undefined
      },
    },
  } as unknown as Context
}

describe('Presentation runtime integration', () => {
  it('maps adopted Pre visual assets into formal Presentation assets', () => {
    expect(adoptedPresentationAssets(frozenProject)).toEqual([expect.objectContaining({
      sourceKey: 'asset-1',
      sourcePath: '/tmp/asset-1.png',
      displayName: '滨江公共空间概念图',
      originalFileName: 'asset-1.png',
      semanticRole: 'concept_visual',
      widthPx: 1600,
      heightPx: 900,
      objectIds: ['DG05'],
      evidenceIds: [],
      origin: expect.objectContaining({
        type: 'generated_by_plugin',
        sourceTool: { name: 'pre-design', version: '2.0.0' },
      }),
    })])
  })

  it('registers a user command and an Agent tool that publish a validated standard project', async () => {
    const commands: CommandDefinition[] = []
    const tools: ToolDefinition[] = []
    const exportProject = vi.fn(async () => ({
      directoryRoot: 'C:\\Users\\tester\\.dsh\\presentation-projects\\project-1-riverfront',
      projectId: '01900000-0000-7000-8000-000000000001',
      projectSlug: 'riverfront',
      standardVersion: '0.1.0' as const,
      replacedExisting: false,
      fileHashes: {},
      validation: { valid: true, errors: [] },
      stableIds: {},
    }))
    const source = vi.fn(async () => frozenProject)
    registerPresentationRuntime(runtimeContext(commands, tools), {
      repository: {
        readContext: vi.fn(() => ({
          project: {
            projectId: frozenProject.projectId,
            name: frozenProject.projectName,
            currentRevision: frozenProject.revision,
          },
        })),
      } as never,
      standardProjects: { exportProject } as never,
      source,
    })

    expect(commands.map(command => command.name)).toEqual(['preplan-presentation-sync'])
    expect(tools.map(tool => tool.name)).toEqual(['preplanning_sync_presentation_project'])

    const commandResult = await commands[0]?.handler({
      rawInput: '',
      agent: { id: 'session-1' },
    } as never)
    expect(source).toHaveBeenCalledWith(frozenProject.projectId, frozenProject.revision)
    expect(exportProject).toHaveBeenCalledWith(expect.objectContaining({
      frozenProject,
      confirmExternalChanges: false,
      assets: expect.arrayContaining([expect.objectContaining({ sourceKey: 'asset-1' })]),
    }))
    expect(commandResult).toMatchObject({
      kind: 'success',
      text: expect.stringContaining('PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS'),
    })
    expect(commandResult?.kind === 'success' ? commandResult.text : '').toContain('C:\\Users\\tester\\.dsh\\presentation-projects')

    await tools[0]?.execute(
      { confirmExternalChanges: true },
      { agent: { id: 'session-1' } } as never,
    )
    expect(exportProject).toHaveBeenLastCalledWith(expect.objectContaining({
      confirmExternalChanges: true,
    }))
  })
})