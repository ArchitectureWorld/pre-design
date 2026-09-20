import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PlanningManuscriptDiagram, PlanningManuscriptPage } from '../report/manuscript/types.ts'
import { validatePlanningDiagram } from '../report/manuscript/validation.ts'
import type { FrozenProjectInput } from '../report/types.ts'
import type { PresentationAdoptedAssetInput } from './standard-project-types.ts'

export const MANUSCRIPT_DIAGRAM_SOURCE_PREFIX = 'manuscript-diagram:'
const WIDTH = 1280, HEIGHT = 720, BACKGROUND = '#f5f4ef', CLEARANCE = 24
const escape = (value: string) => value.replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)
const tones = {
  accent: { fill: '#245b50', stroke: '#245b50', text: '#ffffff' },
  neutral: { fill: '#ffffff', stroke: '#c1d1c7', text: '#243f37' },
  muted: { fill: '#e6ece6', stroke: '#d4ded5', text: '#51675b' },
}

type Box = { x: number; y: number; width: number; height: number }
type Point = readonly [number, number]
type Port = { anchor: Point; exit: Point }
type Label = Box & { lines: string[]; size: number; leader?: readonly [Point, Point] }
type Route = { points: Point[]; label?: Label }

const round = (value: number) => Math.round(value * 10) / 10
const characterWidth = (value: string) => /[MW@%&#]/u.test(value) ? 1 : /[\u0020-\u007e]/u.test(value) ? 0.66 : 1
const textWidth = (value: string, size: number) => Array.from(value).reduce((sum, char) => sum + characterWidth(char) * size, 0)
const wordSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })

function wrap(value: string, size: number, width: number): string[] {
  const result: string[] = []
  for (const paragraph of value.split('\n')) {
    const characters = Array.from(paragraph); let offset = 0, remaining = textWidth(paragraph, size)
    const boundaries = new Set([...wordSegmenter.segment(paragraph)].map(item => Array.from(paragraph.slice(0, item.index + item.segment.length)).length))
    let count = 1, probe = 0
    for (const char of characters) {
      const next = characterWidth(char) * size
      if (probe && probe + next > width) { count++; probe = 0 }
      probe += next
    }
    if (!characters.length) result.push('')
    for (let line = 0; offset < characters.length; line++) {
      const target = remaining / Math.max(1, count - line)
      let used = 0, best = Number.POSITIVE_INFINITY, end = offset + 1, selectedWidth = 0
      for (let next = offset; next < characters.length; next++) {
        used += characterWidth(characters[next]!) * size
        if (used > width && next > offset) break
        const score = Math.abs(used - target) + (boundaries.has(next + 1) ? 0 : size * 0.9)
        if (score < best) { best = score; end = next + 1; selectedWidth = used }
      }
      result.push(characters.slice(offset, end).join('')); offset = end; remaining -= selectedWidth
    }
  }
  return result
}
function centeredText(chunks: string[], x: number, y: number, size: number, color: string, weight = 500): string {
  const lineHeight = round(size * 1.22)
  const firstY = y - (chunks.length - 1) * lineHeight / 2
  return `<text x="${x}" y="${round(firstY)}" text-anchor="middle" dominant-baseline="central" font-size="${size}" font-weight="${weight}" fill="${color}">${chunks.map((chunk, i) => `<tspan x="${x}" dy="${i ? lineHeight : 0}">${escape(chunk)}</tspan>`).join('')}</text>`
}

function nodeTypography(value: string, box: Box): { size: number; lines: string[] } {
  const fits: { size: number; lines: string[] }[] = []
  for (let size = 34; size >= 22; size--) {
    const lines = wrap(value, size, box.width - 40)
    if (size + (lines.length - 1) * round(size * 1.22) <= box.height - 24) fits.push({ size, lines })
  }
  const large = fits.filter(option => option.size >= 30)
  if (large.length) return large.sort((a, b) => a.lines.length - b.lines.length)[0]!
  return fits[0] ?? { size: 22, lines: wrap(value, 22, box.width - 32) }
}

/** Authored coordinates retain their ordering; unused rows/columns do not consume the canvas. */
function layoutNodes(graph: PlanningManuscriptDiagram): { boxes: Map<string, Box>; xs: number[]; ys: number[] } {
  const columns = [...new Set(graph.nodes.map(node => node.column))].sort((a, b) => a - b)
  const rows = [...new Set(graph.nodes.map(node => node.row))].sort((a, b) => a - b)
  const width = [440, 352, 292, 232][columns.length - 1]!, horizontalGap = [0, 176, 120, 84][columns.length - 1]!
  const height = [160, 144, 128][rows.length - 1]!, verticalGap = [0, 132, 92][rows.length - 1]!
  const left = (WIDTH - columns.length * width - (columns.length - 1) * horizontalGap) / 2
  const top = (HEIGHT - rows.length * height - (rows.length - 1) * verticalGap) / 2
  const boxes = new Map(graph.nodes.map(node => [node.id, { x: left + columns.indexOf(node.column) * (width + horizontalGap),
    y: top + rows.indexOf(node.row) * (height + verticalGap), width, height }]))
  const xs = [24, ...columns.slice(1).map((_, index) => left + width + horizontalGap / 2 + index * (width + horizontalGap)), WIDTH - 24]
  const ys = [36, ...rows.slice(1).map((_, index) => top + height + verticalGap / 2 + index * (height + verticalGap)), HEIGHT - 36]
  return { boxes, xs, ys }
}

