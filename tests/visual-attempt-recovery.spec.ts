import { describe, expect, it, vi } from 'vitest'
import { encode } from 'jpeg-js'
import { PNG } from 'pngjs'
import { SessionImageCollector, type SessionEventLike } from '../src/visual/session-image-collector.ts'

const pixels = { width: 16, height: 12, data: Buffer.alloc(16 * 12 * 4, 180) }
const jpeg = encode(pixels, 80).data
const png = PNG.sync.write(Object.assign(new PNG({ width: 16, height: 12 }), { data: pixels.data }))
const uri = (data = jpeg, mime = 'jpeg') => `![scene](data:image/${mime};base64,${data.toString('base64')})`
const start = (seq = 1, turn = 1): SessionEventLike => ({ seq, type: 'turn/start', data: { turn } })
const end = (seq = 20, turn = 1, reason: unknown = { kind: 'error', error: { code: 'TRANSPORT' } }): SessionEventLike => ({ seq, type: 'turn/end', data: { turn, reason } })
const attempt = (seq = 13, turn = 1, text = uri()): SessionEventLike => ({ seq, type: 'assistant/attempt', data: { turn, step: 1,
  stream: [{ type: 'text-chunks', index: 0, time0: 1000, dt: [0, 1, 2], texts: [text.slice(0, 30), text.slice(30, 65), text.slice(65)] }] } })
function collector(events: readonly SessionEventLike[]) {
  return new SessionImageCollector({ sessions: { get: () => undefined }, readPersistedEvents: async () => events,
    attachments: { readImage: vi.fn() }, waitForEvent: vi.fn() })
}

describe('complete raster recovery from failed assistant streams', () => {
  it.each(['jpeg', 'png'])('recovers a fully decoded %s across text chunk boundaries in a terminal attempt', async mime => {
    const bytes = mime === 'jpeg' ? jpeg : png
    const result = await collector([start(), attempt(13, 1, uri(bytes, mime)), end()]).inspectExisting('child', 0)
    expect(result).toMatchObject({ completed: true, image: { mimeType: `image/${mime}`, width: 16, height: 12,
      attemptSource: { eventSeq: 13, turn: 1, step: 1 } } })
    expect(Buffer.from(result.image!.data)).toEqual(bytes)
  })
  it('identifies a valid image during retries without claiming that the child has completed', async () => {
    const result = await collector([start(), attempt()]).inspectExisting('child', 0)
    expect(result).toMatchObject({ completed: false, image: { width: 16, attemptSource: { eventSeq: 13 } } })
  })
  it.each(['truncated', 'header-only', 'corrupt-pixels', 'png-crc', 'oversized'])('does not rescue %s data even when image dimensions can be read', async kind => {
    let bytes = Buffer.from(jpeg), mime = 'jpeg'
    if (kind === 'truncated') bytes = bytes.subarray(0, bytes.length - 8)
    if (kind === 'header-only') bytes = Buffer.from([255,216,255,192,0,17,8,0,12,0,16,3,1,17,0,2,17,0,3,17,0,255,217])
    if (kind === 'corrupt-pixels') bytes = Buffer.concat([bytes.subarray(0, bytes.indexOf(Buffer.from([255,218])) + 2), Buffer.from([255,217])])
    if (kind === 'png-crc' || kind === 'oversized') { bytes = Buffer.from(png); mime = 'png'; if (kind === 'png-crc') bytes[bytes.indexOf(Buffer.from('IDAT')) + 4] ^= 1; else bytes.writeUInt32BE(100000, 16) }
    const result = await collector([start(), attempt(13, 1, uri(bytes, mime)), end()]).inspectExisting('child', 0)
    expect(result).toMatchObject({ completed: true, image: undefined })
  })
  it('skips a corrupt earlier attempt and finds a later complete image', async () => {
    const result = await collector([start(), attempt(13, 1, uri(jpeg.subarray(0, 60))), attempt(16), end()]).findExistingImage('child', 0)
    expect(result).toMatchObject({ width: 16, attemptSource: { eventSeq: 16 } })
  })
  it.each(['truncated', 'corrupt-header'])('does not let a %s final message hide the complete attempt image', async kind => {
    const bytes = kind === 'truncated' ? jpeg.subarray(0, jpeg.length - 8) : Buffer.from([0, 1, 2])
    const message = { seq: 19, type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: uri(bytes) }] } } }
    expect((await collector([start(), attempt(), message, end()]).inspectExisting('child', 0)).image).toMatchObject({ width: 16, attemptSource: { eventSeq: 13 } })
  })
  it('handles highly fragmented failed-stream text without overflowing the argument stack', async () => {
    const text = ' '.repeat(150000) + uri()
    const event = { seq: 13, type: 'assistant/attempt', data: { turn: 1, step: 1,
      stream: [{ type: 'text-chunks', index: 0, time0: 1, dt: [], texts: [...text] }] } }
    expect((await collector([start(), event, end()]).inspectExisting('child', 0)).image).toMatchObject({ width: 16 })
  })
  it('does not cross turn or cursor boundaries to reuse an old image', async () => {
    const events = [start(), attempt(), end(), start(21, 2), end(30, 2)]
    expect((await collector(events).inspectExisting('child', 0)).image).toBeUndefined()
    expect((await collector([start(), attempt(), end()]).inspectExisting('child', 14)).image).toBeUndefined()
    expect((await collector([start(), attempt(13, 2), end()]).inspectExisting('child', 0)).image).toBeUndefined()
  })
  it.each(['user', 'hook', 'disposed'])('does not rescue an attempt from an explicitly %s-cancelled turn', async kind => {
    expect((await collector([start(), attempt(), end(20, 1, { kind: 'aborted', reason: { kind } })]).inspectExisting('child', 0)).image).toBeUndefined()
  })
  it('honors current parent cancellation even for a complete stored image', async () => {
    const reason = new Error('cancelled by parent')
    await expect(collector([start(), attempt(), end()]).inspectExisting('child', 0, AbortSignal.abort(reason))).rejects.toBe(reason)
  })
  it('does not collect image-like text from reasoning or tool arguments', async () => {
    const event = { seq: 13, type: 'assistant/attempt', data: { turn: 1, step: 1, stream: [
      { type: 'reasoning-chunks', index: 0, time0: 1, dt: [0], texts: [uri()] },
      { type: 'tool-call-chunks', index: 1, time0: 1, dt: [0], args: [uri()] },
    ] } }
    expect((await collector([start(), event, end()]).inspectExisting('child', 0)).image).toBeUndefined()
  })
})
