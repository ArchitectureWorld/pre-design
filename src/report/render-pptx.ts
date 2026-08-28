import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { REPORT_THEME } from './theme.ts'
import type { RenderedArtifact, ReportDocument, ReportNode, ReportSection } from './types.ts'

const SLIDE_WIDTH = 13.333
const SLIDE_HEIGHT = 7.5

function displayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value)
  return match === null ? value : `${match[1]}年${match[2]}月${match[3]}日`
}

function sourceNote(document: ReportDocument, section?: ReportSection): string {
  const scope = section === undefined ? '整份报告' : `章节：${section.title}`
  return `[Sources]\n- ${scope}基于项目 ${document.meta.projectId} 的冻结 Revision ${document.meta.sourceRevision}。\n- 概念图仅作方向表达，不替代事实资料与法定依据。`
}

function addFooter(slide: PptxGenJS.Slide, document: ReportDocument, page: number): void {
  slide.addText(`ArchitectureWorld 前期策划  |  成果版本 R${document.meta.sourceRevision}`, {
    x: 0.72, y: 7.08, w: 10.7, h: 0.18, fontFace: REPORT_THEME.fonts.body,
    fontSize: 9, color: REPORT_THEME.colors.muted, margin: 0,
  })
  slide.addText(String(page).padStart(2, '0'), {
    x: 12.0, y: 7.03, w: 0.6, h: 0.24, fontFace: REPORT_THEME.fonts.body,
    fontSize: 10, bold: true, align: 'right', color: REPORT_THEME.colors.accent, margin: 0,
  })
}

function addTitle(slide: PptxGenJS.Slide, title: string, sectionIndex: number): void {
  slide.addText(String(sectionIndex).padStart(2, '0'), {
    x: 0.72, y: 0.42, w: 0.74, h: 0.42, fontFace: REPORT_THEME.fonts.display,
    fontSize: 18, bold: true, color: REPORT_THEME.colors.accent, margin: 0,
  })
  slide.addText(title, {
    x: 1.55, y: 0.34, w: 10.7, h: 0.65, fontFace: REPORT_THEME.fonts.display,
    fontSize: 35, bold: true, color: REPORT_THEME.colors.ink, margin: 0, breakLine: false,
  })
}

function addBulletList(slide: PptxGenJS.Slide, items: readonly string[], y: number, color = REPORT_THEME.colors.ink): void {
  const safeItems = items.length === 0 ? ['本轮暂无已冻结条目。'] : items.slice(0, 7)
  slide.addText(safeItems.map(item => ({ text: item, options: { bullet: { indent: 18 }, breakLine: true } })), {
    x: 1.0, y, w: 11.25, h: Math.min(4.8, 0.6 + safeItems.length * 0.55),
    fontFace: REPORT_THEME.fonts.body, fontSize: 18, color,
    breakLine: false, valign: 'top', margin: 0.08, paraSpaceAfter: 8,
  })
}

function nodeSummary(node: ReportNode): string[] {
  if (node.type === 'heading') return [node.text]
  if (node.type === 'paragraph') return [node.text]
  if (node.type === 'metric') return [`${node.label}：${node.value}（${node.basis}）`]
  if (node.type === 'table') return node.rows.slice(0, 5).map(row => row.join('｜'))
  if (node.type === 'chart') return node.labels.slice(0, 6).map((label, index) => `${label}：${node.values[index] ?? 0}${node.unit}`)
  if (node.type === 'image' || node.type === 'map') return [node.caption]
  return [node.title, ...node.items]
}

