import type { VisualImageData } from './types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { completeRaster } from './complete-raster.ts'
import { COMFYUI_IMAGE_TOOL } from '../agent-classes/image-tools.ts'

export interface SessionEventLike {
  readonly seq: number
  readonly type: string
  readonly data: unknown
}

interface SessionLike {
  readonly seq: number
  snapshotEvents(): readonly SessionEventLike[]
}

/** Structural subset of the SDK's public read handle; it cannot resume or write a session. */
interface PersistedVisualSessionHandle {
  readonly id: string
  readonly access: 'read' | 'write'
  read(offset?: number, length?: number, options?: { readonly signal?: AbortSignal }): Promise<{ readonly events: readonly SessionEventLike[] }>
  close(): Promise<void>
}
export interface VisualSessionPersistence {
  open(id: SessionId, access: 'read', options?: { readonly signal?: AbortSignal }): Promise<PersistedVisualSessionHandle>
}
export async function readPersistedVisualEvents(persistence: VisualSessionPersistence, childId: string, signal?: AbortSignal): Promise<readonly SessionEventLike[] | undefined> {
  signal?.throwIfAborted()
  let handle: PersistedVisualSessionHandle | undefined
  try {
    handle = await persistence.open(childId as SessionId, 'read', { signal })
    if (String(handle.id) !== childId) throw new Error('VISUAL_SESSION_IDENTITY_MISMATCH: persistence returned a different child')
    if (handle.access !== 'read') throw new Error('VISUAL_SESSION_READ_ONLY_REQUIRED')
    const result = await handle.read(0, undefined, { signal })
    signal?.throwIfAborted()
    return result.events
  } catch (error) {
    if (error instanceof Error && error.name === 'SessionPersistenceNotFoundError' && String((error as { sessionId?: unknown }).sessionId) === childId) return undefined
    throw error
  } finally { await handle?.close() }
}

const completed = (events: readonly SessionEventLike[]) => events.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')?.type === 'turn/end'
export interface ExistingVisualObservation { readonly image: VisualImageData | undefined; readonly completed: boolean; readonly turn?: number }

export interface SessionImageCollectorDependencies {
  readonly sessions: { get(id: string): SessionLike | undefined }
  readonly readPersistedEvents?: (id: string, signal: AbortSignal) => Promise<readonly SessionEventLike[] | undefined>
  readonly attachments: {
    readImage(ref: unknown, signal?: AbortSignal): Promise<{
      readonly ref: { readonly mediaType: string; readonly width: number; readonly height: number; readonly bytes: number }
      readonly data: Uint8Array
    }>
  }
  readonly waitForEvent: (childId: string, signal: AbortSignal) => Promise<void>
}

export class SessionImageCollector {
  constructor(private readonly dependencies: SessionImageCollectorDependencies) {}

  cursor(childId: string): number {
    return this.dependencies.sessions.get(childId)?.seq ?? 0
  }

  private async events(childId: string, signal: AbortSignal): Promise<readonly SessionEventLike[]> {
    signal.throwIfAborted()
    const live = this.dependencies.sessions.get(childId)
    if (live) return live.snapshotEvents()
    const stored = await this.dependencies.readPersistedEvents?.(childId, signal)
    signal.throwIfAborted()
    // A concurrent live restore is fresher than the cold read and must win.
    return this.dependencies.sessions.get(childId)?.snapshotEvents() ?? stored ?? []
  }

  /** Only an observed latest-turn terminal settles an unknown paid attempt. */
  async hasCompleted(childId: string, signal: AbortSignal = new AbortController().signal): Promise<boolean> {
    return completed(await this.events(childId, signal))
  }

  private async waitForChange(childId: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const recheck = new AbortController()
    const reason = new Error('visual child observation interval elapsed')
    // A terminal may publish between snapshot inspection and listener registration,
    // or the child may unload. Re-read the original session without dispatching work.
    const timer = setTimeout(() => recheck.abort(reason), 1000)
    try {
      await this.dependencies.waitForEvent(childId, AbortSignal.any([signal, recheck.signal]))
    } catch (error) {
      signal.throwIfAborted()
      if (error !== reason) throw error
    } finally {
      clearTimeout(timer)
      recheck.abort()
    }
  }

  async waitUntilIdle(childId: string, signal: AbortSignal): Promise<void> {
    while (true) {
      if (signal.aborted) throw signal.reason
      if (await this.hasCompleted(childId, signal)) return
      await this.waitForChange(childId, signal)
    }
  }

