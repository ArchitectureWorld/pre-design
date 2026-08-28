import { describe, expect, it } from 'vitest'
import { preplanningStatusDefinition } from '../src/client/status-definition.ts'

const status = {
  projectId: 'project-1', projectName: '验收项目', revision: 2, stage: '01-01',
  status: 'pending_review', pendingProposalCount: 1, openQuestionCount: 0,
}

const commandEvent = {
  type: 'command/done', seq: 7, time: 1_777_777,
  data: {
    commandId: 'command-1', kind: 'success',
    text: '已更新项目。\n前期策划状态：项目 "验收项目"（project-1），revision 2，阶段 01-01，待确认 1 项，开放问题 0 项。',
  },
}

const toolEvent = {
  type: 'tool/result', seq: 12, time: 1_888_888, surfaceOp: 'append',
  data: {
    turn: 1, step: 1,
    message: {
      id: 'message-1', role: 'user', source: { kind: 'tool', callId: 'call-1' },
      content: [{
        type: 'tool-result', toolCallId: 'call-1', isError: false,
        content: [{ type: 'text', text: JSON.stringify({ proposalId: 'proposal-1', preplanningStatus: status }) }],
      }],
    },
  },
}

function projectOnce(event: object) {
  const identity = preplanningStatusDefinition.match(event as never)
  if (identity === null) throw new Error('event did not match')
  const match = { ...identity, event, location: { kind: 'session' } } as never
  const state = preplanningStatusDefinition.start({} as never, match, {} as never)
  return preplanningStatusDefinition.buildViewNode?.({
    key: `preplanning-status:${identity.id}`,
    kind: preplanningStatusDefinition.kind,
    id: identity.id,
    state,
    start: match,
    matches: [match],
    current: new Map(),
  } as never)
}

describe('preplanning status conversation definition', () => {
  it('冷启动重放与分页重放从标准 command/done 事件得到相同节点', () => {
    const cold = projectOnce(commandEvent)
    const paged = projectOnce(commandEvent)
    expect(cold).toEqual(paged)
    expect(cold).toMatchObject({
      kind: 'preplanning-status', target: 'chat', anchorSeq: 7,
      data: { projectId: 'project-1', revision: 2, status: 'pending_review' },
    })
  })

  it('从标准 tool/result 事件恢复模型提交后的项目状态', () => {
    expect(projectOnce(toolEvent)).toMatchObject({
      kind: 'preplanning-status', target: 'chat', anchorSeq: 12,
      data: {
        projectId: 'project-1', revision: 2, status: 'pending_review', pendingProposalId: 'proposal-1',
      },
    })
  })
})
