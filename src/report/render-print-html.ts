import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { assertClientReportPolicy } from './client-policy.ts'
import { clientTextChunks } from './client-typography.ts'
import type { ClientContentBlock, ClientPage, ClientRenderContext } from './client-types.ts'
import { assertClientPagePlan } from './page-plan.ts'
import { renderAnalyticalHtml, renderDecisionConvergenceHtml, renderSitePlanHtml } from './render-analytical-html.ts'

const ANALYTICAL_PRINT_CSS = `.page-copy h1{text-wrap:wrap;word-break:normal}.analysis-site-plan{margin-top:3mm}.analysis-site-plan svg{display:block;width:100%;height:62mm;background:#EEF1ED;border:.25mm solid #D4DAD7}.analysis-site-plan text{fill:#132A2E;font-family:inherit;font-size:15px;font-weight:700}.analysis-site-plan .site-plan-ground{fill:#EEF1ED}.analysis-site-plan .site-plan-water{fill:#CFE1E1}.analysis-site-plan .site-plan-road{fill:none;stroke:#A9B1AE;stroke-width:18}.analysis-site-plan .site-plan-buildings{opacity:.28}.analysis-site-plan pattern rect{fill:#6E7775}.analysis-site-plan [data-map-layer="functional-zones"] rect{fill:#F4DCD5;stroke:#B85C3A}.analysis-site-plan [data-map-layer="concept-boundary"] path{fill:none;stroke:#0D5D66;stroke-width:4;stroke-dasharray:13 8}.analysis-site-plan [data-map-layer="movement"] path,.analysis-site-plan [data-map-layer="spatial-system"] path{fill:none;stroke:#B85C3A;stroke-width:5}.analysis-site-plan [data-map-anchor] circle{fill:#0D5D66;stroke:#FFFFFF;stroke-width:4}.analysis-site-plan marker path,.analysis-edge marker path{fill:#B85C3A}.site-plan-status{margin:2mm 0 0;color:#B85C3A;font-size:8pt;font-weight:800}.analysis-site-plan .analysis-disclosure{margin-top:1mm;font-size:7pt}.analysis-directed-map,.analysis-convergence{display:grid;gap:1.2mm}.analysis-node-row,.analysis-edge-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5mm}.analysis-node{display:grid;gap:1mm;min-height:13mm;padding:2.5mm 3mm;background:#FFFFFF;border-top:.8mm solid #0D5D66}.analysis-node>span{color:#B85C3A;font-size:7pt;font-weight:800}.analysis-node>strong{font-size:10pt;line-height:1.25}.analysis-node>small{color:#6E7775;font-size:7pt;line-height:1.35}.analysis-directed-map>.analysis-node,.analysis-convergence>.analysis-node{width:100%;margin-inline:auto;text-align:center}.analysis-edge{display:grid;grid-template-rows:auto 5mm;align-items:center;text-align:center}.analysis-edge>span{color:#B85C3A;font-size:7pt;font-weight:800}.analysis-edge svg{display:block;width:100%;height:5mm;overflow:visible}.analysis-edge line{stroke:#B85C3A;stroke-width:3}.analysis-directed-map .analysis-edge svg,.analysis-convergence .analysis-edge svg{width:14mm;margin:auto;transform:rotate(90deg);transform-origin:center}.analysis-matrix table{width:100%;table-layout:fixed}.analysis-matrix td[data-level="高"]{background:#0D5D66}.analysis-matrix td[data-level="高"] span{color:#FFFFFF}.analysis-matrix td[data-level="中"]{background:#CFE1E1}.analysis-matrix td[data-level="低"]{background:#EEF1ED}.visual-evidence.layout-editorial .evidence small,.visual-evidence.layout-editorial .evidence li>span{color:#C9D7D8}`
const R9_DIRECTED_EDGE_PRINT_CSS = `.analysis-directed-map .analysis-edge,.analysis-convergence .analysis-edge{grid-template-rows:auto 14mm}.analysis-directed-map .analysis-edge svg,.analysis-convergence .analysis-edge svg{display:block;width:5mm;height:14mm;margin:auto;transform:none;transform-origin:center}.visual-evidence.layout-editorial .evidence small,.visual-evidence.layout-editorial .evidence li>span{color:#C9D7D8!important}`

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}

