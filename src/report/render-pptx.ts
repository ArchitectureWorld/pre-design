import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { assertClientReportPolicy } from './client-policy.ts'
import { wrapClientText } from './client-typography.ts'
import type {
  ClientAnalyticalVisual,
  ClientContentBlock,
  ClientPage,
  ClientPageKind,
  ClientProduct,
  ClientRenderContext,
  ClientReport,
  ClientVisualAsset,
} from './client-types.ts'
import { assertClientPagePlan } from './page-plan.ts'
import { addEditableSitePlan } from './render-site-plan.ts'
import { REPORT_THEME } from './theme.ts'
import type { RenderedArtifact, ReportDocument, ReportNode, ReportSection } from './types.ts'

export { wrapClientText } from './client-typography.ts'

const SLIDE_WIDTH = 13.333
const SLIDE_HEIGHT = 7.5

function displayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value)
  return match === null ? value : `${match[1]}-${match[2]}-${match[3]}`
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

function distinctBlockText(report: ClientReport, page: ClientPage): string {
  const copy = blockText(clientBlock(report, page))
  return copy === page.headline ? '' : copy
}

function clientNotes(context: ClientRenderContext, page: ClientPage): string {
  const visualRole = page.visualRole === undefined ? '' : `\n[VisualRole]${page.visualRole}`
  const boundary = context.identity.siteBoundaryIntegrityDigest === undefined ? '' : `\nsiteBoundaryIntegrityDigest=${context.identity.siteBoundaryIntegrityDigest}`
  return `[PageKind]${page.kind}${visualRole}\n[Publishable]false\n[PreplanIdentity]\nprojectId=${context.identity.projectId}\nsourceRevision=${context.identity.sourceRevision}\nrecommendationId=${context.identity.recommendationId}\nadoptedAssetIds=${[...context.identity.adoptedAssetIds].sort().join(',')}${boundary}`
}

