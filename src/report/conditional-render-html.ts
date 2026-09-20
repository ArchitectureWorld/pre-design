import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { conditionalReportDetails } from './conditional-report.ts'
import { renderHtml } from './render-html.ts'
import type { ClientRenderContext } from './client-types.ts'

function escape(value: string): string {
  return value.replace(/[&<>"']/gu, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]!)
}

export async function renderConditionalHtml(context: ClientRenderContext, root: string) {
  const artifact = await renderHtml(context, root)
  const detail = conditionalReportDetails(context.report)
  const appendix = `<article id="planning-details" style="max-width:1100px;margin:48px auto;padding:32px;line-height:1.8;background:#fff;color:#182b2e"><h1>详细策划资料</h1><p>以下保留全部已冻结策划条目及依据说明；内容及测算尚待专项复核。</p>${detail.map(row =>
    `<details style="margin:20px 0;border:1px solid #ccd6d3;padding:16px"><summary>${escape(row.title)}</summary>${row.entries.map(entry => `<p style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(entry)}</p>`).join('')}</details>`).join('')}</article>`
  const authored = context.report.chapters.some(chapter => chapter.blocks.some(block => block.type === 'planning-page'))
  const original = await readFile(artifact.path, 'utf8')
  if (authored) {
    const sourcePath = join(root, 'planning-sources.html')
    const sourceHtml = context.plan.canvas ? await readFile(sourcePath, 'utf8') : '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>策划依据与工作资料</title></head><body></body></html>'
    await writeFile(sourcePath, sourceHtml.replace('</body>', `${appendix}</body>`), 'utf8')
  }
  const html = (authored ? original : original.replace('</body>', `${appendix}</body>`))
    .replace('</head>', '<style>.lead-copy{white-space:pre-line;font-size:clamp(16px,1.4vw,22px)!important;line-height:1.6}.content-grid h2{font-size:clamp(26px,2.6vw,44px)}.content-grid .page-visual img{max-height:65vh;object-fit:contain}</style></head>')
  const bytes = Buffer.from(html)
  await writeFile(artifact.path, bytes)
  return { ...artifact, bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex') }
}
