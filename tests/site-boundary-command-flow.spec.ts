import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { ImageBlock } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import * as BoundaryCommands from '../src/commands/register.ts'

const { registerPreplanningCommands } = BoundaryCommands
const owner = { actorId: 'dsh-user:session-1', name: 'DSH 用户', role: 'decision_owner' as const }
const canonicalAcknowledgement = '该图是本项目采用的总平图或红线图，且图中明确表达项目边界'

function topLevelAgent(id = 'session-1') {
  return {
    id,
    session: { header: { version: 0, id, createdAt: 1, delegationDepth: 0 } },
  }
}

const imageBlock: ImageBlock = {
  type: 'image',
  attachment: {
    attachmentId: 'attachment-1' as ImageAttachmentRef['attachmentId'], mediaType: 'image/png', bytes: 68,
    width: 1, height: 1, name: 'redline.png', originalDimensions: { width: 1, height: 1 },
  },
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    repository: { readContext: vi.fn(() => ({ project: { projectId: 'project-1', name: '测试项目', currentRevision: 7 } })) },
    gateway: {}, governance: {}, runtime: {}, automation: {}, gates: {}, revisions: {}, coordinator: {}, visual: {}, reports: {}, registry: {},
    boundaries: {}, resolveBoundaryActor: vi.fn(() => owner), createId: () => 'project-1', now: () => '2026-08-30T12:00:00.000Z', ...overrides,
  }
}

