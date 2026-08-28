import { describe, expect, it, vi } from 'vitest'
import { SessionImageCollector } from '../src/visual/session-image-collector.ts'

describe('SessionImageCollector', () => {
  it('waits for the child initialization turn to end before accepting a visual followup', async () => {
    const childSession = { seq: 1, events: [] as Array<{ seq: number; type: string; data: unknown }> }
    const waitForEvent = vi.fn(async () => {
      childSession.seq = 2
      childSession.events.push({ seq: 2, type: 'turn/end', data: {} })
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
    const childSession = {
      seq: 4,
      events: [{
        seq: 3,
        type: 'assistant/message',
        data: {
          message: {
            role: 'assistant',
            content: [{ type: 'image', attachment: { attachmentId: 'attachment-1', mediaType: 'image/png' } }],
          },
        },
      }],
    }
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
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x84, 0x06, 0x40,
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
      0xff, 0xd9,
    ])
    const dataUri = `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`
    const childSession = {
      seq: 5,
      events: [{
        seq: 3,
        type: 'assistant/message',
        data: {
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: `![image](${dataUri})\n![image](${dataUri})` }],
          },
        },
      }, { seq: 4, type: 'turn/end', data: {} }],
    }
    const collector = new SessionImageCollector({
      sessions: { get: vi.fn(() => childSession) } as never,
      attachments: { readImage: vi.fn() } as never,
      waitForEvent: vi.fn(async () => undefined),
    })

    await expect(collector.waitForImage('child-1', 2, AbortSignal.timeout(1000))).resolves.toEqual({
      mimeType: 'image/jpeg', data: jpeg, width: 1600, height: 900,
    })
  })

  it('finds a late image already persisted in the isolated task child without waiting for another event', async () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x84, 0x06, 0x40,
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
      0xff, 0xd9,
    ])
    const childSession = {
      seq: 39,
      events: [{
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
      }, { seq: 39, type: 'turn/end', data: {} }],
    }
    const waitForEvent = vi.fn(async () => {
      throw new Error('late image recovery must not wait for a new event')
    })
    const collector = new SessionImageCollector({
      sessions: { get: vi.fn(() => childSession) } as never,
      attachments: { readImage: vi.fn() } as never,
      waitForEvent,
    })

    await expect(collector.findExistingImage('child-1', 0)).resolves.toEqual({
      mimeType: 'image/jpeg', data: jpeg, width: 1600, height: 900,
    })
    expect(waitForEvent).not.toHaveBeenCalled()
  })
})