function ports(graph: PlanningManuscriptDiagram, boxes: Map<string, Box>, nodeId: string, role: 'from' | 'to', edgeIndex: number): Port[] {
  const box = boxes.get(nodeId)!, otherRole = role === 'from' ? 'to' : 'from'
  const incident = graph.edges.map((edge, index) => ({ edge, index, other: boxes.get(edge[otherRole])! })).filter(item => item.edge[role] === nodeId)
  const side = (other: Box) => other.x !== box.x ? (other.x > box.x ? 0 : 1) : (other.y >= box.y ? 2 : 3)
  return [0, 1, 2, 3].map(direction => {
    const sameSide = incident.filter(item => side(item.other) === direction)
      .sort((a, b) => (direction < 2 ? a.other.y - b.other.y : a.other.x - b.other.x) || a.index - b.index)
    const position = sameSide.findIndex(item => item.index === edgeIndex)
    const offset = sameSide.length > 1 && position >= 0 ? (position / (sameSide.length - 1) - 0.5) * Math.min(52, box.height - 60) : 0
    const x = round(box.x + box.width / 2 + offset), y = round(box.y + box.height / 2 + offset)
    const options: Port[] = [
      { anchor: [box.x + box.width, y], exit: [box.x + box.width + CLEARANCE, y] },
      { anchor: [box.x, y], exit: [box.x - CLEARANCE, y] },
      { anchor: [x, box.y + box.height], exit: [x, box.y + box.height + CLEARANCE] },
      { anchor: [x, box.y], exit: [x, box.y - CLEARANCE] },
    ]
    return options[direction]!
  })
}
function simplify(points: readonly Point[]): Point[] {
  const result: Point[] = []
  for (const point of points) {
    const last = result.at(-1)
    if (last?.[0] === point[0] && last[1] === point[1]) continue
    const before = result.at(-2)
    if (before && last && ((before[0] === last[0] && last[0] === point[0] && (last[1] - before[1]) * (point[1] - last[1]) >= 0)
      || (before[1] === last[1] && last[1] === point[1] && (last[0] - before[0]) * (point[0] - last[0]) >= 0))) result.pop()
    result.push(point)
  }
  return result
}
function segments(points: readonly Point[]): (readonly [Point, Point])[] { return points.slice(1).map((point, index) => [points[index]!, point] as const) }
const distance = (a: Point, b: Point) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])
const inflate = (box: Box, pad: number): Box => ({ x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 })
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
function crossesBox(a: Point, b: Point, box: Box): boolean {
  return a[0] === b[0]
    ? a[0] > box.x && a[0] < box.x + box.width && Math.max(a[1], b[1]) > box.y && Math.min(a[1], b[1]) < box.y + box.height
    : a[1] > box.y && a[1] < box.y + box.height && Math.max(a[0], b[0]) > box.x && Math.min(a[0], b[0]) < box.x + box.width
}

function candidates(from: Port[], to: Port[], layout: ReturnType<typeof layoutNodes>, self: boolean): Point[][] {
  const result: Point[][] = [], seen = new Set<string>(), obstacles = [...layout.boxes.values()].map(box => inflate(box, 12))
  for (const start of from) for (const end of to) {
    if (self && start.anchor[0] === end.anchor[0] && start.anchor[1] === end.anchor[1]) continue
    const s = start.exit, t = end.exit
    const alternatives: Point[][] = [
      [s, [t[0], s[1]], t], [s, [s[0], t[1]], t],
      ...layout.xs.map(x => [s, [x, s[1]], [x, t[1]], t] as Point[]),
      ...layout.ys.map(y => [s, [s[0], y], [t[0], y], t] as Point[]),
    ]
    for (const main of alternatives) {
      if (main.some(([x, y]) => x < 16 || x > WIDTH - 16 || y < 16 || y > HEIGHT - 16)) continue
      if (segments(main).some(([a, b]) => obstacles.some(box => crossesBox(a, b, box)))) continue
      const points = simplify([start.anchor, ...main, end.anchor]), key = JSON.stringify(points)
      if (points.length < 2 || seen.has(key)) continue
      seen.add(key); result.push(points)
    }
  }
  return result
}