function addEvidenceContent(slide: PptxGenJS.Slide, document: ReportDocument, section: ReportSection): void {
  const imageNode = section.nodes.find(node => node.type === 'image' || node.type === 'map')
  if (imageNode?.type === 'image' || imageNode?.type === 'map') {
    const asset = document.assets.find(row => row.assetId === imageNode.assetId)
    if (asset !== undefined) {
      slide.addImage({ path: asset.sourcePath, x: 6.6, y: 1.42, w: 5.78, h: 4.85, altText: imageNode.caption })
      slide.addText(imageNode.caption, {
        x: 6.6, y: 6.35, w: 5.78, h: 0.35, fontFace: REPORT_THEME.fonts.body,
        fontSize: 10, color: REPORT_THEME.colors.muted, margin: 0,
      })
    }
  }

  const table = section.nodes.find(node => node.type === 'table')
  if (table?.type === 'table') {
    const rows = [table.columns, ...table.rows]
      .map(row => row.map(text => ({ text })))
    slide.addTable(rows, {
      x: 0.85, y: 1.48, w: imageNode === undefined ? 11.65 : 5.25,
      h: 4.85, fontFace: REPORT_THEME.fonts.body, fontSize: 13,
      color: REPORT_THEME.colors.ink, border: { color: 'C8D0CD', pt: 0.6 },
      fill: { color: REPORT_THEME.colors.white }, margin: 0.08,
      rowH: 0.48, bold: false,
    })
    return
  }

  const chart = section.nodes.find(node => node.type === 'chart')
  if (chart?.type === 'chart' && chart.labels.length > 0) {
    slide.addChart('bar', [{ name: chart.unit || '数值', labels: [...chart.labels], values: [...chart.values] }], {
      x: 0.9, y: 1.5, w: 11.5, h: 4.65, showLegend: false, showValue: true,
      chartColors: [REPORT_THEME.colors.river], catAxisLabelFontFace: REPORT_THEME.fonts.body,
      valAxisLabelFontFace: REPORT_THEME.fonts.body, dataLabelFontFace: REPORT_THEME.fonts.body,
      showTitle: false, showValAxisTitle: false, showCatAxisTitle: false,
    })
    return
  }

  const summaries = section.nodes.flatMap(nodeSummary).filter(Boolean).slice(0, 8)
  addBulletList(slide, summaries, 1.55)
}

function addSectionSlides(pptx: PptxGenJS, document: ReportDocument, section: ReportSection, sectionIndex: number, page: number): number {
  const overview = pptx.addSlide()
  overview.background = { color: REPORT_THEME.colors.paper }
  addTitle(overview, section.title, sectionIndex)
  overview.addText(section.claim, {
    x: 0.9, y: 1.65, w: 10.9, h: 1.35, fontFace: REPORT_THEME.fonts.display,
    fontSize: 26, bold: true, color: REPORT_THEME.colors.river, margin: 0,
  })
  const decisions = section.nodes.flatMap(node => node.type === 'decision' || node.type === 'warning' ? node.items : []).slice(0, 5)
  addBulletList(overview, decisions.length > 0 ? decisions : section.nodes.flatMap(nodeSummary).slice(0, 5), 3.15)
  overview.addNotes(sourceNote(document, section))
  addFooter(overview, document, page)

  const evidence = pptx.addSlide()
  evidence.background = { color: REPORT_THEME.colors.paper }
  addTitle(evidence, `${section.title}｜依据与成果`, sectionIndex)
  addEvidenceContent(evidence, document, section)
  evidence.addNotes(sourceNote(document, section))
  addFooter(evidence, document, page + 1)

  return page + 2
}

function addConceptGallerySlides(pptx: PptxGenJS, document: ReportDocument, startingPage: number): number {
  const concepts = document.assets.filter(asset => asset.kind === 'concept')
  let page = startingPage
  for (let index = 0; index < concepts.length; index += 2) {
    const pair = concepts.slice(index, index + 2)
    const slide = pptx.addSlide()
    slide.background = { color: REPORT_THEME.colors.paper }
    addTitle(slide, `概念表现图｜方向 ${String(index + 1).padStart(2, '0')}–${String(index + pair.length).padStart(2, '0')}`, 14)
    pair.forEach((asset, pairIndex) => {
      const x = pairIndex === 0 ? 0.85 : 7.18
      slide.addImage({ path: asset.sourcePath, x, y: 1.28, w: 4.95, h: 4.95, altText: asset.caption })
      slide.addText(asset.caption, {
        x, y: 6.32, w: 4.95, h: 0.38, fontFace: REPORT_THEME.fonts.body,
        fontSize: 10, color: REPORT_THEME.colors.muted, margin: 0,
      })
    })
    slide.addNotes(sourceNote(document))
    addFooter(slide, document, page)
    page += 1
  }
  return page
}

