import type { PlanningManuscriptPage } from './manuscript/types.ts'
import { planningProductRows } from './render-planning-page.ts'
import { wrapClientText } from './client-typography.ts'

// Inches; these bounds also leave room inside the A4 landscape print layout.
export const PLANNING_CONTENT_BOTTOM = 6.74
export const PLANNING_TABLE_GAP = 0.15
export const PLANNING_BODY_LINE_POINTS = 18
export const PLANNING_PARAGRAPH_GAP_POINTS = 8
const wrap = (text: string, width: number) => wrapClientText(text.replace(/\r\n?/gu, '\n'), width, Number.MAX_SAFE_INTEGER, 'PLANNING_LAYOUT_TEXT')
const linesOf = (text: string, width: number) => wrap(text, width).split('\n').length

export function planningPageGeometry(page: PlanningManuscriptPage) {
  const title = wrap(page.title, 30), titleHeight = Math.max(0.5, title.split('\n').length * 0.45 + 0.02)
  const claim = wrap(page.claim, 41), claimY = Math.max(1.65, 0.92 + titleHeight + 0.12)
  const claimHeight = Math.max(0.85, claim.split('\n').length * 0.32 + 0.03)
  const contentTop = claimY + claimHeight + 0.12, capacity = PLANNING_CONTENT_BOTTOM - contentTop
  if (capacity < 0.5) throw new Error('PLANNING_LAYOUT_HEADER_TOO_TALL: 标题与结论超过可读页眉空间。')
  return { title, titleHeight, claim, claimY, claimHeight, contentTop, capacity }
}

export function planningProseHeight(text: string, width: number): number {
  const paragraphs = text.split(/\r\n?|\n/u).length
  return (linesOf(text, width) * PLANNING_BODY_LINE_POINTS + paragraphs * PLANNING_PARAGRAPH_GAP_POINTS) / 72
}

const tableCellHeight = (text: string, width: number) => linesOf(text, width) * 0.24 + 0.16
export function planningTableGeometry(table: NonNullable<PlanningManuscriptPage['table']>) {
  const width = 53 / table.columns.length
  const rowHeights = [table.columns, ...table.rows].map(row => Math.max(...row.map(cell => tableCellHeight(cell, width))))
  return { rowHeights, height: rowHeights.reduce((sum, height) => sum + height, 0) }
}

function splitWithinHeight(text: string, capacity: number, measure: (text: string) => number): string[] {
  if (measure(text) <= capacity) return [text]
  const characters = Array.from(text), chunks: string[] = []
  for (let offset = 0; offset < characters.length;) {
    let low = 1, high = characters.length - offset, length = 0
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      if (measure(characters.slice(offset, offset + middle).join('')) <= capacity) { length = middle; low = middle + 1 }
      else high = middle - 1
    }
    if (length === 0) throw new Error('PLANNING_LAYOUT_CONTENT_TOO_TALL: 单个字符无法放入剩余正文空间。')
    chunks.push(characters.slice(offset, offset + length).join('')); offset += length
  }
  return chunks
}

/** Physical pagination preserves every character and table row. It never summarizes copy. */
export function paginatePlanningPage(page: PlanningManuscriptPage, hasMedia: boolean): PlanningManuscriptPage[] {
  const width = hasMedia ? page.visual.diagram ? 17 : 27 : 53
  const { capacity } = planningPageGeometry(page)
  const parts: PlanningManuscriptPage[] = []
  let current = { ...page, body: [] as string[], product: undefined, table: undefined } as PlanningManuscriptPage
  let used = 0
  const finish = () => { if (used > 0) parts.push(current); current = { ...page, body: [], product: undefined, table: undefined }; used = 0 }
  const append = (text: string) => {
    for (const chunk of splitWithinHeight(text, capacity, value => planningProseHeight(value, width))) {
      const height = planningProseHeight(chunk, width)
      if (used + height > capacity) finish()
      current = { ...current, body: [...current.body, chunk] }; used += height
    }
  }
  for (const paragraph of page.body) append(paragraph)
  if (page.product) {
    const productHeight = planningProductRows(page).reduce((n, row) => n + planningProseHeight(row.join('｜'), width), 0)
    if (productHeight <= capacity) {
      if (used + productHeight > capacity) finish()
      current = { ...current, product: page.product }; used += productHeight
    } else {
      // Long product details become normal continuation paragraphs at readable type size.
      for (const row of planningProductRows(page)) append(row.join('｜'))
    }
  }
  if (page.table) {
    const columnWidth = 53 / page.table.columns.length
    const header = Math.max(...page.table.columns.map(cell => tableCellHeight(cell, columnWidth)))
    const rowCapacity = capacity - PLANNING_TABLE_GAP - header
    if (rowCapacity < tableCellHeight('', columnWidth)) throw new Error('PLANNING_LAYOUT_TABLE_HEADER_TOO_TALL: 表头未给正文行留下可读空间。')
    for (const row of page.table.rows) {
      const columns = row.map(cell => splitWithinHeight(cell, rowCapacity, value => tableCellHeight(value, columnWidth)))
      for (let index = 0; index < Math.max(...columns.map(chunks => chunks.length)); index++) {
        const fragment = columns.map(chunks => chunks[index] ?? '')
        const height = Math.max(...fragment.map(cell => tableCellHeight(cell, columnWidth)))
        if (used + height + (current.table ? 0 : header + PLANNING_TABLE_GAP) > capacity) finish()
        const initial = current.table ? 0 : header + PLANNING_TABLE_GAP
        current = { ...current, table: { columns: page.table.columns, rows: [...current.table?.rows ?? [], fragment] } }
        used += height + initial
      }
    }
  }
  finish()
  return parts.length ? parts : [page]
}
