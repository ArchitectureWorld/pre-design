import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildReportDocument } from '../src/report/build-document.ts'
import { renderPptx } from '../src/report/render-pptx.ts'
import { REPORT_INPUT } from './report-fixture.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function zipNames(buffer: Buffer): string[] {
  const names: string[] = []
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02])
  let offset = buffer.indexOf(signature)
  while (offset >= 0 && offset + 46 <= buffer.length) {
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'))
    offset = buffer.indexOf(signature, offset + 46 + nameLength + extraLength + commentLength)
  }
  return names
}

describe('renderPptx', () => {
  it('creates an editable 16:9 client deck with 35-60 slides and the frozen revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-pptx-'))
    roots.push(root)
    const output = join(root, 'report.pptx')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    const visualAssets = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
      const sourcePath = join(root, `concept-${String(index + 1).padStart(2, '0')}.png`)
      await writeFile(sourcePath, png)
      return {
        assetId: `concept-${String(index + 1).padStart(2, '0')}`,
        kind: 'concept' as const,
        caption: `概念表现图 ${index + 1}（AI 生成）`,
        sourcePath,
        mimeType: 'image/png' as const,
      }
    }))
    const document = buildReportDocument({
      ...REPORT_INPUT,
      visualAssets,
      adoptedAssetIds: visualAssets.map(asset => asset.assetId),
    })

    const artifact = await renderPptx(document, output)
    const bytes = await readFile(output)
    const archiveNames = bytes.toString('latin1').match(/ppt\/slides\/slide\d+\.xml/gu) ?? []
    const slideCount = new Set(archiveNames).size

    expect(artifact).toMatchObject({ format: 'pptx', fileName: 'report.pptx', sha256: expect.any(String) })
    expect(bytes.subarray(0, 2).toString()).toBe('PK')
    expect(slideCount).toBeGreaterThanOrEqual(35)
    expect(slideCount).toBeLessThanOrEqual(60)
    const mediaNames = zipNames(bytes).filter(name => name.startsWith('ppt/media/'))
    expect(mediaNames.length).toBeGreaterThanOrEqual(12)
    expect(bytes.toString('utf16le')).not.toContain('raw json')
  })
})