export async function renderPptx(document: ReportDocument, outputPath: string): Promise<RenderedArtifact> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'ArchitectureWorld 前期策划'
  pptx.company = 'ArchitectureWorld'
  pptx.subject = `冻结 Revision ${document.meta.sourceRevision} · ${document.meta.recommendationId}`
  pptx.title = `${document.meta.title}｜${document.meta.subtitle}`
  pptx.theme = {
    headFontFace: REPORT_THEME.fonts.display,
    bodyFontFace: REPORT_THEME.fonts.body,
  }

  const cover = pptx.addSlide()
  cover.background = { color: REPORT_THEME.colors.ink }
  cover.addText('ARCHITECTUREWORLD · PRE-PLANNING', {
    x: 0.85, y: 0.68, w: 7.6, h: 0.28, fontFace: REPORT_THEME.fonts.body,
    fontSize: 11, charSpacing: 2.2, color: 'B6C8C5', margin: 0,
  })
  cover.addText(document.meta.title, {
    x: 0.85, y: 1.55, w: 10.9, h: 1.3, fontFace: REPORT_THEME.fonts.display,
    fontSize: 52, bold: true, color: REPORT_THEME.colors.white, margin: 0,
  })
  cover.addText(document.meta.subtitle, {
    x: 0.88, y: 3.15, w: 7.4, h: 0.65, fontFace: REPORT_THEME.fonts.display,
    fontSize: 26, color: 'CDE0DD', margin: 0,
  })
  cover.addText(document.executiveSummary, {
    x: 0.9, y: 4.55, w: 10.8, h: 1.0, fontFace: REPORT_THEME.fonts.body,
    fontSize: 18, color: REPORT_THEME.colors.white, margin: 0,
  })
  cover.addText(`成果版本 R${document.meta.sourceRevision}  |  ${displayDate(document.meta.generatedAt)}`, {
    x: 0.9, y: 6.62, w: 8.4, h: 0.28, fontFace: REPORT_THEME.fonts.body,
    fontSize: 11, color: 'B6C8C5', margin: 0,
  })
  cover.addNotes(sourceNote(document))

  let page = 2
  document.sections.forEach((section, index) => {
    page = addSectionSlides(pptx, document, section, index + 1, page)
  })
  page = addConceptGallerySlides(pptx, document, page)

  const closing = pptx.addSlide()
  closing.background = { color: REPORT_THEME.colors.river }
  closing.addText('本轮决策与下一步', {
    x: 0.85, y: 0.9, w: 10.5, h: 0.8, fontFace: REPORT_THEME.fonts.display,
    fontSize: 42, bold: true, color: REPORT_THEME.colors.white, margin: 0,
  })
  closing.addText(document.executiveSummary, {
    x: 0.9, y: 2.05, w: 10.9, h: 1.0, fontFace: REPORT_THEME.fonts.display,
    fontSize: 26, bold: true, color: 'EAF4F2', margin: 0,
  })
  addBulletList(closing, ['确认本轮核心建议与决策事项', '按确认意见冻结下一成果版本', '以同一成果版本进入后续深化与汇报'], 3.65, REPORT_THEME.colors.white)
  closing.addText(`成果版本 R${document.meta.sourceRevision}`, {
    x: 10.2, y: 6.62, w: 2.15, h: 0.32, fontFace: REPORT_THEME.fonts.body,
    fontSize: 13, align: 'right', color: REPORT_THEME.colors.white, margin: 0,
  })
  closing.addNotes(sourceNote(document))

  await pptx.writeFile({ fileName: outputPath })
  const bytes = (await stat(outputPath)).size
  return {
    format: 'pptx', fileName: basename(outputPath), path: outputPath, bytes,
    sha256: createHash('sha256').update(await readFile(outputPath)).digest('hex'),
  }
}
