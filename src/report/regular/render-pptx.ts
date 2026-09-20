import type PptxGenJS from 'pptxgenjs'
import type { ClientReport } from '../client-types.ts'
import type { RegularLayout } from './layout.ts'

export function addRegularSlide(pptx: PptxGenJS, slide: PptxGenJS.Slide, report: ClientReport, layout: RegularLayout, index: number, count: number): void {
  slide.background = { color: layout.mode === 'cover' ? '173D35' : 'F5F4EF' }
  for (const image of layout.media) {
    const asset = report.assets.find(a => a.assetId === image.assetId)!
    const { x, y, w, h } = image.box
    const ratio = asset.width / asset.height
    const width = Math.min(w, h * ratio), height = width / ratio
    // PptxGenJS 4 reads options.w/h as the source aspect ratio when sizing is
    // supplied. Reusing the target frame there stretches the image with zero crop.
    const geometry = image.fit === 'cover' ? { x, y, w: ratio, h: 1, sizing: { type: 'cover' as const, w, h } } : { x: x + (w - width) / 2, y: y + (h - height) / 2, w: width, h: height }
    slide.addImage({ path: asset.sourcePath, ...geometry, altText: asset.caption })
  }
  if (layout.shade) slide.addShape(pptx.ShapeType.rect, { ...layout.shade, fill: { color: '112A26', transparency: 18 }, line: { color: '112A26', transparency: 100 } })
  for (const t of layout.texts) slide.addText(t.text, { ...t.box, fontFace: 'Microsoft YaHei', lang: 'zh-CN', fontSize: t.size,
    bold: t.role !== 'body', color: t.dark ? 'FFFFFF' : t.role === 'eyebrow' ? '607D73' : t.role === 'claim' ? '386455' : '203B3C',
    breakLine: false, margin: 0, valign: 'top', lineSpacing: t.leading, paraSpaceAfter: 0, charSpacing: 0,
  })
  if (layout.table) {
    const table = layout.table
    slide.addTable([table.columns, ...table.rows].map((row, index) => row.map(value => ({ text: value, options: index === 0 ? { bold: true, fill: { color: '315C4E' }, color: 'FFFFFF' } : { fill: { color: index % 2 === 0 ? 'E9EEE7' : 'F5F4EF' } } }))), {
      ...table.box, colW: table.columnWidths ? [...table.columnWidths] : Array.from({ length: table.columns.length }, () => table.box.w / table.columns.length), rowH: [...table.rowHeights],
      fontFace: 'Microsoft YaHei', lang: 'zh-CN', fontSize: 14, color: '203B3C',
      margin: [0.075, 0.12, 0.075, 0.12], border: { type: 'solid', pt: 0.4, color: 'CED8D0' },
      valign: 'top', autoPage: false,
    })
  }
  slide.addText(`${String(index + 1).padStart(2, '0')} / ${count}`, { x: 11.78, y: 7.12, w: 1.23, h: 0.22, fontFace: 'Microsoft YaHei', fontSize: 9, margin: 0, align: 'right', color: ['cover', 'background', 'right', 'bottom'].includes(layout.mode) ? 'FFFFFF' : '607D73' })
}
