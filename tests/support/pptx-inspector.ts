import { readFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'

const EMU_PER_INCH = 914_400
const SLIDE_WIDTH = 13.333 * EMU_PER_INCH
const SLIDE_HEIGHT = 7.5 * EMU_PER_INCH

function unzipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>()
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02])
  let offset = buffer.indexOf(signature)
  while (offset >= 0 && offset + 46 <= buffer.length) {
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize)
    if (method === 0) entries.set(name, compressed)
    else if (method === 8) entries.set(name, inflateRawSync(compressed))
    offset = buffer.indexOf(signature, offset + 46 + nameLength + extraLength + commentLength)
  }
  return entries
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&')
}

function xmlText(xml: string): string {
  return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gu)]
    .map(match => decodeXml(match[1] ?? ''))
    .join('\n')
}

function numberedEntries(entries: Map<string, Buffer>, pattern: RegExp): [string, Buffer][] {
  return [...entries].filter(([name]) => pattern.test(name)).sort(([left], [right]) => {
    const leftNumber = Number(left.match(/\d+/u)?.[0] ?? 0)
    const rightNumber = Number(right.match(/\d+/u)?.[0] ?? 0)
    return leftNumber - rightNumber
  })
}

function inspectBounds(slides: readonly [string, Buffer][]): string[] {
  const failures: string[] = []
  slides.forEach(([name, content]) => {
    const xml = content.toString('utf8')
    for (const match of xml.matchAll(/<a:xfrm[^>]*>[\s\S]*?<a:off x="(\d+)" y="(\d+)"\/?>(?:<\/a:off>)?[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"\/?>(?:<\/a:ext>)?[\s\S]*?<\/a:xfrm>/gu)) {
      const [x, y, width, height] = match.slice(1).map(Number)
      if (x! < 0 || y! < 0 || x! + width! > SLIDE_WIDTH + 2 || y! + height! > SLIDE_HEIGHT + 2) {
        failures.push(`${name}:${x},${y},${width},${height}`)
      }
    }
  })
  return failures
}

function inspectMinimumText(slides: readonly [string, Buffer][]): string[] {
  const failures: string[] = []
  slides.forEach(([name, content]) => {
    const xml = content.toString('utf8')
    for (const match of xml.matchAll(/<(?:a:rPr|a:defRPr)\b[^>]*\bsz="(\d+)"/gu)) {
      const points = Number(match[1]) / 100
      if (points < 10) failures.push(`${name}:${points}pt`)
    }
  })
  return failures
}

export interface PptxInspection {
  readonly slideCount: number
  readonly slideTexts: readonly string[]
  readonly notesTexts: readonly string[]
  readonly pageKinds: readonly string[]
  readonly mediaNames: readonly string[]
  readonly outOfBoundsObjects: readonly string[]
  readonly textBelowMinimum: readonly string[]
}

export async function inspectPptx(path: string): Promise<PptxInspection> {
  const entries = unzipEntries(await readFile(path))
  const slides = numberedEntries(entries, /^ppt\/slides\/slide\d+\.xml$/u)
  const notes = numberedEntries(entries, /^ppt\/notesSlides\/notesSlide\d+\.xml$/u)
  const slideTexts = slides.map(([, content]) => xmlText(content.toString('utf8')))
  const notesTexts = notes.map(([, content]) => xmlText(content.toString('utf8')))
  return {
    slideCount: slides.length,
    slideTexts,
    notesTexts,
    pageKinds: notesTexts.flatMap(text => text.match(/\[PageKind\]([^\n]+)/u)?.[1]?.trim() ?? []),
    mediaNames: [...entries.keys()].filter(name => /^ppt\/media\//u.test(name)),
    outOfBoundsObjects: inspectBounds(slides),
    textBelowMinimum: inspectMinimumText(slides),
  }
}
