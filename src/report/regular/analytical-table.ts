/** Financial analysis can be read directly; an unrelated scene adds no evidence.
 * This only applies to analytical continuations. The report-wide 15% text-page
 * limit still counts every such page and remains a separate publication gate.
 */
export function allowsAnalyticalTableText(body: readonly string[], rows: readonly (readonly string[])[]): boolean {
  if (!rows.length) return false
  const financial = /现金流|税费|融资|折现|收益|收入|收支|成本|支出|投资|资金|价格|预算|费用|单价|估算|核算|报价/u
  const physical = /公园|建筑|楼宇|场馆|厕所|卫生间|步道|栈道|停车|接驳|集散|茶室|茶园|茶厂|品茶|漫游|商店|客房|场地|广场|水库|水岸|设备房|茶事|采摘|零售|导览|露营|骑行|餐饮|游泳|划船|滑雪/u
  const analytical = (text: string) => financial.test(text) && !physical.test(text)
  // Read complete rows: a generic label may carry only a cost calculation,
  // while an income label can still describe a concrete place or activity.
  return body.filter(value => value.trim()).every(analytical) && rows.every(row => {
    const label = row[0]?.trim() ?? '', text = row.join(' ')
    const deferredCategory = /^(?:外围)?(?:新增|其他|后续)(?:活动|内容|事项)$/u.test(label)
      && /不纳入[^。；]{0,20}(?:收入|预测|估算)/u.test(text)
    return (financial.test(label) || deferredCategory) && analytical(text)
  })
}

/** Apply the same decision to saved physical-page context, including every cell. */
export function allowsAnalyticalSourceText(sources: readonly { readonly path: string; readonly text: string }[]): boolean {
  const rows = new Map<string, Map<number, string>>()
  for (const source of sources) {
    const match = /^table\.rows\[(\d+)\]\[(\d+)\]$/u.exec(source.path)
    if (!match) continue
    const columns = rows.get(match[1]!) ?? new Map<number, string>()
    columns.set(Number(match[2]), source.text); rows.set(match[1]!, columns)
  }
  if ([...rows.values()].some(columns => !columns.has(0))) return false
  return allowsAnalyticalTableText(sources.filter(source => /^body\[\d+\]$/u.test(source.path)).map(source => source.text),
    [...rows.values()].map(columns => [...columns].sort((a, b) => a[0] - b[0]).map(([, text]) => text)))
}
