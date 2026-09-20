import { describe, expect, it, vi } from 'vitest'
import { readPersistedVisualEvents, SessionImageCollector } from '../src/visual/session-image-collector.ts'
import { encode } from 'jpeg-js'

interface TestEvent {
  readonly seq: number
  readonly type: string
  readonly data: unknown
}

function testSession(events: TestEvent[], seq = events.length) {
  return {
    seq,
    snapshotEvents: () => events,
  }
}

describe('SessionImageCollector', () => {
  it.each(['image', 'no-image', 'idle'] as const)('settles %s after a missed child notification without waiting for the generation deadline', async kind => {
    vi.useFakeTimers()
    const parent = new AbortController()
    const events: TestEvent[] = [{ seq: 1, type: 'turn/start', data: {} }]
    let subscriptions = 0
    let outcome: { value?: unknown; error?: Error } | undefined
    const collector = new SessionImageCollector({
      sessions: { get: () => undefined },
      readPersistedEvents: async () => [...events],
      attachments: { readImage: async () => ({ ref: { mediaType: 'image/png', width: 1600, height: 900, bytes: 3 }, data: new Uint8Array([1, 2, 3]) }) },
      waitForEvent: (_childId, signal) => new Promise((_resolve, reject) => {
        // The child publishes between reading the snapshot and subscribing; there is no next event.
        if (kind === 'image') events.push({ seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'image', attachment: {} }] } } })
        events.push({ seq: 3, type: 'turn/end', data: {} })
        subscriptions += 1
        signal.addEventListener('abort', () => { subscriptions -= 1; reject(signal.reason) }, { once: true })
      }),
    })
    const pending = (kind === 'idle' ? collector.waitUntilIdle('child', parent.signal) : collector.waitForImage('child', 0, parent.signal))
      .then(value => { outcome = { value } }, error => { outcome = { error } })
    try {
      await vi.advanceTimersByTimeAsync(2000)
      expect(outcome).toBeDefined()
      if (kind === 'image') expect(outcome?.value).toMatchObject({ mimeType: 'image/png', width: 1600 })
      if (kind === 'no-image') expect(outcome?.error?.message).toContain('completed without an assistant image')
      if (kind === 'idle') expect(outcome).toEqual({ value: undefined })
      expect(subscriptions).toBe(0)
    } finally { parent.abort(new Error('test cleanup')); await pending; vi.useRealTimers() }
  })
  it('propagates an event subscription failure instead of treating it as a periodic recheck', async () => {
    const failure = new Error('event subscription unavailable')
    const collector = new SessionImageCollector({ sessions: { get: () => testSession([]) }, attachments: { readImage: vi.fn() },
      waitForEvent: async () => { throw failure } })
    await expect(collector.waitForImage('child', 0, new AbortController().signal)).rejects.toBe(failure)
  })
  it('cancels the pending child subscription promptly with the parent reason', async () => {
    const parent = new AbortController(), reason = new Error('parent cancelled')
    let subscribed = false, detached = false
    const collector = new SessionImageCollector({ sessions: { get: () => testSession([]) }, attachments: { readImage: vi.fn() },
      waitForEvent: (_childId, signal) => new Promise((_resolve, reject) => {
        subscribed = true
        signal.addEventListener('abort', () => { detached = true; reject(signal.reason) }, { once: true })
        parent.abort(reason)
      }) })
    await expect(collector.waitForImage('child', 0, parent.signal)).rejects.toBe(reason)
    expect(subscribed).toBe(true); expect(detached).toBe(true)
  })
  const ended = [
    { seq: 4, type: 'turn/start', data: { turn: 1 } },
    { seq: 28, type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'working' }] } } },
    { seq: 30, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'parent' } } } },
  ]
  it('observes the durable latest terminal after the child is absent from the memory store', async () => {
    const load = vi.fn(async () => ended), wait = vi.fn()
    const collector = new SessionImageCollector({ sessions: { get: () => undefined }, readPersistedEvents: load,
      attachments: { readImage: vi.fn() }, waitForEvent: wait })
    await expect(collector.inspectExisting('unloaded-child', 0)).resolves.toMatchObject({ completed: true, image: undefined })
    await expect(collector.hasCompleted('unloaded-child')).resolves.toBe(true)
    await expect(collector.waitForImage('unloaded-child', 0, AbortSignal.timeout(1000))).rejects.toThrow('completed without an assistant image')
    expect(load).toHaveBeenCalledWith('unloaded-child', expect.any(AbortSignal))
    expect(wait).not.toHaveBeenCalled()
  })
  it('recovers a durable late image and terminal from one cold observation', async () => {
    const events = [...ended.slice(0, 2), { seq: 29, type: 'assistant/message', data: { message: { content: [{ type: 'image', attachment: { attachmentId: 'late' } }] } } }, ended[2]!]
    const load = vi.fn(async () => events), readImage = vi.fn(async () => ({ ref: { mediaType: 'image/png', width: 1600, height: 900, bytes: 3 }, data: new Uint8Array([1, 2, 3]) }))
    const collector = new SessionImageCollector({ sessions: { get: () => undefined }, readPersistedEvents: load, attachments: { readImage }, waitForEvent: vi.fn() })
    await expect(collector.inspectExisting('unloaded-child', 0)).resolves.toMatchObject({ completed: true, image: { attachmentId: 'late' } })
    expect(load).toHaveBeenCalledOnce()
  })
  it('prefers a live newer turn and does not use an older persisted terminal', async () => {
    const load = vi.fn(async () => ended)
    const collector = new SessionImageCollector({ sessions: { get: () => testSession([...ended, { seq: 31, type: 'turn/start', data: { turn: 2 } }]) },
      readPersistedEvents: load, attachments: { readImage: vi.fn() }, waitForEvent: vi.fn() })
    await expect(collector.hasCompleted('child')).resolves.toBe(false)
    expect(load).not.toHaveBeenCalled()
  })
  it('does not cache an incomplete cold log across recovery checks', async () => {
    const load = vi.fn().mockResolvedValueOnce(ended.slice(0, 2)).mockResolvedValueOnce(ended)
    const collector = new SessionImageCollector({ sessions: { get: () => undefined }, readPersistedEvents: load, attachments: { readImage: vi.fn() }, waitForEvent: vi.fn() })
    await expect(collector.hasCompleted('child')).resolves.toBe(false)
    await expect(collector.hasCompleted('child')).resolves.toBe(true)
  })
  it('reads an existing SDK handle with read-only access and closes it even when reading fails', async () => {
    const signal = new AbortController().signal, close = vi.fn(async () => {}), read = vi.fn(async () => ({ events: ended }))
    const open = vi.fn(async () => ({ id: 'child', access: 'read' as const, read, close }))
    await expect(readPersistedVisualEvents({ open }, 'child', signal)).resolves.toEqual(ended)
    expect(open).toHaveBeenCalledWith('child', 'read', { signal })
    expect(read).toHaveBeenCalledWith(0, undefined, { signal })
    expect(close).toHaveBeenCalledOnce()
    read.mockRejectedValueOnce(new Error('persisted log cannot be validated'))
    await expect(readPersistedVisualEvents({ open }, 'child', signal)).rejects.toThrow('cannot be validated')
    expect(close).toHaveBeenCalledTimes(2)
  })
  it('keeps absent logs unknown and refuses a handle for a different session', async () => {
    const absent = Object.assign(new Error('missing'), { name: 'SessionPersistenceNotFoundError', sessionId: 'child' })
    await expect(readPersistedVisualEvents({ open: vi.fn(async () => { throw absent }) }, 'child')).resolves.toBeUndefined()
    const close = vi.fn(async () => {}), read = vi.fn()
    await expect(readPersistedVisualEvents({ open: vi.fn(async () => ({ id: 'another-child', access: 'read' as const, read, close })) }, 'child')).rejects.toThrow('SESSION_IDENTITY_MISMATCH')
    expect(read).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce()
  })
  it('waits for the latest turn instead of failing on an earlier turn end during recovery', async () => {
    const events: any[] = [{ seq: 1, type: 'turn/start', data: {} }, { seq: 2, type: 'turn/end', data: {} }, { seq: 3, type: 'turn/start', data: {} }]
    const collector = new SessionImageCollector({
      sessions: { get: () => ({ seq: 3, snapshotEvents: () => events }) },
      attachments: { readImage: async () => ({ ref: { mediaType: 'image/png', width: 1, height: 1, bytes: 1 }, data: new Uint8Array([1]) }) },
      waitForEvent: async () => { events.push({ seq: 4, type: 'assistant/message', data: { message: { content: [{ type: 'image', attachment: {} }] } } }) },
    })
    await expect(collector.waitForImage('child', 0, AbortSignal.timeout(1000))).resolves.toMatchObject({ mimeType: 'image/png' })
  })
  it('waits for the child initialization turn to end before accepting a visual followup', async () => {
    const events: TestEvent[] = []
    const childSession = testSession(events, 1)
    const waitForEvent = vi.fn(async () => {
      events.push({ seq: 2, type: 'turn/end', data: {} })
    })
    const collector = new SessionImageCollector({
      sessions: { get: vi.fn(() => childSession) } as never,
      attachments: { readImage: vi.fn() } as never,
      waitForEvent,
    })

    await collector.waitUntilIdle('child-1', AbortSignal.timeout(1000))

    expect(waitForEvent).toHaveBeenCalledOnce()
  })

  it('collects only an assistant image from the requested child session', async () => {
    const readImage = vi.fn(async () => ({
      ref: { mediaType: 'image/png', width: 1600, height: 900, bytes: 3 },
      data: new Uint8Array([1, 2, 3]),
    }))
    const childSession = testSession([{
      seq: 3,
      type: 'assistant/message',
      data: {
        message: {
          role: 'assistant',
          content: [{ type: 'image', attachment: { attachmentId: 'attachment-1', mediaType: 'image/png' } }],
        },
      },
    }], 4)
    const collector = new SessionImageCollector({
      sessions: { get: vi.fn((id: string) => id === 'child-1' ? childSession : undefined) } as never,
      attachments: { readImage } as never,
      waitForEvent: vi.fn(async () => undefined),
    })

    const image = await collector.waitForImage('child-1', 0, AbortSignal.timeout(1000))

    expect(image).toEqual({
      mimeType: 'image/png', data: new Uint8Array([1, 2, 3]), width: 1600, height: 900,
      attachmentId: 'attachment-1',
    })
    expect(readImage).toHaveBeenCalledOnce()
  })

  it('decodes the first Markdown data URI image returned by the Gemini chat-completions route', async () => {
    const jpeg = new Uint8Array(encode({ width: 16, height: 12, data: Buffer.alloc(16 * 12 * 4, 180) }).data)
    const dataUri = `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`
    const childSession = testSession([{
      seq: 3,
      type: 'assistant/message',
      data: {
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: `![image](${dataUri})\n![image](${dataUri})` }],
        },
      },
    }, { seq: 4, type: 'turn/end', data: {} }], 5)
    const collector = new SessionImageCollector({
      sessions: { get: vi.fn(() => childSession) } as never,
      attachments: { readImage: vi.fn() } as never,
      waitForEvent: vi.fn(async () => undefined),
    })

    await expect(collector.waitForImage('child-1', 2, AbortSignal.timeout(1000))).resolves.toEqual({
      mimeType: 'image/jpeg', data: jpeg, width: 16, height: 12,
    })
  })

  it('finds a late image already persisted in the isolated task child without waiting for another event', async () => {
    const jpeg = new Uint8Array(encode({ width: 16, height: 12, data: Buffer.alloc(16 * 12 * 4, 180) }).data)
    const childSession = testSession([{
      seq: 37,
      type: 'assistant/message',
      data: {
        message: {
          role: 'assistant',
          content: [{
            type: 'text',
            text: `![generated](data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')})`,
          }],
        },
      },
    }, { seq: 39, type: 'turn/end', data: {} }], 39)
    const waitForEvent = vi.fn(async () => {
      throw new Error('late image recovery must not wait for a new event')
    })
    const collector = new SessionImageCollector({
      sessions: { get: vi.fn(() => childSession) } as never,
      attachments: { readImage: vi.fn() } as never,
      waitForEvent,
    })

    await expect(collector.findExistingImage('child-1', 0)).resolves.toEqual({
      mimeType: 'image/jpeg', data: jpeg, width: 16, height: 12,
    })
    expect(waitForEvent).not.toHaveBeenCalled()
  })
})
