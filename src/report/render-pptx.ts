import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { assertClientReportPolicy } from './client-policy.ts'
import type {
  ClientContentBlock,
  ClientPage,
  ClientPageKind,
  ClientProduct,
  ClientRenderContext,
  ClientReport,
  ClientVisualAsset,
} from './client-types.ts'
import { assertClientPagePlan } from './page-plan.ts'
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

async function renderLegacyPptx(document: ReportDocument, outputPath: string): Promise<RenderedArtifact> {
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

const SAFE_X = 0.8
const SAFE_Y = 0.5
const CONTENT_RIGHT = 12.533
const CONTENT_BOTTOM = 6.88
const CONTENT_WIDTH = CONTENT_RIGHT - SAFE_X

function clientBlock(report: ClientReport, page: ClientPage): ClientContentBlock | undefined {
  const chapter = report.chapters.find(candidate => candidate.id === page.chapterId)
  const index = page.blockIndexes[0]
  return index === undefined ? undefined : chapter?.blocks[index]
}

function clientProduct(
  report: ClientReport,
  page: ClientPage,
  block?: ClientContentBlock,
): ClientProduct | undefined {
  const productId = block?.type === 'product'
    ? block.productId
    : block?.type === 'scene'
      ? block.productIds[0]
      : page.primaryFocus.type === 'product'
        ? page.primaryFocus.productId
        : undefined
  return productId === undefined
    ? report.products[0]
    : report.products.find(product => product.productId === productId)
}

function blockText(block?: ClientContentBlock): string {
  if (block === undefined) return ''
  if (block.type === 'narrative') return block.statement
  if (block.type === 'metric') return `${block.label}\n${block.value} ${block.unit}`
  if (block.type === 'comparison') return `当前｜${block.before}\n目标｜${block.after}`
  if (block.type === 'timeline') {
    return block.phases.map(phase => `${phase.name}｜${phase.actions.join('；')}`).join('\n')
  }
  if (block.type === 'investment') {
    return block.items.map(item => `${item.name}｜${item.amount} ${item.unit}\n${item.assumption}`).join('\n')
  }
  if (block.type === 'decision') return block.asks.join('\n')
  if (block.type === 'product') return '以核心产品承接项目定位与使用场景'
  if (block.type === 'scene') return block.headline
  return block.headline
}

function clientNotes(context: ClientRenderContext, page: ClientPage): string {
  return `[PageKind]${page.kind}\n[PreplanIdentity]\nprojectId=${context.identity.projectId}\nsourceRevision=${context.identity.sourceRevision}\nrecommendationId=${context.identity.recommendationId}\nadoptedAssetIds=${[...context.identity.adoptedAssetIds].sort().join(',')}`
}

function addClientFooter(
  slide: PptxGenJS.Slide,
  report: ClientReport,
  pageNumber: number,
): void {
  const { muted, accent } = report.theme.tokens.colors
  slide.addText('前期策划成果提案', {
    x: SAFE_X, y: 7.05, w: 3.2, h: 0.2, fontFace: report.theme.tokens.fonts.body,
    fontSize: 10, color: muted, margin: 0,
  })
  slide.addText(String(pageNumber).padStart(2, '0'), {
    x: 11.75, y: 7.03, w: 0.78, h: 0.22, fontFace: report.theme.tokens.fonts.body,
    fontSize: 10, bold: true, align: 'right', color: accent, margin: 0,
  })
}

function addClientEyebrow(
  slide: PptxGenJS.Slide,
  report: ClientReport,
  text: string,
  color = report.theme.tokens.colors.accent,
): void {
  slide.addText(text, {
    x: SAFE_X, y: SAFE_Y, w: 4.4, h: 0.24, fontFace: report.theme.tokens.fonts.body,
    fontSize: 10, bold: true, charSpacing: 1.8, color, margin: 0,
  })
}

function addClientTitle(
  slide: PptxGenJS.Slide,
  report: ClientReport,
  headline: string,
  options: Readonly<{ x?: number; y?: number; w?: number; h?: number; color?: string; size?: number }> = {},
): void {
  slide.addText(headline, {
    x: options.x ?? SAFE_X,
    y: options.y ?? 0.92,
    w: options.w ?? CONTENT_WIDTH,
    h: options.h ?? 1.05,
    fontFace: report.theme.tokens.fonts.display,
    fontSize: options.size ?? 30,
    bold: true,
    color: options.color ?? report.theme.tokens.colors.ink,
    margin: 0,
    valign: 'middle',
    fit: 'shrink',
  })
}

function imageGeometry(
  asset: ClientVisualAsset,
  box: Readonly<{ x: number; y: number; w: number; h: number }>,
): Readonly<{ x: number; y: number; w: number; h: number }> {
  const ratio = asset.width / asset.height
  const boxRatio = box.w / box.h
  if (ratio > boxRatio) {
    const height = box.w / ratio
    return { x: box.x, y: box.y + (box.h - height) / 2, w: box.w, h: height }
  }
  const width = box.h * ratio
  return { x: box.x + (box.w - width) / 2, y: box.y, w: width, h: box.h }
}

function addClientImage(
  slide: PptxGenJS.Slide,
  report: ClientReport,
  assetId: string | undefined,
  box: Readonly<{ x: number; y: number; w: number; h: number }>,
): boolean {
  const asset = report.assets.find(candidate => candidate.assetId === assetId)
  if (asset === undefined) return false
  const geometry = imageGeometry(asset, box)
  slide.addImage({ path: asset.sourcePath, ...geometry, altText: asset.caption })
  slide.addText(asset.disclosure === undefined ? asset.caption : `${asset.caption}｜${asset.disclosure}`, {
    x: box.x, y: box.y + box.h + 0.08, w: box.w, h: 0.28,
    fontFace: report.theme.tokens.fonts.body, fontSize: 10,
    color: report.theme.tokens.colors.muted, margin: 0, fit: 'shrink',
  })
  return true
}

function addClientEvidence(
  slide: PptxGenJS.Slide,
  report: ClientReport,
  evidenceIds: readonly string[],
  box: Readonly<{ x: number; y: number; w: number; h: number }>,
): void {
  const evidence = evidenceIds.flatMap(id => {
    const row = report.evidence.find(candidate => candidate.evidenceId === id)
    return row === undefined ? [] : [row]
  }).slice(0, 3)
  if (evidence.length === 0) return
  const gap = 0.14
  const height = (box.h - gap * (evidence.length - 1)) / evidence.length
  evidence.forEach((row, index) => {
    const y = box.y + index * (height + gap)
    slide.addText([
      { text: row.statement, options: { bold: true, breakLine: true } },
      { text: `${row.sourceLabel} · ${displayDate(row.sourceDate)}`, options: { breakLine: false } },
    ], {
      x: box.x, y, w: box.w, h: height,
      fontFace: report.theme.tokens.fonts.body, fontSize: 14,
      color: report.theme.tokens.colors.ink, fill: { color: report.theme.tokens.colors.surface },
      breakLine: false, margin: 0.16, valign: 'middle', fit: 'shrink',
    })
  })
}

type ClientSlideRenderer = (
  slide: PptxGenJS.Slide,
  report: ClientReport,
  page: ClientPage,
) => void

const addCoverSlide: ClientSlideRenderer = (slide, report, page) => {
  const { ink, surface, accent } = report.theme.tokens.colors
  slide.background = { color: ink }
  addClientEyebrow(slide, report, '前期策划成果提案', accent)
  addClientTitle(slide, report, report.identity.reportTitle, {
    x: SAFE_X, y: 1.2, w: 8.5, h: 1.55, color: surface, size: 50,
  })
  slide.addText(report.identity.projectName, {
    x: SAFE_X, y: 2.95, w: 7.8, h: 0.45, fontFace: report.theme.tokens.fonts.body,
    fontSize: 20, color: 'C9D7D8', margin: 0,
  })
  slide.addText(report.proposition.coreValue, {
    x: SAFE_X, y: 4.0, w: 8.8, h: 1.18, fontFace: report.theme.tokens.fonts.display,
    fontSize: 24, bold: true, color: surface, margin: 0, fit: 'shrink',
  })
  slide.addText(report.proposition.keywords.join('  ·  '), {
    x: SAFE_X, y: 5.65, w: 8.8, h: 0.32, fontFace: report.theme.tokens.fonts.body,
    fontSize: 12, color: 'C9D7D8', margin: 0,
  })
  addClientImage(slide, report, page.assetIds[0], { x: 9.5, y: 1.25, w: 3.0, h: 4.8 })
}

const addOpeningClaimSlide: ClientSlideRenderer = (slide, report, page) => {
  const dark = page.layoutVariant === 'full-bleed'
  slide.background = { color: dark ? report.theme.tokens.colors.ink : report.theme.tokens.colors.background }
  addClientEyebrow(slide, report, '核心判断')
  addClientTitle(slide, report, page.headline, {
    y: 1.2, w: 10.9, h: 1.1, color: dark ? report.theme.tokens.colors.surface : undefined, size: 34,
  })
  const statement = page.primaryFocus.type === 'claim' ? page.primaryFocus.statement : page.headline
  slide.addText(statement, {
    x: SAFE_X, y: 3.0, w: 10.9, h: 1.75, fontFace: report.theme.tokens.fonts.display,
    fontSize: 28, bold: true, color: dark ? 'DCE7E7' : report.theme.tokens.colors.primary,
    margin: 0, fit: 'shrink',
  })
}

const addChapterDividerSlide: ClientSlideRenderer = (slide, report, page) => {
  slide.background = { color: report.theme.tokens.colors.primary }
  addClientEyebrow(slide, report, '成果章节', 'E4B29F')
  addClientTitle(slide, report, page.headline, {
    y: 1.55, w: 10.7, h: 1.7, color: report.theme.tokens.colors.surface, size: 42,
  })
  const chapter = report.chapters.find(candidate => candidate.id === page.chapterId)
  slide.addText(chapter?.claim ?? page.headline, {
    x: SAFE_X, y: 4.15, w: 9.6, h: 1.15, fontFace: report.theme.tokens.fonts.body,
    fontSize: 22, color: 'DCE7E7', margin: 0, fit: 'shrink',
  })
}

function addEditorialContent(
  slide: PptxGenJS.Slide,
  report: ClientReport,
  page: ClientPage,
  label: string,
): void {
  slide.background = { color: report.theme.tokens.colors.background }
  addClientEyebrow(slide, report, label)
  const imageAdded = addClientImage(slide, report, page.assetIds[0], { x: 7.25, y: 1.35, w: 5.28, h: 4.85 })
  addClientTitle(slide, report, page.headline, { w: imageAdded ? 5.9 : 10.8, h: 1.18 })
  const block = clientBlock(report, page)
  slide.addText(blockText(block), {
    x: SAFE_X, y: 2.35, w: imageAdded ? 5.9 : 7.2, h: 1.55,
    fontFace: report.theme.tokens.fonts.body, fontSize: 18,
    color: report.theme.tokens.colors.ink, margin: 0, valign: 'top', fit: 'shrink',
  })
  addClientEvidence(slide, report, page.evidenceIds, {
    x: SAFE_X, y: 4.15, w: imageAdded ? 5.9 : CONTENT_WIDTH, h: 2.15,
  })
}

const addEvidenceSlide: ClientSlideRenderer = (slide, report, page) => addEditorialContent(slide, report, page, '事实与判断')
const addOpportunitySlide: ClientSlideRenderer = (slide, report, page) => addEditorialContent(slide, report, page, '机会识别')

const addPositioningSlide: ClientSlideRenderer = (slide, report, page) => {
  slide.background = { color: report.theme.tokens.colors.background }
  addClientEyebrow(slide, report, '定位与策略')
  addClientTitle(slide, report, page.headline, { h: 1.12 })
  slide.addText(report.proposition.positioning, {
    x: SAFE_X, y: 2.45, w: CONTENT_WIDTH, h: 1.15,
    fontFace: report.theme.tokens.fonts.display, fontSize: 32, bold: true,
    color: report.theme.tokens.colors.primary, margin: 0, fit: 'shrink',
  })
  slide.addText(blockText(clientBlock(report, page)), {
    x: SAFE_X, y: 4.35, w: 8.2, h: 1.25, fontFace: report.theme.tokens.fonts.body,
    fontSize: 18, color: report.theme.tokens.colors.ink, margin: 0, fit: 'shrink',
  })
}

const addProductSlide: ClientSlideRenderer = (slide, report, page) => {
  slide.background = { color: report.theme.tokens.colors.background }
  addClientEyebrow(slide, report, '核心产品')
  const block = clientBlock(report, page)
  const product = clientProduct(report, page, block)
  addClientTitle(slide, report, product?.name ?? page.headline, { w: 6.05, h: 1.1 })
  slide.addText(product?.valueProposition ?? blockText(block), {
    x: SAFE_X, y: 2.25, w: 5.8, h: 1.05, fontFace: report.theme.tokens.fonts.body,
    fontSize: 18, color: report.theme.tokens.colors.primary, bold: true, margin: 0, fit: 'shrink',
  })
  const details = product === undefined ? blockText(block) : [
    `内容组合｜${product.contents.join(' · ')}`,
    `使用场景｜${product.usageScenarios.join(' · ')}`,
    `运营方式｜${product.operatingModel}`,
  ].join('\n')
  slide.addText(details, {
    x: SAFE_X, y: 3.6, w: 5.8, h: 2.2, fontFace: report.theme.tokens.fonts.body,
    fontSize: 16, color: report.theme.tokens.colors.ink, breakLine: false,
    margin: 0.12, fit: 'shrink',
  })
  if (!addClientImage(slide, report, page.assetIds[0], { x: 7.0, y: 1.25, w: 5.53, h: 5.2 })) {
    addClientEvidence(slide, report, product?.evidenceIds ?? page.evidenceIds, { x: 7.0, y: 1.55, w: 5.53, h: 4.6 })
  }
}

const addSceneSlide: ClientSlideRenderer = (slide, report, page) => {
  const hasImage = addClientImage(slide, report, page.assetIds[0], { x: 6.45, y: 0.72, w: 6.08, h: 5.9 })
  slide.background = { color: report.theme.tokens.colors.background }
  addClientEyebrow(slide, report, '空间场景')
  addClientTitle(slide, report, page.headline, { w: hasImage ? 5.2 : 10.9, h: 1.25 })
  slide.addText(blockText(clientBlock(report, page)), {
    x: SAFE_X, y: 2.65, w: hasImage ? 5.1 : 8.4, h: 1.5,
    fontFace: report.theme.tokens.fonts.body, fontSize: 20,
    color: report.theme.tokens.colors.primary, margin: 0, fit: 'shrink',
  })
}

const addImplementationSlide: ClientSlideRenderer = (slide, report, page) => {
  slide.background = { color: report.theme.tokens.colors.background }
  addClientEyebrow(slide, report, '实施路径')
  addClientTitle(slide, report, page.headline, { h: 1.08 })
  slide.addText(blockText(clientBlock(report, page)), {
    x: SAFE_X, y: 2.25, w: 7.15, h: 3.35,
    fontFace: report.theme.tokens.fonts.body, fontSize: 18,
    color: report.theme.tokens.colors.ink, fill: { color: report.theme.tokens.colors.surface },
    margin: 0.24, valign: 'middle', fit: 'shrink',
  })
  addClientEvidence(slide, report, page.evidenceIds, { x: 8.25, y: 2.25, w: 4.28, h: 3.35 })
}

const addDecisionSlide: ClientSlideRenderer = (slide, report, page) => {
  slide.background = { color: report.theme.tokens.colors.ink }
  addClientEyebrow(slide, report, '共同决策')
  addClientTitle(slide, report, page.headline, { color: report.theme.tokens.colors.surface, h: 1.1 })
  const block = clientBlock(report, page)
  const asks = block?.type === 'decision'
    ? block.asks
    : page.primaryFocus.type === 'decision'
      ? page.primaryFocus.asks
      : []
  const rows = asks.length === 0 ? ['确认项目定位与首期实施边界'] : asks
  rows.slice(0, 4).forEach((ask, index) => {
    slide.addText([
      { text: String(index + 1).padStart(2, '0'), options: { bold: true } },
      { text: `  ${ask}`, options: { bold: false } },
    ], {
      x: SAFE_X, y: 2.45 + index * 0.88, w: 10.8, h: 0.64,
      fontFace: report.theme.tokens.fonts.body, fontSize: 20,
      color: report.theme.tokens.colors.surface, breakLine: false,
      margin: 0.08, fit: 'shrink',
    })
  })
}

const addAppendixSlide: ClientSlideRenderer = (slide, report, page) => {
  slide.background = { color: report.theme.tokens.colors.background }
  addClientEyebrow(slide, report, '依据索引')
  addClientTitle(slide, report, page.headline, { h: 1.15 })
  addClientEvidence(slide, report, page.evidenceIds, { x: SAFE_X, y: 2.45, w: CONTENT_WIDTH, h: 3.8 })
}

const PPTX_LAYOUTS: Readonly<Record<ClientPageKind, ClientSlideRenderer>> = {
  cover: addCoverSlide,
  'opening-claim': addOpeningClaimSlide,
  'chapter-divider': addChapterDividerSlide,
  evidence: addEvidenceSlide,
  opportunity: addOpportunitySlide,
  positioning: addPositioningSlide,
  product: addProductSlide,
  scene: addSceneSlide,
  implementation: addImplementationSlide,
  decision: addDecisionSlide,
  appendix: addAppendixSlide,
}

async function renderClientPptx(
  context: ClientRenderContext,
  outputPath: string,
): Promise<RenderedArtifact> {
  assertClientReportPolicy(context.report)
  assertClientPagePlan(context.plan)
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'ArchitectureWorld 前期策划'
  pptx.company = 'ArchitectureWorld'
  pptx.subject = `sourceRevision=${context.identity.sourceRevision};recommendationId=${context.identity.recommendationId};adoptedAssetIds=${[...context.identity.adoptedAssetIds].sort().join(',')}`
  pptx.title = context.report.identity.reportTitle
  pptx.theme = {
    headFontFace: context.report.theme.tokens.fonts.display,
    bodyFontFace: context.report.theme.tokens.fonts.body,
  }

  context.plan.pages.forEach((page, index) => {
    const slide = pptx.addSlide()
    PPTX_LAYOUTS[page.kind](slide, context.report, page)
    addClientFooter(slide, context.report, index + 1)
    slide.addNotes(clientNotes(context, page))
  })

  await pptx.writeFile({ fileName: outputPath })
  return {
    format: 'pptx',
    fileName: basename(outputPath),
    path: outputPath,
    bytes: (await stat(outputPath)).size,
    sha256: createHash('sha256').update(await readFile(outputPath)).digest('hex'),
  }
}

function isClientRenderContext(value: ClientRenderContext | ReportDocument): value is ClientRenderContext {
  return 'report' in value && 'plan' in value && 'identity' in value
}

export function renderPptx(context: ClientRenderContext, outputPath: string): Promise<RenderedArtifact>
export function renderPptx(document: ReportDocument, outputPath: string): Promise<RenderedArtifact>
export function renderPptx(
  input: ClientRenderContext | ReportDocument,
  outputPath: string,
): Promise<RenderedArtifact> {
  return isClientRenderContext(input)
    ? renderClientPptx(input, outputPath)
    : renderLegacyPptx(input, outputPath)
}