function renderHeading(value: string): string {
  return clientTextChunks(value).map(chunk => chunk === '\n'
    ? '<br>'
    : `<span class="heading-word text-chunk">${escapeHtml(chunk)}</span><wbr>`).join('')
}

function renderInlineText(value: string): string {
  return clientTextChunks(value).map(chunk => chunk === '\n'
    ? '<br>'
    : `<span class="text-chunk">${escapeHtml(chunk)}</span><wbr>`).join('')
}

function displayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  return match === null ? value : `${match[1]}-${match[2]}-${match[3]}`
}

function safeAssetName(assetId: string, sourcePath: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(assetId)) throw new Error(`unsafe report asset id '${assetId}'`)
  const extension = extname(sourcePath).toLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(extension)) {
    throw new Error(`unsupported print asset '${assetId}'`)
  }
  return assetId + extension
}

function pageBlock(context: ClientRenderContext, page: ClientPage): ClientContentBlock | undefined {
  const chapter = context.report.chapters.find(candidate => candidate.id === page.chapterId)
  const index = page.blockIndexes[0]
  return index === undefined ? undefined : chapter?.blocks[index]
}

function blockCopy(block?: ClientContentBlock): string {
  if (block === undefined) return ''
  if (block.type === 'narrative') return block.statement
  if (block.type === 'metric') return `${block.label}｜${block.value} ${block.unit}`
  if (block.type === 'comparison') return `当前：${block.before}\n目标：${block.after}`
  if (block.type === 'timeline') return block.phases.map(phase => `${phase.name}：${phase.actions.join('；')}`).join('\n')
  if (block.type === 'investment') return block.items.map(item => `${item.name}：${item.amount} ${item.unit}（${item.assumption}）`).join('\n')
  if (block.type === 'decision') return block.asks.join('\n')
  if (block.type === 'product') return '以核心产品承接项目定位、内容组合与使用场景。'
  return block.headline
}

function pageFocus(context: ClientRenderContext, page: ClientPage): string {
  const focus = page.primaryFocus
  if (focus.type === 'claim') return focus.statement
  if (focus.type === 'decision') return focus.asks.join('\n')
  if (focus.type === 'product') {
    return context.report.products.find(product => product.productId === focus.productId)?.valueProposition ?? page.headline
  }
  return context.report.assets.find(asset => asset.assetId === focus.assetId)?.caption ?? page.headline
}

function pageProduct(
  context: ClientRenderContext,
  page: ClientPage,
  block?: ClientContentBlock,
): ClientRenderContext['report']['products'][number] | undefined {
  const productId = block?.type === 'product'
    ? block.productId
    : block?.type === 'scene'
      ? block.productIds[0]
      : page.primaryFocus.type === 'product'
        ? page.primaryFocus.productId
        : undefined
  return productId === undefined
    ? context.report.products[0]
    : context.report.products.find(product => product.productId === productId)
}

function pageProducts(
  context: ClientRenderContext,
  block?: ClientContentBlock,
): readonly ClientRenderContext['report']['products'][number][] {
  if (block?.type !== 'scene') return []
  return block.productIds.flatMap(productId => {
    const product = context.report.products.find(candidate => candidate.productId === productId)
    return product === undefined ? [] : [product]
  })
}

function renderEvidence(context: ClientRenderContext, page: ClientPage): string {
  return page.evidenceIds.flatMap(id => {
    const evidence = context.report.evidence.find(candidate => candidate.evidenceId === id)
    if (evidence === undefined) return []
    const assumption = evidence.assumption === undefined ? '' : `<span> · 口径：${renderInlineText(evidence.assumption)}</span>`
    return [`<li><strong>${renderInlineText(evidence.statement)}</strong><small>${renderInlineText(evidence.sourceLabel)} · <span class="text-chunk">${escapeHtml(displayDate(evidence.sourceDate))}</span></small>${assumption}</li>`]
  }).join('')
}

