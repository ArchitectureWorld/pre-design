import type { VisualImageData } from './types.ts'

const MARKDOWN_DATA_IMAGE = /data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=\r\n]+)/u

function jpegDimensions(data: Buffer): { width: number; height: number } {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) throw new Error('invalid JPEG image data')
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2
  while (offset + 8 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = data[offset + 1]
    offset += 2
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 1 >= data.length) break
    const length = data.readUInt16BE(offset)
    if (length < 2 || offset + length > data.length) break
    if (startOfFrame.has(marker)) {
      return { height: data.readUInt16BE(offset + 3), width: data.readUInt16BE(offset + 5) }
    }
    offset += length
  }
  throw new Error('JPEG dimensions not found')
}

function pngDimensions(data: Buffer): { width: number; height: number } {
  if (data.length < 24 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('invalid PNG image data')
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

function embeddedImage(text: string): VisualImageData | undefined {
  const match = MARKDOWN_DATA_IMAGE.exec(text)
  if (match === null) return undefined
  const mimeType = match[1] as 'image/jpeg' | 'image/png'
  const decoded = Buffer.from(match[2].replace(/[\r\n]/gu, ''), 'base64')
  const dimensions = mimeType === 'image/jpeg' ? jpegDimensions(decoded) : pngDimensions(decoded)
  return { mimeType, data: new Uint8Array(decoded), ...dimensions }
}

interface SessionEventLike {
  readonly seq: number
  readonly type: string
  readonly data: unknown
}

interface SessionLike {
  readonly seq: number
  readonly events: readonly SessionEventLike[]
}

export interface SessionImageCollectorDependencies {
  readonly sessions: { get(id: string): SessionLike | undefined }
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

  async waitUntilIdle(childId: string, signal: AbortSignal): Promise<void> {
    while (true) {
      if (signal.aborted) throw signal.reason
      const events = this.dependencies.sessions.get(childId)?.events ?? []
      const lastTurnStart = events.filter(event => event.type === 'turn/start').at(-1)?.seq ?? -1
      const lastTurnEnd = events.filter(event => event.type === 'turn/end').at(-1)?.seq ?? -1
      if (lastTurnEnd >= lastTurnStart && lastTurnEnd >= 0) return
      await this.dependencies.waitForEvent(childId, signal)
    }
  }

  async findExistingImage(
    childId: string,
    afterSeq: number,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<VisualImageData | undefined> {
    const session = this.dependencies.sessions.get(childId)
    const events = session?.events.filter(event => event.seq >= afterSeq) ?? []
    for (const event of events) {
      if (event.type !== 'assistant/message') continue
      const message = (event.data as { readonly message?: { readonly content?: readonly unknown[] } }).message
      for (const block of message?.content ?? []) {
        const image = block as { readonly type?: unknown; readonly attachment?: unknown; readonly text?: unknown }
        if (image.type === 'text' && typeof image.text === 'string') {
          const decoded = embeddedImage(image.text)
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
      const session = this.dependencies.sessions.get(childId)
      const events = session?.events.filter(event => event.seq >= afterSeq) ?? []
      const image = await this.findExistingImage(childId, afterSeq, signal)
      if (image !== undefined) return image
      if (events.some(event => event.type === 'turn/end')) {
        throw new Error(`visual child '${childId}' completed without an assistant image`)
      }
      await this.dependencies.waitForEvent(childId, signal)
    }
  }
}
