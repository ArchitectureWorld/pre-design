import type PptxGenJS from 'pptxgenjs'
import type { ClientAnalyticalVisual, ClientReport } from './client-types.ts'

type SitePlanVisual = Extract<ClientAnalyticalVisual,
  { readonly kind: 'spatial-sequence' } | { readonly kind: 'spatial-system' }>

const PLAN = Object.freeze({ x: 0.8, y: 2.12, w: 11.733, h: 3.25 })
const BOUNDARY = Object.freeze({ x: 1.18, y: 2.43, w: 9.38, h: 2.55 })

function addPlanText(
  slide: PptxGenJS.Slide,
  report: ClientReport,
  text: string,
  box: Readonly<{ x: number; y: number; w: number; h: number }>,
  options: Readonly<{
    size?: number
    color?: string
    bold?: boolean
    align?: 'left' | 'center' | 'right'
    name: string
  }>,
): void {
  slide.addText(text, {
    ...box,
    fontFace: report.theme.tokens.fonts.body,
    fontSize: options.size ?? 10,
    color: options.color ?? report.theme.tokens.colors.ink,
    bold: options.bold ?? false,
    align: options.align ?? 'left',
    valign: 'middle',
    margin: 0,
    fit: 'shrink',
    objectName: options.name,
  })
}

function addSitePlanBase(
  slide: PptxGenJS.Slide,
  report: ClientReport,
  visualKind: SitePlanVisual['kind'],
): void {
  const { primary, accent, ink, muted, surface } = report.theme.tokens.colors
  slide.addShape('rect', {
    ...PLAN,
    fill: { color: 'F1F3F0' },
    line: { color: 'D6DDDA', width: 0.8 },
    objectName: 'EditableSitePlan Base',
  })

  for (const [index, x] of [2.95, 5.35, 7.75].entries()) {
    slide.addShape('line', {
      x, y: PLAN.y + 0.18, w: 0, h: PLAN.h - 0.36,
      line: { color: 'D8DEDB', width: 0.6, transparency: 24 },
      objectName: `EditableSitePlan Context Grid Vertical ${index + 1}`,
    })
  }
  for (const [index, y] of [3.18, 4.18].entries()) {
    slide.addShape('line', {
      x: PLAN.x + 0.2, y, w: PLAN.w - 0.4, h: 0,
      line: { color: 'D8DEDB', width: 0.6, transparency: 24 },
      objectName: `EditableSitePlan Context Grid Horizontal ${index + 1}`,
    })
  }

  slide.addShape('rect', {
    x: 10.35, y: PLAN.y, w: PLAN.x + PLAN.w - 10.35, h: PLAN.h,
    fill: { color: 'CFE1E1', transparency: 8 },
    line: { color: 'CFE1E1', transparency: 100 },
    objectName: 'EditableSitePlan Water',
  })
  addPlanText(slide, report, '水岸', { x: 10.72, y: 3.55, w: 1.25, h: 0.35 }, {
    size: 14, color: primary, bold: true, align: 'center', name: 'EditableSitePlan Water Label',
  })

  const zones = [
    { x: 1.45, y: 2.72, w: 2.35, h: 0.82, label: '门户服务' },
    { x: 4.05, y: 2.64, w: 2.25, h: 0.98, label: '文化活动' },
    { x: 6.58, y: 2.72, w: 2.1, h: 0.82, label: '社区共享' },
    { x: 3.35, y: 4.08, w: 5.3, h: 0.62, label: '生态休闲' },
  ] as const
  zones.forEach((zone, index) => {
    const hidesSystemBandBase = visualKind === 'spatial-system' && index === 3
    slide.addShape('rect', {
      x: zone.x, y: zone.y, w: zone.w, h: zone.h,
      fill: { color: index % 2 === 0 ? accent : primary, transparency: hidesSystemBandBase ? 100 : 84 },
      line: { color: index % 2 === 0 ? accent : primary, transparency: hidesSystemBandBase ? 100 : 72, width: 0.7 },
      objectName: `EditableSitePlan Functional Zone ${index + 1}`,
    })
    if (!hidesSystemBandBase) {
      addPlanText(slide, report, zone.label, { x: zone.x + 0.1, y: zone.y + 0.08, w: zone.w - 0.2, h: 0.25 }, {
        size: 10, color: ink, bold: true, name: `EditableSitePlan Functional Zone Label ${index + 1}`,
      })
    }
  })

  slide.addShape('rect', {
    ...BOUNDARY,
    fill: { color: surface, transparency: 100 },
    line: { color: primary, width: 1.4, dashType: 'lgDash' },
    objectName: 'EditableSitePlan Research Boundary',
  })
  addPlanText(slide, report, '研究范围（待核）', { x: 1.32, y: 4.72, w: 1.95, h: 0.24 }, {
    size: 10, color: primary, bold: true, name: 'EditableSitePlan Research Boundary Label',
  })
  addPlanText(slide, report, '功能分区', { x: 8.92, y: 2.55, w: 1.2, h: 0.24 }, {
    size: 10, color: muted, bold: true, align: 'right', name: 'EditableSitePlan Functional Zone Legend',
  })

  slide.addShape('line', {
    x: 11.86, y: 2.5, w: 0, h: 0.62,
    line: { color: ink, width: 1.1, endArrowType: 'triangle' },
    objectName: 'EditableSitePlan North Arrow',
  })
  addPlanText(slide, report, 'N', { x: 11.64, y: 2.31, w: 0.44, h: 0.2 }, {
    size: 10, color: ink, bold: true, align: 'center', name: 'EditableSitePlan North Label',
  })
  addPlanText(slide, report, 'NTS', { x: 11.55, y: 3.17, w: 0.62, h: 0.2 }, {
    size: 10, color: muted, align: 'center', name: 'EditableSitePlan Scale Label',
  })

  addPlanText(slide, report, '自定义示例总平面｜测试阶段排版与分析演示', {
    x: PLAN.x + 0.18, y: PLAN.y + 0.08, w: 4.85, h: 0.25,
  }, { size: 10, color: muted, bold: true, name: 'EditableSitePlan Sample Label' })
}

