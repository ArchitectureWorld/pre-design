import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { assertClientReportPolicy } from './client-policy.ts'
import type {
  ClientContentBlock,
  ClientPage,
  ClientPageKind,
  ClientProduct,
  ClientRenderContext,
  ClientReport,
} from './client-types.ts'
import { assertClientPagePlan } from './page-plan.ts'
import { renderChartSvg } from './render-chart.ts'
import { CLIENT_REPORT_CSS } from './theme.ts'
import type { RenderedArtifact, ReportDocument, ReportNode } from './types.ts'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}

function assetFileName(assetId: string, sourcePath: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(assetId)) throw new Error(`unsafe report asset id '${assetId}'`)
  const extension = extname(sourcePath).toLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(extension)) {
    throw new Error(`unsupported report asset: ${basename(sourcePath)}`)
  }
  return `${assetId}${extension}`
}

function displayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value)
  return match === null ? value : `${match[1]}年${match[2]}月${match[3]}日`
}

function renderAsset(
  report: ClientReport,
  assetId: string,
  imageNames: ReadonlyMap<string, string>,
): string {
  const asset = report.assets.find(candidate => candidate.assetId === assetId)
  const name = imageNames.get(assetId)
  if (asset === undefined || name === undefined) return ''
  const disclosure = asset.disclosure === undefined
    ? ''
    : `<span class="asset-disclosure">${escapeHtml(asset.disclosure)}</span>`
  return `<figure class="page-visual"><img src="assets/images/${encodeURIComponent(name)}" alt="${escapeHtml(asset.caption)}"><figcaption>${escapeHtml(asset.caption)}${disclosure}</figcaption></figure>`
}

function evidenceCards(report: ClientReport, ids: readonly string[]): string {
  if (ids.length === 0) return ''
  const items = ids.flatMap(id => {
    const evidence = report.evidence.find(candidate => candidate.evidenceId === id)
    if (evidence === undefined) return []
    const measure = evidence.unit === undefined ? '' : `<span>${escapeHtml(evidence.unit)}</span>`
    return [`<li><strong>${escapeHtml(evidence.statement)}</strong><small>${escapeHtml(evidence.sourceLabel)} · ${escapeHtml(displayDate(evidence.sourceDate))}</small>${measure}</li>`]
  })
  return items.length === 0 ? '' : `<ul class="evidence-list">${items.join('')}</ul>`
}

function findBlock(report: ClientReport, page: ClientPage): ClientContentBlock | undefined {
  const chapter = report.chapters.find(candidate => candidate.id === page.chapterId)
  const index = page.blockIndexes[0]
  return index === undefined ? undefined : chapter?.blocks[index]
}

function findProduct(report: ClientReport, page: ClientPage, block?: ClientContentBlock): ClientProduct | undefined {
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

function renderBlock(report: ClientReport, page: ClientPage): string {
  const block = findBlock(report, page)
  if (block === undefined) return ''
  if (block.type === 'narrative') return `<p class="lead-copy">${escapeHtml(block.statement)}</p>`
  if (block.type === 'metric') {
    return `<div class="metric-focus"><span>${escapeHtml(block.label)}</span><strong>${escapeHtml(block.value)}</strong><small>${escapeHtml(block.unit)}</small></div>`
  }
  if (block.type === 'comparison') {
    return `<div class="comparison"><article><span>当前</span><p>${escapeHtml(block.before)}</p></article><article><span>目标</span><p>${escapeHtml(block.after)}</p></article></div>`
  }
  if (block.type === 'timeline') {
    return `<ol class="phase-list">${block.phases.map(phase => `<li><strong>${escapeHtml(phase.name)}</strong><p>${phase.actions.map(escapeHtml).join('；')}</p></li>`).join('')}</ol>`
  }
  if (block.type === 'investment') {
    return `<div class="investment-list">${block.items.map(item => `<article><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.amount)} ${escapeHtml(item.unit)}</span><small>${escapeHtml(item.assumption)}</small></article>`).join('')}</div>`
  }
  if (block.type === 'decision') {
    return `<ol class="decision-list">${block.asks.map(ask => `<li>${escapeHtml(ask)}</li>`).join('')}</ol>`
  }
  if ('headline' in block) return `<p class="lead-copy">${escapeHtml(block.headline)}</p>`
  return ''
}

function renderPageAssets(
  report: ClientReport,
  page: ClientPage,
  imageNames: ReadonlyMap<string, string>,
): string {
  return page.assetIds.map(assetId => renderAsset(report, assetId, imageNames)).join('')
}

type PageRenderer = (
  report: ClientReport,
  page: ClientPage,
  imageNames: ReadonlyMap<string, string>,
) => string

