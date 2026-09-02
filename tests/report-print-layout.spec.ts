import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { runGoldenProject } from '../scripts/build-golden-project.ts'
import {
  copyWordBreakViolations,
  directedGraphLayoutViolations,
  fullBleedLayoutViolations,
  headingTailViolations,
  headingWordBreakViolations,
  INSTALLED_EDGE,
  probePrintLayoutWithEdge,
  sitePlanAxisLabelViolations,
} from './support/edge-print-layout.ts'

const fixtureRoot = fileURLToPath(new URL('./fixtures/golden-project/', import.meta.url))
const roots: string[] = []
const PROTECTED_HEADING_TERMS = [
  '项目所处的区域网络',
  '生态',
  '城市生活',
  '公共',
  '整体识别',
  '之间',
  '时段组合',
  '共享',
  '全天候',
  '全天候使用',
  '后续游线',
  '一体设计',
  '基础设施',
  '公共界面与运营模型',
] as const
const PROTECTED_COPY_TERMS = [
  '城市界面',
  '目的地',
  '非测绘成果',
  '步行体验',
  '后续游线',
  '空间构成',
  '全天组合',
  '服务半径',
  '界面一体',
  '建设节奏',
  '公共性',
  '运营模型',
  '降低一次性投入风险',
  '形成持续发生的城市生活目的地',
] as const

const LEGACY_FULL_BLEED_MUTATION = `
.visual-evidence.layout-full-bleed {
  display: block;
  padding: 9mm 12mm 13mm;
  align-items: initial;
}
.visual-evidence.layout-full-bleed .page-media {
  height: 146mm;
  overflow: visible;
}
.visual-evidence.layout-full-bleed .page-media img {
  height: 138mm;
  max-height: none;
}
.visual-evidence.layout-full-bleed .page-copy {
  display: grid;
  grid-template-columns: 42mm 1fr;
  grid-template-rows: none;
  gap: 2mm 6mm;
  min-height: initial;
  margin-top: 3mm;
  padding-top: 3mm;
}
.visual-evidence.layout-full-bleed .page-copy .eyebrow {
  grid-column: auto;
  grid-row: 1 / 3;
}
.visual-evidence.layout-full-bleed .page-copy h1,
.visual-evidence.layout-full-bleed .focus,
.visual-evidence.layout-full-bleed .visual-contract {
  grid-column: auto;
  grid-row: auto;
}
`

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

describe('Golden 打印版真实 Edge 布局', () => {
  it.runIf(INSTALLED_EDGE !== undefined)('客户标题没有词内断行或极短尾行，且 full-bleed 专业图件页没有重叠或文本区域溢出', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-print-layout-'))
    roots.push(root)
    const outputRoot = join(root, 'golden')
    await runGoldenProject(fixtureRoot, outputRoot, { browserExecutable: INSTALLED_EDGE!, formats: ['html', 'pptx', 'pdf'] })
    const printHtml = join(outputRoot, 'print', 'index.html')

    const legacy = await probePrintLayoutWithEdge(printHtml, INSTALLED_EDGE!, {
      injectedCss: LEGACY_FULL_BLEED_MUTATION,
    })
    const current = await probePrintLayoutWithEdge(printHtml, INSTALLED_EDGE!)

    expect(legacy.pages.length).toBeGreaterThan(0)
    expect(legacy.pages).toHaveLength(current.pages.length)
    expect(fullBleedLayoutViolations(legacy)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^07 \/ \d+:copy-footer-overlap$/u),
      expect.stringMatching(/^07 \/ \d+:contract-footer-overlap$/u),
      expect.stringMatching(/^10 \/ \d+:title-content-overflow$/u),
    ]))
    expect(current.devicePixelRatio).toBe(1)
    expect(
      fullBleedLayoutViolations(current),
      JSON.stringify(current.pages.map(page => ({
        pageNumber: page.pageNumber,
        title: page.title,
        body: page.body,
        contract: page.contract,
      })), null, 2),
    ).toEqual([])
    const headingDiagnostics = JSON.stringify(current.headings.map(heading => ({
      pageNumber: heading.pageNumber,
      text: heading.text,
      lines: heading.lines.map(line => ({
        text: line.text,
        width: line.rect.width,
      })),
    })), null, 2)
    expect(
      headingWordBreakViolations(current, PROTECTED_HEADING_TERMS),
      headingDiagnostics,
    ).toEqual([])
    expect(
      headingTailViolations(current),
      headingDiagnostics,
    ).toEqual([])
    const copyDiagnostics = JSON.stringify(current.copyBlocks.map(copy => ({
      pageNumber: copy.pageNumber,
      text: copy.text,
      lines: copy.lines.map(line => line.text),
    })), null, 2)
    expect(
      copyWordBreakViolations(current, PROTECTED_COPY_TERMS),
      copyDiagnostics,
    ).toEqual([])
    const graphDiagnostics = JSON.stringify(current.directedGraphs, null, 2)
    expect.soft(directedGraphLayoutViolations(current), graphDiagnostics).toEqual([])
    expect.soft(sitePlanAxisLabelViolations(current), JSON.stringify(current.sitePlanAxisLabels, null, 2)).toEqual([])
  }, 90_000)

  it.runIf(INSTALLED_EDGE !== undefined)('时段—客群矩阵占满打印内容栏并保持水平居中', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-print-matrix-layout-'))
    roots.push(root)
    const outputRoot = join(root, 'golden')
    await runGoldenProject(fixtureRoot, outputRoot, { browserExecutable: INSTALLED_EDGE!, formats: ['html', 'pptx', 'pdf'] })
    const current = await probePrintLayoutWithEdge(join(outputRoot, 'print', 'index.html'), INSTALLED_EDGE!)
    const matrix = current.analysisMatrices.find(candidate => candidate.pageNumber.startsWith('28'))

    expect(matrix, 'PDF 第28页缺少可测量的时段—客群矩阵').toBeDefined()
    expect(matrix!.table.width / matrix!.copy.width, 'PDF 第28页矩阵未占满内容栏').toBeGreaterThanOrEqual(0.94)
    expect(
      Math.abs((matrix!.table.left + matrix!.table.width / 2) - (matrix!.copy.left + matrix!.copy.width / 2)),
      'PDF 第28页矩阵未在内容栏中水平居中',
    ).toBeLessThanOrEqual(2)
  }, 90_000)
})