function addMovementOverlay(
  slide: PptxGenJS.Slide,
  report: ClientReport,
  visual: Extract<SitePlanVisual, { readonly kind: 'spatial-sequence' }>,
): void {
  const { primary, accent, ink, surface } = report.theme.tokens.colors
  const nodes = visual.nodes.slice(0, 4)
  const centers = [1.82, 4.22, 6.92, 9.42]
  const centerY = 3.82
  centers.slice(0, -1).forEach((center, index) => {
    const next = centers[index + 1]!
    slide.addShape('line', {
      x: center + 0.19, y: centerY, w: next - center - 0.38, h: 0,
      line: { color: accent, width: 2.0, endArrowType: 'triangle' },
      objectName: `EditableSitePlan Movement Arrow ${index + 1}`,
    })
  })
  nodes.forEach((node, index) => {
    const center = centers[index] ?? centers.at(-1)!
    slide.addShape('ellipse', {
      x: center - 0.16, y: centerY - 0.16, w: 0.32, h: 0.32,
      fill: { color: primary },
      line: { color: surface, width: 1.2 },
      objectName: `EditableSitePlan Movement Node ${index + 1}`,
    })
    addPlanText(slide, report, node, {
      x: center - 0.62, y: centerY - 0.58, w: 1.24, h: 0.28,
    }, {
      size: 11, color: ink, bold: true, align: 'center', name: `EditableSitePlan Movement Node Label ${index + 1}`,
    })
  })

  slide.addShape('line', {
    x: 1.62, y: 4.55, w: 7.95, h: 0,
    line: { color: primary, width: 1.5, dashType: 'dash', endArrowType: 'triangle' },
    objectName: 'EditableSitePlan Slow Movement',
  })
  addPlanText(slide, report, '主轴', { x: 5.15, y: 3.42, w: 0.8, h: 0.22 }, {
    size: 10, color: accent, bold: true, align: 'center', name: 'EditableSitePlan Main Axis Label',
  })
  addPlanText(slide, report, '慢行系统', { x: 5.0, y: 4.62, w: 1.15, h: 0.24 }, {
    size: 10, color: primary, bold: true, align: 'center', name: 'EditableSitePlan Slow Movement Label',
  })
  for (const [index, x] of [1.16, 10.4].entries()) {
    slide.addShape('diamond', {
      x, y: centerY - 0.13, w: 0.26, h: 0.26,
      fill: { color: accent },
      line: { color: surface, width: 0.8 },
      objectName: `EditableSitePlan Entrance ${index + 1}`,
    })
    addPlanText(slide, report, `入口 ${String.fromCharCode(65 + index)}`, {
      x: index === 0 ? 1.3 : 9.62, y: centerY + 0.2, w: 0.82, h: 0.23,
    }, {
      size: 10, color: accent, bold: true, align: index === 0 ? 'left' : 'right',
      name: `EditableSitePlan Entrance Label ${index + 1}`,
    })
  }
}

