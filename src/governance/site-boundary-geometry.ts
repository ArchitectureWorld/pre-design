import { createHash } from 'node:crypto'

export interface NormalizedSiteBoundaryGeometry {
  readonly source: 'closed_coordinates' | 'geojson'
  readonly crs: string
  readonly coordinates: readonly (readonly [number, number])[]
  readonly sha256: string
}

type Point = readonly [number, number]

const MAX_OPEN_VERTICES = 5000
const GEOGRAPHIC_CRS = new Set(['EPSG:4326', 'EPSG:4490'])

function fail(code: string): never {
  throw new Error(code)
}

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value
}

function samePoint(left: Point, right: Point): boolean {
  return left[0] === right[0] && left[1] === right[1]
}

function parseCrs(crs: string): string {
  if (!/^EPSG:[1-9]\d*$/u.test(crs)) fail('SITE_BOUNDARY_CRS_INVALID')
  return crs
}

function parsePayload(payload: unknown): { readonly source: NormalizedSiteBoundaryGeometry['source']; readonly ring: unknown } {
  if (Array.isArray(payload)) return { source: 'closed_coordinates', ring: payload }
  if (payload === null || typeof payload !== 'object') fail('SITE_BOUNDARY_GEOMETRY_INVALID')

  const geometry = payload as { readonly type?: unknown; readonly coordinates?: unknown }
  if (geometry.type !== 'Polygon') fail('SITE_BOUNDARY_GEOMETRY_GEOJSON_UNSUPPORTED')
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length !== 1) fail('SITE_BOUNDARY_GEOMETRY_GEOJSON_UNSUPPORTED')
  return { source: 'geojson', ring: geometry.coordinates[0] }
}

function parseClosedRing(ring: unknown): Point[] {
  if (!Array.isArray(ring) || ring.length < 2) fail('SITE_BOUNDARY_GEOMETRY_INVALID')
  const points = ring.map((candidate): Point => {
    if (!Array.isArray(candidate) || candidate.length !== 2 || typeof candidate[0] !== 'number' || typeof candidate[1] !== 'number') {
      fail('SITE_BOUNDARY_GEOMETRY_INVALID')
    }
    if (!Number.isFinite(candidate[0]) || !Number.isFinite(candidate[1])) fail('SITE_BOUNDARY_GEOMETRY_NON_FINITE')
    return [normalizeZero(candidate[0]), normalizeZero(candidate[1])]
  })
  if (!samePoint(points[0]!, points.at(-1)!)) fail('SITE_BOUNDARY_GEOMETRY_UNCLOSED')
  return points
}

function removeConsecutiveDuplicates(closed: readonly Point[]): Point[] {
  const deduplicated: Point[] = []
  for (const point of closed) {
    if (deduplicated.length === 0 || !samePoint(deduplicated.at(-1)!, point)) deduplicated.push(point)
  }
  if (deduplicated.length < 2 || !samePoint(deduplicated[0]!, deduplicated.at(-1)!)) fail('SITE_BOUNDARY_GEOMETRY_UNCLOSED')
  return deduplicated.slice(0, -1)
}

function validateOpenRing(crs: string, points: readonly Point[]): void {
  if (points.length > MAX_OPEN_VERTICES) fail('SITE_BOUNDARY_GEOMETRY_TOO_MANY_VERTICES')
  if (new Set(points.map(point => `${point[0]},${point[1]}`)).size < 3) fail('SITE_BOUNDARY_GEOMETRY_TOO_FEW_DISTINCT_POINTS')
  if (GEOGRAPHIC_CRS.has(crs) && points.some(([longitude, latitude]) => longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90)) {
    fail('SITE_BOUNDARY_GEOMETRY_COORDINATE_RANGE')
  }
}

function signedDoubleArea(points: readonly Point[]): number {
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]!
    return sum + point[0] * next[1] - next[0] * point[1]
  }, 0)
  if (!Number.isFinite(area)) fail('SITE_BOUNDARY_GEOMETRY_NUMERIC')
  return area
}

