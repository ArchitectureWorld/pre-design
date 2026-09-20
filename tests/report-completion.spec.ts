import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { Session, KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { createAutomaticReportCompletion, createReportStatusPublisher } from '../src/session/report-completion.ts'
import { buildPreplanningStatus, formatPreplanningStatus, parsePreplanningStatus } from '../src/session/events.ts'
import { preplanningStatusDefinition } from '../src/client/status-definition.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
async function fixture() {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(CommandRuntime)
  const session = Session.create('report-status-test' as never)
  const context = { project: { projectId: 'p', name: '少潭河', currentRevision: 103, currentStage: '08-08' }, proposals: [], questions: [] }
  const agent = { ctx, id: session.id, session, followup: vi.fn(), whenIdle: async () => undefined }
  const generate = vi.fn(async () => undefined)
  const reportErrors = new Map<string, string>()
  const dependencies = { repository: { readContext: () => context }, reports: { generate }, reportErrors,
    governance: { readProject: () => ({ gateDecisions: [], visualAssets: [], visualTasks: [], siteBoundaries: [], reportPackages: [
      { packageId: 'conditional-103', status: 'generated_conditional', sourceRevision: 103, createdAt: 'a' },
    ] }) }, runtime: { snapshot: () => ({ runs: [], blocked: [], chapters: [{ chapterId: '08', completed: 8, total: 8 }] }) } }
  ctx.commands.register({ name: 'preplan-status', description: '状态', handler: () => ({ kind: 'success',
    text: formatPreplanningStatus(buildPreplanningStatus(context as never, dependencies as never)) }) })
  const publishStatus = createReportStatusPublisher({ commands: ctx.commands, repository: dependencies.repository as never, reportErrors })
  const complete = createAutomaticReportCompletion({ ...dependencies, publishStatus } as never)
  return { context, agent, generate, complete, session, reportErrors }
}
describe('automatic report session status', () => {
  it('writes the manuscript before planning visuals and rendering, and never exports when writing fails', async () => {
    const h = await fixture()
    const calls: string[] = []
    const prepareManuscript = vi.fn(async () => { calls.push('write') })
    const complete = createAutomaticReportCompletion({ repository: { readContext: () => h.context } as never,
      prepareManuscript, prepareVisuals: async () => { calls.push('visual') },
      reports: { generate: async () => { calls.push('export') } } as never, publishStatus: async () => undefined })
    await complete('p', new AbortController().signal, h.agent)
    expect(calls).toEqual(['write', 'visual', 'export'])
    calls.length = 0
    prepareManuscript.mockRejectedValueOnce(new Error('writing failed'))
    await expect(complete('p', new AbortController().signal, h.agent)).rejects.toThrow('writing failed')
    expect(calls).toEqual([])
  })
  it('uses native paired command records accepted by the persistence event catalog and replayed as a status card', async () => {
    const h = await fixture()
    await h.complete('p', new AbortController().signal, h.agent)
    const events = h.session.snapshotEvents()
    expect(events.map(row => row.type)).toEqual(['command/run', 'command/done'])
    expect(events.every(row => KNOWN_SESSION_EVENT_TYPES.has(row.type))).toBe(true)
    expect((events[0]!.data as any).commandId).toBe((events[1]!.data as any).commandId)
    const restored = Session.create(h.session.id, JSON.parse(JSON.stringify(events)), h.session.header)
    const event = restored.snapshotEvents().find(row => row.type === 'command/done')!
    expect(preplanningStatusDefinition.match(event as never)).not.toBeNull()
    expect(parsePreplanningStatus((event.data as any).text)?.reportPackage).toMatchObject({ deliveryMode: 'conditional', sourceRevision: 103 })
    expect(h.agent.followup).not.toHaveBeenCalled()
    expect(restored.deriveMessages()).toEqual([])
  })
  it('publishes a safe error even when generation fails before any staging record', async () => {
    const h = await fixture()
    h.generate.mockRejectedValue(new Error('source read failed'))
    await expect(h.complete('p', new AbortController().signal, h.agent)).rejects.toThrow('source read failed')
    const event = h.session.snapshotEvents().find(row => row.type === 'command/done')!
    const error = parsePreplanningStatus((event.data as any).text)?.reportError
    expect(error).toContain('报告生成失败')
    expect(error).not.toContain('source read failed')
  })
  it('does not publish a cancelled generation over a resumed one and clears an old error on success', async () => {
    const h = await fixture()
    const cancellation = new AbortController()
    h.generate.mockImplementationOnce(async () => { cancellation.abort(); throw new Error('cancelled') })
    await expect(h.complete('p', cancellation.signal, h.agent)).rejects.toThrow()
    expect(h.session.snapshotEvents()).toHaveLength(0)
    h.reportErrors.set('p', '旧错误')
    await h.complete('p', new AbortController().signal, h.agent)
    expect(h.reportErrors.has('p')).toBe(false)
  })
})