const EVIDENCE_KIND_LABELS = Object.freeze({
  fact: '项目事实',
  observation: '场地观察',
  policy: '政策依据',
  case: '案例研究',
  assumption: '策划假设',
  calculation: '测算口径',
})

function renderAppendixRecord(context: ClientRenderContext, page: ClientPage): string {
  const evidence = page.evidenceIds
    .map(id => context.report.evidence.find(candidate => candidate.evidenceId === id))
    .find(candidate => candidate !== undefined)
  if (evidence === undefined) return ''
  const evidenceIndex = context.report.evidence.findIndex(candidate => candidate.evidenceId === evidence.evidenceId) + 1
  const row = (label: string, value: string): string => `<div><dt>${label}</dt><dd>${renderInlineText(value)}</dd></div>`
  return `<article class="appendix-record" data-evidence-id="${escapeHtml(evidence.evidenceId)}"><p class="appendix-code">E${String(evidenceIndex).padStart(2, '0')}</p><blockquote>${renderInlineText(evidence.statement)}</blockquote><dl>${row('资料类型', EVIDENCE_KIND_LABELS[evidence.kind])}${row('资料来源', evidence.sourceLabel)}${row('资料日期', displayDate(evidence.sourceDate))}${row('资料定位', evidence.locator)}${evidence.unit === undefined ? '' : row('单位', evidence.unit)}${evidence.assumption === undefined ? '' : row('口径说明', evidence.assumption)}</dl></article>`
}

function renderAssets(
  context: ClientRenderContext,
  page: ClientPage,
  assetNames: ReadonlyMap<string, string>,
): string {
  return page.assetIds.flatMap(assetId => {
    const asset = context.report.assets.find(candidate => candidate.assetId === assetId)
    const name = assetNames.get(assetId)
    if (asset === undefined || name === undefined) return []
    return [`<figure><img src="assets/images/${encodeURIComponent(name)}" alt="${escapeHtml(asset.caption)}"><figcaption>${renderInlineText(asset.caption)}</figcaption></figure>`]
  }).join('')
}

function visualContractRows(context: ClientRenderContext, page: ClientPage): string[] {
  const asset = context.report.assets.find(candidate => candidate.assetId === page.assetIds[0])
  if (asset === undefined || asset.provenance === undefined) return []
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
  return rows
}

function visualContractSummary(context: ClientRenderContext, page: ClientPage): string {
  const rows = visualContractRows(context, page)
  if (rows.length === 0) return ''
  return `<p class="visual-contract">${rows.map(renderInlineText).join('<br>')}</p>`
}

function assertFullBleedTextBudget(headline: string, copy: string, contractRows: readonly string[]): void {
  const lineLengths = (value: string): number[] => value.split('\n').map(line => [...line].length)
  if (
    lineLengths(headline).some(length => length > 36)
    || lineLengths(copy).length > 3
    || lineLengths(copy).some(length => length > 42)
    || contractRows.length > 4
    || contractRows.some(row => [...row].length > 78)
  ) throw new Error('CLIENT_PRINT_FULL_BLEED_TEXT_BUDGET_EXCEEDED')
}

function renderImplementation(block?: ClientContentBlock, omitBasis = false): string {
  if (block?.type === 'timeline') {
    return `<div class="implementation-timeline">${block.phases.slice(0, 3).map(phase =>
      `<article class="phase"><strong>${renderInlineText(phase.name)}</strong><p>行动｜${renderInlineText(phase.actions.join('；'))}</p><small>前置｜${renderInlineText(phase.prerequisites.join('；'))}</small></article>`).join('')}</div>`
  }
  if (block?.type === 'investment') {
    const item = block.items[0]
    if (item === undefined) return ''
    return `<div class="implementation-investment"><p class="investment-value">${renderInlineText(item.amount)}</p><div><strong>${renderInlineText(item.name)}</strong><p>${renderInlineText(item.unit)}</p>${omitBasis ? '' : `<small>${renderInlineText(item.assumption)}</small>`}</div></div>`
  }
  return ''
}

