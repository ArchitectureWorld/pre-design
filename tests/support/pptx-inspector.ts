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

export interface PptxTextObject {
  readonly slideNumber: number
  readonly text: string
  readonly fontSize: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly usesNormAutofit: boolean
  readonly color: string
  readonly fillColor: string
}

export interface PptxShapeObject {
  readonly slideNumber: number
  readonly name: string
  readonly text: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface PptxPictureObject {
  readonly slideNumber: number
  readonly name: string
  readonly altText: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly sourceCrop: Readonly<{
    left: number
    right: number
    top: number
    bottom: number
  }>
}

function inspectShapeObjects(slides: readonly [string, Buffer][]): PptxShapeObject[] {
  return slides.flatMap(([, content], slideIndex) => {
    const xml = content.toString('utf8')
    return [...xml.matchAll(/<p:sp\b[^>]*>([\s\S]*?)<\/p:sp>/gu)].map(match => {
      const shape = match[1] ?? ''
      const metadata = /<p:cNvPr\b([^>]*)\/?>(?:<\/p:cNvPr>)?/u.exec(shape)?.[1] ?? ''
      const transform = /<a:xfrm[^>]*>[\s\S]*?<a:off x="(\d+)" y="(\d+)"\/?>(?:<\/a:off>)?[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"\/?>(?:<\/a:ext>)?[\s\S]*?<\/a:xfrm>/u.exec(shape)
      const [x, y, width, height] = transform === null
        ? [0, 0, 0, 0]
        : transform.slice(1).map(value => Number(value) / EMU_PER_INCH)
      const name = decodeXml(/\bname="([^"]*)"/u.exec(metadata)?.[1] ?? '')
      return {
        slideNumber: slideIndex + 1,
        name,
        text: xmlText(shape),
        x: x!,
        y: y!,
        width: width!,
        height: height!,
      }
    })
  })
}

function inspectTextObjects(slides: readonly [string, Buffer][]): PptxTextObject[] {
  return slides.flatMap(([, content], slideIndex) => {
    const xml = content.toString('utf8')
    return [...xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/gu)].flatMap(match => {
      const shape = match[1] ?? ''
      const transform = /<a:xfrm[^>]*>[\s\S]*?<a:off x="(\d+)" y="(\d+)"\/?>(?:<\/a:off>)?[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"\/?>(?:<\/a:ext>)?[\s\S]*?<\/a:xfrm>/u.exec(shape)
      const text = xmlText(shape)
      if (transform === null || text === '') return []
      const fontSizes = [...shape.matchAll(/<(?:a:rPr|a:defRPr)\b[^>]*\bsz="(\d+)"/gu)]
        .map(size => Number(size[1]) / 100)
      const color = /<a:solidFill><a:srgbClr\b[^>]*\bval="([A-Fa-f0-9]{6})"/u.exec(shape)?.[1]?.toUpperCase() ?? ''
      const shapeProperties = /<p:spPr\b[^>]*>([\s\S]*?)<\/p:spPr>/u.exec(shape)?.[1] ?? ''
      const fillColor = /<a:solidFill><a:srgbClr\b[^>]*\bval="([A-Fa-f0-9]{6})"/u
        .exec(shapeProperties)?.[1]?.toUpperCase() ?? ''
      const [x, y, width, height] = transform.slice(1).map(value => Number(value) / EMU_PER_INCH)
      return [{
        slideNumber: slideIndex + 1,
        text,
        fontSize: fontSizes.length === 0 ? 0 : Math.min(...fontSizes),
        x: x!,
        y: y!,
        width: width!,
        height: height!,
        usesNormAutofit: /<a:normAutofit\b/u.test(shape),
        color,
        fillColor,
      }]
    })
  })
}

function inspectPictureObjects(slides: readonly [string, Buffer][]): PptxPictureObject[] {
  return slides.flatMap(([, content], slideIndex) => {
    const xml = content.toString('utf8')
    return [...xml.matchAll(/<p:pic>([\s\S]*?)<\/p:pic>/gu)].flatMap(match => {
      const picture = match[1] ?? ''
      const metadata = /<p:cNvPr\b([^>]*)\/?>(?:<\/p:cNvPr>)?/u.exec(picture)?.[1] ?? ''
      const sourceRect = /<a:srcRect\b([^>]*)\/?>(?:<\/a:srcRect>)?/u.exec(picture)?.[1] ?? ''
      const transform = /<a:xfrm[^>]*>[\s\S]*?<a:off x="(\d+)" y="(\d+)"\/?>(?:<\/a:off>)?[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"\/?>(?:<\/a:ext>)?[\s\S]*?<\/a:xfrm>/u.exec(picture)
      if (transform === null) return []
      const attribute = (attributes: string, name: string): string => decodeXml(
        new RegExp(`\\b${name}="([^"]*)"`, 'u').exec(attributes)?.[1] ?? '',
      )
      const crop = (name: string): number => Number(attribute(sourceRect, name) || 0)
      const [x, y, width, height] = transform.slice(1).map(value => Number(value) / EMU_PER_INCH)
      return [{
        slideNumber: slideIndex + 1,
        name: attribute(metadata, 'name'),
        altText: attribute(metadata, 'descr'),
        x: x!,
        y: y!,
        width: width!,
        height: height!,
        sourceCrop: {
          left: crop('l'),
          right: crop('r'),
          top: crop('t'),
          bottom: crop('b'),
        },
      }]
    })
  })
}

export interface PptxInspection {
  readonly slideCount: number
  readonly slideTexts: readonly string[]
  readonly notesTexts: readonly string[]
  readonly pageKinds: readonly string[]
  readonly mediaNames: readonly string[]
  readonly outOfBoundsObjects: readonly string[]
  readonly textBelowMinimum: readonly string[]
  readonly shapeObjects: readonly PptxShapeObject[]
  readonly textObjects: readonly PptxTextObject[]
  readonly pictureObjects: readonly PptxPictureObject[]
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
    shapeObjects: inspectShapeObjects(slides),
    textObjects: inspectTextObjects(slides),
    pictureObjects: inspectPictureObjects(slides),
  }
}