function placeLabel(value: string, points: Point[], occupied: Box[], detached = false): Label | undefined {
  const size = 22, lines = wrap(value, size, 220)
  const width = round(Math.max(...lines.map(line => textWidth(line, size))) + 24), height = round(lines.length * size * 1.22 + 16)
  const clear = (box: Box) => box.x >= 6 && box.x + box.width <= WIDTH - 6 && box.y >= 6 && box.y + box.height <= HEIGHT - 6
    && !occupied.some(other => overlaps(box, inflate(other, 8)))
  const ordered = segments(points).sort((a, b) => distance(...b) - distance(...a))
  for (const [a, b] of ordered) {
    const horizontal = a[1] === b[1], length = distance(a, b)
    if (!detached && length < (horizontal ? width : height) + 20) continue
    for (const part of [0.5, 0.35, 0.65]) {
      const center: Point = [round(a[0] + (b[0] - a[0]) * part), round(a[1] + (b[1] - a[1]) * part)]
      for (const shift of detached ? [-1, 1] : [0]) {
        const x = center[0] + (horizontal ? 0 : shift * (width / 2 + 18))
        const y = center[1] + (horizontal ? shift * (height / 2 + 18) : 0)
        const box = { x: round(x - width / 2), y: round(y - height / 2), width, height }
        if (clear(box)) return { ...box, lines, size, ...(detached ? { leader: [center, [x, y]] as const } : {}) }
      }
    }
  }
  return undefined
}

function routeGraph(graph: PlanningManuscriptDiagram, layout: ReturnType<typeof layoutNodes>): Route[] {
  const routes: Route[] = [], labels: Label[] = [], used: (readonly [Point, Point])[] = []
  const nodes = [...layout.boxes.values()]
  // Longer labels reserve their space first. Original edge order and identity are retained in the SVG.
  const order = graph.edges.map((edge, index) => ({ edge, index })).sort((a, b) => (b.edge.label?.length ?? 0) - (a.edge.label?.length ?? 0))
  for (const { edge, index } of order) {
    const from = ports(graph, layout.boxes, edge.from, 'from', index)
    const to = ports(graph, layout.boxes, edge.to, 'to', index)
    let chosen: Route | undefined, best = Number.POSITIVE_INFINITY
    for (const points of candidates(from, to, layout, edge.from === edge.to)) {
      const label = edge.label === undefined ? undefined : (placeLabel(edge.label, points, [...nodes, ...labels])
        ?? placeLabel(edge.label, points, [...nodes, ...labels], true))
      if (edge.label !== undefined && !label) continue
      const parts = segments(points)
      let score = parts.reduce((sum, [a, b]) => sum + distance(a, b), 0) + (parts.length - 1) * 28 + (label?.leader ? 300 : 0)
      for (const [a, b] of parts) {
        score += labels.filter(box => crossesBox(a, b, inflate(box, 5))).length * 1000
        for (const [c, d] of used) {
          if (a[0] === b[0] && c[0] === d[0] && a[0] === c[0]) score += Math.max(0, Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) - Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1]))) * 2
          else if (a[1] === b[1] && c[1] === d[1] && a[1] === c[1]) score += Math.max(0, Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) - Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0]))) * 2
          else if (Math.min(a[0], b[0]) <= Math.max(c[0], d[0]) && Math.max(a[0], b[0]) >= Math.min(c[0], d[0])
            && Math.min(a[1], b[1]) <= Math.max(c[1], d[1]) && Math.max(a[1], b[1]) >= Math.min(c[1], d[1])) score += 70
        }
      }
      if (score < best) { chosen = { points, ...(label ? { label } : {}) }; best = score }
    }
    if (!chosen) throw new Error(`MANUSCRIPT_DIAGRAM_LAYOUT: cannot place relation ${index + 1} without covering diagram content`)
    routes[index] = chosen; used.push(...segments(chosen.points)); if (chosen.label) labels.push(chosen.label)
  }
  return routes
}

/** Crop only unused canvas; retain enough space for strokes, arrowheads and label leaders. */
function diagramViewport(boxes: Map<string, Box>, routes: Route[]): Box {
  const points: Point[] = []
  const includeBox = (box: Box) => { points.push([box.x, box.y], [box.x + box.width, box.y + box.height]) }
  for (const box of boxes.values()) includeBox(box)
  for (const route of routes) {
    points.push(...route.points)
    if (route.label) {
      includeBox(route.label)
      if (route.label.leader) points.push(...route.label.leader)
    }
  }
  const padding = 16
  const x = Math.floor(Math.min(...points.map(point => point[0]))) - padding
  const y = Math.floor(Math.min(...points.map(point => point[1]))) - padding
  return { x, y, width: Math.ceil(Math.max(...points.map(point => point[0]))) - x + padding,
    height: Math.ceil(Math.max(...points.map(point => point[1]))) - y + padding }
}