function renderPage(
  context: ClientRenderContext,
  page: ClientPage,
  index: number,
  assetNames: ReadonlyMap<string, string>,
): string {
  const block = pageBlock(context, page)
  const assets = renderAssets(context, page, assetNames)
  const evidence = page.kind === 'visual-evidence' && page.layoutVariant === 'full-bleed'
    ? ''
    : renderEvidence(context, page)
  const chapter = context.report.chapters.find(candidate => candidate.id === page.chapterId)
  const product = pageProduct(context, page, block)
  const products = pageProducts(context, block)
  const productCopy = page.kind === 'product' && product !== undefined
    ? `<aside><h3>${renderInlineText(product.name)}</h3><p>${renderInlineText(product.valueProposition)}</p><p>${product.contents.map(renderInlineText).join(' · ')}</p></aside>`
    : ''
  const sceneCopy = page.kind === 'scene' && products.length > 0
    ? `<ol class="scene-products">${products.map(product => `<li><strong>${renderInlineText(product.name)}</strong><span>${renderInlineText(product.valueProposition)}</span></li>`).join('')}</ol>`
    : ''
  const sourceFootnote = page.kind === 'appendix'
    ? '<footer>本页索引记录本报告采用的资料来源、日期、定位与口径。</footer>'
    : evidence === ''
    ? '<footer>本页为前期策划观点表达，相关事实依据见成果附录。</footer>'
    : '<footer>本页观点由所列项目资料支撑；概念示意不替代事实资料与法定依据。</footer>'
  const decisionConvergence = page.kind === 'decision' && block === undefined && page.primaryFocus.type === 'decision'
    ? renderDecisionConvergenceHtml(page.primaryFocus.asks, escapeHtml)
    : ''
  const rawCopy = block?.type === 'product' && product !== undefined
    ? product.valueProposition
    : decisionConvergence !== ''
      ? ''
    : blockCopy(block) || pageFocus(context, page)
  const copy = rawCopy === page.headline
    ? chapter?.claim !== undefined && chapter.claim !== page.headline ? chapter.claim : ''
    : rawCopy
  const analysis = decisionConvergence !== ''
    ? decisionConvergence
    : page.kind === 'scene' && page.analyticalVisual === undefined && assets === ''
      ? renderSitePlanHtml(undefined, escapeHtml)
      : renderAnalyticalHtml(page.analyticalVisual, escapeHtml)
  const analysisReplacesCopy = decisionConvergence !== ''
    || (page.kind === 'scene' && page.analyticalVisual === undefined && assets === '')
    || page.analyticalVisual?.kind === 'spatial-sequence'
    || page.analyticalVisual?.kind === 'spatial-system'
    || page.analyticalVisual?.kind === 'operating-model'
    || page.analyticalVisual?.kind === 'investment-sequence'
    || page.analyticalVisual?.kind === 'decision-triad'
  const effectiveCopy = analysisReplacesCopy ? '' : copy
  const implementation = page.kind === 'implementation'
    ? renderImplementation(block, page.analyticalVisual?.kind === 'investment-sequence')
    : ''
  const evidenceClass = assets === '' ? 'evidence-feature' : 'evidence'
  if (page.kind === 'visual-evidence' && page.layoutVariant === 'full-bleed') {
    assertFullBleedTextBudget(page.headline, copy, visualContractRows(context, page))
  }
  const visualRole = page.visualRole === undefined ? '' : ` data-visual-role="${page.visualRole}"`
  const visualClass = page.kind === 'visual-evidence' ? ' visual-evidence' : ''
  const pageCopy = page.kind === 'appendix'
    ? `<div class="page-copy"><p class="eyebrow">依据索引</p><h1>${renderHeading(page.headline)}</h1>${renderAppendixRecord(context, page)}</div>`
    : `<div class="page-copy"><p class="eyebrow">前期策划成果提案</p><h1>${renderHeading(page.headline)}</h1>${page.kind === 'scene'
      ? sceneCopy === '' && effectiveCopy !== '' ? `<p class="focus">${renderInlineText(effectiveCopy)}</p>` : sceneCopy
      : implementation !== '' ? implementation
        : effectiveCopy === '' ? '' : `<p class="focus${page.kind === 'implementation' || (page.kind === 'evidence' && assets === '') ? ' implementation-judgement' : ''}">${renderInlineText(effectiveCopy)}</p>`}${analysis}${page.kind === 'visual-evidence' ? visualContractSummary(context, page) : ''}${productCopy}${evidence === '' ? '' : `<ul class="${evidenceClass}">${evidence}</ul>`}</div>`
  const pageMedia = `<div class="page-media">${assets}</div>`
  const pageBody = page.kind === 'visual-evidence' && page.layoutVariant === 'full-bleed'
    ? pageMedia + pageCopy
    : pageCopy + pageMedia
  return `<section class="print-page layout-${page.layoutVariant}${visualClass}${assets === '' ? ' no-media' : ''}${analysis === '' ? '' : ' has-analysis'}" data-page-kind="${page.kind}"${visualRole}><div class="page-number">${String(index + 1).padStart(2, '0')} / ${String(context.plan.pages.length).padStart(2, '0')}</div>${pageBody}${sourceFootnote}</section>`
}

