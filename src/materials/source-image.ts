import sharp from 'sharp'
import exifr from 'exifr'
import { dirname } from 'node:path'
import type { MaterialCorpusDocument } from './research-evidence.ts'

export const SOURCE_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
export interface SourceImageIdentity { readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; readonly width: number; readonly height: number }
/** Prefer coverage of separate source folders before repeated photographs of a point. */
export function sourceImageCoverage(documents: readonly MaterialCorpusDocument[], limit = 16): readonly MaterialCorpusDocument[] {
  const images = documents.filter(doc => doc.image && !doc.provenance).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const points = new Set<string>(), first = images.filter(doc => { const point = dirname(doc.path); if (points.has(point)) return false; points.add(point); return true })
  return [...first, ...images.filter(doc => !first.includes(doc))].slice(0, limit)
}
const numeric = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null
const angle = (value: unknown): number | null => { const n = numeric(value); return n !== null && n >= 0 && n < 360 ? n : null }
export const SOURCE_IMAGE_LIMITATIONS = [
  '本段仅从原图EXIF/XMP提取元数据，未完成图像内容识别；标签本身不证明真实性或测绘精度。',
  'GPS是相机拍摄位置，不等于画面中地物坐标；航拍GPS高度和相对飞行高度不得作为地面高程或建筑高度。',
  '云台偏航与飞行偏航保留为原始标签，不冒充经过真北标定的照片方向；缺失方向保持未知。',
  '仅DateTimeOriginal作为原始拍摄时间；修改日期、文件名与导入时间均不能替代，未写时区时不补推时区。',
  '文件夹与文件名只作用户点位标识，不证明现状用途，也不构成要求采用的产业、产品或设计方案；图中文字同样须区分点位与设想。',
] as const

/** Original embedded tags, never file mtime, filename inference, ground survey or visual recognition. */
export async function readSourceImageMetadata(bytes: Uint8Array): Promise<{ image: SourceImageIdentity; text: string }> {
  const metadata = await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata()
  if (!['jpeg', 'png', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height) throw new Error('SOURCE_IMAGE_FORMAT_INVALID')
  const tags = await exifr.parse(bytes, { translateValues: false, reviveValues: false, xmp: true, icc: false, iptc: false }) ?? {}
  const lat = numeric(tags.latitude), lon = numeric(tags.longitude)
  const latitude = lat !== null && Math.abs(lat) <= 90 ? lat : null
  const longitude = lon !== null && Math.abs(lon) <= 180 ? lon : null
  const original = text(tags.DateTimeOriginal)
  const image: SourceImageIdentity = { mimeType: `image/${metadata.format}` as SourceImageIdentity['mimeType'], width: metadata.width, height: metadata.height }
  const capture = {
    dateTimeOriginal: original && /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/u.test(original) ? original : null,
    timeZone: text(tags.OffsetTimeOriginal), latitude, longitude,
    coordinateDatum: text(tags.GPSMapDatum), direction: angle(tags.GPSImgDirection), directionReference: text(tags.GPSImgDirectionRef),
    gpsAltitude: numeric(tags.GPSAltitude),
    gimbalYawDegree: numeric(tags.GimbalYawDegree), flightYawDegree: numeric(tags.FlightYawDegree),
    relativeAltitude: numeric(tags.RelativeAltitude),
  }
  return { image, text: JSON.stringify({ kind: 'source-image-metadata.v1', ...image, capture,
    limitations: SOURCE_IMAGE_LIMITATIONS }).replace(',"limitations":', ',\n\n"limitations":') }
}
