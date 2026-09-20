import { describe, expect, it } from 'vitest'
import type { PlanningManuscriptDiagram } from '../src/report/manuscript/types.ts'
import { photoStageTopReserve, routePhotoStages } from '../src/report/regular/stage-connections.ts'

type Box = { x: number; y: number; w: number; h: number }
type Point = [number, number]
const canvas = { width: 13.333333, height: 7.5 }, top = 3
function graph(cells: [string, number, number][], edges: PlanningManuscriptDiagram['edges']): PlanningManuscriptDiagram {
  return { nodes: cells.map(([id, column, row]) => ({ id, label: id, column, row })), edges }
}
function boxesFor(diagram: PlanningManuscriptDiagram, start = top): Map<string, Box> {
  const columns = [...new Set(diagram.nodes.map(n => n.column))].sort((a, b) => a - b), gap = 0.28
  const w = (canvas.width - (columns.length - 1) * gap) / columns.length
  return new Map(columns.flatMap((column, col) => {
    const nodes = diagram.nodes.filter(n => n.column === column).sort((a, b) => a.row - b.row)
    const h = (canvas.height - start - (nodes.length - 1) * 0.18) / nodes.length
    return nodes.map((n, row) => [n.id, { x: col * (w + gap), y: start + row * (h + 0.18), w, h }] as const)
  }))
}
function points(path: string): Point[] {
  expect(path).toMatch(/^M /)
  return [...path.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/gu)].map(m => [Number(m[1]), Number(m[2])])
}
const overlap = (a: Box, b: Box) => a.x < b.x + b.w - 1e-5 && a.x + a.w > b.x + 1e-5 && a.y < b.y + b.h - 1e-5 && a.y + a.h > b.y + 1e-5
function labelBox(edge: ReturnType<typeof routePhotoStages>[number]): Box {
  const w = Array.from(edge.label ?? '').length * 0.14 + 0.08
  return { x: edge.labelX - w / 2, y: edge.labelY - 0.25, w, h: 0.21 }
}
function check(diagram: PlanningManuscriptDiagram, boxes = boxesFor(diagram), start = top) {
  const routed = routePhotoStages(diagram, boxes, canvas, start), labels: Box[] = []
  expect(routed).toHaveLength(diagram.edges.length)
  for (const [index, edge] of routed.entries()) {
    expect(edge).toMatchObject(diagram.edges[index]!)
    const nodes = points(edge.path)
    expect(nodes.length).toBeGreaterThan(1)
    for (const [x, y] of nodes) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(canvas.width + 1e-5); expect(y).toBeGreaterThanOrEqual(start - photoStageTopReserve(diagram, canvas.width) - 1e-5); expect(y).toBeLessThanOrEqual(canvas.height + 1e-5) }
    const onEdge = ([x, y]: Point, box: Box) => x >= box.x - 1e-5 && x <= box.x + box.w + 1e-5 && y >= box.y - 1e-5 && y <= box.y + box.h + 1e-5
      && [Math.abs(x - box.x), Math.abs(x - box.x - box.w), Math.abs(y - box.y), Math.abs(y - box.y - box.h)].some(d => d < 1e-5)
    expect(onEdge(nodes[0]!, boxes.get(edge.from)!)).toBe(true)
    expect(onEdge(nodes.at(-1)!, boxes.get(edge.to)!)).toBe(true)
    for (let n = 1; n < nodes.length; n++) {
      const [a, b] = [nodes[n - 1]!, nodes[n]!]
      expect(a[0] === b[0] || a[1] === b[1]).toBe(true)
      for (const box of boxes.values()) {
        const crosses = a[0] === b[0] ? a[0] > box.x + 1e-5 && a[0] < box.x + box.w - 1e-5 && Math.max(a[1], b[1]) > box.y + 1e-5 && Math.min(a[1], b[1]) < box.y + box.h - 1e-5
          : a[1] > box.y + 1e-5 && a[1] < box.y + box.h - 1e-5 && Math.max(a[0], b[0]) > box.x + 1e-5 && Math.min(a[0], b[0]) < box.x + box.w - 1e-5
        expect(crosses, `${edge.from}->${edge.to} crosses a photo: ${edge.path}`).toBe(false)
      }
    }
    if (edge.label) {
      const bounds = labelBox(edge)
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.w).toBeLessThanOrEqual(canvas.width)
      expect(bounds.y).toBeGreaterThanOrEqual(start - photoStageTopReserve(diagram, canvas.width) - 1e-5)
      for (const photo of boxes.values()) expect(overlap(bounds, photo), edge.label).toBe(false)
      for (const prior of labels) expect(overlap(bounds, prior), edge.label).toBe(false)
      labels.push(bounds)
    }
  }
  return routed
}

