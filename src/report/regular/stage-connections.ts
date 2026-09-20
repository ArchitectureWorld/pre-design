import type { PlanningManuscriptDiagram } from '../manuscript/types.ts'

export interface PhotoStageBox { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface PhotoStageConnection { readonly from: string; readonly to: string; readonly path: string; readonly label?: string; readonly labelX: number; readonly labelY: number }
type Point = readonly [number, number]
type Segment = readonly [Point, Point]
type Port = { anchor: Point; exit: Point }

/** An authored unlabelled chain states sequence; a labelled spatial relation does not. */
export function photoStagePresentation(graph: PlanningManuscriptDiagram) {
  const seen = new Set<string>()
  const edges = graph.edges.filter(edge => {
    const key = JSON.stringify([edge.from, edge.to, edge.label ?? ''])
    if (seen.has(key)) return false
    seen.add(key); return true
  })
  const ids = new Set(graph.nodes.map(node => node.id))
  const outgoing = new Map<string, string[]>(), incoming = new Map<string, string[]>()
  for (const edge of edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to])
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from])
  }
  const first = graph.nodes.filter(node => !incoming.has(node.id))
  const sequenceLabels = /^(?:下一步|随后|然后|依次|进入下一阶段|next|then)$/iu
  if (graph.nodes.length > 1 && edges.length === graph.nodes.length - 1 && first.length === 1
    && edges.every(edge => ids.has(edge.from) && ids.has(edge.to) && (!edge.label || sequenceLabels.test(edge.label.trim())))
    && [...outgoing.values(), ...incoming.values()].every(nodes => nodes.length <= 1)) {
    const ordered: string[] = [], visited = new Set<string>()
    let current: string | undefined = first[0]!.id
    while (current && !visited.has(current)) { ordered.push(current); visited.add(current); current = outgoing.get(current)?.[0] }
    if (ordered.length === graph.nodes.length) return { kind: 'sequence' as const, nodeIds: ordered, edges: [] }
  }
  return { kind: edges.length ? 'network' as const : 'parallel' as const,
    nodeIds: [...graph.nodes].sort((a, b) => a.column - b.column || a.row - b.row).map(node => node.id), edges }
}
const EPS = 1e-6, CLEAR = 0.045, LABEL_TOP = 0.25, LABEL_HEIGHT = 0.21
const round = (n: number) => Math.round(n * 1e6) / 1e6
const equal = (a: number, b: number) => Math.abs(a - b) < EPS
const distance = (a: Point, b: Point) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])
const segments = (points: readonly Point[]): Segment[] => points.slice(1).map((p, i) => [points[i]!, p])
const inflate = (b: PhotoStageBox, p: number): PhotoStageBox => ({ x: b.x - p, y: b.y - p, w: b.w + p * 2, h: b.h + p * 2 })
const overlaps = (a: PhotoStageBox, b: PhotoStageBox) => a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS
const textWidth = (value: string) => Array.from(value).reduce((n, c) => n + (/[ -~]/u.test(c) && !/[MW@%&#]/u.test(c) ? 0.085 : 0.14), 0) + 0.10
function crosses(a: Point, b: Point, box: PhotoStageBox): boolean {
  return equal(a[0], b[0])
    ? a[0] > box.x + EPS && a[0] < box.x + box.w - EPS && Math.max(a[1], b[1]) > box.y + EPS && Math.min(a[1], b[1]) < box.y + box.h - EPS
    : a[1] > box.y + EPS && a[1] < box.y + box.h - EPS && Math.max(a[0], b[0]) > box.x + EPS && Math.min(a[0], b[0]) < box.x + box.w - EPS
}
function simplify(points: readonly Point[]): Point[] {
  const result: Point[] = []
  for (const input of points) {
    const p: Point = [round(input[0]), round(input[1])], last = result.at(-1), before = result.at(-2)
    if (last && distance(last, p) < EPS) continue
    if (before && last && ((equal(before[0], last[0]) && equal(last[0], p[0]) && (last[1] - before[1]) * (p[1] - last[1]) >= 0)
      || (equal(before[1], last[1]) && equal(last[1], p[1]) && (last[0] - before[0]) * (p[0] - last[0]) >= 0))) result.pop()
    result.push(p)
  }
  return result
}

/** Photos start at `top`; callers reserve this much clear space immediately above them. */
export function photoStageTopReserve(graph: PlanningManuscriptDiagram, canvasWidth: number): number {
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) throw new Error('PHOTO_STAGE_ROUTING_INVALID_INPUT: canvas width')
  const pairs = new Map<string, number>()
  for (const edge of graph.edges) { const key = JSON.stringify([edge.from, edge.to].sort()); pairs.set(key, (pairs.get(key) ?? 0) + 1) }
  const labelRows = Math.ceil(graph.edges.reduce((sum, edge) => sum + (edge.label ? textWidth(edge.label) + 0.18 : 0), 0) / Math.max(0.1, canvasWidth - 0.3))
  return round(Math.ceil(Math.max(0.45, 0.20 + labelRows * 0.24, 0.20 + Math.max(0, ...pairs.values()) * 0.065) / 0.05) * 0.05)
}

function ports(graph: PlanningManuscriptDiagram, boxes: ReadonlyMap<string, PhotoStageBox>, nodeId: string, role: 'from' | 'to', edgeIndex: number,
  canvas: { width: number; height: number }, bandTop: number): Port[] {
  const box = boxes.get(nodeId)!, incidents = graph.edges.flatMap((e, index) => [e.from === nodeId ? `${index}:from` : '', e.to === nodeId ? `${index}:to` : '']).filter(Boolean)
  const rank = incidents.indexOf(`${edgeIndex}:${role}`), fraction = incidents.length > 1 ? rank / (incidents.length - 1) : 0.5
  const x = box.x + box.w * (0.3 + fraction * 0.4), y = box.y + box.h * (0.3 + fraction * 0.4)
  const specifications: { anchor: Point; dx: number; dy: number; room: number }[] = [
    { anchor: [box.x + box.w, y], dx: 1, dy: 0, room: canvas.width - box.x - box.w },
    { anchor: [box.x, y], dx: -1, dy: 0, room: box.x },
    { anchor: [x, box.y], dx: 0, dy: -1, room: box.y - bandTop },
    { anchor: [x, box.y + box.h], dx: 0, dy: 1, room: canvas.height - box.y - box.h },
  ]
  return specifications.flatMap(spec => {
    let room = spec.room
    for (const [id, other] of boxes) {
      if (id === nodeId) continue
      if (spec.dx && y > other.y - EPS && y < other.y + other.h + EPS) {
        const d = spec.dx > 0 ? other.x - spec.anchor[0] : spec.anchor[0] - other.x - other.w
        if (d >= -EPS) room = Math.min(room, d)
      }
      if (spec.dy && x > other.x - EPS && x < other.x + other.w + EPS) {
        const d = spec.dy > 0 ? other.y - spec.anchor[1] : spec.anchor[1] - other.y - other.h
        if (d >= -EPS) room = Math.min(room, d)
      }
    }
    if (room < CLEAR * 2 + 0.015) return []
    const delta = Math.min(0.14, room / 2) + (fraction - 0.5) * Math.min(0.1, Math.max(0, room - 0.12))
    return [{ anchor: spec.anchor, exit: [spec.anchor[0] + spec.dx * delta, spec.anchor[1] + spec.dy * delta] as Point }]
  })
}

function linePenalty(parts: readonly Segment[], used: readonly Segment[]): number {
  let cost = 0
  for (const [a, b] of parts) for (const [c, d] of used) {
    if (equal(a[0], b[0]) && equal(c[0], d[0]) && equal(a[0], c[0])) cost += Math.max(0, Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) - Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1]))) * 24
    else if (equal(a[1], b[1]) && equal(c[1], d[1]) && equal(a[1], c[1])) cost += Math.max(0, Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) - Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0]))) * 24
    else if (Math.min(a[0], b[0]) < Math.max(c[0], d[0]) + EPS && Math.max(a[0], b[0]) > Math.min(c[0], d[0]) - EPS
      && Math.min(a[1], b[1]) < Math.max(c[1], d[1]) + EPS && Math.max(a[1], b[1]) > Math.min(c[1], d[1]) - EPS) cost += 0.4
  }
  return cost
}

