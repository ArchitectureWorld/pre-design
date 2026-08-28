import { describe, expect, it, vi } from 'vitest'
import { VisualAgentError, VisualAgentService } from '../src/visual/agent.ts'

interface StartSpec {
  readonly childId: string
  readonly label: string
  readonly request: { readonly prompt: readonly { readonly text: string }[] }
}

function fixture(options: {
  startError?: Error
  existingChild?: boolean
  existingChildId?: string
  existingAttempts?: number
  existingStatus?: string
  existingBlockedReason?: string
  lateImage?: boolean
} = {}) {
  const visualTasks = [{
    taskId: 'task-1', projectId: 'project-1', chapterId: '03', workItemId: '03-06',
    kind: 'concept', required: true, status: options.existingStatus ?? 'queued',
    attempts: options.existingAttempts ?? 0, updatedAt: '2026-08-28T08:00:00.000Z',
    ...(options.existingChild || options.existingChildId !== undefined
      ? { childId: options.existingChildId ?? 'restored-child' }
      : {}),
    ...(options.existingBlockedReason === undefined ? {} : { blockedReason: options.existingBlockedReason }),
  }]
  const visualAssets: Array<Record<string, unknown>> = []
  const putVisualTask = vi.fn(async (record) => {
    const index = visualTasks.findIndex(row => row.taskId === record.taskId)
    if (index >= 0) visualTasks[index] = record
    else visualTasks.push(record)
    return record
  })
  const startContinuable = options.startError === undefined
    ? vi.fn(async (spec: StartSpec) => ({ childId: spec.childId, messageId: 'message-1' }))
    : vi.fn(async () => { throw options.startError })
  const service = new VisualAgentService({
    governance: {
      readProject: vi.fn(() => ({ visualTasks, visualAssets })),
      putVisualTask,
      putVisualAsset: vi.fn(async (record) => {
        const index = visualAssets.findIndex(row => row.assetId === record.assetId)
        if (index >= 0) visualAssets[index] = record
        else visualAssets.push(record)
        return record
      }),
    } as never,
    llm: { listModels: vi.fn(async () => [{ id: 'gemini-3.1-flash-image' }]) } as never,
    subagents: {
      startContinuable,
    } as never,
    collector: {
      findExistingImage: vi.fn(async () => options.lateImage ? ({
        mimeType: 'image/png', data: new Uint8Array([1, 2, 3]), width: 1600, height: 900,
      }) : undefined),
      waitForImage: vi.fn(async (_childId, _afterSeq, signal: AbortSignal) => {
        if (signal.aborted) throw signal.reason
        return ({
          mimeType: 'image/png', data: new Uint8Array([1, 2, 3]), width: 1600, height: 900,
        })
      }),
    } as never,
    store: {
      saveCandidate: vi.fn(async (task) => ({
        assetId: 'asset-1', taskId: task.taskId, projectId: task.projectId, kind: 'concept', required: true,
        status: 'candidate', mimeType: 'image/png', fileName: 'project-1/candidates/asset-1.png',
        sha256: 'a'.repeat(64), width: 1600, height: 900, createdAt: '2026-08-28T08:30:00.000Z',
      })),
    } as never,
    now: () => '2026-08-28T08:30:00.000Z',
  })
  return { service, visualTasks, visualAssets, putVisualTask, startContinuable }
}

