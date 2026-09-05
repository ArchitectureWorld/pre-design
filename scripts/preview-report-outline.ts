/** Read-only production snapshot preview. Writes only the explicitly requested HTML file. */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { homedir } from 'node:os'
import { ContractRegistry } from '../src/contracts/registry.ts'
import { createFrozenProjectInput, type ReportSourceDependencies } from '../src/report/source.ts'
import { compileReportOutline } from '../src/presentation/projector/report-outline.ts'
import { DEFAULT_PRESENTATION_TOPICS } from '../src/presentation/projector/topics.ts'

const args = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const projectId = option('--project-id')
const storageRoot = option('--storage-root')
if (!projectId || !storageRoot) throw new Error('Usage: tsx scripts/preview-report-outline.ts --project-id ID --storage-root DIR [--out EXISTING_DIR/outline.html]')
const load = async (name: string) => JSON.parse(await readFile(join(storageRoot, name), 'utf8'))
const state = await load('preplanning_agent.json')
const governance = await load('preplanning_governance.json')
const project = Object.values(state.tables.projects).find((item: any) => item.projectId === projectId) as any
if (project === undefined) throw new Error('Project not found')
const revision = Object.values(state.tables.revisions).find((item: any) => item.projectId === projectId && item.revision === project.currentRevision) as any
if (revision === undefined) throw new Error('Revision not found')
const registry = await ContractRegistry.open(new URL('../contracts/v0.6/', import.meta.url))
const projectRows = (name: string) => Object.values(governance.tables[name] ?? {}).filter((item: any) => item.projectId === projectId)
const source = createFrozenProjectInput(projectId, project.currentRevision, {
  repository: { readProjectRevision: () => ({ project, revision, stateSnapshot: revision.stateSnapshot }) },
  governance: { readProject: () => ({
    gateDecisions: projectRows('gate_decisions'), visualTasks: projectRows('visual_tasks'),
    visualAssets: projectRows('visual_assets'), siteBoundaries: projectRows('site_boundaries'),
  }) },
  registry,
  visualStore: { resolveAsset: (name: string) => join(homedir(), '.dsh/preplanning-agent/visual-assets', name) },
} as ReportSourceDependencies)
const findings = compileReportOutline(source)
const metrics = { projectName: project.name, revision: source.revision, objects: source.stateObjects.length,
  chapters: new Set(findings.map(f => f.topicKey)).size, sections: new Set(findings.map(f => f.sectionKey)).size,
  pages: findings.length, entries: source.stateObjects.reduce((n, object) => n + (object.reportSections ?? []).reduce((n, section) => n + section.entries.length, 0), 0) }
console.log(JSON.stringify(metrics))
console.log(findings.map(finding => `${finding.topicKey} | ${finding.title}`).join('\n'))
const out = option('--out')
if (out) {
  const target = resolve(out)
  const inside = relative(resolve(storageRoot), target)
  if (!inside.startsWith('..') && !isAbsolute(inside)) throw new Error('Preview must not write into the source storage directory')
  const escape = (text: unknown) => String(text ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
  const topics = DEFAULT_PRESENTATION_TOPICS.filter(topic => findings.some(f => f.topicKey === topic.key))
  let pageNumber = 0
  const content = topics.map((topic, chapterIndex) => {
    const chapterPages = findings.filter(f => f.topicKey === topic.key)
    const sections = [...new Set(chapterPages.map(f => f.sectionKey))]
    return `<section id="${topic.key}"><h2>${chapterIndex + 1} ${escape(topic.title)}</h2>${sections.map((sectionKey, sectionIndex) => {
      const pages = chapterPages.filter(f => f.sectionKey === sectionKey)
      return `<h3>${chapterIndex + 1}.${sectionIndex + 1} ${escape(pages[0]!.sectionTitle)}</h3>${pages.map((page, index) => {
        const blocks = page.supportingBlocks.map(block => {
          if (block.type === 'heading') return `<h5>${escape(block.content)}</h5>`
          if (block.type === 'text') return `<p class="${block.contentNature === 'missing' ? 'warning' : block.role ?? ''}">${escape(block.content)}</p>`
          if (block.type === 'list') return `<ul>${block.items.map(item => `<li>${escape(item)}</li>`).join('')}</ul>`
          if (block.type === 'table') return `<details><summary>查看论证依据与对照内容</summary><table><thead><tr>${block.columns.map(column => `<th>${escape(column)}</th>`).join('')}</tr></thead><tbody>${block.rows.map(row => `<tr>${row.map(cell => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`
          return ''
        }).join('')
        return `<article><h4><span>P${++pageNumber} · ${chapterIndex + 1}.${sectionIndex + 1}.${index + 1}</span> ${escape(page.title)}</h4><p class="claim">${escape(page.keyMessage)}</p>${blocks}<details><summary>完整成果与逐项来源</summary>${(page.speakerNotes ?? []).map(note => `<p>${escape(note)}</p>`).join('')}</details></article>`
      }).join('')}`
    }).join('')}</section>`
  }).join('')
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(project.name)}｜详细汇报大纲</title><style>body{font:16px/1.8 system-ui,'Microsoft YaHei',sans-serif;background:#f5f3ed;color:#223136;margin:0}main{max-width:1100px;margin:auto;padding:40px 28px}h1{font-size:32px}h2{border-top:3px solid #2e5b53;padding-top:26px;margin-top:56px}h3{background:#e3ebe5;padding:10px 16px}h4{font-size:21px;margin:0 0 12px}h4 span{color:#5e756e;font:14px system-ui}h5{font-size:16px;margin-bottom:4px}article{background:white;border:1px solid #d9ddd7;padding:24px;margin:16px 0}nav{display:flex;gap:14px;flex-wrap:wrap}a{color:#245c53}.claim{border-left:3px solid #557c68;padding-left:14px}.warning{background:#fff1cd;padding:12px;border-left:3px solid #a47722}.caption,.source_note,details{font-size:14px;color:#5d6668}summary{cursor:pointer}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}li{margin-bottom:9px}@media print{nav,details{display:none}article{break-inside:avoid}body{background:white}}</style><main><header><p>前期策划成果 · R${source.revision} · 汇报编写大纲</p><h1>${escape(project.name)}<br>详细汇报大纲</h1><p>${metrics.objects} 项成果形成 ${metrics.chapters} 章、${metrics.sections} 个专题、${metrics.pages} 个页级编写任务。页数由内容决定。</p><p>本文件是详细编写大纲，并非已完成的正式汇报正文。每页列出要回答的问题、论证要点、依据与拟用图表；来源中待核实的数据和条件继续保留。</p><nav>${topics.map(topic => `<a href="#${topic.key}">${escape(topic.title)}</a>`).join('')}</nav></header>${content}</main></html>`
  await writeFile(target, html, { encoding: 'utf8', flag: 'wx' })
  console.log(`Preview written: ${target}; parent directory: ${dirname(target)}`)
}
