/** Financial rows can be read directly; an unrelated scene adds no evidence.
 * This only applies to table-only continuations. The report-wide 15% text-page
 * limit still counts every such page and remains a separate publication gate.
 */
export function allowsAnalyticalTableText(body: readonly string[], rowLabels: readonly string[]): boolean {
  if (body.some(value => value.trim()) || !rowLabels.length) return false
  const financial = /现金流|税费|融资|折现|收益|收支|成本|支出|投资回收|资金|价格|预算/u
  const physical = /公园|建筑|楼宇|场馆|厕所|卫生间|步道|栈道|停车|接驳|集散|茶室|商店|客房|场地|广场|水库|水岸|设备/u
  return rowLabels.every(label => financial.test(label) && !physical.test(label))
}
