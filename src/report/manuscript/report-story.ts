import type { PlanningManuscriptPage } from './types.ts'

export const REPORT_STORY_VERSION = 'visual-report-story-2026-09-18.2'
// A decimal point, negation or condition can change a conclusion. Only whitespace
// and an optional Chinese sentence terminator are interchangeable here.
const sentenceKey = (value: string) => value.replace(/\s+/gu, ' ').trim().replace(/。$/u, '')
const sentences = (s: string) => s.match(/[^。！？]+[。！？]?/gu)?.map(v => v.trim()).filter(Boolean) ?? []
function covered(candidate: string, existing: readonly string[]): boolean {
  const key = sentenceKey(candidate)
  return key.length > 0 && existing.some(value => sentenceKey(value) === key)
}

/** Extract complete source sentences. This never invents facts or edits a cached manuscript. */
export function summarizeReportPage(page: PlanningManuscriptPage): PlanningManuscriptPage {
  if (page.editorialSummary) return page
  const archived = ['完整文稿', page.title, page.claim, ...page.body,
    ...(page.product ? Object.entries(page.product).map(([key, value]) => `${key}：${value}`) : []),
    ...(page.table ? [page.table.columns.join('｜'), ...page.table.rows.map(row => row.join('｜'))] : [])].join('\n')
  // Keep each table row's scope intact. A value from a conditional row cannot
  // cover an unconditional statement, and words from different rows cannot be combined.
  const tableStatements = page.table?.rows.flatMap(row => [row.join('｜'),
    ...(row.length === 2 ? [`${row[0]}：${row[1]}`, `${row[0]}: ${row[1]}`] : [])]) ?? []
  const alreadyPresented = [...sentences(page.claim), ...tableStatements]
  const selected: string[] = []
  for (const sentence of page.body.flatMap(sentences)) {
    if (covered(sentence, [...alreadyPresented, ...selected])) continue
    selected.push(sentence)
  }
  // Layouts replace the product card with this visible copy, so capacity and
  // operating conditions must survive along with experience and location.
  if (page.product) {
    const fields = [['name', '产品'], ['audience', '服务客群'], ['experience', '体验内容'],
      ['location', '空间载体'], ['scale', '容量规模'], ['operations', '运营方式']] as const
    for (const [field, label] of fields) {
      const value = page.product[field], statement = `${label}｜${value}`
      const existing = [...alreadyPresented, ...selected, ...(field === 'name' ? [page.title] : [])]
      if (covered(statement, existing) || sentences(value).every(sentence => covered(sentence, existing))) continue
      selected.push(statement)
    }
  }
  // Concision is an author/editor responsibility. Pagination must accommodate
  // all remaining unique source statements rather than silently discarding them.
  return { ...page, editorialSummary: true, body: selected, notes: [...page.notes, archived] }
}