function addSystemOverlay(
  slide: PptxGenJS.Slide,
  report: ClientReport,
): void {
  const { primary, accent, ink, surface } = report.theme.tokens.colors
  slide.addShape('rect', {
    x: 1.4, y: 4.08, w: 7.52, h: 0.58,
    fill: { color: accent, transparency: 68 },
    line: { color: accent, transparency: 100 },
    objectName: 'EditableSitePlan System Band 1',
  })
  slide.addShape('rect', {
    x: 9.12, y: 2.55, w: 1.2, h: 2.27,
    fill: { color: primary, transparency: 66 },
    line: { color: primary, transparency: 100 },
    objectName: 'EditableSitePlan System Band 2',
  })
  addPlanText(slide, report, '文化活力带', { x: 1.72, y: 4.2, w: 1.25, h: 0.24 }, {
    size: 10, color: ink, bold: true, name: 'EditableSitePlan System Band Label 1',
  })
  addPlanText(slide, report, '生态水岸带', { x: 9.18, y: 2.72, w: 1.05, h: 0.25 }, {
    size: 10, color: primary, bold: true, align: 'center', name: 'EditableSitePlan System Band Label 2',
  })

  slide.addShape('line', {
    x: 1.58, y: 3.72, w: 8.48, h: 0,
    line: { color: accent, width: 2.4, endArrowType: 'triangle' },
    objectName: 'EditableSitePlan System Axis',
  })
  addPlanText(slide, report, '公共主轴', { x: 5.05, y: 3.3, w: 1.25, h: 0.25 }, {
    size: 11, color: accent, bold: true, align: 'center', name: 'EditableSitePlan System Axis Label',
  })

  const cores = [
    { x: 2.55, y: 3.02, label: '门户核心' },
    { x: 5.35, y: 3.78, label: '文化核心' },
    { x: 9.4, y: 2.92, label: '滨水核心' },
  ] as const
  cores.forEach((core, index) => {
    slide.addShape('ellipse', {
      x: core.x, y: core.y, w: 0.62, h: 0.62,
      fill: { color: index === 1 ? accent : primary, transparency: 8 },
      line: { color: surface, width: 1.4 },
      objectName: `EditableSitePlan System Core ${index + 1}`,
    })
    addPlanText(slide, report, core.label, {
      x: core.x - 0.34, y: index === 1 ? core.y + 0.68 : 3.82, w: 1.3, h: 0.24,
    }, {
      size: 10, color: ink, bold: true, align: 'center', name: `EditableSitePlan System Core Label ${index + 1}`,
    })
  })

  slide.addShape('roundRect', {
    x: 10.54, y: 4.02, w: 1.78, h: 1.16,
    rectRadius: 0.04,
    fill: { color: surface, transparency: 18 },
    line: { color: primary, transparency: 72, width: 0.6 },
    objectName: 'EditableSitePlan System Legend Panel',
  })
  addPlanText(slide, report, '一轴 · 两带 · 三核', { x: 10.67, y: 4.12, w: 1.52, h: 0.2 }, {
    size: 10, color: primary, bold: true, align: 'center', name: 'EditableSitePlan System Legend',
  })
  slide.addShape('line', {
    x: 10.7, y: 4.5, w: 0.32, h: 0,
    line: { color: accent, width: 1.8, endArrowType: 'triangle' },
    objectName: 'EditableSitePlan System Legend Axis Swatch',
  })
  addPlanText(slide, report, '轴线', { x: 11.12, y: 4.39, w: 0.82, h: 0.2 }, {
    size: 9, color: ink, bold: true, name: 'EditableSitePlan System Legend Axis Label',
  })
  slide.addShape('rect', {
    x: 10.7, y: 4.72, w: 0.32, h: 0.14,
    fill: { color: primary, transparency: 58 },
    line: { color: primary, transparency: 100 },
    objectName: 'EditableSitePlan System Legend Band Swatch',
  })
  addPlanText(slide, report, '功能带', { x: 11.12, y: 4.66, w: 0.82, h: 0.2 }, {
    size: 9, color: ink, bold: true, name: 'EditableSitePlan System Legend Band Label',
  })
  slide.addShape('ellipse', {
    x: 10.78, y: 4.96, w: 0.17, h: 0.17,
    fill: { color: primary },
    line: { color: surface, width: 0.6 },
    objectName: 'EditableSitePlan System Legend Core Swatch',
  })
  addPlanText(slide, report, '核心节点', { x: 11.12, y: 4.92, w: 0.92, h: 0.2 }, {
    size: 9, color: ink, bold: true, name: 'EditableSitePlan System Legend Core Label',
  })
}

export function addEditableSitePlan(
  slide: PptxGenJS.Slide,
  report: ClientReport,
  visual: SitePlanVisual,
): void {
  addSitePlanBase(slide, report, visual.kind)
  if (visual.kind === 'spatial-sequence') addMovementOverlay(slide, report, visual)
  else addSystemOverlay(slide, report)
  slide.addShape('rect', {
    x: PLAN.x, y: PLAN.y + PLAN.h, w: PLAN.w, h: 0.36,
    fill: { color: report.theme.tokens.colors.accent, transparency: 91 },
    line: { color: report.theme.tokens.colors.accent, width: 0.7, transparency: 12 },
    objectName: 'EditableSitePlan Disclosure Band',
  })
  addPlanText(slide, report,
    `正式资料前置｜总平图、红线图、带 CRS 的闭合坐标或兼容 GeoJSON，并由人确认。\n研究范围（待核） · 非法定红线 · 非测绘成果｜${visual.disclosure}`,
    { x: PLAN.x + 0.16, y: PLAN.y + PLAN.h + 0.01, w: PLAN.w - 0.32, h: 0.33 },
    { size: 10, color: report.theme.tokens.colors.ink, name: 'EditableSitePlan Disclosure' },
  )
}