const renderCover: PageRenderer = (report, page, imageNames) => {
  const hero = page.assetIds.map(assetId => renderAsset(report, assetId, imageNames)).join('')
  return `<div class="cover-grid"><div class="cover-copy"><p class="eyebrow">前期策划成果提案</p><h1>${escapeHtml(report.identity.reportTitle)}</h1><p class="cover-project">${escapeHtml(report.identity.projectName)}</p><p class="cover-value">${escapeHtml(report.proposition.coreValue)}</p><ul class="keyword-list">${report.proposition.keywords.map(keyword => `<li>${escapeHtml(keyword)}</li>`).join('')}</ul><time>${escapeHtml(displayDate(report.identity.reportDate))}</time></div>${hero}</div>`
}

const renderOpeningClaim: PageRenderer = (_report, page) => {
  const statement = page.primaryFocus.type === 'claim' ? page.primaryFocus.statement : page.headline
  return `<div class="claim-stage"><p class="eyebrow">核心判断</p><h2>${escapeHtml(page.headline)}</h2><p class="claim-focus">${escapeHtml(statement)}</p></div>`
}

const renderChapterDivider: PageRenderer = (report, page) => {
  const chapter = report.chapters.find(candidate => candidate.id === page.chapterId)
  return `<div class="chapter-stage"><p class="eyebrow">成果章节</p><h2>${escapeHtml(page.headline)}</h2><p>${escapeHtml(chapter?.claim ?? page.headline)}</p></div>`
}

const renderEvidence: PageRenderer = (report, page, imageNames) => `<div class="content-grid"><div><p class="eyebrow">事实与判断</p><h2>${escapeHtml(page.headline)}</h2>${renderBlock(report, page)}${evidenceCards(report, page.evidenceIds)}</div><div>${renderPageAssets(report, page, imageNames)}</div></div>`

const renderOpportunity: PageRenderer = (report, page, imageNames) => `<div class="content-grid opportunity-grid"><div><p class="eyebrow">机会识别</p><h2>${escapeHtml(page.headline)}</h2>${renderBlock(report, page)}${evidenceCards(report, page.evidenceIds)}</div><div>${renderPageAssets(report, page, imageNames)}</div></div>`

const renderPositioning: PageRenderer = (report, page, imageNames) => `<div class="positioning-stage"><p class="eyebrow">定位与策略</p><h2>${escapeHtml(page.headline)}</h2>${renderBlock(report, page)}<blockquote>${escapeHtml(report.proposition.positioning)}</blockquote>${renderPageAssets(report, page, imageNames)}</div>`

const renderProduct: PageRenderer = (report, page, imageNames) => {
  const block = findBlock(report, page)
  const product = findProduct(report, page, block)
  const productDetails = product === undefined ? '' : `<div class="product-card"><p class="eyebrow">核心产品</p><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.valueProposition)}</p><dl><div><dt>内容组合</dt><dd>${product.contents.map(escapeHtml).join(' · ')}</dd></div><div><dt>使用场景</dt><dd>${product.usageScenarios.map(escapeHtml).join(' · ')}</dd></div><div><dt>运营方式</dt><dd>${escapeHtml(product.operatingModel)}</dd></div></dl></div>`
  return `<div class="content-grid product-grid"><div><h2>${escapeHtml(page.headline)}</h2>${productDetails}${evidenceCards(report, product?.evidenceIds ?? page.evidenceIds)}</div><div>${renderPageAssets(report, page, imageNames)}</div></div>`
}

const renderScene: PageRenderer = (report, page, imageNames) => `<div class="scene-stage"><div><p class="eyebrow">空间场景</p><h2>${escapeHtml(page.headline)}</h2>${renderBlock(report, page)}</div>${renderPageAssets(report, page, imageNames)}</div>`

const renderImplementation: PageRenderer = (report, page) => `<div class="implementation-stage"><p class="eyebrow">实施路径</p><h2>${escapeHtml(page.headline)}</h2>${renderBlock(report, page)}${evidenceCards(report, page.evidenceIds)}</div>`

const renderDecision: PageRenderer = (report, page) => {
  const block = findBlock(report, page)
  const asks = page.primaryFocus.type === 'decision' ? page.primaryFocus.asks : []
  const content = block === undefined
    ? `<ol class="decision-list">${asks.map(ask => `<li>${escapeHtml(ask)}</li>`).join('')}</ol>`
    : renderBlock(report, page)
  return `<div class="decision-stage"><p class="eyebrow">共同决策</p><h2>${escapeHtml(page.headline)}</h2>${content}${evidenceCards(report, page.evidenceIds)}</div>`
}