export async function renderPrintHtml(
  context: ClientRenderContext,
  outputRoot: string,
): Promise<string> {
  assertClientReportPolicy(context.report)
  assertClientPagePlan(context.plan, context.report)
  if (context.plan.medium !== 'pdf') throw new Error('print HTML requires a PDF page plan')
  const printRoot = join(outputRoot, 'print')
  const imageRoot = join(printRoot, 'assets', 'images')
  await mkdir(imageRoot, { recursive: true })
  const assetNames = new Map<string, string>()
  for (const asset of context.report.assets) {
    const name = safeAssetName(asset.assetId, asset.sourcePath)
    await copyFile(asset.sourcePath, join(imageRoot, name))
    assetNames.set(asset.assetId, name)
  }
  const pages = context.plan.pages.map((page, index) => renderPage(context, page, index, assetNames)).join('\n')
  const colors = context.report.theme.tokens.colors
  const fonts = [context.report.theme.tokens.fonts.body, ...context.report.theme.tokens.fonts.fallbacks]
    .map(font => `"${font.replace(/"/gu, '')}"`).join(',')
  const adoptedAssets = [...context.identity.adoptedAssetIds].sort().join(',')
  const boundaryMeta = context.identity.siteBoundaryIntegrityDigest === undefined ? '' : `<meta name="preplan-site-boundary-digest" content="${escapeHtml(context.identity.siteBoundaryIntegrityDigest)}">`
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="preplan-project-id" content="${escapeHtml(context.identity.projectId)}"><meta name="preplan-source-revision" content="${context.identity.sourceRevision}"><meta name="preplan-recommendation-id" content="${escapeHtml(context.identity.recommendationId)}"><meta name="preplan-adopted-assets" content="${escapeHtml(adoptedAssets)}">${boundaryMeta}<title>${escapeHtml(context.report.identity.reportTitle)}｜打印版</title><style>@page{size:A4 landscape;margin:0}*{box-sizing:border-box}body{margin:0;color:#${colors.ink};font-family:${fonts}}.print-page{position:relative;width:297mm;height:210mm;padding:17mm 18mm 16mm;display:grid;grid-template-columns:7fr 5fr;gap:10mm;align-items:center;overflow:hidden;break-after:page;background:#${colors.background}}.print-page.no-media{grid-template-columns:1fr}.print-page.no-media .page-copy{max-width:245mm}.print-page.has-analysis.no-media .page-copy{max-width:255mm}.print-page.no-media .page-media{display:none}.print-page:last-child{break-after:auto}.layout-full-bleed{color:#${colors.surface};background:#${colors.ink}}.print-page[data-page-kind="appendix"].layout-editorial{color:#${colors.surface};background:#${colors.ink}}.print-page[data-page-kind="appendix"].layout-data{color:#${colors.ink};background:#${colors.background}}.print-page[data-page-kind="appendix"].layout-split{color:#${colors.surface};background:#${colors.primary}}.print-page[data-page-kind="appendix"].layout-editorial.no-media .page-copy{max-width:215mm;align-self:end;padding-bottom:12mm}.print-page[data-page-kind="appendix"].layout-split.no-media .page-copy{max-width:205mm;margin-left:28mm}.visual-evidence.layout-full-bleed{display:grid;grid-template-columns:1fr;grid-template-rows:132mm minmax(0,1fr);gap:4mm;padding:8mm 12mm 14mm;background:#${colors.ink};color:#${colors.surface};align-items:stretch}.visual-evidence.layout-full-bleed .page-media{height:132mm;overflow:hidden}.visual-evidence.layout-full-bleed .page-media img{height:124mm;max-height:none;object-fit:contain}.visual-evidence.layout-full-bleed .page-copy{display:grid;grid-template-columns:32mm minmax(0,1fr) 62mm;grid-template-rows:minmax(8.1mm,auto) minmax(0,1fr);gap:2mm 6mm;min-height:0;margin:0;padding-top:3mm;border-top:.3mm solid #${colors.muted}}.visual-evidence.layout-full-bleed .page-copy .eyebrow{grid-column:1;grid-row:1/3;margin:0}.visual-evidence.layout-full-bleed .page-copy h1{grid-column:2;grid-row:1;margin:0;font-size:20pt;line-height:1.05}.visual-evidence.layout-full-bleed .focus{grid-column:2;grid-row:2;margin:0;font-size:10pt;line-height:1.25;color:#${colors.surface}}.visual-evidence.layout-full-bleed .visual-contract{grid-column:3;grid-row:1/3;margin:0;font-size:9pt;line-height:1.25;color:#${colors.surface}}.visual-evidence.layout-split{grid-template-columns:1fr 1fr;gap:12mm;background:#${colors.background};color:#${colors.ink}}.visual-evidence.layout-split .page-copy{align-self:center}.visual-evidence.layout-split .page-copy h1{font-size:25pt}.visual-evidence.layout-split .focus{font-size:12pt;color:#${colors.primary}}.visual-evidence.layout-split .page-media img{max-height:165mm;object-fit:contain}.visual-evidence.layout-editorial{grid-template-columns:4.8fr 7.2fr;gap:8mm;background:#${colors.ink};color:#${colors.surface}}.visual-evidence.layout-editorial .page-copy{align-self:end;padding:0 5mm 12mm 0;border-right:.3mm solid #${colors.muted}}.visual-evidence.layout-editorial .page-copy h1{font-size:25pt}.visual-evidence.layout-editorial .focus{font-size:12pt;color:#${colors.surface}}.visual-evidence.layout-editorial .evidence li{min-height:auto;padding:3mm 0;background:transparent;color:#${colors.surface};border-left:0;border-top:.3mm solid #${colors.muted}}.visual-evidence.layout-editorial .evidence strong,.visual-evidence.layout-editorial .evidence strong .text-chunk{color:#F5F5F7}.visual-evidence.layout-editorial .evidence small,.visual-evidence.layout-editorial .evidence li>span{color:#C9D7D8}.visual-evidence.layout-editorial .page-media img{max-height:170mm;object-fit:contain}.page-number{position:absolute;top:8mm;right:18mm;color:#${colors.muted};font-size:9pt}.layout-full-bleed .page-number,.visual-evidence.layout-editorial .page-number,.print-page[data-page-kind="appendix"].layout-editorial .page-number,.print-page[data-page-kind="appendix"].layout-split .page-number{color:#C9D7D8}.eyebrow{color:#${colors.accent};font-size:9pt;font-weight:700;letter-spacing:.18em}.page-copy h1{margin:4mm 0 6mm;font-size:28pt;line-height:1.08;text-wrap:balance}.text-chunk{white-space:nowrap}.no-media .page-copy h1{max-width:235mm;font-size:32pt}.focus{white-space:pre-line;font-size:16pt;line-height:1.5;color:#${colors.primary}}.no-media .focus{max-width:220mm;font-size:23pt;font-weight:700}.layout-full-bleed .focus{color:#${colors.surface}}aside{padding:5mm;background:#${colors.surface};color:#${colors.ink}}aside h3{margin:0 0 3mm;font-size:17pt}.scene-products{display:grid;gap:0;margin:6mm 0 0;padding:0;list-style:none;border-top:.3mm solid #${colors.muted}}.scene-products li{display:grid;grid-template-columns:58mm 1fr;gap:5mm;padding:4mm 0;border-bottom:.3mm solid #${colors.muted}}.scene-products strong{font-size:16pt}.scene-products span{color:#${colors.muted};font-size:10pt;line-height:1.45}.evidence{display:grid;gap:3mm;margin:7mm 0 0;padding:0;list-style:none}.evidence li{display:grid;gap:1.5mm;min-height:22mm;padding:4mm 5mm;background:#${colors.surface};color:#${colors.ink};border-left:2mm solid #${colors.primary};font-size:11pt}.evidence small,.evidence li>span,.evidence-feature small,.evidence-feature li>span{color:#${colors.muted};font-size:9pt}.evidence-feature{display:grid;grid-template-columns:repeat(auto-fit,minmax(72mm,1fr));gap:5mm;margin:10mm 0 0;padding:0;list-style:none;border-top:.35mm solid #${colors.muted}}.has-analysis .evidence-feature{margin-top:5mm}.evidence-feature li{min-width:0;padding-top:3mm;font-size:11pt;line-height:1.35}.evidence-feature li+li{border-left:.35mm solid #${colors.muted};padding-left:5mm}.implementation-timeline{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5mm;margin-top:10mm}.implementation-timeline .phase{min-width:0;padding-top:3mm;border-top:.8mm solid #${colors.primary}}.implementation-timeline .phase strong{font-size:19pt}.implementation-timeline .phase p{margin:3mm 0 2mm;font-size:11pt;line-height:1.4}.implementation-timeline .phase small{color:#${colors.muted};font-size:10pt;line-height:1.35}.implementation-investment{display:grid;grid-template-columns:58mm minmax(0,1fr);gap:7mm;align-items:start;margin-top:5mm}.investment-value{margin:0;color:#${colors.primary};font-size:42pt;font-weight:800;line-height:1}.implementation-investment div{padding-top:3mm;border-top:.8mm solid #${colors.primary}}.implementation-investment strong{font-size:16pt}.implementation-investment div p{margin:2mm 0;font-size:10pt}.implementation-investment small{color:#${colors.muted};font-size:9pt}.analysis-visual{margin-top:6mm}.analysis-disclosure{margin:4mm 0 0;color:#${colors.muted};font-size:8pt}.analysis-shared-basis{margin:3mm 0 0;color:#${colors.muted};font-size:8pt}.analysis-big-number{display:flex;align-items:end;gap:4mm}.analysis-big-number strong{font-size:54pt;line-height:.85;color:#${colors.primary}}.analysis-big-number span{padding-bottom:1mm;font-size:15pt;font-weight:700}.analysis-urgency{display:grid;grid-template-columns:56mm 1fr;gap:4mm 8mm;align-items:end}.analysis-urgency ol,.analysis-sequence ol,.analysis-investment ol,.analysis-decisions ol{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5mm;margin:0;padding:0;list-style:none}.analysis-urgency li,.analysis-sequence li,.analysis-investment li,.analysis-decisions li{padding-top:3mm;border-top:.8mm solid #${colors.primary}}.analysis-urgency li span,.analysis-sequence li span,.analysis-investment li>span,.analysis-decisions li>span{display:block;margin-bottom:3mm;color:#${colors.accent};font-size:9pt;font-weight:800}.analysis-urgency li strong,.analysis-sequence li strong,.analysis-investment li strong,.analysis-decisions li strong{display:block;font-size:15pt}.analysis-urgency li p,.analysis-investment li p,.analysis-decisions li p{margin:2mm 0;color:#${colors.muted};font-size:9pt}.analysis-urgency .analysis-disclosure{grid-column:1/-1}.analysis-sequence ol{grid-template-columns:repeat(4,minmax(0,1fr));position:relative}.analysis-sequence li{position:relative}.analysis-sequence li:not(:last-child)::after{position:absolute;right:-4mm;top:6mm;content:'→';color:#${colors.accent};font-size:15pt}.analysis-system dl{display:grid;grid-template-columns:repeat(4,1fr);gap:5mm;margin:0}.analysis-system dl div{padding-top:3mm;border-top:.8mm solid #${colors.primary}}.analysis-system dt{font-size:46pt;font-weight:800;line-height:1;color:#${colors.primary}}.analysis-system dd{margin:2mm 0 0;font-size:15pt;font-weight:700}.analysis-layers,.analysis-teams{display:grid;grid-template-columns:repeat(3,1fr);gap:5mm}.analysis-layers article{padding-top:3mm;border-top:.8mm solid #${colors.primary}}.analysis-layers span{display:block;color:#${colors.accent};font-size:9pt;font-weight:800}.analysis-layers strong{display:block;margin-top:3mm;font-size:14pt}.analysis-outcome{margin:4mm 0;padding:3mm 0;border-block:.3mm solid #${colors.muted};color:#${colors.primary};font-size:18pt;font-weight:800;text-align:center}.analysis-teams span{font-size:11pt;text-align:center}.analysis-matrix table{margin:0;background:transparent}.analysis-matrix th,.analysis-matrix td{padding:2.5mm;border-color:#D6D6D8;text-align:center;font-size:9pt}.analysis-matrix thead th{color:#${colors.primary}}.analysis-matrix tbody th{text-align:left}.analysis-matrix td span{display:inline-block;color:#${colors.primary};font-size:8pt;font-weight:700}.analysis-investment li p{font-size:19pt;font-weight:800;color:#${colors.primary}}.analysis-investment li small{color:#${colors.muted};font-size:8pt}.analysis-decision-flow{display:grid;grid-template-columns:1fr 14mm 1fr;gap:5mm;align-items:center}.analysis-decision-flow>div{display:grid;gap:2mm;padding-top:3mm;border-top:.8mm solid #${colors.primary}}.analysis-decision-flow>div span{color:#${colors.accent};font-size:9pt;font-weight:800}.analysis-decision-flow>div strong{font-size:13pt}.analysis-decision-flow>b{color:#${colors.accent};font-size:25pt;text-align:center}.appendix-record{display:grid;grid-template-columns:32mm minmax(0,1fr);gap:6mm 10mm;margin-top:8mm;padding-top:7mm;border-top:.4mm solid currentColor}.appendix-code{grid-row:1/3;margin:0;color:#${colors.accent};font-size:34pt;font-weight:800;letter-spacing:.08em}.appendix-record blockquote{grid-column:2;margin:0;font-size:19pt;line-height:1.25;font-weight:650}.appendix-record dl{grid-column:2;display:grid;grid-template-columns:1fr 1fr;gap:4mm 8mm;margin:2mm 0 0}.appendix-record dl div{border-top:.25mm solid currentColor;padding-top:2.5mm}.appendix-record dt{font-size:8pt;letter-spacing:.12em;opacity:.72}.appendix-record dd{margin:1mm 0 0;font-size:10pt;line-height:1.35}.page-media figure{margin:0}.page-media img{display:block;width:100%;max-height:145mm;object-fit:contain}.page-media figcaption{margin-top:2mm;color:#${colors.muted};font-size:8pt}.layout-full-bleed .page-media figcaption,.visual-evidence.layout-editorial .page-media figcaption{color:#C9D7D8}.print-page>footer{position:absolute;left:18mm;right:18mm;bottom:7mm;color:#${colors.muted};font-size:8pt}.layout-full-bleed>footer,.visual-evidence.layout-editorial>footer,.print-page[data-page-kind="appendix"].layout-editorial>footer,.print-page[data-page-kind="appendix"].layout-split>footer{color:#C9D7D8}</style></head><body>${pages}</body></html>`
  const finalHtml = html
    .replace('text-wrap:balance', 'text-wrap:wrap;word-break:normal')
    .replace('</style>', `${ANALYTICAL_PRINT_CSS}${R9_DIRECTED_EDGE_PRINT_CSS}</style>`)
  const path = join(printRoot, 'index.html')
  await writeFile(path, finalHtml, 'utf8')
  return path
}
