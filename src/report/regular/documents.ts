import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClientReport } from '../client-types.ts'
import { planningProductRows } from '../render-planning-page.ts'

const esc = (s: string) => s.replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const cell = (s: string) => s.replace(/\|/gu, '\\|').replace(/\n/gu, '<br>')
const table = (columns: readonly string[], rows: readonly (readonly string[])[]) => [`| ${columns.map(cell).join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.map(cell).join(' | ')} |`)].join('\n')

export async function writeAuthoredReportDocuments(report: ClientReport, root: string): Promise<void> {
  const copy = [`# ${report.identity.reportTitle}`], sources: string[] = []
  let previous = ''
  for (const chapter of report.chapters) for (const block of chapter.blocks) if (block.type === 'planning-page') {
    if (previous !== block.chapterTitle) { copy.push(`## ${block.chapterTitle}`); previous = block.chapterTitle }
    const page = block.page
    copy.push(`### ${page.title}`, `**${page.claim}**`, ...page.body)
    if (page.product) copy.push(table(['产品要素', '策划内容'], planningProductRows(page)))
    if (page.table) copy.push(table(page.table.columns, page.table.rows))
    sources.push(`<section><h2>${esc(page.title)}</h2><p>图像类别：${esc(({ source: '原始资料 / 真实案例照片', concept: '生成的策划场景', diagram: '策划关系图', none: '文字与表格' })[page.visual.kind])}</p>${page.notes.map(n => `<p>${esc(n)}</p>`).join('')}${page.sourceRefs.map(id => {
      const evidence = report.evidence.find(e => e.evidenceId === id)
      return evidence ? `<p>${esc(evidence.statement)}</p><p class="basis">${esc(evidence.sourceLabel)} · ${esc(evidence.sourceDate)} · ${esc(evidence.locator)}</p>` : ''
    }).join('')}</section>`)
  }
  await writeFile(join(root, 'report-manuscript.md'), copy.join('\n\n') + '\n', 'utf8')
  await writeFile(join(root, 'planning-sources.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>资料依据</title><style>body{max-width:1000px;margin:48px auto;padding:24px;font-family:"Microsoft YaHei",sans-serif;line-height:1.8;color:#203b3c}section{padding:24px 0;border-bottom:1px solid #ccd6cd}p{white-space:pre-wrap;overflow-wrap:anywhere}.basis{color:#62776a}</style></head><body><h1>${esc(report.identity.reportTitle)} · 资料依据</h1>${sources.join('')}</body></html>`, 'utf8')
}
