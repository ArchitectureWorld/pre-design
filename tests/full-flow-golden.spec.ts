import { inflateRawSync } from 'node:zlib'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { runGoldenProject } from '../scripts/build-golden-project.ts'

const fixtureRoot = fileURLToPath(new URL('./fixtures/golden-project/', import.meta.url))
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

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

function decodePdfMetadata(buffer: Buffer): Record<string, unknown> {
  const marker = '%PREPLAN-METADATA:'
  const encoded = buffer.toString('latin1').split(marker).at(-1)?.split(/\r?\n/u)[0]?.trim()
  if (encoded === undefined || encoded === '') throw new Error('PDF preplanning metadata is missing')
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1
}

describe('Golden Project full flow', () => {
  it('publishes a complete 57-item, 8-gate, visual-rich package from one frozen revision', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'preplan-golden-'))
    roots.push(outputRoot)

    const result = await runGoldenProject(fixtureRoot, outputRoot, { browserExecutable: edge })

    expect(result.workflowCounts).toEqual({ total: 57, confirmed: 57, blocked: 0 })
    expect(result.gateCounts).toEqual({ total: 8, decided: 8 })
    expect(result.visualCounts.aiConcepts).toBeGreaterThanOrEqual(12)
    expect(result.visualCounts.aiConcepts).toBeLessThanOrEqual(20)
    expect(result.visualCounts.deterministicCharts).toBeGreaterThanOrEqual(15)
    expect(result.visualCounts.deterministicCharts).toBeLessThanOrEqual(25)
    expect(result.manifest.sourceRevision).toBe(result.project.currentRevision)
    expect(result.manifest.artifacts.map(row => row.format).sort()).toEqual(['html', 'pdf', 'pptx'])
  }, 60_000)

  it('embeds the same revision, recommendation and adopted visual identity in all three formats', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'preplan-golden-'))
    roots.push(outputRoot)
    const result = await runGoldenProject(fixtureRoot, outputRoot, { browserExecutable: edge })
    const expected = {
      revision: result.manifest.sourceRevision,
      recommendationId: result.manifest.recommendationId,
      adoptedAssetIds: [...(result.manifest.adoptedAssetIds ?? [])].sort(),
    }

    const html = await readFile(join(outputRoot, 'html', 'index.html'), 'utf8')
    expect(html).toContain(`data-report-revision="${expected.revision}"`)
    expect(html).toContain(`data-recommendation-id="${expected.recommendationId}"`)
    for (const assetId of expected.adoptedAssetIds) expect(html).toContain(assetId)
    expect.soft(countOccurrences(html, '项目基本情况与启动原因')).toBe(1)
    expect.soft(html).not.toMatch(/preplan\.wf\.|approved_with_conditions|2026-08-28T12:00:00\.000Z/u)

    const pptxEntries = unzipEntries(await readFile(join(outputRoot, 'report.pptx')))
    const core = pptxEntries.get('docProps/core.xml')?.toString('utf8') ?? ''
    const slideText = [...pptxEntries]
      .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
      .map(([, content]) => content.toString('utf8'))
      .join('\n')
    expect(core).toContain(`Revision ${expected.revision}`)
    expect(slideText).toContain(result.project.recommendation)
    expect.soft(countOccurrences(slideText, '项目基本情况与启动原因')).toBe(1)
    expect.soft(slideText).not.toMatch(/preplan\.wf\.|approved_with_conditions|2026-08-28T12:00:00\.000Z/u)
    const decisionEvidence = [...pptxEntries]
      .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
      .find(([, content]) => content.toString('utf8').includes('决策清单与成果索引｜依据与成果'))?.[1]
      ?.toString('utf8') ?? ''
    expect.soft(decisionEvidence).toContain('G7')
    expect.soft(decisionEvidence).toContain('G8')
    const closingSlide = [...pptxEntries]
      .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
      .find(([, content]) => content.toString('utf8').includes('本轮决策与下一步'))?.[1]
      ?.toString('utf8') ?? ''
    expect.soft(closingSlide).not.toContain('132A2E')
    expect([...pptxEntries.keys()].filter(name => /^ppt\/media\//u.test(name)).length)
      .toBeGreaterThanOrEqual(expected.adoptedAssetIds.length)

    const pdf = await readFile(join(outputRoot, 'report.pdf'))
    expect(decodePdfMetadata(pdf)).toMatchObject(expected)
    expect.soft(pdf.toString('latin1').match(/\/Type\s*\/Page\b/gu)?.length ?? 0).toBeLessThanOrEqual(70)
  }, 60_000)
})
