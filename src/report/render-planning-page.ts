import type { PlanningManuscriptPage } from './manuscript/types.ts'

const esc = (value: string) => value.replace(/[&<>"']/gu, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]!)

export function planningProductRows(page: PlanningManuscriptPage): string[][] {
  const p = page.product
  return p ? [...(page.title.includes(p.name) ? [] : [['产品名称', p.name]]), ['目标客群', p.audience], ['核心体验', p.experience], ['空间载体', p.location], ['规模依据', p.scale], ['运营组织', p.operations]] : []
}

export function renderPlanningPage(page: PlanningManuscriptPage, chapterTitle: string, assets = ''): string {
  const product = planningProductRows(page)
  const table = page.table ? `<table class="planning-table"><thead><tr>${page.table.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${page.table.rows.map(row => `<tr>${row.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''
  return `<article class="planning-page${assets ? ' with-media' : ''}${assets && page.visual.diagram ? ' with-diagram' : ''}"><header><p class="planning-chapter">${esc(chapterTitle)}</p><h1>${esc(page.title)}</h1><p class="planning-claim">${esc(page.claim)}</p></header><div class="planning-main"><div class="planning-copy">${page.body.map(p => `<p>${esc(p)}</p>`).join('')}${product.length ? `<dl class="planning-product">${product.map(([label, body]) => `<div><dt>${esc(label!)}</dt><dd>${esc(body!)}</dd></div>`).join('')}</dl>` : ''}</div>${assets ? `<div class="planning-media">${assets}</div>` : ''}</div>${table}</article>`
}

export const PLANNING_PAGE_CSS = `
.report-page:has(.planning-page){display:block;min-height:100vh;height:auto;padding:64px 6vw;background:#f5f4ef;color:#203b3c;overflow:visible}
.planning-page{width:100%;max-width:1500px;margin:auto}.planning-chapter{font-size:14px;letter-spacing:.12em;color:#55776e;margin:0 0 14px}.planning-page h1{font-size:clamp(28px,3vw,46px);line-height:1.3;margin:0 0 20px;max-width:none}
.planning-claim{font-size:clamp(20px,1.8vw,28px);font-weight:650;line-height:1.55;margin:0 0 24px;max-width:1200px}.planning-main{display:grid;gap:32px}.planning-page.with-media .planning-main{grid-template-columns:1.1fr 1fr}.planning-copy>p{font-size:18px;line-height:1.8;margin:0 0 16px}.planning-media{min-width:0}.planning-media figure{margin:0}.planning-media img{width:100%;max-height:500px;object-fit:contain}.planning-media figcaption{font-size:13px;color:#5d706e;margin-top:8px}
.planning-product{display:grid;gap:12px;margin:24px 0 0}.planning-product>div{display:grid;grid-template-columns:76px 1fr;gap:14px;padding-top:10px;border-top:1px solid #cdd7d0}.planning-product dt{font-size:14px;color:#4a6c62}.planning-product dd{font-size:16px;line-height:1.7;margin:0}.planning-table{width:100%;border-collapse:collapse;margin-top:24px;table-layout:fixed;font-size:16px;line-height:1.65}.planning-table th{background:#2e5951;color:white;text-align:left}.planning-table th,.planning-table td{padding:12px 16px;border-bottom:1px solid #cdd7d0;overflow-wrap:anywhere}.planning-table tbody tr:nth-child(even){background:#e9eeea}
.planning-copy{min-width:0}.planning-copy>p,.planning-product dd,.planning-table th,.planning-table td{white-space:pre-line;overflow-wrap:anywhere}
.planning-page.with-diagram .planning-main{grid-template-columns:1fr 2fr}.planning-page.with-diagram .planning-media img{object-position:center top}
@media(max-width:800px){.planning-page.with-media .planning-main{grid-template-columns:1fr}}
`

export const PLANNING_PRINT_CSS = `
.print-page:has(.planning-page){display:block;padding:14mm 18mm 16mm;align-items:start}.print-page .planning-page h1{font-size:24pt;line-height:1.25;margin:0 0 5mm}.print-page .planning-chapter{font-size:9pt;margin:0 0 3mm}.print-page .planning-claim{font-size:15pt;line-height:1.45;margin:0 0 5mm}.print-page .planning-main{gap:7mm}.print-page .planning-copy>p{font-size:11pt;line-height:1.6;margin:0 0 3mm}.print-page .planning-product{margin-top:4mm;gap:2mm}.print-page .planning-product>div{grid-template-columns:18mm 1fr;gap:3mm;padding-top:2mm}.print-page .planning-product dt{font-size:9pt}.print-page .planning-product dd{font-size:10pt;line-height:1.5}.print-page .planning-table{font-size:10pt;line-height:1.5;margin-top:5mm}.print-page .planning-table th,.print-page .planning-table td{padding:2mm 3mm}.print-page .planning-media img{max-height:95mm}.print-page .planning-media figcaption{font-size:8pt}
.print-page .planning-page{height:100%;display:flex;flex-direction:column}.print-page .planning-page>header,.print-page .planning-table{flex-shrink:0}.print-page .planning-main{flex:1;min-height:0;grid-template-rows:minmax(0,1fr)}.print-page .planning-page.with-media .planning-main{grid-template-columns:1.1fr 1fr}.print-page .planning-media{height:100%;min-height:0;display:flex;flex-direction:column;gap:3mm}.print-page .planning-media figure{flex:1;min-height:0;display:flex;flex-direction:column}.print-page .planning-media img{flex:1;min-height:0;height:0;max-height:none;object-fit:contain}.print-page .planning-media figcaption{flex-shrink:0}
.print-page .planning-page.with-diagram .planning-main{grid-template-columns:1fr 2fr}
.print-page .planning-page:not(.with-media) .planning-main{flex:0 0 auto}
`
