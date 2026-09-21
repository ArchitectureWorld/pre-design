import { describe, expect, it, vi } from 'vitest'
import { VisualAgentError, VisualAgentService } from '../src/visual/agent.ts'
import type { AgentClassService } from '../src/agent-classes/service.ts'
import { SessionImageCollector, type SessionEventLike } from '../src/visual/session-image-collector.ts'
import { PNG } from 'pngjs'

interface StartSpec {
  readonly childId: string
  readonly label: string
  readonly request: { readonly prompt: readonly { readonly text: string }[] }
}

function fixture(options: {
  agentClasses?: AgentClassService
  startError?: Error
  waitUntilAborted?: boolean
  existingChild?: boolean
  existingChildId?: string
  existingAttempts?: number
  existingStatus?: string
  existingBlockedReason?: string
  lateImage?: boolean
  collector?: SessionImageCollector
  existingExecutionId?: string
  existingModelRoute?: { provider: string; model: string }
} = {}) {
  const visualTasks = [{
    taskId: 'task-1', projectId: 'project-1', chapterId: '03', workItemId: '03-06',
    kind: 'concept', required: true, status: options.existingStatus ?? 'queued',
    attempts: options.existingAttempts ?? 0, updatedAt: '2026-08-28T08:00:00.000Z',
    ...(options.existingChild || options.existingChildId !== undefined
      ? { childId: options.existingChildId ?? 'restored-child' }
      : {}),
    ...(options.existingBlockedReason === undefined ? {} : { blockedReason: options.existingBlockedReason }),
    ...(options.existingExecutionId ? { executionId: options.existingExecutionId } : {}),
    ...(options.existingModelRoute ? { modelRoute: options.existingModelRoute } : {}),
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
  const interrupt = vi.fn()
  const service = new VisualAgentService({
    agentClasses: options.agentClasses,
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
      interrupt,
    } as never,
    collector: options.collector ?? {
      findExistingImage: vi.fn(async () => options.lateImage ? ({
        mimeType: 'image/png', data: new Uint8Array([1, 2, 3]), width: 1600, height: 900,
      }) : undefined),
      waitForImage: vi.fn(async (_childId, _afterSeq, signal: AbortSignal) => {
        if (signal.aborted) throw signal.reason
        if (options.waitUntilAborted) {
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        }
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
  return { service, visualTasks, visualAssets, putVisualTask, startContinuable, interrupt }
}

describe('VisualAgentService', () => {
  it('dispatches ComfyUI through its paired LLM and only the image tool, while recording the image producer', async () => {
    const route = { provider: 'Comfyui-PIC', model: 'Klein', llm: { provider: 'test', model: 'writer' } }
    const agentClasses = { begin: vi.fn(async () => ({ id: 'comfy-execution', selected: route })), attach: vi.fn(), finish: vi.fn() } as unknown as AgentClassService
    const f = fixture({ agentClasses })
    const asset = await f.service.generate({ id: 'parent' } as never, {
      taskId: 'task-1', projectId: 'project-1', chapterId: '03', workItemId: '03-06', kind: 'concept', required: true, prompt: '林下休憩空间',
    })
    expect(f.startContinuable).toHaveBeenCalledWith(expect.objectContaining({ label: 'preplanning_visual_tool_task:project-1:task-1:1',
      request: expect.objectContaining({ agentOptions: { ...route.llm, maxTokens: 8192 }, toolFilter: { allow: ['comfyui_pic'] },
        persona: expect.stringContaining('comfyui_pic') }) }))
    expect((f.startContinuable.mock.calls[0]?.[0] as any).request.persona).not.toContain('禁止调用任何工具')
    expect(f.visualTasks[0]).toMatchObject({ modelRoute: route })
    expect(asset).toMatchObject({ provider: 'Comfyui-PIC', model: 'Klein' })
  })
  const recoveryTask = { taskId: 'task-1', projectId: 'project-1', chapterId: '03', workItemId: '03-06', kind: 'concept' as const, required: true, prompt: '滨水公共文化空间概念表现图' }
  const completeImage = PNG.sync.write(Object.assign(new PNG({ width: 16, height: 12 }), { data: Buffer.alloc(16 * 12 * 4, 180) }))
  function attemptEvents(): SessionEventLike[] {
    return [{ seq: 1, type: 'turn/start', data: { turn: 1 } }, { seq: 13, type: 'assistant/attempt', data: { turn: 1, step: 1,
      stream: [{ type: 'text-chunks', index: 0, time0: 1, dt: [0], texts: [`![scene](data:image/png;base64,${completeImage.toString('base64')})`] }] } }]
  }
  it('drains the owned retry before recording a complete failed-stream image', async () => {
    const events = attemptEvents()
    let terminalObserved = false
    const collector = new SessionImageCollector({ sessions: { get: () => ({ seq: events.length, snapshotEvents: () => events }) }, attachments: { readImage: vi.fn() },
      waitForEvent: async () => {
        expect(h.interrupt).toHaveBeenCalledOnce()
        expect(h.visualAssets).toHaveLength(0)
        terminalObserved = true
        events.push({ seq: 20, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'parent' } } } })
      } })
    const h = fixture({ collector })
    await expect(h.service.generate({ id: 'parent' } as never, recoveryTask, AbortSignal.timeout(2000), { preserveUncertain: true })).resolves.toMatchObject({ status: 'candidate' })
    expect(terminalObserved).toBe(true)
    expect(h.visualAssets).toHaveLength(1)
    expect(h.startContinuable).toHaveBeenCalledOnce()
  })
  it.each(['interrupt-rejected', 'parent-cancelled', 'turn-replaced'])('does not adopt or retry an attempt when settlement is %s', async scenario => {
    const events = attemptEvents(), parent = new AbortController()
    const collector = new SessionImageCollector({ sessions: { get: () => ({ seq: events.length, snapshotEvents: () => events }) }, attachments: { readImage: vi.fn() },
      waitForEvent: async () => {
        if (scenario === 'parent-cancelled') parent.abort(new Error('user cancelled'))
        if (scenario === 'turn-replaced') events.push({ seq: 19, type: 'turn/start', data: { turn: 2 } })
        events.push({ seq: 20, type: 'turn/end', data: { turn: scenario === 'turn-replaced' ? 2 : 1, reason: { kind: 'completed' } } })
      } })
    const h = fixture({ collector })
    if (scenario === 'interrupt-rejected') h.interrupt.mockImplementation(() => { throw new Error('child is not attached') })
    await expect(h.service.generate({ id: 'parent' } as never, recoveryTask, parent.signal, { preserveUncertain: true })).rejects.toBeInstanceOf(VisualAgentError)
    expect(h.visualAssets).toHaveLength(0)
    expect(h.visualTasks[0].status).not.toBe('candidate_ready')
    expect(h.startContinuable).toHaveBeenCalledOnce()
  })
  it('recovers a terminal failed stream on the original execution without dispatch or interruption', async () => {
    const events = [...attemptEvents(), { seq: 20, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'parent' } } } }]
    const h = coldRecovery(events)
    await expect(h.service.generate({ id: 'parent' } as never, recoveryTask, AbortSignal.timeout(2000), { recoveryOnly: true })).resolves.toMatchObject({ status: 'candidate' })
    expect(h.visualTasks[0]).toMatchObject({ attempts: 1, executionId: 'paid-original-execution', status: 'candidate_ready' })
    expect(h.startContinuable).not.toHaveBeenCalled(); expect(h.interrupt).not.toHaveBeenCalled()
  })
  function coldRecovery(events: readonly SessionEventLike[] | undefined | Error) {
    const finish = vi.fn(), begin = vi.fn(), read = vi.fn(async () => { if (events instanceof Error) throw events; return events })
    const collector = new SessionImageCollector({ sessions: { get: () => undefined }, readPersistedEvents: read,
      attachments: { readImage: async () => ({ ref: { mediaType: 'image/png', width: 1600, height: 900, bytes: 3 }, data: new Uint8Array([1, 2, 3]) }) },
      waitForEvent: vi.fn(async () => { throw new Error('cold recovery must not wait') }) })
    const execution = () => ({ id: 'paid-original-execution', projectId: 'project-1', classId: 'image', status: 'failed',
      childId: 'preplanning-visual-659ab1ce6ceb320a005db7c6', selected: { provider: 'antigravity', model: 'gemini-3.1-flash-image' },
      actual: { provider: 'antigravity', model: 'gemini-3.1-flash-image' } })
    return { ...fixture({ collector, agentClasses: { begin, finish, execution } as unknown as AgentClassService,
      existingChildId: 'preplanning-visual-659ab1ce6ceb320a005db7c6', existingAttempts: 1, existingStatus: 'running', existingExecutionId: 'paid-original-execution',
      existingModelRoute: { provider: 'antigravity', model: 'gemini-3.1-flash-image' } }), finish, begin, read }
  }
  it('settles an unloaded terminal child and its original class execution without a fresh model call', async () => {
    const h = coldRecovery([{ seq: 4, type: 'turn/start', data: { turn: 1 } }, { seq: 30, type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'parent' } } } }])
    await expect(h.service.generate({ id: 'parent' } as never, recoveryTask, AbortSignal.timeout(1000), { preserveUncertain: true, recoveryOnly: true })).rejects.toMatchObject({ code: 'visual-generation-failed' })
    expect(h.visualTasks[0]).toMatchObject({ status: 'failed', attempts: 1, executionId: 'paid-original-execution' })
    expect(h.finish).toHaveBeenCalledWith('paid-original-execution', 'failed', expect.stringContaining('已终结'))
    expect(h.startContinuable).not.toHaveBeenCalled(); expect(h.begin).not.toHaveBeenCalled(); expect(h.visualAssets).toHaveLength(0)
  })
  it('recovers a late cold image and completes the original execution from one persisted observation', async () => {
    const h = coldRecovery([{ seq: 4, type: 'turn/start', data: {} }, { seq: 29, type: 'assistant/message', data: { message: { content: [{ type: 'image', attachment: { attachmentId: 'late-image' } }] } } },
      { seq: 30, type: 'turn/end', data: { reason: { kind: 'completed' } } }])
    await expect(h.service.generate({ id: 'parent' } as never, recoveryTask, AbortSignal.timeout(1000), { preserveUncertain: true, recoveryOnly: true })).resolves.toMatchObject({ status: 'candidate' })
    expect(h.finish).toHaveBeenCalledWith('paid-original-execution', 'completed', undefined)
    expect(h.read).toHaveBeenCalledOnce(); expect(h.startContinuable).not.toHaveBeenCalled(); expect(h.begin).not.toHaveBeenCalled()
  })
  it.each(['missing', 'unfinished', 'unreadable'] as const)('keeps a %s persisted child unknown without reissuing a paid task or settling the execution', async state => {
    const h = coldRecovery(state === 'missing' ? undefined : state === 'unreadable' ? new Error('stored log validation failed') : [{ seq: 4, type: 'turn/start', data: {} }])
    await expect(h.service.generate({ id: 'parent' } as never, recoveryTask, AbortSignal.timeout(1000), { preserveUncertain: true, recoveryOnly: true })).rejects.toMatchObject({ code: 'visual-recovery-required' })
    expect(h.visualTasks[0]).toMatchObject({ status: 'running', attempts: 1 })
    expect(h.finish).not.toHaveBeenCalled(); expect(h.begin).not.toHaveBeenCalled(); expect(h.startContinuable).not.toHaveBeenCalled()
  })
  it('rejects an adopted image while preserving its file, revision and original execution history', async () => {
    const h = fixture({ lateImage: true })
    await h.service.generate({ id: 'parent' } as never, { taskId: 'task-1', projectId: 'project-1',
      chapterId: '03', workItemId: '03-06', kind: 'concept', required: true, prompt: '茶园研学' }, AbortSignal.timeout(1000))
    await h.service.adopt('project-1', 'asset-1', 12)
    const before = { ...h.visualAssets[0] }
    const childId = h.visualTasks[0]!.childId
    await h.service.reject('project-1', 'asset-1', '画面出现禁止的水上活动')
    expect(h.visualAssets[0]).toMatchObject({ ...before, status: 'rejected',
      quality: { accepted: false, score: 0, issues: ['画面出现禁止的水上活动'] } })
    expect(h.visualTasks[0]).toMatchObject({ status: 'failed', childId, blockedReason: '画面出现禁止的水上活动' })
    await expect(h.service.adopt('project-1', 'asset-1', 12)).rejects.toThrow('quality-approved')
    await expect(h.service.generate({ id: 'parent' } as never, { taskId: 'task-1', projectId: 'project-1',
      chapterId: '03', workItemId: '03-06', kind: 'concept', required: true, prompt: '茶园研学' }, AbortSignal.timeout(1000)))
      .rejects.toThrow('VISUAL_BRIEF_REJECTED')
    expect(h.visualAssets).toHaveLength(1)
    expect(h.visualAssets[0]?.status).toBe('rejected')
    expect(h.startContinuable).toHaveBeenCalledOnce()
  })
  it('keeps the original class route and execution identity when recovering a paid request after a config change', async () => {
    const classes = { begin: vi.fn(async () => ({ id: 'execution-original', selected: { provider: 'custom-provider', model: 'image-a' } })), attach: vi.fn(), finish: vi.fn() }
    const options = { agentClasses: classes as unknown as AgentClassService, waitUntilAborted: true, lateImage: false }
    const h = fixture(options)
    const task = { taskId: 'task-1', projectId: 'project-1', chapterId: '03', workItemId: '03-06', kind: 'concept' as const, required: true, prompt: '滨水公共文化空间概念表现图' }
    await expect(h.service.generate({ id: 'parent' } as never, task, AbortSignal.timeout(40), { preserveUncertain: true })).rejects.toMatchObject({ code: 'visual-recovery-required' })
    expect(h.startContinuable).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ agentOptions: { provider: 'custom-provider', model: 'image-a', maxTokens: 8192 } }) }))
    classes.begin.mockResolvedValue({ id: 'execution-new', selected: { provider: 'new-provider', model: 'image-b' } })
    options.lateImage = true
    const recovered = await h.service.generate({ id: 'parent' } as never, task, AbortSignal.timeout(1000), { recoveryOnly: true })
    expect(recovered).toMatchObject({ provider: 'custom-provider', model: 'image-a' })
    expect(h.startContinuable).toHaveBeenCalledTimes(1)
    expect(classes.begin).toHaveBeenCalledTimes(1)
    expect(classes.finish).toHaveBeenLastCalledWith('execution-original', 'completed', undefined)
  })
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
    const { service, visualTasks, startContinuable, interrupt } = fixture({ startError: new Error('model not found') })
    const task = {
      taskId: 'task-1', projectId: 'project-1', chapterId: '03', workItemId: '03-06',
      kind: 'concept' as const, required: true, prompt: '滨水公共文化空间概念表现图',
    }

    await expect(service.generate({ id: 'parent-1' } as never, task, AbortSignal.timeout(1000))).rejects.toEqual(
      expect.objectContaining<Partial<VisualAgentError>>({ code: 'visual-model-unavailable' }),
    )
    expect(startContinuable).toHaveBeenCalledOnce()
    expect(interrupt).not.toHaveBeenCalled()
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

  it('interrupts the accepted child when the caller deadline aborts image collection', async () => {
    const { service, visualTasks, visualAssets, startContinuable, interrupt } = fixture({ waitUntilAborted: true })
    const parent = { id: 'parent-1' }
    const task = {
      taskId: 'task-1', projectId: 'project-1', chapterId: '03', workItemId: '03-06',
      kind: 'concept' as const, required: true, prompt: '滨水公共文化空间概念表现图',
    }
    const controller = new AbortController()
    const generated = service.generate(parent as never, task, controller.signal)

    await vi.waitFor(() => expect(startContinuable).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(interrupt).not.toHaveBeenCalled())
    controller.abort(new Error('visual task deadline exceeded'))

    await expect(generated).rejects.toEqual(expect.objectContaining<Partial<VisualAgentError>>({
      code: 'visual-generation-failed',
    }))
    expect(interrupt).toHaveBeenCalledOnce()
    expect(interrupt).toHaveBeenCalledWith(expect.stringMatching(/^preplanning-visual-/u), {
      kind: 'ancestor', agent: parent,
    })
    expect(visualTasks[0]).toMatchObject({ status: 'blocked' })
    expect(visualAssets).toHaveLength(0)
  })

  it('supersedes a rejected candidate only with an adopted replacement for the same visual brief', async () => {
    const { service, visualTasks, visualAssets } = fixture()
    const task = {
      taskId: 'task-1', projectId: 'project-1', chapterId: '03', workItemId: '03-06',
      kind: 'concept' as const, required: true, prompt: '滨水公共文化空间概念表现图',
    }
    await service.generate({ id: 'parent-1' } as never, task, AbortSignal.timeout(1000))
    visualTasks.push({
      taskId: 'task-2', projectId: 'project-1', chapterId: '03', workItemId: '03-06',
      kind: 'concept', required: true, status: 'adopted', attempts: 1, updatedAt: '2026-08-28T08:35:00.000Z',
    })
    visualAssets.push({
      assetId: 'asset-2', taskId: 'task-2', projectId: 'project-1', kind: 'concept', required: true,
      status: 'adopted', mimeType: 'image/png', fileName: 'project-1/candidates/asset-2.png',
      sha256: 'b'.repeat(64), width: 1600, height: 900, createdAt: '2026-08-28T08:35:00.000Z',
      adoptedRevision: 12, quality: { accepted: true, score: 100, issues: [] },
    })

    await expect(service.replace('project-1', 'asset-1', 'asset-2')).resolves.toMatchObject({
      rejectedAssetId: 'asset-1', replacementAssetId: 'asset-2',
    })
    expect(visualAssets.find(asset => asset.assetId === 'asset-1')).toMatchObject({ status: 'rejected' })
    expect(visualTasks.find(row => row.taskId === 'task-1')).toMatchObject({
      required: false, status: 'failed', blockedReason: '已由采用资产 asset-2 替代',
    })
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