  async findExistingImage(
    childId: string,
    afterSeq: number,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<VisualImageData | undefined> {
    return (await this.inspectExisting(childId, afterSeq, signal)).image
  }

  /** One observation prevents a new image arriving between separate image and terminal reads from being lost. */
  async inspectExisting(childId: string, afterSeq: number, signal: AbortSignal = new AbortController().signal): Promise<ExistingVisualObservation> {
    const all = await this.events(childId, signal)
    const startIndex = all.findLastIndex(event => event.type === 'turn/start')
    const current = all.slice(Math.max(0, startIndex))
    const turn = (current[0]?.type === 'turn/start' ? current[0].data as { turn?: number } : undefined)?.turn
    const events = current.filter(event => event.seq >= afterSeq)
    const descriptor = all.find(event => event.type === 'subagent/descriptor')?.data as { version?: number; provider?: string; mode?: string; label?: string } | undefined
    const toolImage = descriptor?.version === 3 && descriptor.provider === 'spawn' && descriptor.mode === 'continuable'
      && descriptor.label?.startsWith('preplanning_visual_tool_task:')
    // Tool-backed children must have a correlated tool result AND finish their
    // turn. Reference/assistant images are not proof of a ComfyUI generation.
    const image = toolImage ? (completed(events) ? await this.image(this.toolImages(events), signal) : undefined)
      : await this.image(events, signal) ?? this.attemptImage(events, turn)
    signal.throwIfAborted()
    return { completed: completed(events), image, ...(typeof turn === 'number' ? { turn } : {}) }
  }

  private toolImages(events: readonly SessionEventLike[]): SessionEventLike[] {
    const calls = new Map<string, { turn: unknown; step: unknown }>()
    const images: SessionEventLike[] = []
    for (const event of events) {
      const data = event.data as { name?: string; callId?: string; turn?: unknown; step?: unknown; message?: { content?: unknown[] } } | undefined
      if (event.type === 'tool/call' && data?.name === COMFYUI_IMAGE_TOOL && typeof data.callId === 'string') calls.set(data.callId, { turn: data.turn, step: data.step })
      if (event.type !== 'tool/result' || !Array.isArray(data?.message?.content)) continue
      for (const value of data.message.content) {
        const block = value as { type?: string; toolCallId?: string; isError?: boolean; content?: unknown[] } | undefined
        const call = block?.toolCallId ? calls.get(block.toolCallId) : undefined
        if (block?.type !== 'tool-result' || block.isError || !call || call.turn !== data.turn || call.step !== data.step || !Array.isArray(block.content)) continue
        images.push({ ...event, type: 'assistant/message', data: { message: { content: block.content.filter(part => part && typeof part === 'object' && (part as { type?: unknown }).type === 'image') } } })
      }
    }
    return images
  }

  private attemptImage(events: readonly SessionEventLike[], turn: number | undefined): VisualImageData | undefined {
    if (!Number.isInteger(turn)) return undefined
    const terminal = events.findLast(event => event.type === 'turn/end')?.data as { turn?: number; reason?: { kind?: string; reason?: { kind?: string } } } | undefined
    if (terminal && terminal.turn !== turn) return undefined
    if (terminal?.reason?.kind === 'aborted' && terminal.reason.reason?.kind !== 'parent') return undefined
    const latestStep = (events.findLast(event => event.type === 'step/start')?.data as { step?: number } | undefined)?.step
    for (const event of events) {
      if (event.type !== 'assistant/attempt') continue
      const data = event.data as { turn?: number; step?: number; stream?: unknown[] }
      if (data.turn !== turn || !Number.isInteger(data.step) || data.step! < 1 || (latestStep !== undefined && data.step !== latestStep) || !Array.isArray(data.stream)) continue
      // Each text block is independent. Never join unrelated blocks, attempts, reasoning or tool arguments.
      const blocks = new Map<number, string[]>()
      let characters = 0, oversized = false
      for (const record of data.stream) {
        if (!record || typeof record !== 'object') continue
        const chunk = record as { type?: string; index?: number; texts?: unknown[] }
        if (chunk.type !== 'text-chunks' || !Number.isInteger(chunk.index) || !Array.isArray(chunk.texts) || !chunk.texts.every(text => typeof text === 'string')) continue
        const parts = blocks.get(chunk.index!) ?? []
        for (const text of chunk.texts as string[]) {
          characters += text.length
          if (characters > 48 * 1024 * 1024) { oversized = true; break }
          if (text.length) parts.push(text)
        }
        if (oversized) break
        blocks.set(chunk.index!, parts)
      }
      if (oversized) continue
      for (const parts of blocks.values()) {
        const image = completeRaster(parts.join(''))
        if (image) return { ...image, attemptSource: { eventSeq: event.seq, turn: turn!, step: data.step! } }
      }
    }
    return undefined
  }

  private async image(events: readonly SessionEventLike[], signal: AbortSignal): Promise<VisualImageData | undefined> {
    for (const event of events) {
      if (event.type !== 'assistant/message') continue
      const message = (event.data as { readonly message?: { readonly content?: readonly unknown[] } }).message
      for (const block of message?.content ?? []) {
        const image = block as { readonly type?: unknown; readonly attachment?: unknown; readonly text?: unknown }
        if (image.type === 'text' && typeof image.text === 'string') {
          const decoded = completeRaster(image.text)
          if (decoded !== undefined) return decoded
        }
        if (image.type !== 'image' || image.attachment === undefined) continue
        const attachmentId = (image.attachment as { readonly attachmentId?: unknown }).attachmentId
        const stored = await this.dependencies.attachments.readImage(image.attachment, signal)
        if (stored.ref.mediaType !== 'image/png' && stored.ref.mediaType !== 'image/jpeg' && stored.ref.mediaType !== 'image/webp') {
          throw new Error(`unsupported assistant image type: ${stored.ref.mediaType}`)
        }
        return {
          mimeType: stored.ref.mediaType,
          data: stored.data,
          width: stored.ref.width,
          height: stored.ref.height,
          ...(typeof attachmentId === 'string' ? { attachmentId } : {}),
        }
      }
    }
    return undefined
  }

  async waitForImage(childId: string, afterSeq: number, signal: AbortSignal): Promise<VisualImageData> {
    while (true) {
      if (signal.aborted) throw signal.reason
      const existing = await this.inspectExisting(childId, afterSeq, signal)
      if (existing.image !== undefined) return existing.image
      if (existing.completed) {
        throw new Error(`visual child '${childId}' completed without an assistant image`)
      }
      await this.waitForChange(childId, signal)
    }
  }
}