describe('VisualAgentService', () => {
  it('creates one isolated task child on the exact spawn and Gemini route', async () => {
    const { service, startContinuable } = fixture()
    const parent = { id: 'parent-1' }
    const task = {
      taskId: 'task-1', projectId: 'project-1', chapterId: '03', workItemId: '03-06',
      kind: 'concept' as const, required: true, prompt: '滨水公共文化空间概念表现图',
    }

    await expect(service.probeModel()).resolves.toEqual({
      provider: 'antigravity', model: 'gemini-3.1-flash-image', advertised: true,
    })
    await expect(service.generate(parent as never, task, AbortSignal.timeout(1000))).resolves.toMatchObject({
      status: 'candidate', provider: 'antigravity', model: 'gemini-3.1-flash-image',
    })

    expect(startContinuable).toHaveBeenCalledWith({
      provider: 'spawn',
      label: 'preplanning_visual_task:project-1:task-1:1',
      childId: expect.stringMatching(/^preplanning-visual-/u),
      request: {
        parent,
        prompt: [{ type: 'text', text: expect.stringContaining('当前唯一视觉任务 task-1') }],
        agentOptions: { provider: 'antigravity', model: 'gemini-3.1-flash-image', maxTokens: 8192 },
        maxDepth: 1,
        toolFilter: { allow: [] },
        persona: expect.stringContaining('禁止使用 Shell、网页搜索'),
      },
      signal: expect.any(AbortSignal),
    })
  })

  it('blocks the governed visual task when the exact route cannot start and never substitutes a model', async () => {
    const { service, visualTasks, startContinuable } = fixture({ startError: new Error('model not found') })
    const task = {
      taskId: 'task-1', projectId: 'project-1', chapterId: '03', workItemId: '03-06',
      kind: 'concept' as const, required: true, prompt: '滨水公共文化空间概念表现图',
    }

    await expect(service.generate({ id: 'parent-1' } as never, task, AbortSignal.timeout(1000))).rejects.toEqual(
      expect.objectContaining<Partial<VisualAgentError>>({ code: 'visual-model-unavailable' }),
    )
    expect(startContinuable).toHaveBeenCalledOnce()
    expect(visualTasks[0]).toMatchObject({
      status: 'blocked', blockedReason: expect.stringContaining('gemini-3.1-flash-image'),
    })
  })

  it('records a quality-approved candidate on the exact route and adopts it at one revision', async () => {
    const { service, visualTasks, visualAssets } = fixture()
    const task = {
      taskId: 'task-1', projectId: 'project-1', chapterId: '03', workItemId: '03-06',
      kind: 'concept' as const, required: true, prompt: '滨水公共文化空间概念表现图',
    }

    const candidate = await service.generate({ id: 'parent-1' } as never, task, AbortSignal.timeout(1000))

    expect(candidate).toMatchObject({
      assetId: 'asset-1', status: 'candidate', provider: 'antigravity', model: 'gemini-3.1-flash-image',
      quality: { accepted: true },
    })
    expect(visualTasks[0]).toMatchObject({ status: 'candidate_ready', childId: expect.stringMatching(/^preplanning-visual-/u) })
    expect(visualAssets).toHaveLength(1)

    Object.assign(visualTasks[0], { blockedReason: 'stale failure from an earlier attempt' })
    await expect(service.adopt('project-1', 'asset-1', 12)).resolves.toMatchObject({
      status: 'adopted', adoptedRevision: 12,
    })
    expect(visualTasks[0]).toMatchObject({ status: 'adopted' })
    expect(visualTasks[0]).not.toHaveProperty('blockedReason')
  })

  it('starts a fresh task attempt instead of reusing a restored child with image history', async () => {
    const { service, visualTasks, startContinuable } = fixture({
      existingChild: true,
      existingAttempts: 1,
      existingStatus: 'blocked',
      existingBlockedReason: 'previous attempt timed out',
    })
    const task = {
      taskId: 'task-1', projectId: 'project-1', chapterId: '03', workItemId: '03-06',
      kind: 'concept' as const, required: true, prompt: '滨水公共文化空间概念表现图',
    }

    await expect(service.generate({ id: 'parent-1' } as never, task, AbortSignal.timeout(1000))).resolves.toMatchObject({
      assetId: 'asset-1', status: 'candidate',
    })
    expect(startContinuable).toHaveBeenCalledWith(expect.objectContaining({
      childId: expect.not.stringMatching(/^restored-child$/u),
      label: 'preplanning_visual_task:project-1:task-1:2',
    }))
    expect(visualTasks[0]).not.toHaveProperty('blockedReason')
  })

  it('recovers a late image from the same deterministic task attempt without spawning another child', async () => {
    const { service, visualTasks, startContinuable } = fixture({
      existingChildId: 'preplanning-visual-659ab1ce6ceb320a005db7c6',
      existingAttempts: 1,
      existingStatus: 'blocked',
      lateImage: true,
    })
    const task = {
      taskId: 'task-1', projectId: 'project-1', chapterId: '03', workItemId: '03-06',
      kind: 'concept' as const, required: true, prompt: '滨水公共文化空间概念表现图',
    }

    await expect(service.generate({ id: 'parent-after-restart' } as never, task, AbortSignal.timeout(1000))).resolves.toMatchObject({
      assetId: 'asset-1', status: 'candidate',
    })
    expect(visualTasks[0]).toMatchObject({
      status: 'candidate_ready', attempts: 1, childId: 'preplanning-visual-659ab1ce6ceb320a005db7c6',
    })
    expect(startContinuable).not.toHaveBeenCalled()
  })

  it('keeps the default collection window open long enough for one transport retry', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => (
      milliseconds >= 600_000
        ? new AbortController().signal
        : AbortSignal.abort(new Error('collection window ended before retry completed'))
    ))
    const { service } = fixture()
    const task = {
      taskId: 'task-1', projectId: 'project-1', chapterId: '03', workItemId: '03-06',
      kind: 'concept' as const, required: true, prompt: '滨水公共文化空间概念表现图',
    }

    try {
      await expect(service.generate({ id: 'parent-1' } as never, task)).resolves.toMatchObject({
        assetId: 'asset-1', status: 'candidate',
      })
    } finally {
      timeout.mockRestore()
    }
  })

  it('isolates consecutive visual tasks in distinct children while applying one project style', async () => {
    const { service, startContinuable } = fixture()
    const parent = { id: 'parent-1' }
    const first = {
      taskId: 'task-1', projectId: 'project-1', chapterId: '01', workItemId: '01-01',
      kind: 'concept' as const, required: true, prompt: '滨水鸟瞰图',
    }
    const second = {
      taskId: 'task-2', projectId: 'project-1', chapterId: '02', workItemId: '02-03',
      kind: 'concept' as const, required: true, prompt: '文化场馆入口人视图',
    }

    await service.generate(parent as never, first, AbortSignal.timeout(1000))
    await service.generate(parent as never, second, AbortSignal.timeout(1000))

    const starts = startContinuable.mock.calls.map(([spec]) => spec)
    expect(starts.map(spec => spec.childId)).toEqual([
      expect.stringMatching(/^preplanning-visual-[a-f0-9]{24}$/u),
      expect.stringMatching(/^preplanning-visual-[a-f0-9]{24}$/u),
    ])
    expect(new Set(starts.map(spec => spec.childId)).size).toBe(2)
    expect(starts.map(spec => spec.label)).toEqual([
      'preplanning_visual_task:project-1:task-1:1',
      'preplanning_visual_task:project-1:task-2:1',
    ])
    expect(starts[1].request.prompt[0].text).toContain('视觉任务 task-2')
    expect(starts[1].request.prompt[0].text).toContain('统一项目视觉风格')
    expect(starts[1].request.prompt[0].text).not.toContain('task-1')
  })
})