const renderAppendix: PageRenderer = (report, page) => `<div class="appendix-stage"><p class="eyebrow">依据索引</p><h2>${escapeHtml(page.headline)}</h2>${evidenceCards(report, page.evidenceIds)}</div>`

const PAGE_RENDERERS: Readonly<Record<ClientPageKind, PageRenderer>> = {
  cover: renderCover,
  'opening-claim': renderOpeningClaim,
  'chapter-divider': renderChapterDivider,
  evidence: renderEvidence,
  opportunity: renderOpportunity,
  positioning: renderPositioning,
  product: renderProduct,
  scene: renderScene,
  implementation: renderImplementation,
  decision: renderDecision,
  appendix: renderAppendix,
}

async function copyClientAssets(
  report: ClientReport,
  imageRoot: string,
): Promise<ReadonlyMap<string, string>> {
  const imageNames = new Map<string, string>()
  for (const asset of report.assets) {
    const name = assetFileName(asset.assetId, asset.sourcePath)
    await copyFile(asset.sourcePath, join(imageRoot, name))
    imageNames.set(asset.assetId, name)
  }
  return imageNames
}

function clientThemeCss(report: ClientReport): string {
  const { colors, fonts, motion } = report.theme.tokens
  const family = [fonts.body, ...fonts.fallbacks].map(font => `"${font.replace(/"/gu, '')}"`).join(',')
  return `:root{--background:#${colors.background};--surface:#${colors.surface};--ink:#${colors.ink};--muted:#${colors.muted};--primary:#${colors.primary};--accent:#${colors.accent};--font-body:${family};--motion-duration:${motion.durationMs}ms;--motion-easing:${motion.easing}}`
}

