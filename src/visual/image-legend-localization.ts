import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import type { PresentationAdoptedAssetInput } from '../presentation/standard-project-types.ts'

/** A transcription of an already bilingual source legend, never an invented translation. */
export interface ImageLegendLocalization {
  readonly version: 'source-legend-zh-v1'
  readonly sourceSha256: string
  readonly width: number
  readonly height: number
  readonly regions: readonly {
    readonly x: number; readonly y: number; readonly width: number; readonly height: number
    readonly columns?: number; readonly fontSize?: number
    readonly lines: readonly { readonly sourceText: string; readonly chineseText: string }[]
  }[]
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const esc = (value: string) => value.replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)

export async function localizeImageLegend(bytes: Uint8Array, definition: ImageLegendLocalization) {
  if (sha(bytes) !== definition.sourceSha256) throw new Error('LEGEND_SOURCE_CHANGED')
  const image = sharp(bytes), metadata = await image.metadata()
  if (definition.version !== 'source-legend-zh-v1' || definition.width !== metadata.width || definition.height !== metadata.height
    || !definition.regions.length || definition.regions.length > 8) throw new Error('LEGEND_SOURCE_INVALID')
  let area = 0
  const overlays = definition.regions.map((region, index) => {
    if (![region.x, region.y, region.width, region.height].every(Number.isInteger) || region.x < 0 || region.y < 0
      || region.width < 1 || region.height < 1 || region.x + region.width > definition.width || region.y + region.height > definition.height)
      throw new Error('LEGEND_REGION_INVALID')
    if (definition.regions.slice(0, index).some(other => Math.min(region.x + region.width, other.x + other.width) > Math.max(region.x, other.x)
      && Math.min(region.y + region.height, other.y + other.height) > Math.max(region.y, other.y))) throw new Error('LEGEND_REGION_OVERLAP')
    area += region.width * region.height
    if (area > definition.width * definition.height * 0.2) throw new Error('LEGEND_AREA_EXCEEDED')
    if (!region.lines.length || region.lines.length > 30) throw new Error('LEGEND_TRANSCRIPTION_INVALID')
    for (const line of region.lines) if (!line.chineseText.trim() || /[a-z]/iu.test(line.chineseText)
      || !line.sourceText.replace(/\s/gu, '').includes(line.chineseText.replace(/\s/gu, '')))
      throw new Error('LEGEND_TRANSCRIPTION_INVALID')
    const columns = region.columns ?? 1, rows = Math.ceil(region.lines.length / columns)
    const fontSize = region.fontSize ?? Math.min(20, Math.floor((region.height - 12) / (rows * 1.4)))
    if (!Number.isInteger(columns) || columns < 1 || columns > 4 || !Number.isFinite(fontSize) || fontSize < 12 || fontSize > 40
      || rows * fontSize * 1.4 + 12 > region.height) throw new Error('LEGEND_TEXT_OVERFLOW')
    const columnWidth = (region.width - 16) / columns
    const texts = region.lines.map((line, i) => {
      const units = Array.from(line.chineseText).reduce((n, char) => n + (/[\x00-\x7f]/u.test(char) ? 0.65 : 1), 0)
      if (units * fontSize > columnWidth - 8) throw new Error('LEGEND_TEXT_OVERFLOW')
      const x = 8 + Math.floor(i / rows) * columnWidth, y = 6 + fontSize + (i % rows) * fontSize * 1.4
      return `<text x="${x}" y="${y}" font-size="${fontSize}">${esc(line.chineseText)}</text>`
    }).join('')
    return { left: region.x, top: region.y, input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${region.width}" height="${region.height}"><rect width="100%" height="100%" fill="white"/><g font-family="Microsoft YaHei,Noto Sans CJK SC,sans-serif" fill="#202020">${texts}</g></svg>`) }
  })
  // The canvas, drawing and numbered spatial references are untouched. No
  // generative redraw, resampling or crop can alter the original architecture.
  const output = await image.ensureAlpha().composite(overlays).png().toBuffer()
  return { bytes: output, sha256: sha(output), sourceSha256: definition.sourceSha256, width: definition.width, height: definition.height }
}

/** Replaying the narrow transformation binds the derivative to its intact source. */
export async function verifyLocalizedLegendMaterial(material: PresentationAdoptedAssetInput): Promise<boolean> {
  let method: Record<string, any>
  try { method = JSON.parse(material.origin.method) } catch { return true }
  if (!method.legendLocalization) return true
  try {
    const record = method.legendLocalization
    const result = await localizeImageLegend(await readFile(record.sourcePath), record.definition)
    const bytes = await readFile(material.imagePreparation?.sourcePath ?? material.sourcePath)
    return result.sha256 === record.sha256 && result.sha256 === sha(bytes)
  } catch { return false }
}

/** A separate, reviewable derivative. Publisher receipts always continue to identify the original. */
export async function prepareLocalizedLegendMaterial(original: PresentationAdoptedAssetInput, definition: ImageLegendLocalization, directory: string): Promise<PresentationAdoptedAssetInput> {
  const result = await localizeImageLegend(await readFile(original.sourcePath), definition)
  await mkdir(directory, { recursive: true })
  const name = `${result.sha256}.png`, sourcePath = join(directory, name)
  await writeFile(sourcePath, result.bytes)
  const method = JSON.parse(original.origin.method)
  const { inspection: _inspection, ...quality } = original.imageQuality ?? {}
  return { ...original, sourceKey: `${original.sourceKey}:legend-zh`, sourcePath, originalFileName: name,
    aliases: [...new Set([original.sourceKey, ...(original.aliases ?? [])])], mimeType: 'image/png',
    imageQuality: quality,
    imageIdentity: { originalId: original.imageIdentity?.originalId ?? `sha256:${result.sourceSha256}`,
      fileSha256: result.sha256, derivedFromSha256: result.sourceSha256, verification: 'declared-derivative' },
    origin: { ...original.origin, type: 'generated_by_tool', parentAssetKeys: [original.sourceKey],
      sourceTool: { name: 'pre-design-source-legend-localization', version: definition.version },
      method: JSON.stringify({ ...method, legendLocalization: { sourcePath: original.sourcePath, definition, sha256: result.sha256 } }) } }
}
