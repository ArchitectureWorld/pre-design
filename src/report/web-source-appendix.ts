import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FrozenProjectInput } from './types.ts'
import { makeSourceIndex } from './manuscript/source.ts'
import { readModuleWebSource } from '../research-v2/module-web-acquisition.ts'

const esc = (value: string) => value.replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
/** Offline source responses travel with HTML. Raw site HTML is escaped and never executed. */
export async function writeReportWebSourceAppendix(input: FrozenProjectInput, workspaceRoot: string, root: string): Promise<void> {
  const used = new Set(input.manuscript?.chapters.flatMap(chapter => chapter.pages.flatMap(page => page.sourceRefs)) ?? [])
  const paths = new Set(makeSourceIndex(input).filter(source => used.has(source.id)).flatMap(source => source.moduleLineage?.sources.map(row => row.source.path) ?? []))
  const documents = (input.moduleResearch?.documents ?? []).filter(document => document.provenance && paths.has(document.path))
  if (!documents.length) return
  for (const folder of ['sources', 'sources/web']) {
    const path = join(root, folder); await mkdir(path, { recursive: true })
    if ((await lstat(path)).isSymbolicLink()) throw new Error('REPORT_SOURCE_PATH_INVALID')
  }
  const entries: string[] = [], seen = new Set<string>()
  for (const document of documents) {
    const { archive, text } = await readModuleWebSource(workspaceRoot, document)
    if (seen.has(document.contentHash)) continue
    seen.add(document.contentHash)
    const path = `sources/web/${document.contentHash}.json`, source = document.provenance!
    try { await writeFile(join(root, path), archive, { flag: 'wx' }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await readFile(join(root, path), 'utf8') !== archive) throw error }
    const searchLog = source.sourceUri.startsWith('workspace:native-web-query/')
    const heading = searchLog ? '检索执行记录' : '网络来源原文'
    const origin = searchLog ? '实际公开网页查询操作' : `<a href="${esc(source.sourceUri)}" target="_blank" rel="noopener noreferrer">原发页面</a>`
    const boundary = searchLog ? '仅证明查询行为与执行状态，不能替代外部业务原文或证明检索覆盖完整。' : '此处保留网页记载，发表日期和适用性见各项研究；不自动视为当前现场事实。'
    entries.push(`<section id="web-source-${document.contentHash}"><h2>${heading}</h2><p>${origin} · 获取时间 ${esc(source.retrievedAt)} · <a href="${path}">原始响应快照</a></p><p>SHA-256：${document.contentHash}。${boundary}</p><details><summary>查看提取原文</summary><p>${esc(text)}</p></details></section>`)
  }
  const htmlPath = join(root, 'planning-sources.html'), html = await readFile(htmlPath, 'utf8')
  if (!html.includes('</body>')) throw new Error('REPORT_SOURCE_HTML_INVALID')
  const block = `<div id="web-source-archive">${entries.join('')}</div>`
  await writeFile(htmlPath, html.includes('<div id="web-source-archive">') ? html.replace(/<div id="web-source-archive">[\s\S]*?<\/div>/u, block) : html.replace('</body>', `${block}</body>`))
}
