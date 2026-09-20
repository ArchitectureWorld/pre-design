import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { verifiedRasterImageDimensions } from '../governance/site-boundary-asset-store.ts'

export interface ReportRasterInput {
  readonly bytes: Uint8Array
  readonly mimeType: 'image/png' | 'image/jpeg'
  readonly signal?: AbortSignal
}
export interface ReportRasterResult {
  readonly bytes: Uint8Array
  readonly mimeType: 'image/png' | 'image/jpeg'
  readonly width: number
  readonly height: number
  readonly sourceSha256: string
  readonly normalized: boolean
}

const MAX_SOURCE_BYTES = 32 * 1024 * 1024
const MAX_SOURCE_PIXELS = 64_000_000
const MAX_SOURCE_EDGE = 8192
const MAX_OUTPUT_PIXELS = 4 * 1024 * 1024
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const JPEG_QUALITIES = [90, 80, 65] as const

/** Complete, aspect-preserving report raster; originals and all filesystem state stay untouched.
 * sourceSha256 identifies the input snapshot, never the encoded derivative. Alpha stays in PNG. */
export async function normalizeReportRaster(input: ReportRasterInput): Promise<ReportRasterResult> {
  input.signal?.throwIfAborted()
  if (input.bytes.byteLength > MAX_SOURCE_BYTES) throw new Error('REPORT_RASTER_SOURCE_LIMIT')
  if (!['image/png', 'image/jpeg'].includes(input.mimeType)) throw new Error('REPORT_RASTER_INVALID')
  // Native operations are asynchronous: retain a stable source even if a caller reuses its buffer.
  const source = Buffer.from(input.bytes), sourceSha256 = createHash('sha256').update(source).digest('hex')
  let containerEnd = source.length
  if (input.mimeType === 'image/jpeg') while (containerEnd > 2 && source[containerEnd - 1] === 0) containerEnd--
  let dimensions: { width: number; height: number }
  try { dimensions = verifiedRasterImageDimensions(input.mimeType, source.subarray(0, containerEnd)) }
  catch { throw new Error('REPORT_RASTER_INVALID') }
  if (dimensions.width > MAX_SOURCE_EDGE || dimensions.height > MAX_SOURCE_EDGE
    || dimensions.width * dimensions.height > MAX_SOURCE_PIXELS) throw new Error('REPORT_RASTER_SOURCE_LIMIT')
  try {
    const pipeline = sharp(source, { failOn: 'warning', limitInputPixels: MAX_SOURCE_PIXELS }).timeout({ seconds: 30 })
    const metadata = await pipeline.metadata()
    input.signal?.throwIfAborted()
    if (metadata.format !== (input.mimeType === 'image/png' ? 'png' : 'jpeg')
      || metadata.width !== dimensions.width || metadata.height !== dimensions.height || (metadata.pages ?? 1) > 1) {
      throw new Error('REPORT_RASTER_INVALID')
    }
    const orientation = metadata.orientation ?? 1
    const normalized = dimensions.width * dimensions.height > MAX_OUTPUT_PIXELS
      || containerEnd > MAX_OUTPUT_BYTES || orientation !== 1
    if (!normalized) {
      // Header inspection alone cannot certify a pass-through stream's actual pixels.
      await pipeline.raw().toBuffer()
      input.signal?.throwIfAborted()
      // Keep the encoded pixels intact, but use the same complete container
      // validated above. Native attachment ingestion rejects trailing padding.
      return { bytes: source.subarray(0, containerEnd), mimeType: input.mimeType, ...dimensions, sourceSha256, normalized: containerEnd !== source.length }
    }
    const rotated = orientation >= 5 && orientation <= 8
    const width = rotated ? dimensions.height : dimensions.width, height = rotated ? dimensions.width : dimensions.height
    const targetWidth = Math.max(1, Math.min(width, Math.floor(Math.sqrt(MAX_OUTPUT_PIXELS * width / height))))
    const targetHeight = Math.max(1, Math.min(height, Math.floor(Math.sqrt(MAX_OUTPUT_PIXELS * height / width))))
    const prepared = pipeline.rotate().toColourspace('srgb').resize({
      width: targetWidth, height: targetHeight, fit: 'inside', withoutEnlargement: true,
    })
    // Keep transparency losslessly. High-entropy transparent images may be refused by the byte cap.
    const mimeType = metadata.hasAlpha ? 'image/png' as const : 'image/jpeg' as const
    for (const quality of metadata.hasAlpha ? [undefined] : JPEG_QUALITIES) {
      input.signal?.throwIfAborted()
      const encoded = metadata.hasAlpha
        ? prepared.clone().png({ compressionLevel: 9 })
        : prepared.clone().jpeg({ quality, chromaSubsampling: '4:4:4' })
      const { data, info } = await encoded.toBuffer({ resolveWithObject: true })
      input.signal?.throwIfAborted()
      if (data.length > MAX_OUTPUT_BYTES) continue
      if (info.width < 1 || info.height < 1 || info.width > targetWidth || info.height > targetHeight
        || info.width * info.height > MAX_OUTPUT_PIXELS) throw new Error('REPORT_RASTER_OUTPUT_LIMIT')
      return { bytes: data, mimeType, width: info.width, height: info.height, sourceSha256, normalized: true }
    }
    throw new Error('REPORT_RASTER_OUTPUT_LIMIT')
  } catch (error) {
    input.signal?.throwIfAborted()
    if (error instanceof Error && error.message.startsWith('REPORT_RASTER_')) throw error
    throw new Error('REPORT_RASTER_INVALID', { cause: error })
  }
}