function addClientFooter(
  slide: PptxGenJS.Slide,
  report: ClientReport,
  pageNumber: number,
  dark: boolean,
): void {
  const { muted, accent } = report.theme.tokens.colors
  slide.addText('前期策划成果提案', {
    x: SAFE_X, y: 7.05, w: 3.2, h: 0.2, fontFace: report.theme.tokens.fonts.body,
    fontSize: 10, color: dark ? 'C9D7D8' : muted, margin: 0,
  })
  slide.addText(String(pageNumber).padStart(2, '0'), {
    x: 11.75, y: 7.03, w: 0.78, h: 0.22, fontFace: report.theme.tokens.fonts.body,
    fontSize: 10, bold: true, align: 'right', color: dark ? 'F5F5F7' : accent, margin: 0,
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
  const width = options.w ?? CONTENT_WIDTH
  const height = options.h ?? 1.05
  const fontSize = options.size ?? 30
  const maximumLineWidth = Math.max(6, Math.floor(width * 72 / fontSize * 0.98))
  const maximumLines = Math.max(1, Math.floor(height / (fontSize / 72 * 1.12)))
  const fitted = wrapClientText(headline, maximumLineWidth, maximumLines, 'CLIENT_PPTX_TITLE_TEXT_BUDGET_EXCEEDED')
  slide.addText(fitted, {
    x: options.x ?? SAFE_X,
    y: options.y ?? 0.92,
    w: width,
    h: height,
    fontFace: report.theme.tokens.fonts.display,
    fontSize,
    bold: true,
    color: options.color ?? report.theme.tokens.colors.ink,
    margin: 0,
    valign: 'top',
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
  options: Readonly<{
    captionBox?: Readonly<{ x: number; y: number; w: number; h: number }>
    captionColor?: string
    showCaption?: boolean
  }> = {},
): boolean {
  const asset = report.assets.find(candidate => candidate.assetId === assetId)
  if (asset === undefined) return false
  const geometry = imageGeometry(asset, box)
  slide.addImage({ path: asset.sourcePath, ...geometry, altText: asset.caption })
  if (options.showCaption === false) return true
  const captionBox = options.captionBox ?? {
    x: box.x,
    y: box.y + box.h + 0.08,
    w: box.w,
    h: 0.28,
  }
  slide.addText(asset.caption, {
    ...captionBox,
    fontFace: report.theme.tokens.fonts.body, fontSize: 10,
    color: options.captionColor ?? report.theme.tokens.colors.muted, margin: 0, fit: 'shrink',
  })
  return true
}

function visualContractText(report: ClientReport, page: ClientPage): string {
  const asset = report.assets.find(candidate => candidate.assetId === page.assetIds[0])
  if (asset === undefined || asset.provenance === undefined) return ''
  const rows = [`${asset.provenance.sourceLabel} · ${displayDate(asset.provenance.sourceDate)} · ${asset.provenance.locator}`]
  if (asset.analysisKind !== undefined && asset.cartography !== undefined) {
    const boundary = asset.cartography.boundary === 'confirmed' ? '项目边界：已由项目资料确认'
      : asset.cartography.boundary === 'research' ? (asset.cartography.disclosures ?? []).join(' · ')
        : '项目边界：不适用'
    rows.push(`${boundary} · 图例 · N · ${asset.cartography.scale.kind === 'nts' ? 'NTS' : asset.cartography.scale.label}`)
  }
  if (asset.role === 'chart' && asset.chartContract !== undefined) {
    rows.push(`单位：${asset.chartContract.unit} · 口径：${asset.chartContract.methodology}`)
  }
  return rows.join('\n')
}

function addClientEvidence(
  slide: PptxGenJS.Slide,
  report: ClientReport,
  evidenceIds: readonly string[],
  box: Readonly<{ x: number; y: number; w: number; h: number }>,
  options: Readonly<{ variant?: 'card' | 'flat'; maxItems?: number }> = {},
): void {
  const evidence = evidenceIds.flatMap(id => {
    const row = report.evidence.find(candidate => candidate.evidenceId === id)
    return row === undefined ? [] : [row]
  }).slice(0, options.maxItems ?? 3)
  if (evidence.length === 0) return
  const flat = options.variant === 'flat'
  const gap = 0.14
  const height = (box.h - gap * (evidence.length - 1)) / evidence.length
  evidence.forEach((row, index) => {
    const y = box.y + index * (height + gap)
    const margin: number | [number, number, number, number] = flat ? 0 : [8, 12, 8, 12]
    const horizontalMargin = flat ? 0 : 24 / 72
    const statementWidth = Math.max(10, Math.floor((box.w - horizontalMargin) * 72 / 14 * 0.94))
    const sourceWidth = Math.max(14, Math.floor((box.w - horizontalMargin) * 72 / 10 * 0.94))
    const statement = wrapClientText(row.statement, statementWidth, 3, 'CLIENT_PPTX_EVIDENCE_TEXT_BUDGET_EXCEEDED')
    const source = wrapClientText(
      `${row.sourceLabel} · ${displayDate(row.sourceDate)}`,
      sourceWidth,
      2,
      'CLIENT_PPTX_EVIDENCE_SOURCE_BUDGET_EXCEEDED',
    )
    slide.addText([
      { text: statement, options: { bold: true, breakLine: true } },
      { text: source, options: { breakLine: false, fontSize: 10, color: report.theme.tokens.colors.muted } },
    ], {
      x: box.x, y, w: box.w, h: height,
      fontFace: report.theme.tokens.fonts.body, fontSize: 14,
      color: report.theme.tokens.colors.ink,
      ...(flat ? {} : { fill: { color: report.theme.tokens.colors.surface } }),
      breakLine: false, margin, valign: 'top',
    })
  })
}

function addAnalysisRule(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  width: number,
  color: string,
  name: string,
): void {
  slide.addShape('line', {
    x, y, w: width, h: 0,
    line: { color, width: 2.2 },
    objectName: name,
  })
}

function addAnalysisDisclosure(
  slide: PptxGenJS.Slide,
  report: ClientReport,
  value: string,
  y = 5.55,
): void {
  slide.addText(value, {
    x: SAFE_X, y, w: CONTENT_WIDTH, h: 0.28,
    fontFace: report.theme.tokens.fonts.body,
    fontSize: 10,
    color: report.theme.tokens.colors.muted,
    margin: 0,
    fit: 'shrink',
    objectName: 'AnalysisVisual Disclosure',
  })
}

function addAnalysisText(
  slide: PptxGenJS.Slide,
  report: ClientReport,
  value: string,
  box: Readonly<{ x: number; y: number; w: number; h: number }>,
  options: Readonly<{
    size?: number
    color?: string
    bold?: boolean
    align?: 'left' | 'center' | 'right'
    valign?: 'top' | 'middle' | 'bottom'
    name?: string
  }> = {},
): void {
  slide.addText(value, {
    ...box,
    fontFace: report.theme.tokens.fonts.body,
    fontSize: options.size ?? 16,
    color: options.color ?? report.theme.tokens.colors.ink,
    bold: options.bold ?? false,
    align: options.align ?? 'left',
    valign: options.valign ?? 'top',
    margin: 0,
    fit: 'shrink',
    objectName: options.name ?? 'AnalysisVisual Text',
  })
}

function addAnalyticalVisual(
  slide: PptxGenJS.Slide,
  report: ClientReport,
  page: ClientPage,
): boolean {
  const visual: ClientAnalyticalVisual | undefined = page.analyticalVisual
  if (visual === undefined) return false
  const { primary, accent, ink, muted, surface } = report.theme.tokens.colors

  if (visual.kind === 'urgency-signals') {
    const signals = visual.signals.slice(0, 3)
    const startX = 4.05
    const gap = 0.36
    const width = (CONTENT_RIGHT - startX - gap * Math.max(0, signals.length - 1)) / Math.max(1, signals.length)
    signals.forEach((_, index) => addAnalysisRule(
      slide,
      startX + index * (width + gap),
      2.68,
      width,
      primary,
      `AnalysisVisual Urgency Rule ${index + 1}`,
    ))
    addAnalysisText(slide, report, wrapClientText(
      visual.countLabel,
      5,
      2,
      'CLIENT_PPTX_URGENCY_COUNT_BUDGET_EXCEEDED',
    ), { x: SAFE_X, y: 3.02, w: 2.85, h: 0.8 }, {
      size: 38, color: primary, bold: true, name: 'AnalysisVisual Urgency Count',
    })
    signals.forEach((signal, index) => {
      const x = startX + index * (width + gap)
      addAnalysisText(slide, report, String(index + 1).padStart(2, '0'), { x, y: 2.87, w: width, h: 0.28 }, {
        size: 11, color: accent, bold: true, name: `AnalysisVisual Urgency Order ${index + 1}`,
      })
      addAnalysisText(slide, report, signal.label, { x, y: 3.35, w: width, h: 0.45 }, {
        size: 20, bold: true, name: `AnalysisVisual Urgency Label ${index + 1}`,
      })
      addAnalysisText(slide, report, signal.state, { x, y: 4.03, w: width, h: 0.85 }, {
        size: 14, color: muted, name: `AnalysisVisual Urgency State ${index + 1}`,
      })
    })
    addAnalysisDisclosure(slide, report, visual.disclosure)
    return true
  }

  if (visual.kind === 'spatial-sequence' || visual.kind === 'spatial-system') {
    addEditableSitePlan(slide, report, visual)
    return true
  }

  if (visual.kind === 'operating-model') {
    const layers = visual.layers.slice(0, 3)
    const teams = visual.teams.slice(0, 3)
    const gap = 0.55
    const nodeWidth = (CONTENT_WIDTH - gap * 2) / 3
    const xs = layers.map((_, index) => SAFE_X + index * (nodeWidth + gap))
    addAnalysisText(slide, report, '三类运营策略', { x: SAFE_X, y: 2.08, w: 2.2, h: 0.28 }, {
      size: 11, color: accent, bold: true, name: 'AnalysisVisual Operating Strategy Heading',
    })
    addAnalysisText(slide, report, '建设 / 内容策划 / 运营三团队', { x: SAFE_X, y: 5.47, w: CONTENT_WIDTH, h: 0.25 }, {
      size: 10, color: muted, bold: true, align: 'center', name: 'AnalysisVisual Operating Team Heading',
    })
    layers.forEach((_, index) => addAnalysisRule(
      slide,
      xs[index] ?? SAFE_X,
      2.42,
      nodeWidth,
      primary,
      `AnalysisVisual Operating Strategy Rule ${index + 1}`,
    ))
    layers.forEach((layer, index) => {
      const x = xs[index] ?? SAFE_X
      addAnalysisText(slide, report, String(index + 1).padStart(2, '0'), { x, y: 2.58, w: nodeWidth, h: 0.24 }, {
        size: 11, color: accent, bold: true, name: `AnalysisVisual Operating Layer Order ${index + 1}`,
      })
      addAnalysisText(slide, report, layer, { x, y: 2.78, w: nodeWidth, h: 0.39 }, {
        size: 17, bold: true, name: `AnalysisVisual Operating Strategy ${index + 1}`,
      })
      slide.addShape('line', {
        x: x + nodeWidth / 2, y: 3.2, w: 0, h: 0.53,
        line: { color: muted, width: 1.3, endArrowType: 'triangle' },
        objectName: `AnalysisVisual Operating Strategy Arrow ${index + 1}`,
      })
    })
    slide.addShape('rect', {
      x: SAFE_X, y: 3.76, w: CONTENT_WIDTH, h: 0.68,
      fill: { color: primary, transparency: 90 },
      line: { color: primary, width: 0.9 },
      objectName: 'AnalysisVisual Operating Common Value Surface',
    })
    addAnalysisText(slide, report, `共同价值｜${visual.outcome}`, { x: SAFE_X, y: 3.76, w: CONTENT_WIDTH, h: 0.68 }, {
      size: 22, color: primary, bold: true, align: 'center', valign: 'middle', name: 'AnalysisVisual Operating Common Value',
    })
    teams.forEach((team, index) => {
      const x = xs[index] ?? SAFE_X
      slide.addShape('line', {
        x: x + nodeWidth / 2, y: 4.47, w: 0, h: 0.46,
        line: { color: muted, width: 1.3, endArrowType: 'triangle' },
        objectName: `AnalysisVisual Operating Team Arrow ${index + 1}`,
      })
      addAnalysisText(slide, report, team, { x, y: 4.96, w: nodeWidth, h: 0.42 }, {
        size: 16, bold: true, align: 'center', valign: 'middle', name: `AnalysisVisual Operating Team ${index + 1}`,
      })
    })
    return true
  }

  if (visual.kind === 'daypart-matrix') {
    const columns = visual.columns.slice(0, 4)
    const rows = visual.rows.slice(0, 4)
    const labelWidth = 2.35
    const gridX = SAFE_X + labelWidth
    const gridY = 2.72
    const gridWidth = CONTENT_WIDTH - labelWidth
    const cellWidth = gridWidth / Math.max(1, columns.length)
    const cellHeight = 0.62
    rows.forEach((_, rowIndex) => columns.forEach((_, columnIndex) => {
      const level = visual.values[rowIndex]?.[columnIndex] ?? '中'
      const transparency = level === '高' ? 36 : level === '中' ? 64 : 82
      slide.addShape('rect', {
        x: gridX + columnIndex * cellWidth,
        y: gridY + rowIndex * cellHeight,
        w: cellWidth - 0.05,
        h: cellHeight - 0.05,
        fill: { color: primary, transparency },
        line: { color: surface, transparency: 100 },
        objectName: `AnalysisVisual Matrix Cell ${rowIndex + 1}-${columnIndex + 1}`,
      })
    }))
    addAnalysisText(slide, report, '需求强度（策划示例）', { x: SAFE_X, y: 2.05, w: labelWidth, h: 0.32 }, {
      size: 11, color: accent, bold: true, name: 'AnalysisVisual Matrix Legend',
    })
    columns.forEach((column, index) => addAnalysisText(
      slide,
      report,
      column,
      { x: gridX + index * cellWidth, y: 2.04, w: cellWidth, h: 0.42 },
      { size: 14, color: primary, bold: true, align: 'center', name: `AnalysisVisual Matrix Column ${index + 1}` },
    ))
    rows.forEach((row, rowIndex) => {
      addAnalysisText(slide, report, row, { x: SAFE_X, y: gridY + rowIndex * cellHeight + 0.12, w: labelWidth - 0.18, h: 0.35 }, {
        size: 15, bold: true, name: `AnalysisVisual Matrix Row ${rowIndex + 1}`,
      })
      columns.forEach((_, columnIndex) => addAnalysisText(
        slide,
        report,
        visual.values[rowIndex]?.[columnIndex] ?? '中',
        { x: gridX + columnIndex * cellWidth, y: gridY + rowIndex * cellHeight + 0.13, w: cellWidth, h: 0.28 },
        { size: 12, color: ink, bold: true, align: 'center', name: `AnalysisVisual Matrix Value ${rowIndex + 1}-${columnIndex + 1}` },
      ))
    })
    addAnalysisDisclosure(slide, report, visual.disclosure, 5.55)
    return true
  }

  if (visual.kind === 'investment-sequence') {
    const items = visual.items.slice(0, 3)
    const sharedBasis = items.length > 1 && new Set(items.map(item => item.basis)).size === 1
      ? items[0]?.basis
      : undefined
    const source = clientBlock(report, page)
    const repeatedAmount = source?.type === 'investment'
      && source.items.length === 1
      && new Set(items.map(item => `${item.amount}|${item.unit}`)).size === 1
    const startX = repeatedAmount ? 3.45 : SAFE_X
    const available = CONTENT_RIGHT - startX
    const gap = 0.38
    const width = (available - gap * Math.max(0, items.length - 1)) / Math.max(1, items.length)
    items.forEach((_, index) => addAnalysisRule(
      slide,
      startX + index * (width + gap),
      2.52,
      width,
      primary,
      `AnalysisVisual Investment Rule ${index + 1}`,
    ))
    if (repeatedAmount && items[0] !== undefined) {
      addAnalysisText(slide, report, items[0].amount, { x: SAFE_X, y: 2.62, w: 2.15, h: 0.88 }, {
        size: 42, color: primary, bold: true, name: 'AnalysisVisual Investment Primary Value',
      })
      addAnalysisText(slide, report, items[0].unit, { x: SAFE_X, y: 3.68, w: 2.2, h: 0.35 }, {
        size: 14, color: muted, bold: true, name: 'AnalysisVisual Investment Primary Unit',
      })
    }
    items.forEach((item, index) => {
      const x = startX + index * (width + gap)
      addAnalysisText(slide, report, `${item.order} ${item.label}`, { x, y: 2.78, w: width, h: 0.5 }, {
        size: 17, bold: true, name: `AnalysisVisual Investment Label ${index + 1}`,
      })
      addAnalysisText(slide, report, `${item.amount}${item.unit === '' ? '' : ` ${item.unit}`}`, { x, y: 3.56, w: width, h: 0.68 }, {
        size: 28, color: primary, bold: true, name: `AnalysisVisual Investment Amount ${index + 1}`,
      })
      if (sharedBasis === undefined) {
        addAnalysisText(slide, report, item.basis, { x, y: 4.48, w: width, h: 0.62 }, {
          size: 10, color: muted, name: `AnalysisVisual Investment Basis ${index + 1}`,
        })
      }
    })
    if (sharedBasis !== undefined) {
      addAnalysisText(slide, report, `测算口径｜${sharedBasis}`, { x: SAFE_X, y: 4.78, w: CONTENT_WIDTH, h: 0.28 }, {
        size: 10, color: muted, name: 'AnalysisVisual Investment Shared Basis',
      })
    }
    addAnalysisDisclosure(slide, report, visual.disclosure, 5.48)
    return true
  }

  if (visual.kind === 'decision-triad') {
    const items = visual.items.slice(0, 3)
    const gap = 0.45
    const width = (CONTENT_WIDTH - gap * Math.max(0, items.length - 1)) / Math.max(1, items.length)
    items.forEach((_, index) => addAnalysisRule(
      slide,
      SAFE_X + index * (width + gap),
      2.48,
      width,
      primary,
      `AnalysisVisual Decision Rule ${index + 1}`,
    ))
    items.forEach((item, index) => {
      const x = SAFE_X + index * (width + gap)
      addAnalysisText(slide, report, item.order, { x, y: 2.68, w: width, h: 0.28 }, {
        size: 11, color: accent, bold: true, name: `AnalysisVisual Decision Order ${index + 1}`,
      })
      addAnalysisText(slide, report, item.label, { x, y: 3.02, w: width, h: 0.48 }, {
        size: 19, bold: true, name: `AnalysisVisual Decision Input ${index + 1}`,
      })
      addAnalysisText(slide, report, item.output, { x, y: 3.53, w: width, h: 0.27 }, {
        size: 12, color: primary, bold: true, name: `AnalysisVisual Decision Result ${index + 1}`,
      })
      slide.addShape('line', {
        x: x + width / 2, y: 3.83, w: 0, h: 0.63,
        line: { color: muted, width: 1.3, endArrowType: 'triangle' },
        objectName: `AnalysisVisual Decision Arrow ${index + 1}`,
      })
    })
    slide.addShape('rect', {
      x: SAFE_X, y: 4.49, w: CONTENT_WIDTH, h: 0.92,
      fill: { color: primary, transparency: 90 },
      line: { color: primary, width: 0.9 },
      objectName: 'AnalysisVisual Decision Common Input Surface',
    })
    addAnalysisText(slide, report, '形成统一输入（定位结论·首期边界图·协同机制）', { x: SAFE_X, y: 4.5, w: CONTENT_WIDTH, h: 0.88 }, {
      size: 18, color: primary, bold: true, align: 'center', valign: 'middle', name: 'AnalysisVisual Decision Common Input',
    })
    return true
  }

  const decisions = visual.decisions.slice(0, 3)
  const outputs = visual.outputs.slice(0, 3)
  decisions.forEach((_, index) => slide.addShape('line', {
    x: 5.45, y: 2.8 + index * 0.88, w: 1.9, h: 0,
    line: { color: accent, width: 1.5, endArrowType: 'triangle' },
    objectName: `AnalysisVisual Decision Flow Connector ${index + 1}`,
  }))
  addAnalysisRule(slide, SAFE_X, 2.25, 4.65, primary, 'AnalysisVisual Decision Flow Left Rule')
  addAnalysisRule(slide, 7.55, 2.25, 4.98, primary, 'AnalysisVisual Decision Flow Right Rule')
  addAnalysisText(slide, report, '共同确认', { x: SAFE_X, y: 2.42, w: 4.65, h: 0.3 }, {
    size: 11, color: accent, bold: true, name: 'AnalysisVisual Decision Flow Left Heading',
  })
  addAnalysisText(slide, report, '确认后进入', { x: 7.55, y: 2.42, w: 4.98, h: 0.3 }, {
    size: 11, color: accent, bold: true, name: 'AnalysisVisual Decision Flow Right Heading',
  })
  decisions.forEach((decision, index) => addAnalysisText(
    slide,
    report,
    decision,
    { x: SAFE_X, y: 2.72 + index * 0.88, w: 4.65, h: 0.44 },
    { size: 17, bold: true, name: `AnalysisVisual Decision Flow Input ${index + 1}` },
  ))
  outputs.forEach((output, index) => addAnalysisText(
    slide,
    report,
    output,
    { x: 7.55, y: 2.72 + index * 0.88, w: 4.98, h: 0.44 },
    { size: 17, color: primary, bold: true, name: `AnalysisVisual Decision Flow Output ${index + 1}` },
  ))
  return true
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
    x: SAFE_X, y: 1.2, w: 6.45, h: 1.72, color: surface, size: 50,
  })
  slide.addText(report.identity.projectName, {
    x: SAFE_X, y: 3.12, w: 6.45, h: 0.45, fontFace: report.theme.tokens.fonts.body,
    fontSize: 20, color: 'C9D7D8', margin: 0,
  })
  slide.addText(report.proposition.projectDefinition, {
    x: SAFE_X, y: 4.05, w: 6.45, h: 1.28, fontFace: report.theme.tokens.fonts.display,
    fontSize: 24, bold: true, color: surface, margin: 0, fit: 'shrink',
  })
  slide.addText(report.proposition.keywords.join('  ·  '), {
    x: SAFE_X, y: 5.78, w: 6.45, h: 0.32, fontFace: report.theme.tokens.fonts.body,
    fontSize: 12, color: 'C9D7D8', margin: 0,
  })
  addClientImage(slide, report, page.assetIds[0], { x: 7.55, y: 0.92, w: 4.98, h: 5.72 })
}

const addOpeningClaimSlide: ClientSlideRenderer = (slide, report, page) => {
  const dark = page.layoutVariant === 'full-bleed'
  slide.background = { color: dark ? report.theme.tokens.colors.ink : report.theme.tokens.colors.background }
  addClientEyebrow(slide, report, '核心判断')
  addClientTitle(slide, report, page.headline, {
    y: 1.2, w: 10.9, h: 1.1, color: dark ? report.theme.tokens.colors.surface : undefined, size: 34,
  })
  const statement = page.primaryFocus.type === 'claim' ? page.primaryFocus.statement : page.headline
  if (page.analyticalVisual !== undefined) {
    slide.addText(wrapClientText(statement, 12, 4, 'CLIENT_PPTX_OPENING_TEXT_BUDGET_EXCEEDED'), {
      x: SAFE_X, y: 2.12, w: 2.85, h: 0.72,
      fontFace: report.theme.tokens.fonts.body, fontSize: 16, bold: true,
      color: dark ? 'DCE7E7' : report.theme.tokens.colors.primary,
      margin: 0, fit: 'shrink', objectName: 'AnalysisVisual Opening Claim',
    })
    addAnalyticalVisual(slide, report, page)
    return
  }
  const fittedStatement = wrapClientText(statement, 25, 3, 'CLIENT_PPTX_OPENING_TEXT_BUDGET_EXCEEDED')
  slide.addText(fittedStatement, {
    x: SAFE_X, y: 3.0, w: 10.9, h: 1.75, fontFace: report.theme.tokens.fonts.display,
    fontSize: 28, bold: true, color: dark ? 'DCE7E7' : report.theme.tokens.colors.primary,
    margin: 0, fit: 'shrink',
  })
}

const addChapterDividerSlide: ClientSlideRenderer = (slide, report, page) => {
  const chapterNumber = Number(page.chapterId.match(/(\d+)$/u)?.[1] ?? 0)
  slide.background = {
    color: chapterNumber % 2 === 0
      ? report.theme.tokens.colors.ink
      : report.theme.tokens.colors.primary,
  }
  addClientEyebrow(slide, report, '成果章节', 'E4B29F')
  addClientTitle(slide, report, page.headline, {
    y: 1.55, w: 10.7, h: 1.7, color: report.theme.tokens.colors.surface, size: 42,
  })
  const chapter = report.chapters.find(candidate => candidate.id === page.chapterId)
  const displayClaim = wrapClientText(
    chapter?.claim ?? page.headline,
    32,
    3,
    'CLIENT_PPTX_CHAPTER_TEXT_BUDGET_EXCEEDED',
  )
  slide.addText(displayClaim, {
    x: SAFE_X, y: 3.95, w: 9.6, h: 1.4, fontFace: report.theme.tokens.fonts.body,
    fontSize: 21, color: 'DCE7E7', margin: 0,
  })
}

const CLIENT_VISUAL_ROLE_LABELS = Object.freeze({
  map: '场地与区位',
  diagram: '空间逻辑',
  chart: '数据洞察',
})

function fullBleedTextLayout(headline: string, copy: string, contract: string): Readonly<{
  headline: string
  copy: string
  contract: string
}> {
  const errorCode = 'CLIENT_PPTX_FULL_BLEED_TEXT_BUDGET_EXCEEDED'
  return {
    headline: wrapClientText(headline, 9, 2, errorCode),
    copy: wrapClientText(copy, 22, 3, errorCode),
    contract: wrapClientText(contract, 28, 4, errorCode),
  }
}

const addVisualEvidenceSlide: ClientSlideRenderer = (slide, report, page) => {
  const role = page.visualRole ?? 'diagram'
  const block = clientBlock(report, page)
  const product = clientProduct(report, page, block)
  const copy = block?.type === 'product' || block?.type === 'scene'
    ? product?.valueProposition ?? blockText(block)
    : block?.type === 'comparison'
      ? `${block.before}\n→ ${block.after}`
      : distinctBlockText(report, page)
  const contract = visualContractText(report, page)
  const { background, ink, surface, primary } = report.theme.tokens.colors

  if (page.layoutVariant === 'full-bleed') {
    const fittedText = fullBleedTextLayout(page.headline, copy, contract)
    slide.background = { color: ink }
    addClientImage(
      slide,
      report,
      page.assetIds[0],
      { x: 0, y: 1.0, w: SLIDE_WIDTH, h: 6.5 },
      { showCaption: false },
    )
    slide.addText(fittedText.headline, {
      x: SAFE_X, y: 0.15, w: 3.0, h: 0.70,
      fontFace: report.theme.tokens.fonts.display, fontSize: 24, bold: true,
      color: surface, margin: 0,
    })
    if (copy !== '') slide.addText(fittedText.copy, {
      x: 4.0, y: 0.1, w: 4.3, h: 0.72,
      fontFace: report.theme.tokens.fonts.body, fontSize: 14,
      color: 'C9D7D8', margin: 0,
    })
    if (contract !== '') slide.addText(fittedText.contract, {
      x: 8.5, y: 0.1, w: 4.03, h: 0.72,
      fontFace: report.theme.tokens.fonts.body, fontSize: 10,
      color: 'C9D7D8', margin: 0,
    })
    return
  }

  if (page.layoutVariant === 'split') {
    const copyWidth = role === 'chart' ? 4.55 : 5.2
    const imageX = role === 'chart' ? 5.55 : 6.75
    const imageWidth = role === 'chart' ? 6.98 : 5.78
    slide.background = { color: background }
    addClientEyebrow(slide, report, CLIENT_VISUAL_ROLE_LABELS[role])
    addClientTitle(slide, report, page.headline, { x: SAFE_X, y: 1.12, w: copyWidth, h: 1.25, size: 30 })
    if (copy !== '') slide.addText(wrapClientText(copy, role === 'chart' ? 16 : 19, 3, 'CLIENT_PPTX_VISUAL_COPY_BUDGET_EXCEEDED'), {
      x: SAFE_X, y: 2.72, w: copyWidth, h: 1.1,
      fontFace: report.theme.tokens.fonts.body, fontSize: 17,
      color: primary, margin: 0, fit: 'shrink',
    })
    if (contract !== '') slide.addText(wrapClientText(contract, role === 'chart' ? 30 : 34, 6, 'CLIENT_PPTX_VISUAL_CONTRACT_BUDGET_EXCEEDED'), {
      x: SAFE_X, y: 4.28, w: copyWidth, h: 1.12,
      fontFace: report.theme.tokens.fonts.body, fontSize: 10,
      color: report.theme.tokens.colors.muted, margin: 0, fit: 'shrink',
    })
    addClientImage(slide, report, page.assetIds[0], { x: imageX, y: 0.72, w: imageWidth, h: 5.92 })
    return
  }

  slide.background = { color: ink }
  addClientEyebrow(slide, report, CLIENT_VISUAL_ROLE_LABELS[role])
  addClientTitle(slide, report, page.headline, {
    x: SAFE_X, y: 1.05, w: 3.85, h: 1.55, color: surface, size: 27,
  })
  if (copy !== '') slide.addText(wrapClientText(copy, 16, 4, 'CLIENT_PPTX_VISUAL_COPY_BUDGET_EXCEEDED'), {
    x: SAFE_X, y: 2.82, w: 3.85, h: 1.15,
    fontFace: report.theme.tokens.fonts.body, fontSize: 15,
    color: 'C9D7D8', margin: 0, fit: 'shrink',
  })
  if (contract !== '') slide.addText(wrapClientText(contract, 28, 7, 'CLIENT_PPTX_VISUAL_CONTRACT_BUDGET_EXCEEDED'), {
    x: SAFE_X, y: 4.22, w: 3.85, h: 1.3,
    fontFace: report.theme.tokens.fonts.body, fontSize: 10,
    color: 'C9D7D8', margin: 0, fit: 'shrink',
  })
  addClientImage(slide, report, page.assetIds[0], { x: 4.8, y: 0.65, w: 7.73, h: 5.85 }, { captionColor: 'C9D7D8' })
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
  if (!imageAdded && addAnalyticalVisual(slide, report, page)) {
    if (page.analyticalVisual?.kind !== 'decision-triad') {
      addClientEvidence(slide, report, page.evidenceIds, {
        x: SAFE_X, y: 5.88, w: CONTENT_WIDTH, h: 0.72,
      }, { variant: 'flat', maxItems: 1 })
    }
    return
  }
  const block = clientBlock(report, page)
  const distinctCopy = distinctBlockText(report, page)
  const chapterClaim = report.chapters.find(chapter => chapter.id === page.chapterId)?.claim ?? ''
  const copy = distinctCopy !== ''
    ? distinctCopy
    : !imageAdded && chapterClaim !== page.headline ? chapterClaim : ''
  if (copy !== '') slide.addText(copy, {
    x: SAFE_X, y: 2.35, w: imageAdded ? 5.9 : CONTENT_WIDTH, h: imageAdded ? 1.55 : 1.65,
    fontFace: imageAdded ? report.theme.tokens.fonts.body : report.theme.tokens.fonts.display,
    fontSize: imageAdded ? 18 : 28, bold: !imageAdded,
    color: imageAdded ? report.theme.tokens.colors.ink : report.theme.tokens.colors.primary,
    margin: 0, valign: 'top', fit: 'shrink',
  })
  addClientEvidence(slide, report, page.evidenceIds, {
    x: SAFE_X, y: imageAdded ? 4.15 : 4.55, w: imageAdded ? 5.9 : CONTENT_WIDTH, h: imageAdded ? 2.15 : 1.45,
  }, imageAdded ? {} : { variant: 'flat' })
}

const addEvidenceSlide: ClientSlideRenderer = (slide, report, page) => addEditorialContent(slide, report, page, '事实与判断')
const addOpportunitySlide: ClientSlideRenderer = (slide, report, page) => addEditorialContent(slide, report, page, '机会识别')

const addPositioningSlide: ClientSlideRenderer = (slide, report, page) => {
  slide.background = { color: report.theme.tokens.colors.background }
  addClientEyebrow(slide, report, '定位与策略')
  const hasImage = addClientImage(slide, report, page.assetIds[0], { x: 7.25, y: 1.25, w: 5.28, h: 4.9 })
  addClientTitle(slide, report, page.headline, { w: hasImage ? 5.9 : CONTENT_WIDTH, h: 1.12 })
  slide.addText(report.proposition.positioning, {
    x: SAFE_X, y: 2.45, w: hasImage ? 5.9 : CONTENT_WIDTH, h: 1.15,
    fontFace: report.theme.tokens.fonts.display, fontSize: 32, bold: true,
    color: report.theme.tokens.colors.primary, margin: 0, fit: 'shrink',
  })
  const copy = distinctBlockText(report, page)
  if (copy !== '') slide.addText(copy, {
    x: SAFE_X, y: 4.35, w: hasImage ? 5.9 : 8.2, h: 1.25, fontFace: report.theme.tokens.fonts.body,
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
  const block = clientBlock(report, page)
  const products = block?.type === 'scene'
    ? block.productIds.flatMap(productId => {
      const product = report.products.find(candidate => candidate.productId === productId)
      return product === undefined ? [] : [product]
    })
    : []
  const hasImage = addClientImage(slide, report, page.assetIds[0], { x: 6.45, y: 0.72, w: 6.08, h: 5.9 })
  slide.background = { color: report.theme.tokens.colors.background }
  addClientEyebrow(slide, report, '空间场景')
  addClientTitle(slide, report, page.headline, { w: hasImage ? 5.2 : 10.9, h: 1.25 })
  if (!hasImage && addAnalyticalVisual(slide, report, page)) {
    addClientEvidence(slide, report, page.evidenceIds, {
      x: SAFE_X, y: 5.82, w: CONTENT_WIDTH, h: 0.78,
    }, { variant: 'flat', maxItems: 1 })
    return
  }
  const sceneCopy = products.length === 0
    ? blockText(block)
    : products.map((product, index) => `${String(index + 1).padStart(2, '0')}  ${product.name}\n${product.valueProposition}`).join('\n\n')
  const mainCopy = !hasImage && block?.type === 'metric'
    ? `${block.value} ${block.unit}`
    : sceneCopy
  slide.addText(mainCopy, {
    x: SAFE_X, y: 2.45, w: hasImage ? 5.1 : CONTENT_WIDTH, h: hasImage ? 3.5 : 1.55,
    fontFace: hasImage ? report.theme.tokens.fonts.body : report.theme.tokens.fonts.display,
    fontSize: hasImage ? 16 : block?.type === 'metric' ? 40 : 28,
    bold: !hasImage,
    color: report.theme.tokens.colors.primary, margin: 0, breakLine: false, fit: 'shrink',
  })
  if (!hasImage) addClientEvidence(
    slide,
    report,
    page.evidenceIds,
    { x: SAFE_X, y: 4.55, w: CONTENT_WIDTH, h: 1.45 },
    { variant: 'flat' },
  )
}

const addImplementationSlide: ClientSlideRenderer = (slide, report, page) => {
  slide.background = { color: report.theme.tokens.colors.background }
  addClientEyebrow(slide, report, '实施路径')
  addClientTitle(slide, report, page.headline, { h: 1.08 })
  const block = clientBlock(report, page)
  if (addAnalyticalVisual(slide, report, page)) {
    addClientEvidence(slide, report, page.evidenceIds, {
      x: SAFE_X, y: 5.88, w: CONTENT_WIDTH, h: 0.72,
    }, { variant: 'flat', maxItems: 1 })
    return
  }
  if (block?.type === 'timeline') {
    const phases = block.phases.slice(0, 3)
    const phaseXs = phases.map((_, index) => SAFE_X + index * 3.95)
    const phaseCenters = phaseXs.map(x => x + 1.775)
    phaseCenters.slice(0, -1).forEach((center, index) => {
      const next = phaseCenters[index + 1]!
      slide.addShape('line', {
        x: center + 0.18, y: 2.57, w: next - center - 0.36, h: 0,
        line: { color: report.theme.tokens.colors.accent, width: 1.8, endArrowType: 'triangle' },
        objectName: `ImplementationTimeline Direction Connector ${index + 1}`,
      })
    })
    phases.forEach((phase, index) => {
      const x = phaseXs[index] ?? SAFE_X
      const center = phaseCenters[index] ?? x + 1.775
      slide.addShape('ellipse', {
        x: center - 0.16, y: 2.41, w: 0.32, h: 0.32,
        fill: { color: report.theme.tokens.colors.primary },
        line: { color: report.theme.tokens.colors.surface, width: 1.1 },
        objectName: `ImplementationTimeline Stage Node ${index + 1}`,
      })
      addAnalysisText(slide, report, String(index + 1).padStart(2, '0'), {
        x: center - 0.16, y: 2.41, w: 0.32, h: 0.32,
      }, {
        size: 10, color: report.theme.tokens.colors.surface, bold: true, align: 'center', valign: 'middle',
        name: `ImplementationTimeline Stage Order ${index + 1}`,
      })
      slide.addText(phase.name, {
        x, y: 2.92, w: 3.55, h: 0.36,
        fontFace: report.theme.tokens.fonts.body, fontSize: 20, bold: true,
        color: report.theme.tokens.colors.ink, margin: 0,
        objectName: `ImplementationTimeline Phase Title ${index + 1}`,
      })
      slide.addText(`行动｜${phase.actions.join('；')}`, {
        x, y: 3.45, w: 3.55, h: 0.52,
        fontFace: report.theme.tokens.fonts.body, fontSize: 14,
        color: report.theme.tokens.colors.ink, margin: 0, fit: 'shrink',
        objectName: `ImplementationTimeline Phase Action ${index + 1}`,
      })
      slide.addText(`前置｜${phase.prerequisites.join('；')}`, {
        x, y: 4.18, w: 3.55, h: 0.32,
        fontFace: report.theme.tokens.fonts.body, fontSize: 11,
        color: report.theme.tokens.colors.muted, margin: 0, fit: 'shrink',
        objectName: `ImplementationTimeline Phase Prerequisite ${index + 1}`,
      })
    })
    addClientEvidence(slide, report, page.evidenceIds, {
      x: SAFE_X, y: 5.1, w: CONTENT_WIDTH, h: 1.05,
    }, { variant: 'flat', maxItems: 1 })
    return
  }
  if (block?.type === 'investment') {
    const item = block.items[0]
    if (item !== undefined) {
      slide.addText(item.amount, {
        x: SAFE_X, y: 2.2, w: 4.1, h: 0.9,
        fontFace: report.theme.tokens.fonts.display, fontSize: 42, bold: true,
        color: report.theme.tokens.colors.primary, margin: 0, fit: 'shrink',
      })
      slide.addText(`${item.name}｜${item.unit}\n${item.assumption}`, {
        x: 4.9, y: 2.35, w: 7.63, h: 0.85,
        fontFace: report.theme.tokens.fonts.body, fontSize: 16,
        color: report.theme.tokens.colors.ink, margin: 0, fit: 'shrink',
      })
    }
    addClientEvidence(slide, report, page.evidenceIds, {
      x: SAFE_X, y: 4.55, w: CONTENT_WIDTH, h: 1.3,
    }, { variant: 'flat', maxItems: 1 })
    return
  }
  const blockCopy = distinctBlockText(report, page)
  const chapterClaim = report.chapters.find(chapter => chapter.id === page.chapterId)?.claim ?? ''
  const copy = blockCopy !== '' ? blockCopy : chapterClaim === page.headline ? '' : chapterClaim
  if (copy !== '') slide.addText(wrapClientText(copy, 19, 5, 'CLIENT_PPTX_IMPLEMENTATION_TEXT_BUDGET_EXCEEDED'), {
    x: SAFE_X, y: 2.25, w: CONTENT_WIDTH, h: 1.75,
    fontFace: report.theme.tokens.fonts.display, fontSize: 28, bold: true,
    color: report.theme.tokens.colors.primary,
    margin: 0, valign: 'top',
  })
  addClientEvidence(
    slide,
    report,
    page.evidenceIds,
    { x: SAFE_X, y: 4.65, w: CONTENT_WIDTH, h: 1.25 },
    { variant: 'flat', maxItems: 1 },
  )
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
  const decisions = rows.slice(0, 3)
  const gap = 0.48
  const width = (CONTENT_WIDTH - gap * Math.max(0, decisions.length - 1)) / Math.max(1, decisions.length)
  decisions.forEach((_, index) => addAnalysisRule(
    slide,
    SAFE_X + index * (width + gap),
    2.42,
    width,
    '7C9C9F',
    `ClosingDecision Rule ${index + 1}`,
  ))
  decisions.forEach((ask, index) => {
    const x = SAFE_X + index * (width + gap)
    addAnalysisText(slide, report, String(index + 1).padStart(2, '0'), { x, y: 2.66, w: width, h: 0.3 }, {
      size: 11, color: report.theme.tokens.colors.accent, bold: true, name: `ClosingDecision Order ${index + 1}`,
    })
    addAnalysisText(slide, report, ask, { x, y: 3.16, w: width * 0.84, h: 0.72 }, {
      size: 19, color: report.theme.tokens.colors.surface, bold: true, name: `ClosingDecision Label ${index + 1}`,
    })
    slide.addShape('line', {
      x: x + width / 2, y: 3.98, w: 0, h: 0.63,
      line: { color: report.theme.tokens.colors.accent, width: 1.4, endArrowType: 'triangle' },
      objectName: `ClosingDecision Arrow ${index + 1}`,
    })
  })
  slide.addShape('roundRect', {
    x: SAFE_X, y: 4.58, w: CONTENT_WIDTH, h: 1.02,
    rectRadius: 0.04,
    fill: { color: report.theme.tokens.colors.primary, transparency: 18 },
    line: { color: report.theme.tokens.colors.accent, width: 0.9 },
    objectName: 'ClosingDecision Common Target Surface',
  })
  addAnalysisText(slide, report, '共同解锁｜下一步行动\n概念深化 · 专题测算 · 首期实施清单', {
    x: SAFE_X, y: 4.62, w: CONTENT_WIDTH, h: 0.92,
  }, {
    size: 18, color: report.theme.tokens.colors.surface, bold: true, align: 'center', valign: 'middle',
    name: 'ClosingDecision Common Target',
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
  'visual-evidence': addVisualEvidenceSlide,
  evidence: addEvidenceSlide,
  opportunity: addOpportunitySlide,
  positioning: addPositioningSlide,
  product: addProductSlide,
  scene: addSceneSlide,
  implementation: addImplementationSlide,
  decision: addDecisionSlide,
  appendix: addAppendixSlide,
}

function clientPageHasDarkBackground(page: ClientPage): boolean {
  if (page.kind === 'cover' || page.kind === 'chapter-divider' || page.kind === 'decision') return true
  if (page.kind === 'opening-claim') return page.layoutVariant === 'full-bleed'
  if (page.kind === 'visual-evidence') return page.layoutVariant === 'full-bleed' || page.layoutVariant === 'editorial'
  return false
}

async function renderClientPptx(
  context: ClientRenderContext,
  outputPath: string,
): Promise<RenderedArtifact> {
  assertClientReportPolicy(context.report)
  assertClientPagePlan(context.plan, context.report)
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'ArchitectureWorld 前期策划'
  pptx.company = 'ArchitectureWorld'
  pptx.subject = `sourceRevision=${context.identity.sourceRevision};recommendationId=${context.identity.recommendationId};adoptedAssetIds=${[...context.identity.adoptedAssetIds].sort().join(',')};siteBoundaryIntegrityDigest=${context.identity.siteBoundaryIntegrityDigest ?? ''}`
  pptx.title = context.report.identity.reportTitle
  pptx.theme = {
    headFontFace: context.report.theme.tokens.fonts.display,
    bodyFontFace: context.report.theme.tokens.fonts.body,
  }

  context.plan.pages.forEach((page, index) => {
    const slide = pptx.addSlide()
    PPTX_LAYOUTS[page.kind](slide, context.report, page)
    if (page.kind !== 'visual-evidence' || page.layoutVariant !== 'full-bleed') {
      addClientFooter(slide, context.report, index + 1, clientPageHasDarkBackground(page))
    }
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