async function renderClientHtml(
  context: ClientRenderContext,
  outputRoot: string,
): Promise<RenderedArtifact> {
  assertClientReportPolicy(context.report)
  assertClientPagePlan(context.plan)
  const htmlRoot = join(outputRoot, 'html')
  const imageRoot = join(htmlRoot, 'assets', 'images')
  await mkdir(imageRoot, { recursive: true })
  const imageNames = await copyClientAssets(context.report, imageRoot)
  const navigation = context.report.chapters.map((chapter, index) =>
    `<a href="#${encodeURIComponent(chapter.id + '-divider')}">${String(index + 1).padStart(2, '0')} ${escapeHtml(chapter.headline)}</a>`).join('')
  const pages = context.plan.pages.map((page, index) => {
    const content = PAGE_RENDERERS[page.kind](context.report, page, imageNames)
    return `<section class="report-page layout-${page.layoutVariant}" id="${escapeHtml(page.pageId)}" data-page-kind="${page.kind}"><div class="page-count">${String(index + 1).padStart(2, '0')} / ${String(context.plan.pages.length).padStart(2, '0')}</div>${content}</section>`
  }).join('\n')
  const adoptedAssets = [...context.identity.adoptedAssetIds].sort().join(',')
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="preplan-project-id" content="${escapeHtml(context.identity.projectId)}"><meta name="preplan-source-revision" content="${context.identity.sourceRevision}"><meta name="preplan-recommendation-id" content="${escapeHtml(context.identity.recommendationId)}"><meta name="preplan-adopted-assets" content="${escapeHtml(adoptedAssets)}"><title>${escapeHtml(context.report.identity.reportTitle)}</title><style>${clientThemeCss(context.report)}${CLIENT_REPORT_CSS}</style></head><body><a class="skip-link" href="#report-main">跳至成果正文</a><nav class="report-nav" aria-label="成果章节导航">${navigation}</nav><main id="report-main">${pages}</main><footer class="footer">本成果中的概念示意用于表达空间意向，不替代事实资料与法定依据。</footer><script>document.querySelectorAll('.report-nav a').forEach(link=>link.addEventListener('click',()=>history.replaceState(null,'',link.getAttribute('href'))));</script></body></html>`
  const path = join(htmlRoot, 'index.html')
  await writeFile(path, html, 'utf8')
  return {
    format: 'html',
    fileName: 'html/index.html',
    path,
    sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
    bytes: (await stat(path)).size,
  }
}

function renderNode(node: ReportNode, imageNames: ReadonlyMap<string, string>): string {
  if (node.type === 'heading') return `<h${node.level}>${escapeHtml(node.text)}</h${node.level}>`
  if (node.type === 'paragraph') return `<p class="prose">${escapeHtml(node.text)}</p>`
  if (node.type === 'metric') return `<div class="metric"><span>${escapeHtml(node.label)}</span><strong>${escapeHtml(node.value)}</strong><small>${escapeHtml(node.basis)}</small></div>`
  if (node.type === 'table') {
    const header = node.columns.map(column => `<th>${escapeHtml(column)}</th>`).join('')
    const rows = node.rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')
    return `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`
  }
  if (node.type === 'chart') {
    return `<figure class="visual chart"><img src="assets/charts/${encodeURIComponent(node.chartId)}.svg" alt="本节成果状态图"><figcaption>图表数据来自成果版本的已确认内容</figcaption></figure>`
  }
  if (node.type === 'image' || node.type === 'map') {
    const name = imageNames.get(node.assetId)
    if (name === undefined) return `<div class="callout warning"><h3>图片未纳入报告</h3><p>${escapeHtml(node.caption)}</p></div>`
    return `<figure class="visual"><img src="assets/images/${encodeURIComponent(name)}" alt="${escapeHtml(node.caption)}"><figcaption>${escapeHtml(node.caption)}</figcaption></figure>`
  }
  return `<aside class="callout ${node.type}"><h3>${escapeHtml(node.title)}</h3><ul>${node.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></aside>`
}

async function renderLegacyHtml(document: ReportDocument, outputRoot: string): Promise<RenderedArtifact> {
  const htmlRoot = join(outputRoot, 'html')
  const chartRoot = join(htmlRoot, 'assets', 'charts')
  const imageRoot = join(htmlRoot, 'assets', 'images')
  await Promise.all([mkdir(chartRoot, { recursive: true }), mkdir(imageRoot, { recursive: true })])
  const imageNames = new Map<string, string>()
  for (const asset of document.assets) {
    const name = assetFileName(asset.assetId, asset.sourcePath)
    await copyFile(asset.sourcePath, join(imageRoot, name))
    imageNames.set(asset.assetId, name)
  }
  for (const section of document.sections) {
    for (const node of section.nodes) {
      if (node.type === 'chart') await renderChartSvg(node, join(chartRoot, `${node.chartId}.svg`))
    }
  }
  const navigation = document.sections.map((section, index) =>
    `<a href="#${encodeURIComponent(section.id)}">${String(index + 1).padStart(2, '0')} ${escapeHtml(section.title)}</a>`).join('')
  const sections = document.sections.map((section, index) => `
    <section class="report-section" id="${escapeHtml(section.id)}">
      <div class="section-index">${String(index + 1).padStart(2, '0')} / ${String(document.sections.length).padStart(2, '0')}</div>
      <h2>${escapeHtml(section.title)}</h2>
      <p class="claim">${escapeHtml(section.claim)}</p>
      ${section.nodes.map(node => renderNode(node, imageNames)).join('\n')}
    </section>`).join('\n')
  const adoptedAssetIds = document.meta.adoptedAssetIds.join(',')
  const html = `<!doctype html><html lang="zh-CN" data-report-revision="${document.meta.sourceRevision}" data-recommendation-id="${escapeHtml(document.meta.recommendationId)}" data-adopted-asset-ids="${escapeHtml(adoptedAssetIds)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(document.meta.title)}｜${escapeHtml(document.meta.subtitle)}</title><style>${CLIENT_REPORT_CSS}</style></head><body><header class="cover"><div><div class="eyebrow">ArchitectureWorld · Pre-Planning Report</div><h1>${escapeHtml(document.meta.title)}</h1><p>${escapeHtml(document.meta.subtitle)}</p></div><div><p>${escapeHtml(document.executiveSummary)}</p><div class="revision">成果版本 R${document.meta.sourceRevision} · ${escapeHtml(displayDate(document.meta.generatedAt))}</div></div></header><nav class="report-nav" aria-label="报告章节">${navigation}</nav><main>${sections}</main><footer class="footer">本报告由同一成果版本生成；AI 概念图均明确标注，不替代事实资料与法定依据。</footer><script>document.querySelectorAll('.report-nav a').forEach(a=>a.addEventListener('click',()=>history.replaceState(null,'',a.getAttribute('href'))));</script></body></html>`
  const path = join(htmlRoot, 'index.html')
  await writeFile(path, html, 'utf8')
  return {
    format: 'html',
    fileName: 'html/index.html',
    path,
    sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
    bytes: (await stat(path)).size,
  }
}

function isClientRenderContext(value: ClientRenderContext | ReportDocument): value is ClientRenderContext {
  return 'report' in value && 'plan' in value && 'identity' in value
}

export function renderHtml(context: ClientRenderContext, outputRoot: string): Promise<RenderedArtifact>
export function renderHtml(document: ReportDocument, outputRoot: string): Promise<RenderedArtifact>
export function renderHtml(
  input: ClientRenderContext | ReportDocument,
  outputRoot: string,
): Promise<RenderedArtifact> {
  return isClientRenderContext(input)
    ? renderClientHtml(input, outputRoot)
    : renderLegacyHtml(input, outputRoot)
}
