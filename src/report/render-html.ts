import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
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
  if (!['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(extension)) throw new Error(`unsupported report asset: ${basename(sourcePath)}`)
  return `${assetId}${extension}`
}

function displayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value)
  return match === null ? value : `${match[1]}年${match[2]}月${match[3]}日`
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

export async function renderHtml(document: ReportDocument, outputRoot: string): Promise<RenderedArtifact> {
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
  const bytes = (await stat(path)).size
  return {
    format: 'html',
    fileName: 'html/index.html',
    path,
    sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
    bytes,
  }
}
