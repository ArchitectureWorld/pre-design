import { decode } from 'jpeg-js'
import { PNG } from 'pngjs'
import type { VisualImageData } from './types.ts'

const MAX_BYTES = 32 * 1024 * 1024
const MAX_PIXELS = 32 * 1024 * 1024

/** Failed streams are uncommitted output: dimensions alone do not prove intact pixels. */
export function completeRaster(text: string): VisualImageData | undefined {
  for (const match of text.matchAll(/data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=\r\n]+)/gu)) {
    const encoded = match[2]!.replace(/[\r\n]/gu, '')
    if (encoded.length > Math.ceil(MAX_BYTES / 3) * 4 || encoded.length % 4 !== 0) continue
    try {
      const data = Buffer.from(encoded, 'base64')
      if (data.toString('base64') !== encoded) continue
      const mimeType = match[1] as 'image/jpeg' | 'image/png'
      let width: number, height: number
      if (mimeType === 'image/jpeg') {
        if (data.length < 4 || data.readUInt16BE(0) !== 0xffd8 || data.readUInt16BE(data.length - 2) !== 0xffd9) continue
        const decoded = decode(data, { tolerantDecoding: false, useTArray: true, maxResolutionInMP: 32, maxMemoryUsageInMB: 256 })
        width = decoded.width; height = decoded.height
        if (decoded.data.length !== width * height * 4) continue
      } else {
        if (data.length < 45 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          || data.toString('ascii', 12, 16) !== 'IHDR' || data.readUInt32BE(data.length - 12) !== 0
          || data.toString('ascii', data.length - 8, data.length - 4) !== 'IEND') continue
        width = data.readUInt32BE(16); height = data.readUInt32BE(20)
        if (width < 1 || height < 1 || width * height > MAX_PIXELS) continue
        const decoded = PNG.sync.read(data, { checkCRC: true })
        if (decoded.width !== width || decoded.height !== height || decoded.data.length !== width * height * 4) continue
      }
      if (width < 1 || height < 1 || width * height > MAX_PIXELS) continue
      return { mimeType, data: new Uint8Array(data), width, height }
    } catch { /* A truncated or corrupt candidate must not hide a later intact image. */ }
  }
  return undefined
}
