import type { PlanningManuscript, PlanningManuscriptSource } from './types.ts'

const cell = (value: string) => value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, '<br>')
function table(columns: readonly string[], rows: readonly (readonly string[])[]): string {
  return [`| ${columns.map(cell).join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(cell).join(' | ')} |`)].join('\n')
}

/** A readable rendering of the accepted content, without shortening or rewriting its arguments. */
export function renderPlanningManuscriptMarkdown(manuscript: PlanningManuscript): string {
  const parts: string[] = [`# ${manuscript.title}`]
  for (const chapter of manuscript.chapters) {
    parts.push(`## ${chapter.title}`, `**${chapter.thesis}**`)
    for (const page of chapter.pages) {
      parts.push(`### ${page.title}`, `**${page.claim}**`, ...page.body)
      if (page.table) parts.push(table(page.table.columns, page.table.rows))
      if (page.product) parts.push(table(['产品要素', page.product.name], [
        ['服务客群', page.product.audience], ['使用体验', page.product.experience], ['空间载体与选址', page.product.location],
        ['规模与承载', page.product.scale], ['运营方式', page.product.operations],
      ]))
    }
  }
  return parts.join('\n\n') + '\n'
}

/** Technical evidence and art direction are a separate document, never the report body. */
export function renderPlanningManuscriptEvidence(manuscript: PlanningManuscript, sources: readonly PlanningManuscriptSource[] = []): string {
  const parts = [`# ${manuscript.title}：资料依据与图文说明`]
  const index = new Map(sources.map(source => [source.id, source]))
  const visualKinds = { source: '原始资料', concept: '概念场景', diagram: '分析图表', none: '纯文字表达' }
  for (const chapter of manuscript.chapters) for (const page of chapter.pages) {
    parts.push(`### ${page.title}`, ...page.notes,
      `图文职责：${visualKinds[page.visual.kind]}；${page.visual.subject}。${page.visual.purpose}。图注：${page.visual.caption}`)
    for (const ref of page.sourceRefs) {
      const source = index.get(ref)
      parts.push(source ? `- 来源：${source.objectId} / ${source.fieldPath}。${source.text}\n  依据与性质：${source.basis}` : `- 来源索引：${ref}`)
    }
  }
  return parts.join('\n\n') + '\n'
}