function createManuscriptDiagram(page: PlanningManuscriptPage): { svg: string; width: number; height: number } {
  if (page.visual.kind !== 'diagram' || page.visual.diagram === undefined) throw new Error('MANUSCRIPT_DIAGRAM: an authored graph is required')
  const graph = validatePlanningDiagram(page.visual.diagram, `${page.id}.visual.diagram`)
  const layout = layoutNodes(graph), routes = routeGraph(graph, layout), viewport = diagramViewport(layout.boxes, routes)
  const markerId = `arrow-${createHash('sha256').update(page.id).digest('hex').slice(0, 12)}`
  const edgeLabels: string[] = []
  const edges = graph.edges.map((edge, index) => {
    const route = routes[index]!, label = route.label
    if (label) {
      const leader = label.leader ? `<path d="M ${label.leader[0].join(' ')} L ${label.leader[1].join(' ')}" fill="none" stroke="#a2b3a7" stroke-width="1.5"/>` : ''
      edgeLabels.push(`<g data-edge-label="${index}">${leader}<rect x="${label.x}" y="${label.y}" width="${label.width}" height="${label.height}" rx="8" fill="${BACKGROUND}"/>${centeredText(label.lines, label.x + label.width / 2, label.y + label.height / 2, label.size, '#496957')}</g>`)
    }
    return `<path data-edge-index="${index}" data-edge-from="${escape(edge.from)}" data-edge-to="${escape(edge.to)}" d="${route.points.map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' ')}" fill="none" stroke="#799485" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#${markerId})"/>`
  }).join('')
  const nodes = graph.nodes.map(node => {
    const box = layout.boxes.get(node.id)!, tone = tones[node.tone ?? 'neutral'], typography = nodeTypography(node.label, box)
    return `<g data-node-id="${escape(node.id)}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="14" fill="${tone.fill}" stroke="${tone.stroke}" stroke-width="2"/>${centeredText(typography.lines, box.x + box.width / 2, box.y + box.height / 2, typography.size, tone.text, node.tone === 'accent' ? 600 : 500)}</g>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${viewport.width}" height="${viewport.height}" viewBox="${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}" role="img"><title>${escape(page.visual.subject)}</title><defs><marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="12" markerHeight="12" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#799485"/></marker></defs><rect x="${viewport.x}" y="${viewport.y}" width="${viewport.width}" height="${viewport.height}" fill="${BACKGROUND}"/><g font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif">${edges}${nodes}${edgeLabels.join('')}</g></svg>`
  return { svg, width: viewport.width, height: viewport.height }
}

export function renderManuscriptDiagram(page: PlanningManuscriptPage): string { return createManuscriptDiagram(page).svg }

export async function prepareManuscriptDiagrams(input: { frozenProject: FrozenProjectInput; workspaceRoot: string }): Promise<PresentationAdoptedAssetInput[]> {
  const assets: PresentationAdoptedAssetInput[] = []
  for (const chapter of input.frozenProject.manuscript?.chapters ?? []) for (const page of chapter.pages) {
    if (page.visual.kind !== 'diagram' || page.visual.diagram === undefined) continue
    const { svg, width, height } = createManuscriptDiagram(page), sha256 = createHash('sha256').update(svg).digest('hex')
    const root = join(input.workspaceRoot, '.pre-design', 'manuscript-diagrams'), fileName = `${sha256}.svg`
    await mkdir(root, { recursive: true })
    const sourcePath = join(root, fileName)
    await writeFile(sourcePath, svg, 'utf8')
    assets.push({ sourceKey: `${MANUSCRIPT_DIAGRAM_SOURCE_PREFIX}${page.id}`, sourcePath, originalFileName: fileName,
      displayName: page.visual.subject, mimeType: 'image/svg+xml', semanticRole: 'deterministic_visual', widthPx: width, heightPx: height,
      createdAt: input.frozenProject.generatedAt, adoptedAt: input.frozenProject.generatedAt, objectIds: [], evidenceIds: [], role: 'primary',
      pageBindingOnly: true, pageBindings: [{ findingId: `manuscript:${page.id}`, role: 'primary' }],
      origin: { type: 'generated_by_tool', sourceMaterialKeys: [], parentAssetKeys: [], sourceTool: { name: 'pre-design-manuscript-diagram', version: '3' },
        method: JSON.stringify({ pageId: page.id, sourceRefs: page.sourceRefs, sourceRevision: input.frozenProject.revision, sha256,
          originalCaption: page.visual.caption, disclosure: '仅表达已编写的节点和连线；非地理示意' }) },
    })
  }
  return assets
}
