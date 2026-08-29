import { readFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'
import type { ArtifactIdentity } from './client-types.ts'

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
  return value.replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'").replace(/&amp;/gu, '&')
}

function xmlText(xml: string): string {
  return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gu)]
    .map(match => decodeXml(match[1] ?? '')).join('\n')
}

function numbered(entries: Map<string, Buffer>, pattern: RegExp): readonly [string, Buffer][] {
  return [...entries].filter(([name]) => pattern.test(name)).sort(([left], [right]) =>
    Number(left.match(/\d+/u)?.[0] ?? 0) - Number(right.match(/\d+/u)?.[0] ?? 0))
}

function noteValue(notes: string, key: string): string | undefined {
  return notes.match(new RegExp(`(?:^|\\n)${key}=([^\\n]*)`, 'u'))?.[1]?.trim()
}

export interface PptxArtifactInspection {
  readonly slideCount: number
  readonly visibleText: string
  readonly notesText: string
  readonly mediaNames: readonly string[]
  readonly identity?: ArtifactIdentity
}

export async function inspectPptxArtifact(path: string): Promise<PptxArtifactInspection> {
  const entries = unzipEntries(await readFile(path))
  const slides = numbered(entries, /^ppt\/slides\/slide\d+\.xml$/u)
  const notes = numbered(entries, /^ppt\/notesSlides\/notesSlide\d+\.xml$/u)
  const visibleText = slides.map(([, value]) => xmlText(value.toString('utf8'))).join('\n')
  const notesText = notes.map(([, value]) => xmlText(value.toString('utf8'))).join('\n')
  const projectId = noteValue(notesText, 'projectId')
  const sourceRevision = noteValue(notesText, 'sourceRevision')
  const recommendationId = noteValue(notesText, 'recommendationId')
  const adoptedAssets = noteValue(notesText, 'adoptedAssetIds')
  const identity = projectId === undefined || sourceRevision === undefined || recommendationId === undefined
    ? undefined
    : {
        projectId,
        sourceRevision: Number(sourceRevision),
        recommendationId,
        adoptedAssetIds: adoptedAssets?.split(',').filter(Boolean).sort() ?? [],
      }
  return {
    slideCount: slides.length,
    visibleText,
    notesText,
    mediaNames: [...entries.keys()].filter(name => /^ppt\/media\//u.test(name)),
    ...(identity === undefined ? {} : { identity }),
  }
}