describe('photo stage routing', () => {
  it('routes a skipped-column edge above the intervening full-height photograph', () => {
    const diagram = graph([['a', 0, 0], ['b', 1, 0], ['c', 2, 0]], [{ from: 'a', to: 'c' }])
    const [edge] = check(diagram)
    expect(points(edge!.path).some(([, y]) => y < top)).toBe(true)
  })
  it('separates repeated and reverse relations with distinct ports and paths', () => {
    const diagram = graph([['a', 0, 0], ['b', 1, 0]], [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }, { from: 'b', to: 'a' }])
    const result = check(diagram), shapes = result.map(e => { const p = points(e.path); return JSON.stringify(e.from === 'b' ? p.reverse() : p) })
    expect(new Set(shapes).size).toBe(3)
    expect(new Set(result.slice(0, 2).map(e => JSON.stringify(points(e.path)[0]))).size).toBe(2)
  })
  it('routes self loops outside the photo, including one below another node', () => {
    const diagram = graph([['a', 0, 0], ['b', 0, 1], ['c', 1, 0]], [{ from: 'a', to: 'a' }, { from: 'b', to: 'b' }])
    for (const edge of check(diagram)) expect(points(edge.path).length).toBeGreaterThanOrEqual(4)
  })
  it('makes a longer upper route for a self-loop label that cannot fit the column gap', () => {
    check(graph([['a', 0, 0], ['b', 0, 1], ['c', 1, 0]], [{ from: 'b', to: 'b', label: '条件满足后继续开放' }]))
  })
  it('keeps repeated labels readable and distinct instead of placing them on the photos', () => {
    check(graph([['a', 0, 0], ['b', 1, 0]], Array.from({ length: 3 }, () => ({ from: 'a', to: 'b', label: '服务支持' }))))
  })
  it('routes backward, branching and cross-row relations with staggered columns', () => {
    check(graph([['a', 0, 0], ['b', 0, 2], ['c', 1, 0], ['d', 2, 0], ['e', 2, 1], ['f', 2, 2]], [
      { from: 'a', to: 'e' }, { from: 'b', to: 'd', label: '保留必要通行' }, { from: 'f', to: 'a', label: '条件成立后' }, { from: 'a', to: 'b' }, { from: 'd', to: 'f' },
    ]))
  })
  it('uses the open gap between adjacent single-column photos', () => {
    check(graph([['a', 0, 0], ['b', 0, 1]], [{ from: 'a', to: 'b' }]))
  })
  it('reports enclosed geometry instead of crossing a single-column intermediate photo', () => {
    const diagram = graph([['a', 0, 0], ['b', 0, 1], ['c', 0, 2]], [{ from: 'a', to: 'c' }])
    expect(() => routePhotoStages(diagram, boxesFor(diagram), canvas, top)).toThrow('PHOTO_STAGE_ROUTING_SPACE_REQUIRED')
  })
  it('routes single-column skipped edges and lower self-loops within 0.3in side channels', () => {
    const diagram = graph([['a', 0, 0], ['b', 0, 1], ['c', 0, 2]], [
      { from: 'a', to: 'c', label: '条件成立后进入' }, { from: 'c', to: 'a' }, { from: 'c', to: 'c', label: '继续使用' },
    ])
    const boxes = new Map([...boxesFor(diagram)].map(([id, box]) => [id, { ...box, x: 0.3, w: canvas.width - 0.6 }]))
    const result = check(diagram, boxes)
    for (const edge of result) expect(points(edge.path).some(([x]) => x < 0.3 || x > canvas.width - 0.3)).toBe(true)
  })
  it('reserves more room for dense parallel relations', () => {
    const diagram = graph([['a', 0, 0], ['b', 1, 0]], Array.from({ length: 6 }, (_, n) => ({ from: 'a', to: 'b', label: `条件成立${n}` })))
    expect(photoStageTopReserve(diagram, canvas.width)).toBeGreaterThan(0.45)
    check(diagram)
  })
  it('is deterministic, independent of box insertion order and preserves authored edge order', () => {
    const diagram = graph([['a', 0, 0], ['b', 1, 0], ['c', 2, 0]], [{ from: 'c', to: 'a', label: '返回服务' }, { from: 'a', to: 'b' }]), boxes = boxesFor(diagram)
    expect(routePhotoStages(diagram, new Map([...boxes].reverse()), canvas, top)).toEqual(check(diagram, boxes))
  })
  it('rejects missing endpoints, invalid dimensions and overlapping photographs', () => {
    const diagram = graph([['a', 0, 0], ['b', 1, 0]], [{ from: 'a', to: 'b' }]), boxes = boxesFor(diagram)
    expect(() => routePhotoStages(diagram, new Map([...boxes].slice(0, 1)), canvas, top)).toThrow('PHOTO_STAGE_ROUTING_INVALID_INPUT')
    expect(() => routePhotoStages(diagram, boxes, { width: NaN, height: 7.5 }, top)).toThrow('PHOTO_STAGE_ROUTING_INVALID_INPUT')
    expect(() => routePhotoStages(diagram, new Map([['a', boxes.get('a')!], ['b', boxes.get('a')!]]), canvas, top)).toThrow('PHOTO_STAGE_ROUTING_INVALID_INPUT')
  })
  it('returns no connectors for a diagram with no relations', () => {
    const diagram = graph([['a', 0, 0]], [])
    expect(check(diagram)).toEqual([])
  })
})