/** Orthogonal routing keeps photographs, readable labels and previously placed labels clear. */
export function routePhotoStages(graph: PlanningManuscriptDiagram, boxes: ReadonlyMap<string, PhotoStageBox>, canvas: { readonly width: number; readonly height: number }, top: number): readonly PhotoStageConnection[] {
  const invalid = (reason: string): never => { throw new Error(`PHOTO_STAGE_ROUTING_INVALID_INPUT: ${reason}`) }
  if (![canvas.width, canvas.height, top].every(Number.isFinite) || canvas.width <= 0 || canvas.height <= 0 || top < 0 || top >= canvas.height) invalid('canvas or top')
  const reserve = photoStageTopReserve(graph, canvas.width), bandTop = top - reserve
  if (bandTop < 0) throw new Error(`PHOTO_STAGE_ROUTING_SPACE_REQUIRED: reserve ${reserve}in above the photos`)
  const photos = [...boxes.values()].sort((a, b) => a.x - b.x || a.y - b.y), obstacles = photos.map(b => inflate(b, CLEAR))
  for (const node of graph.nodes) if (!boxes.has(node.id)) invalid(`missing photo: ${node.id}`)
  for (const edge of graph.edges) if (!boxes.has(edge.from) || !boxes.has(edge.to)) invalid(`missing edge endpoint: ${edge.from}->${edge.to}`)
  for (const [index, b] of photos.entries()) {
    if (![b.x, b.y, b.w, b.h].every(Number.isFinite) || b.w <= 0 || b.h <= 0 || b.x < -EPS || b.y < top - EPS || b.x + b.w > canvas.width + EPS || b.y + b.h > canvas.height + EPS) invalid('photo bounds')
    if (photos.slice(index + 1).some(other => overlaps(b, other))) invalid('overlapping photos')
  }
  const unique = (values: number[]) => [...new Set(values.map(round))].sort((a, b) => a - b)
  const bounds = (p: Point) => p[0] >= CLEAR && p[0] <= canvas.width - CLEAR && p[1] >= bandTop + CLEAR && p[1] <= canvas.height - CLEAR
  const clear = (points: readonly Point[]) => points.every(bounds) && !segments(points).some(([a, b]) => obstacles.some(box => crosses(a, b, box)))
  const xEdges = unique([0, canvas.width, ...photos.flatMap(b => [b.x, b.x + b.w])])
  const xs = unique(xEdges.slice(1).map((x, i) => (x + xEdges[i]!) / 2))
  const ys = unique(photos.flatMap(b => [b.y - 0.09, b.y + b.h + 0.09]))
  const topYs: number[] = []
  for (let y = top - 0.065; y >= bandTop + LABEL_TOP + 0.025 - EPS; y -= 0.065) topYs.push(round(y))
  const routes: PhotoStageConnection[] = [], labels: PhotoStageBox[] = [], used: Segment[] = []
  const labelAt = (value: string, path: readonly Point[]) => {
    const width = textWidth(value)
    for (const [a, b] of segments(path).sort((left, right) => distance(...right) - distance(...left))) {
      if (!equal(a[1], b[1]) || Math.abs(a[0] - b[0]) < width + 0.06) continue
      const left = Math.min(a[0], b[0]), right = Math.max(a[0], b[0]), y = a[1]
      const positions = unique([(left + right) / 2, left + width / 2 + 0.03, right - width / 2 - 0.03,
        ...labels.flatMap(label => [label.x - width / 2 - 0.08, label.x + label.w + width / 2 + 0.08])])
        .sort((a, b) => Math.abs(a - (left + right) / 2) - Math.abs(b - (left + right) / 2))
      for (const x of positions) {
        if (x - width / 2 < left || x + width / 2 > right) continue
        const box = { x: x - width / 2, y: y - LABEL_TOP, w: width, h: LABEL_HEIGHT }
        if (box.x < CLEAR || box.x + box.w > canvas.width - CLEAR || box.y < bandTop + 0.01 || box.y + box.h > canvas.height - CLEAR) continue
        if (photos.some(photo => overlaps(box, inflate(photo, 0.025))) || labels.some(label => overlaps(box, inflate(label, 0.035)))) continue
        if (used.some(([a, b]) => crosses(a, b, inflate(box, 0.025)))) continue
        return { box, x: round(x), y: round(y) }
      }
    }
    return undefined
  }
  const order = graph.edges.map((edge, index) => ({ edge, index })).sort((a, b) => (b.edge.label ? textWidth(b.edge.label) : 0) - (a.edge.label ? textWidth(a.edge.label) : 0) || a.index - b.index)
  for (const { edge, index } of order) {
    const from = ports(graph, boxes, edge.from, 'from', index, canvas, bandTop), to = ports(graph, boxes, edge.to, 'to', index, canvas, bandTop)
    let best: { points: Point[]; label?: ReturnType<typeof labelAt>; score: number } | undefined
    const seen = new Set<string>()
    const consider = (start: Port, end: Port, middle: Point[]) => {
      if (!clear(middle)) return
      const path = simplify([start.anchor, ...middle, end.anchor]), key = JSON.stringify(path)
      if (path.length < 2 || seen.has(key)) return
      seen.add(key)
      const parts = segments(path)
      if (parts.some(([a, b]) => photos.some(box => crosses(a, b, box)) || labels.some(box => crosses(a, b, inflate(box, 0.025))))) return
      const label = edge.label ? labelAt(edge.label, path) : undefined
      if (edge.label && !label) return
      const score = parts.reduce((sum, pair) => sum + distance(...pair), 0) + Math.max(0, parts.length - 1) * 0.12 + linePenalty(parts, used)
      if (!best || score < best.score - EPS) best = { points: path, label, score }
    }
    for (const start of from) for (const end of to) {
      if (edge.from === edge.to && distance(start.anchor, end.anchor) < 0.04) continue
      const s = start.exit, t = end.exit
      consider(start, end, [s, [t[0], s[1]], t]); consider(start, end, [s, [s[0], t[1]], t])
      for (const x of xs) consider(start, end, [s, [x, s[1]], [x, t[1]], t])
      for (const y of [...ys, ...topYs]) consider(start, end, [s, [s[0], y], [t[0], y], t])
      const startXs = unique([s[0], ...xs]).filter(x => clear([s, [x, s[1]]]))
      const endXs = unique([t[0], ...xs]).filter(x => clear([[x, t[1]], t]))
      for (const x1 of startXs) for (const x2 of endXs) for (const y of topYs) consider(start, end, [s, [x1, s[1]], [x1, y], [x2, y], [x2, t[1]], t])
    }
    // A self-loop or narrow pair may need a deliberate wide turn above the photos for its label.
    if (!best && edge.label) for (const start of from) for (const end of to) {
      const s = start.exit, t = end.exit
      const startXs = unique([s[0], ...xs]).filter(x => clear([s, [x, s[1]]]))
      const endXs = unique([t[0], ...xs]).filter(x => clear([[x, t[1]], t]))
      for (const x1 of startXs) for (const x2 of endXs) for (const y1 of topYs) for (const y2 of topYs) {
        if (Math.abs(y1 - y2) < 0.06) continue
        for (const far of [CLEAR + 0.05, canvas.width / 2, canvas.width - CLEAR - 0.05]) {
          consider(start, end, [s, [x1, s[1]], [x1, y1], [far, y1], [far, y2], [x2, y2], [x2, t[1]], t])
        }
      }
    }
    if (!best) throw new Error(`PHOTO_STAGE_ROUTING_SPACE_REQUIRED: relation ${index + 1} (${edge.from}->${edge.to}); increase the upper reserve or provide side channels`)
    const chosen = best as { points: Point[]; label?: ReturnType<typeof labelAt>; score: number }
    used.push(...segments(chosen.points)); if (chosen.label) labels.push(chosen.label.box)
    const middle = chosen.points[Math.floor(chosen.points.length / 2)]!
    routes[index] = { ...edge, path: chosen.points.map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' '), labelX: chosen.label?.x ?? middle[0], labelY: chosen.label?.y ?? middle[1] }
  }
  return routes
}
