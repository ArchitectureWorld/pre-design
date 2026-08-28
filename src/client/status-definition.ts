import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { normalizePreplanningStatus, parsePreplanningStatus, type PreplanningStatusEventData } from '../session/events.ts'

export interface PreplanningStatusNodeData extends PreplanningStatusEventData {
  readonly time: number
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'preplanning-status': PreplanningStatusNodeData
  }
}

interface PreplanningStatusState {
  readonly data: PreplanningStatusEventData
  readonly seq: number
  readonly time: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function statusFromEvent(event: { readonly type: string; readonly data: unknown }): PreplanningStatusEventData | undefined {
  if (!isRecord(event.data)) return undefined
  if (event.type === 'command/done') {
    return event.data.kind === 'success' && typeof event.data.text === 'string'
      ? parsePreplanningStatus(event.data.text)
      : undefined
  }
  if (event.type !== 'tool/result' || !isRecord(event.data.message)) return undefined
  const root = Array.isArray(event.data.message.content) ? event.data.message.content[0] : undefined
  if (!isRecord(root) || root.type !== 'tool-result' || !Array.isArray(root.content)) return undefined
  for (const block of root.content) {
    if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') continue
    try {
      const value = JSON.parse(block.text) as unknown
      const record = isRecord(value) ? value : undefined
      const status = record === undefined ? undefined : normalizePreplanningStatus(record.preplanningStatus)
      if (status !== undefined) {
        return typeof record?.proposalId === 'string'
          ? { ...status, pendingProposalId: record.proposalId }
          : status
      }
    } catch {
      continue
    }
  }
  return undefined
}

export const preplanningStatusDefinition: ConversationNodeDefinition<PreplanningStatusState> = {
  kind: 'preplanning-status',
  target: 'chat',
  match: event => {
    const status = statusFromEvent(event)
    return status === undefined ? null : { id: `${status.projectId}:${event.seq}`, role: 'start' }
  },
  start: (_context, match) => {
    const status = statusFromEvent(match.event)
    if (status === undefined) throw new Error('preplanning-status requires a supported status carrier')
    return { data: status, seq: match.event.seq, time: match.event.time }
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined ? null : ({
    key: context.key,
    kind: 'preplanning-status',
    id: context.id,
    target: 'chat',
    anchorSeq: context.state.seq,
    location: context.start?.location ?? { kind: 'unresolved' },
    visibility: 'visible',
    data: { ...context.state.data, time: context.state.time },
  }),
}
