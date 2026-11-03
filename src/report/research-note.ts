import { getModuleFieldContracts } from '../research-v2/module-contracts.ts'
import type { FrozenProjectInput } from './types.ts'

/** Mechanical index of retained native research, separate from the proposal. */
export function reportResearchUsage(input: FrozenProjectInput) {
  const research = input.moduleResearch
  if (!research) return []
  const pages = input.manuscript?.chapters.flatMap(chapter => chapter.pages) ?? []
  return research.expectedModuleIds.map(itemId => {
    const result = research.results.find(row => row.itemId === itemId)
    const run = research.moduleRuns.find(row => row.itemId === itemId)
    return { itemId, status: run?.status ?? 'missing',
      pageIds: pages.filter(page => page.sourceRefs.some(ref => ref.startsWith(`source:module:${itemId}:`))).map(page => page.id),
      conclusion: result?.execution?.synthesis?.judgment.conclusion,
      bundleRunId: run?.bundleRunId, resultHash: run?.resultHash,
    }
  })
}

/** Readable projection of already verified research. Never infer a scope from the task transcript. */
export function researchCompilationNote(input: FrozenProjectInput, status: string): readonly string[] | undefined {
  if (!input.moduleResearch) return undefined
  const matches = input.moduleResearch.results.filter(result => result.itemId === '1.01')
  const fail = (): never => { throw new Error('REPORT_RESEARCH_NOTE_UNAVAILABLE: 当前冻结研究缺少有效的项目任务范围与口径日期。') }
  if (matches.length !== 1) return fail()
  const result = matches[0]!, contract = getModuleFieldContracts('1.01')
  const lines = [`成果版本：第 ${input.revision} 版；报告日期：${input.generatedAt.slice(0, 10)}。`, status]
  for (const name of Object.keys(contract.ports)) {
    const port = result.outputs[name] as { scope?: unknown; asOf?: unknown; limitations?: unknown } | undefined
    if (!port || typeof port.scope !== 'string' || !port.scope.trim() || typeof port.asOf !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/u.test(port.asOf) || Number.isNaN(Date.parse(port.asOf))
      || new Date(port.asOf).toISOString().slice(0, 10) !== port.asOf || !Array.isArray(port.limitations)
      || !port.limitations.every(value => typeof value === 'string')) return fail()
    lines.push(`本报告采用的冻结研究范围：${port.scope}`, `研究口径日期：${port.asOf}。`,
      ...port.limitations.map(value => `范围与资料限制：${value}`))
  }
  lines.push(...result.limitations.map(value => `研究适用限制：${value}`))
  lines.push('研究资料索引：完整保留已核验的研究；正文按方案论证需要引用，其余条目作为资料与限制依据。未在正文单独引用不表示关键内容可以省略，方案完整性另经独立审查。')
  for (const entry of reportResearchUsage(input)) {
    const status = entry.status === 'completed' ? '已核验' : entry.status === 'limited' ? '已核验，保留适用条件' : entry.status
    lines.push(`研究 ${entry.itemId}｜${status}｜${entry.pageIds.length ? `正文引用：${entry.pageIds.join('、')}` : '资料与限制依据，正文未单独引用'}`
      + (entry.conclusion ? `｜研究结论：${entry.conclusion}` : ''))
  }
  return lines
}
