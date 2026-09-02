import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { describe, expect, it, vi } from 'vitest'
import { registerPreplanningCommands } from '../src/commands/register.ts'

function commandDependencies(overrides: Record<string, unknown> = {}) {
  return {
    repository: {} as never,
    gateway: {} as never,
    governance: {} as never,
    runtime: {} as never,
    automation: {} as never,
    gates: {} as never,
    revisions: {} as never,
    coordinator: {} as never,
    visual: {} as never,
    boundaries: {} as never,
    reports: {} as never,
    registry: {} as never,
    createId: () => 'project-1',
    now: () => '2026-08-27T17:00:00.000Z',
    ...overrides,
  }
}

describe('preplanning commands', () => {
  it('provides human-only site boundary registration and independent confirmation commands', async () => {
    const definitions: CommandDefinition[] = []
    const registerGeometry = vi.fn(async () => ({ boundaryId: 'boundary-1' }))
    const confirm = vi.fn(async () => ({ boundaryId: 'boundary-1', status: 'confirmed_formal_boundary' }))
    const ctx = { commands: { register: (definition: CommandDefinition) => { definitions.push(definition); return () => undefined } } } as unknown as Context
    registerPreplanningCommands(ctx, commandDependencies({
      repository: { readContext: vi.fn(() => ({ project: { projectId: 'project-1', name: '测试项目', currentRevision: 7 } })) } as never,
      boundaries: { registerGeometry, confirm } as never,
    }) as never)

    const invocation = {
      agent: {
        id: 'session-1',
        session: { header: { version: 0, id: 'session-1', createdAt: 1, delegationDepth: 0 } },
      },
    }
    await expect(definitions.find(row => row.name === 'preplan-boundary-coordinates')?.handler({
      ...invocation, rawInput: 'EPSG:4490 [[0, 0], [4, 0], [0, 3], [0, 0]]',
    } as never)).resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('待确认') })
    await expect(definitions.find(row => row.name === 'preplan-boundary-confirm')?.handler({
      ...invocation,
      rawInput: `boundary-1 7 ${'a'.repeat(64)} 该图是本项目采用的总平图或红线图，且图中明确表达项目边界`,
    } as never)).resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('正式确认') })
    expect(registerGeometry).toHaveBeenCalledWith('project-1', {
      crs: 'EPSG:4490', payload: [[0, 0], [4, 0], [0, 3], [0, 0]], submittedRevision: 7, projectName: '测试项目',
    }, { actor: { actorId: 'dsh-user:session-1', name: 'DSH 用户', role: 'decision_owner' }, channel: 'dsh_human_command' })
    expect(confirm).toHaveBeenCalledWith('project-1', 'boundary-1', 7, {
      boundaryId: 'boundary-1', submittedRevision: 7, contentSha256: 'a'.repeat(64),
      statement: '该图是本项目采用的总平图或红线图，且图中明确表达项目边界',
    }, expect.objectContaining({
      channel: 'dsh_human_command', actor: expect.objectContaining({ role: 'decision_owner' }),
    }))
  })

  it('注册完整全流程命令并提供中文发现文案', () => {
    const definitions: CommandDefinition[] = []
    const ctx = {
      commands: { register: (definition: CommandDefinition) => { definitions.push(definition); return () => undefined } },
    } as unknown as Context
    registerPreplanningCommands(ctx, commandDependencies() as never)

    expect(definitions.map(definition => definition.name)).toEqual([
      'preplan-new', 'preplan-open', 'preplan-list', 'preplan-status', 'preplan-confirm',
      'preplan-mode', 'preplan-run', 'preplan-pause', 'preplan-gate', 'preplan-revise',
      'preplan-visual', 'preplan-visual-adopt', 'preplan-visual-replace',
      'preplan-boundary-asset', 'preplan-boundary-coordinates', 'preplan-boundary-confirm', 'preplan-export',
    ])
    expect(definitions.every(definition => /[\u4e00-\u9fff]/u.test(definition.description))).toBe(true)
  })

  it('preplan-list 从持久化仓储读取并返回中文结果', async () => {
    const definitions: CommandDefinition[] = []
    const ctx = {
      commands: { register: (definition: CommandDefinition) => { definitions.push(definition); return () => undefined } },
    } as unknown as Context
    registerPreplanningCommands(ctx, commandDependencies({
      repository: { listProjects: () => [{ projectId: 'project-1', name: '验收项目', currentRevision: 2 }] } as never,
    }) as never)

    const definition = definitions.find(candidate => candidate.name === 'preplan-list')
    await expect(definition?.handler({} as never)).resolves.toEqual({
      kind: 'success',
      text: '项目列表：\n- 验收项目（project-1）· revision 2',
    })
  })

  it('preplan-new 只通过标准命令事件携带可回放状态，不追加未知 Session 事件', async () => {
    const definitions: CommandDefinition[] = []
    const append = vi.fn()
    const context = {
      project: {
        projectId: 'project-1', name: '验收项目', currentRevision: 0, currentStage: '01-01',
        createdAt: '2026-08-27T17:00:00.000Z', updatedAt: '2026-08-27T17:00:00.000Z',
      },
      binding: { sessionId: 'session-1', projectId: 'project-1', boundAt: '2026-08-27T17:00:00.000Z' },
      stateObjects: [], revisions: [], events: [], proposals: [],
      questions: [{
        questionId: 'question-1', projectId: 'project-1', prompt: '请确认项目身份',
        priority: 100, status: 'open', createdAt: '2026-08-27T17:00:00.000Z',
      }],
    }
    const ctx = {
      commands: { register: (definition: CommandDefinition) => { definitions.push(definition); return () => undefined } },
    } as unknown as Context
    const initializeProject = vi.fn(async () => undefined)
    const createPolicy = vi.fn(async () => undefined)
    registerPreplanningCommands(ctx, commandDependencies({
      repository: {
        createProject: vi.fn(async () => context.project),
        readContext: vi.fn(() => context),
      } as never,
      runtime: { initializeProject, snapshot: vi.fn(() => ({
        chapters: Array.from({ length: 8 }, (_, index) => ({ chapterId: String(index + 1).padStart(2, '0'), completed: 0, total: index === 0 ? 7 : 0 })),
        blocked: [],
      })) } as never,
      governance: { createPolicy, readProject: vi.fn(() => ({
        policy: { mode: 'manual', reportDepth: 'standard' }, gateDecisions: [], visualAssets: [], visualTasks: [], siteBoundaries: [], reportPackages: [],
      })) } as never,
    }) as never)

    const definition = definitions.find(candidate => candidate.name === 'preplan-new')
    const result = await definition?.handler({
      rawInput: ' 验收项目', agent: { id: 'session-1', session: { append } },
    } as never)

    expect(append).not.toHaveBeenCalled()
    expect(initializeProject).toHaveBeenCalledWith('project-1')
    expect(createPolicy).toHaveBeenCalledWith({
      projectId: 'project-1', mode: 'manual', reportDepth: 'standard', updatedAt: '2026-08-27T17:00:00.000Z',
    })
    expect(result).toMatchObject({ kind: 'success', text: expect.stringContaining('前期策划全流程：模式 manual') })
  })

  it('preplan-mode automatic 由当前 decision_owner 签署完整授权', async () => {
    const definitions: CommandDefinition[] = []
    const authorize = vi.fn(async () => ({ authorizationId: 'authorization-1' }))
    const workflows = Array.from({ length: 57 }, (_, index) => ({ workflowId: `wf-${index + 1}` }))
    const gates = Array.from({ length: 8 }, (_, index) => ({ gateId: `G${index + 1}` }))
    const ctx = {
      commands: { register: (definition: CommandDefinition) => { definitions.push(definition); return () => undefined } },
    } as unknown as Context
    registerPreplanningCommands(ctx, commandDependencies({
      repository: {
        readContext: vi.fn(() => ({
          project: { projectId: 'project-1', name: '自动项目', currentRevision: 3 },
        })),
      } as never,
      governance: {
        readProject: vi.fn(() => ({ policy: { reportDepth: 'extended' }, authorizations: [] })),
        putVisualPolicy: vi.fn(async record => record), putPolicy: vi.fn(async record => record),
      } as never,
      automation: { authorize } as never,
      registry: { workflows: () => workflows, gates: () => gates } as never,
    }) as never)

    const result = await definitions.find(row => row.name === 'preplan-mode')?.handler({
      rawInput: ' automatic', agent: { id: 'session-1' },
    } as never)

    expect(authorize).toHaveBeenCalledWith('project-1', {
      baseRevision: 3,
      workflowIds: workflows.map(row => row.workflowId),
      gateIds: gates.map(row => row.gateId),
      maxImages: 20,
      maxModelTurns: 120,
      stopOnBlocking: true,
      reportDepth: 'extended',
    }, { actorId: 'dsh-user:session-1', name: 'DSH 用户', role: 'decision_owner' })
    expect(result).toMatchObject({ kind: 'success', text: expect.stringContaining('全自动模式') })
  })

  it('preplan-mode 持久化用户选择的生图预算与报告深度', async () => {
    const definitions: CommandDefinition[] = []
    const authorize = vi.fn(async () => ({ authorizationId: 'authorization-1' }))
    const putVisualPolicy = vi.fn(async record => record)
    const workflows = Array.from({ length: 57 }, (_, index) => ({ workflowId: `wf-${index + 1}` }))
    const gates = Array.from({ length: 8 }, (_, index) => ({ gateId: `G${index + 1}` }))
    const ctx = {
      commands: { register: (definition: CommandDefinition) => { definitions.push(definition); return () => undefined } },
    } as unknown as Context
    registerPreplanningCommands(ctx, commandDependencies({
      repository: { readContext: vi.fn(() => ({ project: { projectId: 'project-1', currentRevision: 0 } })) } as never,
      governance: {
        readProject: vi.fn(() => ({ policy: { reportDepth: 'standard' }, authorizations: [] })),
        putVisualPolicy,
        putPolicy: vi.fn(async record => record),
      } as never,
      automation: { authorize } as never,
      registry: { workflows: () => workflows, gates: () => gates } as never,
    }) as never)

    await definitions.find(row => row.name === 'preplan-mode')?.handler({
      rawInput: 'automatic 12 extended', agent: { id: 'session-1' },
    } as never)

    expect(putVisualPolicy).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', targetConceptImages: 12, projectGenerationBudget: 12,
    }))
    expect(authorize).toHaveBeenCalledWith('project-1', expect.objectContaining({
      maxImages: 12, reportDepth: 'extended',
    }), expect.any(Object))
  })

  it('preplan-run 将真实命令 Agent 交给 Coordinator', async () => {
    const definitions: CommandDefinition[] = []
    const start = vi.fn(async () => undefined)
    const agent = { id: 'session-1' }
    const ctx = {
      commands: { register: (definition: CommandDefinition) => { definitions.push(definition); return () => undefined } },
    } as unknown as Context
    registerPreplanningCommands(ctx, commandDependencies({
      repository: { readContext: vi.fn(() => ({ project: { projectId: 'project-1', name: '运行项目' } })) } as never,
      coordinator: { start } as never,
    }) as never)

    const result = await definitions.find(row => row.name === 'preplan-run')?.handler({ rawInput: '', agent } as never)

    expect(start).toHaveBeenCalledWith(agent, 'project-1')
    expect(result).toMatchObject({ kind: 'success', text: expect.stringContaining('已开始') })
  })

  it('preplan-export 原子发布当前 Revision 并返回三格式下载地址', async () => {
    const definitions: CommandDefinition[] = []
    const publish = vi.fn(async () => ({
      packageId: 'package-57', sourceRevision: 57,
      artifacts: [
        { format: 'html', fileName: 'html/index.html' },
        { format: 'pptx', fileName: 'report.pptx' },
        { format: 'pdf', fileName: 'report.pdf' },
      ],
    }))
    const ctx = {
      commands: { register: (definition: CommandDefinition) => { definitions.push(definition); return () => undefined } },
    } as unknown as Context
    registerPreplanningCommands(ctx, commandDependencies({
      repository: { readContext: vi.fn(() => ({ project: { projectId: 'project-1', currentRevision: 57 } })) } as never,
      reports: { publish } as never,
    }) as never)

    const result = await definitions.find(row => row.name === 'preplan-export')?.handler({
      rawInput: '', agent: { id: 'session-1' },
    } as never)

    expect(publish).toHaveBeenCalledWith('project-1', 57)
    expect(result).toMatchObject({ kind: 'success', text: expect.stringContaining('/preplan-export/package-57/report.pdf') })
    expect(result?.kind === 'success' ? result.text : '').toContain('/preplan-export/package-57/html/index.html')
  })

  it('preplan-visual 通过固定项目级视觉子 Agent 生成候选图，再由用户采用', async () => {
    const definitions: CommandDefinition[] = []
    const generate = vi.fn(async () => ({
      assetId: 'concept-arrival-1', status: 'candidate',
      provider: 'antigravity', model: 'gemini-3.1-flash-image',
    }))
    const adopt = vi.fn(async () => ({ assetId: 'concept-arrival-1', status: 'adopted', adoptedRevision: 57 }))
    const ctx = {
      commands: { register: (definition: CommandDefinition) => { definitions.push(definition); return () => undefined } },
    } as unknown as Context
    const agent = { id: 'session-1' }
    registerPreplanningCommands(ctx, commandDependencies({
      repository: {
        readContext: vi.fn(() => ({ project: { projectId: 'project-1', currentRevision: 57 } })),
      } as never,
      visual: { generate, adopt } as never,
    }) as never)

    const generated = await definitions.find(row => row.name === 'preplan-visual')?.handler({
      rawInput: 'concept-arrival-1 06 06-01 滨江文化客厅到达场景，AI 概念表现图', agent,
    } as never)
    const adopted = await definitions.find(row => row.name === 'preplan-visual-adopt')?.handler({
      rawInput: 'concept-arrival-1', agent,
    } as never)

    expect(generate).toHaveBeenCalledWith(agent, {
      taskId: 'concept-arrival-1', projectId: 'project-1', chapterId: '06', workItemId: '06-01',
      kind: 'concept', required: true, prompt: '滨江文化客厅到达场景，AI 概念表现图',
    })
    expect(generated).toMatchObject({ kind: 'success', text: expect.stringContaining('concept-arrival-1') })
    expect(adopt).toHaveBeenCalledWith('project-1', 'concept-arrival-1', 57)
    expect(adopted).toMatchObject({ kind: 'success', text: expect.stringContaining('已采用') })
  })

  it('preplan-visual-replace 记录人工拒绝并以同语义已采用资产替代', async () => {
    const definitions: CommandDefinition[] = []
    const replace = vi.fn(async () => ({ rejectedAssetId: 'asset-old', replacementAssetId: 'asset-new' }))
    const ctx = {
      commands: { register: (definition: CommandDefinition) => { definitions.push(definition); return () => undefined } },
    } as unknown as Context
    registerPreplanningCommands(ctx, commandDependencies({
      repository: { readContext: vi.fn(() => ({ project: { projectId: 'project-1', currentRevision: 57 } })) } as never,
      visual: { replace } as never,
    }) as never)

    const result = await definitions.find(row => row.name === 'preplan-visual-replace')?.handler({
      rawInput: 'asset-old asset-new', agent: { id: 'session-1' },
    } as never)

    expect(replace).toHaveBeenCalledWith('project-1', 'asset-old', 'asset-new')
    expect(result).toMatchObject({ kind: 'success', text: expect.stringContaining('asset-new') })
  })
})
