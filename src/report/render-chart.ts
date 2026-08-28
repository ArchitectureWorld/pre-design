import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ReportNode } from './types.ts'

type ChartNode = Extract<ReportNode, { readonly type: 'chart' }>

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]!)
}

export async function renderChartSvg(chart: ChartNode, outputPath: string): Promise<string> {
  if (chart.labels.length !== chart.values.length || chart.labels.length === 0) {
    throw new Error(`chart '${chart.chartId}' labels and values must have equal non-zero length`)
  }
  const width = 1200
  const rowHeight = 92
  const height = 110 + chart.labels.length * rowHeight
  const max = Math.max(1, ...chart.values.map(value => Math.abs(value)))
  const rows = chart.labels.map((label, index) => {
    const value = chart.values[index] ?? 0
    const barWidth = Math.round(760 * Math.abs(value) / max)
    const y = 72 + index * rowHeight
    return `<g><text x="24" y="${y + 28}" font-size="24" fill="#132a2e">${escapeXml(label)}</text><rect x="300" y="${y}" width="${barWidth}" height="40" rx="4" fill="#2b7180"/><text x="${Math.min(1080, 316 + barWidth)}" y="${y + 28}" font-size="22" fill="#132a2e">${escapeXml(String(value))}${escapeXml(chart.unit)}</text></g>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(chart.chartId)}"><rect width="100%" height="100%" fill="#ffffff"/>${rows}</svg>`
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, svg, 'utf8')
  return outputPath
}