describe('场地边界命令分流', () => {
  it('新附件只走附件登记、legacy 不可与附件混用，且坐标命令不记录完整输入', async () => {
    const definitions: CommandDefinition[] = []
    const registerImageAttachment = vi.fn(async () => ({ boundaryId: 'boundary-1' }))
    const registerLegacyAsset = vi.fn(async () => ({ boundaryId: 'boundary-2' }))
    const ctx = { commands: { register: (definition: CommandDefinition) => { definitions.push(definition); return () => undefined } } } as unknown as Context
    registerPreplanningCommands(ctx, dependencies({ boundaries: { registerImageAttachment, registerLegacyAsset } }) as never)
    const assetCommand = definitions.find(row => row.name === 'preplan-boundary-asset')
    const coordinateCommand = definitions.find(row => row.name === 'preplan-boundary-coordinates')
    const invocation = { agent: topLevelAgent() }

    expect(assetCommand?.input).toEqual({ hint: '<approved_site_plan|approved_redline> [assetId]', images: true })
    expect(assetCommand?.recordInput).toBe(false)
    expect(coordinateCommand?.recordInput).toBe(false)
    await expect(assetCommand?.handler({ ...invocation, rawInput: 'approved_redline', attachments: [imageBlock] } as never)).resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('待确认') })
    await expect(assetCommand?.handler({ ...invocation, rawInput: 'approved_redline legacy-asset', attachments: [imageBlock] } as never)).resolves.toMatchObject({ kind: 'error' })
    await expect(assetCommand?.handler({ ...invocation, rawInput: 'approved_redline legacy-asset', attachments: [] } as never)).resolves.toMatchObject({ kind: 'success' })
    expect(registerImageAttachment).toHaveBeenCalledWith('project-1', expect.objectContaining({ source: 'approved_redline', block: imageBlock, submittedRevision: 7 }), expect.objectContaining({ channel: 'dsh_human_command', actor: expect.objectContaining({ actorId: 'dsh-user:session-1', role: 'decision_owner' }) }))
    expect(registerLegacyAsset).toHaveBeenCalledWith('project-1', { source: 'approved_redline', assetId: 'legacy-asset', submittedRevision: 7 }, expect.objectContaining({ channel: 'dsh_human_command' }))
  })

  it('将稳定错误码连同中文处置提示返回，而不让模型或原始输入决定执行上下文', async () => {
    const definitions: CommandDefinition[] = []
    const ctx = { commands: { register: (definition: CommandDefinition) => { definitions.push(definition); return () => undefined } } } as unknown as Context
    registerPreplanningCommands(ctx, dependencies({
      boundaries: { registerImageAttachment: vi.fn(async () => { throw new Error('SITE_BOUNDARY_ATTACHMENT_COUNT_INVALID') }) },
    }) as never)
    const result = await definitions.find(row => row.name === 'preplan-boundary-asset')?.handler({
      agent: topLevelAgent(), rawInput: 'approved_redline', attachments: [imageBlock, imageBlock],
      origin: 'synthetic', channel: 'synthetic_fixture', actor: { role: 'agent' },
    } as never)
    expect(result).toMatchObject({ kind: 'error', text: expect.stringContaining('SITE_BOUNDARY_ATTACHMENT_COUNT_INVALID') })
    expect(result?.kind === 'error' ? result.text : '').toMatch(/[\u4e00-\u9fff]/u)
  })

  it('请求已取消时不调用附件服务，也不产生写入', async () => {
    const definitions: CommandDefinition[] = []
    const writes: unknown[] = []
    const registerImageAttachment = vi.fn(async () => { writes.push('asset'); return { boundaryId: 'boundary-1' } })
    const ctx = { commands: { register: (definition: CommandDefinition) => { definitions.push(definition); return () => undefined } } } as unknown as Context
    registerPreplanningCommands(ctx, dependencies({ boundaries: { registerImageAttachment } }) as never)
    const signal = AbortSignal.abort(new Error('cancelled'))

    await expect(definitions.find(row => row.name === 'preplan-boundary-asset')?.handler({
      agent: topLevelAgent(), rawInput: 'approved_redline', attachments: [imageBlock], signal,
    } as never)).resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('SITE_BOUNDARY_OPERATION_ABORTED') })
    expect(registerImageAttachment).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it('只将明确标记为顶层人工命令的完整 Host header 映射为单用户 decision_owner', () => {
    const resolver = (BoundaryCommands as unknown as {
      readonly resolveSingleUserBoundaryActor?: (invocation: unknown) => unknown
    }).resolveSingleUserBoundaryActor
    expect(resolver, '缺少 Host 顶层人工会话 actor resolver').toBeTypeOf('function')
    if (resolver === undefined) return

    expect(resolver({ agent: topLevelAgent() })).toEqual(owner)
  })

  it('接受 DSH 顶层 SessionHeader 的规范缺省 delegationDepth', () => {
    const resolver = (BoundaryCommands as unknown as {
      readonly resolveSingleUserBoundaryActor: (invocation: unknown) => unknown
    }).resolveSingleUserBoundaryActor

    expect(resolver({
      agent: {
        id: 'session-1',
        session: { header: { version: 0, id: 'session-1', createdAt: 1 } },
      },
    })).toEqual(owner)
  })

  it.each([
    ['缺失 header', { id: 'session-1' }],
    ['不完整 header', { id: 'session-1', session: { header: { id: 'session-1' } } }],
    ['automation origin', { id: 'session-1', session: { header: { version: 0, id: 'session-1', createdAt: 1, origin: 'automation', delegationDepth: 0 } } }],
    ['未知 origin', { id: 'session-1', session: { header: { version: 0, id: 'session-1', createdAt: 1, origin: 'unknown', delegationDepth: 0 } } }],
    ['存在 parentSession', { ...topLevelAgent(), session: { header: { ...topLevelAgent().session.header, parentSession: 'parent-1' } } }],
    ['subagent origin', { ...topLevelAgent(), session: { header: { ...topLevelAgent().session.header, origin: 'subagent', delegationDepth: 1 } } }],
    ['缺失 header.id 且 agent.id 为 undefined 字符串', { id: 'undefined', session: { header: { version: 0, createdAt: 1, delegationDepth: 0 } } }],
    ['header.id 为 null 且 agent.id 为 null 字符串', { id: 'null', session: { header: { version: 0, id: null, createdAt: 1, delegationDepth: 0 } } }],
    ['header.id 为数字且 agent.id 为同值字符串', { id: '7', session: { header: { version: 0, id: 7, createdAt: 1, delegationDepth: 0 } } }],
    ['header.id 与 agent.id 均为空字符串', { id: '', session: { header: { version: 0, id: '', createdAt: 1, delegationDepth: 0 } } }],
    ['header.id 与 agent.id 均为空白字符串', { id: '   ', session: { header: { version: 0, id: '   ', createdAt: 1, delegationDepth: 0 } } }],
    ['agent.id 为数字且 header.id 为同值字符串', { id: 7, session: { header: { version: 0, id: '7', createdAt: 1, delegationDepth: 0 } } }],
  ])('%s 一律拒绝且登记/确认服务零调用', async (_label, agent) => {
    const resolver = (BoundaryCommands as unknown as {
      readonly resolveSingleUserBoundaryActor: (invocation: unknown) => unknown
    }).resolveSingleUserBoundaryActor
    const definitions: CommandDefinition[] = []
    const registerImageAttachment = vi.fn(async () => ({ boundaryId: 'boundary-1' }))
    const confirm = vi.fn(async () => ({ boundaryId: 'boundary-1' }))
    const ctx = { commands: { register: (definition: CommandDefinition) => { definitions.push(definition); return () => undefined } } } as unknown as Context
    registerPreplanningCommands(ctx, dependencies({ boundaries: { registerImageAttachment, confirm }, resolveBoundaryActor: resolver }) as never)
    const assetResult = await definitions.find(row => row.name === 'preplan-boundary-asset')?.handler({
      agent, rawInput: 'approved_redline', attachments: [imageBlock],
    } as never)
    const confirmResult = await definitions.find(row => row.name === 'preplan-boundary-confirm')?.handler({
      agent, rawInput: `boundary-1 7 ${'a'.repeat(64)} ${canonicalAcknowledgement}`,
    } as never)

    expect.soft(resolver({ agent })).toBeUndefined()
    expect.soft(assetResult).toMatchObject({ kind: 'error', text: expect.stringContaining('SITE_BOUNDARY_PERMISSION_DENIED') })
    expect.soft(confirmResult).toMatchObject({ kind: 'error', text: expect.stringContaining('SITE_BOUNDARY_PERMISSION_DENIED') })
    expect(registerImageAttachment).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('确认命令要求用户显式提交绑定 boundary/revision/content SHA 的规范声明', async () => {
    const definitions: CommandDefinition[] = []
    const confirm = vi.fn(async () => ({ boundaryId: 'boundary-1' }))
    const ctx = { commands: { register: (definition: CommandDefinition) => { definitions.push(definition); return () => undefined } } } as unknown as Context
    registerPreplanningCommands(ctx, dependencies({ boundaries: { confirm } }) as never)
    const command = definitions.find(row => row.name === 'preplan-boundary-confirm')
    const digest = 'a'.repeat(64)

    await expect(command?.handler({ agent: topLevelAgent(), rawInput: 'boundary-1' } as never))
      .resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('SITE_BOUNDARY_CONFIRMATION_ACKNOWLEDGEMENT_REQUIRED') })
    await expect(command?.handler({ agent: topLevelAgent(), rawInput: `boundary-1 7 ${digest} 我确认边界` } as never))
      .resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('SITE_BOUNDARY_CONFIRMATION_ACKNOWLEDGEMENT_REQUIRED') })
    expect(confirm).not.toHaveBeenCalled()

    await expect(command?.handler({
      agent: topLevelAgent(), rawInput: `boundary-1 7 ${digest} ${canonicalAcknowledgement}`,
    } as never)).resolves.toMatchObject({ kind: 'success' })
    expect(confirm).toHaveBeenCalledWith('project-1', 'boundary-1', 7, {
      boundaryId: 'boundary-1', submittedRevision: 7, contentSha256: digest, statement: canonicalAcknowledgement,
    }, expect.objectContaining({ actor: owner, channel: 'dsh_human_command' }))
  })

  it.each([
    ['image + 非 image block', 'approved_redline', [imageBlock, { type: 'text', text: 'ambiguous' }]],
    ['仅非 image block', 'approved_redline', [{ type: 'file', fileName: 'boundary.txt' }]],
    ['legacy + 非 image block', 'approved_redline legacy-asset', [{ type: 'text', text: 'ambiguous' }]],
  ])('%s 按原始 attachments 总数拒绝且不调用任何登记端口', async (_label, rawInput, attachments) => {
    const definitions: CommandDefinition[] = []
    const registerImageAttachment = vi.fn()
    const registerLegacyAsset = vi.fn()
    const ctx = { commands: { register: (definition: CommandDefinition) => { definitions.push(definition); return () => undefined } } } as unknown as Context
    registerPreplanningCommands(ctx, dependencies({ boundaries: { registerImageAttachment, registerLegacyAsset } }) as never)

    await expect(definitions.find(row => row.name === 'preplan-boundary-asset')?.handler({
      agent: topLevelAgent(), rawInput, attachments,
    } as never)).resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('SITE_BOUNDARY_ATTACHMENT_COUNT_INVALID') })
    expect(registerImageAttachment).not.toHaveBeenCalled()
    expect(registerLegacyAsset).not.toHaveBeenCalled()
  })
})
