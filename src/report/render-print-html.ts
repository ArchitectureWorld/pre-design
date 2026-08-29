import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { assertClientReportPolicy } from './client-policy.ts'
import type { ClientContentBlock, ClientPage, ClientRenderContext } from './client-types.ts'
import { assertClientPagePlan } from './page-plan.ts'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
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

function renderEvidence(context: ClientRenderContext, page: ClientPage): string {
  return page.evidenceIds.flatMap(id => {
    const evidence = context.report.evidence.find(candidate => candidate.evidenceId === id)
    if (evidence === undefined) return []
    const assumption = evidence.assumption === undefined ? '' : `<span>口径：${escapeHtml(evidence.assumption)}</span>`
    return [`<li><strong>${escapeHtml(evidence.statement)}</strong><small>${escapeHtml(evidence.sourceLabel)} · ${escapeHtml(evidence.sourceDate)}</small>${assumption}</li>`]
  }).join('')
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
    const disclosure = asset.disclosure === undefined ? '' : `｜${escapeHtml(asset.disclosure)}`
    return [`<figure><img src="assets/images/${encodeURIComponent(name)}" alt="${escapeHtml(asset.caption)}"><figcaption>${escapeHtml(asset.caption)}${disclosure}</figcaption></figure>`]
  }).join('')
}

function renderPage(
  context: ClientRenderContext,
  page: ClientPage,
  index: number,
  assetNames: ReadonlyMap<string, string>,
): string {
  const block = pageBlock(context, page)
  const evidence = renderEvidence(context, page)
  const assets = renderAssets(context, page, assetNames)
  const chapter = context.report.chapters.find(candidate => candidate.id === page.chapterId)
  const product = context.report.products[0]
  const productCopy = page.kind === 'product' && product !== undefined
    ? `<aside><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.valueProposition)}</p><p>${product.contents.map(escapeHtml).join(' · ')}</p></aside>`
    : ''
  const sourceFootnote = evidence === ''
    ? '<footer>本页为前期策划观点表达，相关事实依据见成果附录。</footer>'
    : '<footer>本页观点由所列项目资料支撑；概念示意不替代事实资料与法定依据。</footer>'
  const copy = blockCopy(block) || chapter?.claim || pageFocus(context, page)
  return `<section class="print-page layout-${page.layoutVariant}" data-page-kind="${page.kind}"><div class="page-number">${String(index + 1).padStart(2, '0')} / ${String(context.plan.pages.length).padStart(2, '0')}</div><div class="page-copy"><p class="eyebrow">${page.kind === 'appendix' ? '依据索引' : '前期策划成果提案'}</p><h1>${escapeHtml(page.headline)}</h1><p class="focus">${escapeHtml(copy)}</p>${productCopy}${evidence === '' ? '' : `<ul class="evidence">${evidence}</ul>`}</div><div class="page-media">${assets}</div>${sourceFootnote}</section>`
}

export async function renderPrintHtml(
  context: ClientRenderContext,
  outputRoot: string,
): Promise<string> {
  assertClientReportPolicy(context.report)
  assertClientPagePlan(context.plan)
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
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="preplan-project-id" content="${escapeHtml(context.identity.projectId)}"><meta name="preplan-source-revision" content="${context.identity.sourceRevision}"><meta name="preplan-recommendation-id" content="${escapeHtml(context.identity.recommendationId)}"><meta name="preplan-adopted-assets" content="${escapeHtml(adoptedAssets)}"><title>${escapeHtml(context.report.identity.reportTitle)}｜打印版</title><style>@page{size:A4 landscape;margin:0}*{box-sizing:border-box}body{margin:0;color:#${colors.ink};font-family:${fonts}}.print-page{position:relative;width:297mm;height:210mm;padding:17mm 18mm 16mm;display:grid;grid-template-columns:7fr 5fr;gap:10mm;align-items:center;overflow:hidden;break-after:page;background:#${colors.background}}.print-page:last-child{break-after:auto}.layout-full-bleed{color:#${colors.surface};background:#${colors.ink}}.page-number{position:absolute;top:8mm;right:18mm;color:#${colors.muted};font-size:9pt}.eyebrow{color:#${colors.accent};font-size:9pt;font-weight:700;letter-spacing:.18em}.page-copy h1{margin:4mm 0 6mm;font-size:26pt;line-height:1.08}.focus{white-space:pre-line;font-size:15pt;line-height:1.5;color:#${colors.primary}}.layout-full-bleed .focus{color:#${colors.surface}}aside{padding:5mm;background:#${colors.surface};color:#${colors.ink}}aside h3{margin:0 0 3mm;font-size:17pt}.evidence{display:grid;gap:3mm;margin:6mm 0 0;padding:0;list-style:none}.evidence li{display:grid;gap:1.5mm;padding:3mm 4mm;background:#${colors.surface};color:#${colors.ink};border-left:2mm solid #${colors.primary};font-size:10pt}.evidence small,.evidence span{color:#${colors.muted};font-size:8.5pt}.page-media figure{margin:0}.page-media img{display:block;width:100%;max-height:145mm;object-fit:contain}.page-media figcaption{margin-top:2mm;color:#${colors.muted};font-size:8pt}.print-page>footer{position:absolute;left:18mm;right:18mm;bottom:7mm;color:#${colors.muted};font-size:7.5pt}</style></head><body>${pages}</body></html>`
  const path = join(printRoot, 'index.html')
  await writeFile(path, html, 'utf8')
  return path
}