function orientation(a: Point, b: Point, c: Point): number {
  const value = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  if (!Number.isFinite(value)) fail('SITE_BOUNDARY_GEOMETRY_NUMERIC')
  return value
}

function isBetween(value: number, start: number, end: number): boolean {
  return value >= Math.min(start, end) && value <= Math.max(start, end)
}

function isOnSegment(a: Point, b: Point, point: Point): boolean {
  return orientation(a, b, point) === 0
    && isBetween(point[0], a[0], b[0])
    && isBetween(point[1], a[1], b[1])
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = orientation(a, b, c)
  const abD = orientation(a, b, d)
  const cdA = orientation(c, d, a)
  const cdB = orientation(c, d, b)
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true
  return isOnSegment(a, b, c) || isOnSegment(a, b, d) || isOnSegment(c, d, a) || isOnSegment(c, d, b)
}

function areAdjacentEdges(first: number, second: number, count: number): boolean {
  return first === second || (first + 1) % count === second || (second + 1) % count === first
}

function rejectSelfIntersections(points: readonly Point[]): void {
  for (let first = 0; first < points.length; first += 1) {
    const firstEnd = (first + 1) % points.length
    for (let second = first + 1; second < points.length; second += 1) {
      if (areAdjacentEdges(first, second, points.length)) continue
      const secondEnd = (second + 1) % points.length
      if (segmentsIntersect(points[first]!, points[firstEnd]!, points[second]!, points[secondEnd]!)) fail('SITE_BOUNDARY_GEOMETRY_SELF_INTERSECTION')
    }
  }
}

function localWorkingCoordinates(points: readonly Point[]): Point[] | undefined {
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const minimumX = Math.min(...xs)
  const maximumX = Math.max(...xs)
  const minimumY = Math.min(...ys)
  const maximumY = Math.max(...ys)
  const spanX = maximumX - minimumX
  const spanY = maximumY - minimumY
  if (!Number.isFinite(spanX) || !Number.isFinite(spanY)) fail('SITE_BOUNDARY_GEOMETRY_NUMERIC')
  if (spanX === 0 || spanY === 0) return undefined
  return points.map(([x, y]) => {
    const offsetX = x - minimumX
    const offsetY = y - minimumY
    const localX = offsetX / spanX
    const localY = offsetY / spanY
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY) || !Number.isFinite(localX) || !Number.isFinite(localY)) {
      fail('SITE_BOUNDARY_GEOMETRY_NUMERIC')
    }
    return [localX, localY]
  })
}

function canonicalize(points: readonly Point[], counterClockwise: boolean): Point[] {
  const canonicalDirection = counterClockwise ? [...points] : [...points].reverse()
  let first = 0
  for (let index = 1; index < canonicalDirection.length; index += 1) {
    const candidate = canonicalDirection[index]!
    const current = canonicalDirection[first]!
    if (candidate[0] < current[0] || (candidate[0] === current[0] && candidate[1] < current[1])) first = index
  }
  return [...canonicalDirection.slice(first), ...canonicalDirection.slice(0, first)]
}

export function normalizeSiteBoundaryGeometry(crs: string, payload: unknown): NormalizedSiteBoundaryGeometry {
  const normalizedCrs = parseCrs(crs)
  const parsed = parsePayload(payload)
  const open = removeConsecutiveDuplicates(parseClosedRing(parsed.ring))
  validateOpenRing(normalizedCrs, open)
  const local = localWorkingCoordinates(open)
  if (local === undefined) fail('SITE_BOUNDARY_GEOMETRY_ZERO_AREA')
  rejectSelfIntersections(local)
  const area = signedDoubleArea(local)
  if (area === 0) fail('SITE_BOUNDARY_GEOMETRY_ZERO_AREA')
  const canonicalOpen = canonicalize(open, area > 0)
  const coordinates = [...canonicalOpen, canonicalOpen[0]!] as readonly Point[]
  const sha256 = createHash('sha256').update(JSON.stringify({ crs: normalizedCrs, coordinates })).digest('hex')
  return { source: parsed.source, crs: normalizedCrs, coordinates, sha256 }
}
