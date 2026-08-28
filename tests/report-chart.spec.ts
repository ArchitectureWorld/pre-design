import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { renderChartSvg } from '../src/report/render-chart.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('renderChartSvg', () => {
  it('renders deterministic local SVG without executable content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-chart-'))
    roots.push(root)
    const output = join(root, 'progress.svg')
    await renderChartSvg({
      type: 'chart', chartId: 'chapter-progress', chartType: 'bar',
      labels: ['任务确认', '场地研判', '方案策划'], values: [100, 86, 72], unit: '%',
    }, output)
    const svg = await readFile(output, 'utf8')
    expect(svg).toContain('<svg')
    expect(svg).toContain('任务确认')
    expect(svg).not.toMatch(/<script|(?:href|src)=["']https?:\/\//iu)
  })
})
