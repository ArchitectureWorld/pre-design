import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { describe, expect, it } from 'vitest'
import { addRegularSlide } from '../src/report/regular/render-pptx.ts'
import type { ClientReport } from '../src/report/client-types.ts'
import type { RegularLayout } from '../src/report/regular/layout.ts'

describe('regular presentation image fitting', () => {
  it('crops a square photo into wide and tall frames instead of stretching the source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'regular-crop-'))
    try {
      const path = join(root, 'square.png')
      await writeFile(path, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
      const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE'
      const report = { assets: [{ assetId: 'photo', sourcePath: path, width: 1, height: 1, caption: '真实项目' }] } as unknown as ClientReport
      const layout: RegularLayout = { mode: 'row', chapterTitle: '项目案例', texts: [], media: [
        { assetId: 'photo', fit: 'cover', box: { x: 0, y: 0, w: 4, h: 2 } },
        { assetId: 'photo', fit: 'cover', box: { x: 4, y: 0, w: 2, h: 4 } },
        { assetId: 'photo', fit: 'contain', box: { x: 6, y: 0, w: 4, h: 2 } },
      ] }
      addRegularSlide(pptx, pptx.addSlide(), report, layout, 0, 1)
      const buffer = await pptx.write({ outputType: 'nodebuffer', compression: false })
      expect(Buffer.isBuffer(buffer)).toBe(true)
      const xml = (buffer as Buffer).toString('utf8')
      expect(xml).toContain('<a:srcRect l="0" r="0" t="25000" b="25000"/>')
      expect(xml).toContain('<a:srcRect l="25000" r="25000" t="0" b="0"/>')
      expect(xml).not.toContain('<a:srcRect l="0" r="0" t="0" b="0"/>')
      expect((xml.match(/<p:pic>/gu) ?? [])).toHaveLength(3)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
