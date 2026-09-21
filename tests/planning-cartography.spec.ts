import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import * as cartography from '../src/report/cartography/index.ts'
import type { AnalysisBasemap, AnalysisRoute, PlanningAnalysisInput, PlanningAnalysisResult } from '../src/report/cartography/types.ts'

const roots: string[] = []
const hash = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex')
const source = { label: 'Public geographic record', locator: 'https://www.openstreetmap.org/node/1', observedAt: '2026-09-21T00:00:00Z' }
const baseLocation = { id: 'site', label: 'Project site', coordinate: { longitude: 114.97, latitude: 30.84, crs: 'EPSG:4326' as const }, source }
const city = { id: 'city', label: 'City', role: 'city' as const, coordinate: { longitude: 114.80, latitude: 30.90, crs: 'EPSG:4326' as const }, source }
const now = () => new Date('2026-09-21T03:00:00Z')

afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}planning-cartography-`)) throw new Error('UNSAFE_TEST_CLEANUP')
    await rm(root, { recursive: true, force: true })
  }
})

async function input(overrides: Partial<PlanningAnalysisInput> = {}): Promise<PlanningAnalysisInput> {
  const root = await mkdtemp(join(tmpdir(), 'planning-cartography-'))
  roots.push(root)
  return { projectId: 'project-a', pageId: 'regional-a', title: 'Regional context', kind: 'regional-context', outputDirectory: root,
    location: baseLocation, nodes: [city], ...overrides }
}

async function basemap(viewport: { width: number; height: number }): Promise<AnalysisBasemap> {
  const png = await sharp({ create: { width: viewport.width, height: viewport.height, channels: 3, background: '#e4efe4' } }).png().toBuffer()
  return { png, width: viewport.width, height: viewport.height, crs: 'EPSG:3857', attribution: '© OpenStreetMap contributors · ODbL', source,
    receipts: [{ url: 'https://tile.openstreetmap.org/10/839/419.png', retrievedAt: now().toISOString(), mediaType: 'image/png', bytes: png }] }
}

function prepare(...args: Parameters<NonNullable<typeof cartography.preparePlanningAnalysis>>) {
  expect(cartography.preparePlanningAnalysis, 'public map preparation entry point').toBeTypeOf('function')
  return cartography.preparePlanningAnalysis(...args)
}

describe('planning map evidence boundary', () => {
  it('blocks unnamed, unsourced, or unknown coordinates before issuing a map request', async () => {
    const cases = [undefined, { ...baseLocation, source: { label: '', locator: '' } },
      { ...baseLocation, coordinate: { ...baseLocation.coordinate, crs: 'GCJ-02' as const } },
      { ...baseLocation, coordinate: { ...baseLocation.coordinate, latitude: 114.97 } }]
    for (const location of cases) {
      const result = await prepare(await input({ location }), { now, basemap: async () => { throw new Error('must not fetch invalid location') } })
      expect(result.status).toBe('blocked')
      expect(result.assets).toHaveLength(0)
      expect(result.gaps.some(gap => gap.blocking && /LOCATION|CRS|COORDINATE/.test(gap.code))).toBe(true)
    }
  })

  it('writes a real map asset, receipts, CRS, north arrow, scale and source metadata', async () => {
    const request = await input()
    const result = await prepare(request, { now, basemap })
    expect(result.status).toBe('ready')
    expect(result.assets).toHaveLength(1)
    const asset = result.assets[0]
    const bytes = await readFile(asset.adoptedAsset.sourcePath)
    expect((await sharp(bytes).metadata()).width).toBe(1800)
    expect(asset.sha256).toBe(hash(bytes))
    expect(asset.adoptedAsset.semanticRole).toBe('map')
    expect(asset.adoptedAsset.pageBindings).toEqual([{ findingId: 'regional-a', role: 'primary' }])
    expect(asset.cartography).toMatchObject({ boundary: 'not-applicable', legend: 'present', northArrow: 'present', scale: { kind: 'scale-bar' } })
    const metadata = JSON.parse(await readFile(asset.metadataPath, 'utf8'))
    expect(metadata.coordinateSystem).toEqual({ input: 'EPSG:4326', geographic: 'EPSG:4326', display: 'EPSG:3857' })
    expect(metadata.locations[0].source.locator).toBe(source.locator)
    expect(metadata.receipts).toHaveLength(1)
    expect(hash(await readFile(metadata.receipts[0].path))).toBe(metadata.receipts[0].sha256)
    const svg = await readFile(metadata.svgPath, 'utf8')
    expect(svg).toContain('© 开放街图贡献者')
    expect(await readFile(metadata.attributionHtmlPath, 'utf8')).toContain('EPSG:3857')
    expect(svg).toContain('比例尺')
    expect(result.evidence.some(item => item.kind === 'distance' && /直线/.test(item.statement))).toBe(true)
  })

  it('keeps project identities isolated and preserves preexisting evidence on repeat runs', async () => {
    const firstRequest = await input()
    const first = await prepare(firstRequest, { now, basemap })
    const previousBytes = await readFile(first.assets[0].metadataPath)
    const second = await prepare({ ...firstRequest, projectId: 'project-b', location: { ...baseLocation, label: 'London', coordinate: { longitude: -0.1276, latitude: 51.5072, crs: 'WGS84' } }, nodes: [] }, { now, basemap })
    expect(second.assets[0].adoptedAsset.sourceKey).not.toBe(first.assets[0].adoptedAsset.sourceKey)
    expect(second.assets[0].metadataPath).not.toBe(first.assets[0].metadataPath)
    expect(await readFile(first.assets[0].metadataPath)).toEqual(previousBytes)
    expect(JSON.parse(await readFile(second.assets[0].metadataPath, 'utf8')).locations[0].wgs84.longitude).toBeCloseTo(-0.1276, 5)
  })

  it('converts explicit web Mercator input while keeping the original CRS evidence', async () => {
    const result = await prepare(await input({ location: { ...baseLocation, coordinate: { longitude: 1113194.9079327357, latitude: 0, crs: 'EPSG:3857' } }, nodes: [] }), { now, basemap })
    const metadata = JSON.parse(await readFile(result.assets[0].metadataPath, 'utf8'))
    expect(metadata.locations[0].wgs84).toEqual({ longitude: 10, latitude: 0 })
    expect(metadata.coordinateSystem.input).toBe('EPSG:3857')
  })

  it('keeps a Chinese client map with translated attribution and exposes full copyright and technical evidence in accessible HTML', async () => {
    const result = await prepare(await input({ title: '真实区位', question: '项目位置与周边城镇', location: { ...baseLocation, label: '项目' }, nodes: [{ ...city, label: '周边城镇（公开地图代表点）' }] }), { now, basemap })
    const metadata = JSON.parse(await readFile(result.assets[0].metadataPath, 'utf8'))
    const svg = await readFile(metadata.svgPath, 'utf8')
    const visibleText = [...svg.matchAll(/<tspan[^>]*>(.*?)<\/tspan>|<text[^>]*>([^<]+)<\/text>/g)].map(match => match[1] ?? match[2]).join(' ')
    expect(visibleText).not.toMatch(/[a-zA-Z]/)
    expect(visibleText).toContain('© 开放街图贡献者')
    expect(visibleText).toContain('北')
    expect(visibleText).not.toMatch(/公开地图代表点|开发红线|测绘成果|均有来源|归档|证据|许可/)
    expect(visibleText).toContain('项目位置')
    expect(visibleText).toContain('周边城镇')
    expect(metadata.coordinateSystem.display).toBe('EPSG:3857')
    const attribution = await readFile(metadata.attributionHtmlPath, 'utf8')
    expect(attribution).toContain('OpenStreetMap contributors')
    expect(attribution).toContain('https://www.openstreetmap.org/copyright')
    expect(attribution).toContain('EPSG:3857')
    expect(attribution).toContain('非开发红线')
    expect(attribution).toContain('公开地图代表点')
  })

  it('returns explicit gaps for driving, customer and competitor claims without evidence', async () => {
    const driving = await prepare(await input({ kind: 'accessibility', radiusKm: [10, 30] }), { now, basemap })
    expect(driving.status).toBe('partial')
    expect(driving.gaps.some(gap => gap.code === 'DRIVING_ROUTE_MISSING')).toBe(true)
    const metadata = JSON.parse(await readFile(driving.assets[0].metadataPath, 'utf8'))
    expect(metadata.distanceRings.map((ring: { basis: string }) => ring.basis)).toEqual(['geodesic-straight-line', 'geodesic-straight-line'])
    expect(metadata.routes).toEqual([])
    const audience = await prepare(await input({ kind: 'audience-catchment' }), { now, basemap })
    expect(audience.gaps.some(gap => gap.code === 'AUDIENCE_EVIDENCE_MISSING')).toBe(true)
    const competitor = await prepare(await input({ kind: 'competitor-distribution', nodes: [{ ...city, role: 'competitor' }] }), { now, basemap })
    expect(competitor.gaps.some(gap => gap.code === 'COMPETITOR_BASIS_MISSING')).toBe(true)
    const competitorMetadata = JSON.parse(await readFile(competitor.assets[0].metadataPath, 'utf8'))
    expect(competitorMetadata.locations.some((location: { role: string }) => location.role === 'competitor')).toBe(false)
  })

  it('does not promote an unsupported boundary or an unavailable basemap into a ready asset', async () => {
    const result = await prepare(await input({ boundary: { status: 'confirmed', source, coordinates: [baseLocation.coordinate, city.coordinate, baseLocation.coordinate] } }), { now, basemap })
    expect(result.gaps.some(gap => /BOUNDARY/.test(gap.code))).toBe(true)
    expect(result.assets[0].cartography.boundary).toBe('not-applicable')
    const unavailable = await prepare(await input(), { now, basemap: async () => { throw new Error('HTTP 503') } })
    expect(unavailable.status).toBe('blocked')
    expect(unavailable.assets).toHaveLength(0)
    expect(unavailable.gaps.some(gap => gap.code === 'BASEMAP_UNAVAILABLE')).toBe(true)
  })

  it('rejects unknown analysis kinds and malformed research geometry, and reports omitted radius demands', async () => {
    const unknown = await prepare(await input({ kind: 'scene' as any }), { now, basemap })
    expect(unknown.status).toBe('blocked')
    const collinear = await prepare(await input({ boundary: { status: 'research', source, coordinates: [baseLocation.coordinate, city.coordinate, city.coordinate, baseLocation.coordinate] }, radiusKm: [1, 2, 3, 4, 5, 6, 7] }), { now, basemap })
    expect(collinear.gaps.some(gap => gap.code === 'BOUNDARY_INVALID')).toBe(true)
    expect(collinear.gaps.some(gap => gap.code === 'DISTANCE_RADIUS_COUNT_EXCEEDED')).toBe(true)
  })
})

describe('route measurements', () => {
  const route: AnalysisRoute = { fromId: 'city', toId: 'site', mode: 'driving', distanceMeters: 21000, durationSeconds: 1800,
    geometry: [{ longitude: 114.80, latitude: 30.90 }, { longitude: 114.89, latitude: 30.89 }, { longitude: 114.97, latitude: 30.84 }],
    waypoints: [{ coordinate: { longitude: 114.80, latitude: 30.90 }, snapDistanceMeters: 0, name: 'City road' }, { coordinate: { longitude: 114.97, latitude: 30.84 }, snapDistanceMeters: 0, name: 'Local road' }],
    source: { label: 'OSRM driving / OpenStreetMap', locator: 'https://router.project-osrm.org/route/v1/driving/114.8,30.9;114.97,30.84', methodology: 'Road network estimate; no live traffic' },
    traffic: 'not-included', receipts: [{ url: 'https://router.project-osrm.org/route/v1/driving/114.8,30.9;114.97,30.84', retrievedAt: now().toISOString(), mediaType: 'application/json', bytes: Buffer.from('{"code":"Ok"}') }] }

  it('reports provider driving length and time separately from measured straight distance', async () => {
    const result = await prepare(await input({ kind: 'accessibility', routeRequests: [{ fromId: 'city', toId: 'site' }] }), { now, basemap, route: async () => route })
    expect(result.status).toBe('ready')
    const metadata = JSON.parse(await readFile(result.assets[0].metadataPath, 'utf8'))
    expect(metadata.routes[0]).toMatchObject({ distanceMeters: 21000, durationSeconds: 1800, traffic: 'not-included' })
    expect(metadata.straightDistances[0].distanceMeters).toBeGreaterThan(17000)
    expect(metadata.straightDistances[0].distanceMeters).toBeLessThan(18000)
    expect(metadata.disclosures.join(' ')).toContain('实时路况')
  })

  it('rejects invented travel speeds, invalid geometry and distant road snaps as missing routes', async () => {
    const badRoutes = [{ ...route, durationSeconds: 1 }, { ...route, geometry: [{ longitude: 120, latitude: 0 }] },
      { ...route, geometry: [route.geometry[0], { longitude: 120, latitude: 0 }, route.geometry[2]] },
      { ...route, geometry: [route.geometry[0], route.geometry[1], { longitude: 114.97, latitude: 30.841 }], waypoints: [route.waypoints[0], { ...route.waypoints[1], coordinate: { longitude: 114.97, latitude: 30.841 } }] },
      { ...route, waypoints: [route.waypoints[0], { ...route.waypoints[1], snapDistanceMeters: 12000 }] }]
    for (const bad of badRoutes) {
      const result: PlanningAnalysisResult = await prepare(await input({ kind: 'accessibility', routeRequests: [{ fromId: 'city', toId: 'site' }] }), { now, basemap, route: async () => bad })
      expect(result.status).toBe('partial')
      expect(result.gaps.some(gap => /ROUTE/.test(gap.code))).toBe(true)
      expect(JSON.parse(await readFile(result.assets[0].metadataPath, 'utf8')).routes).toEqual([])
    }
  })

  it('keeps road snaps in the accessible companion and verbose methodology in its evidence file', async () => {
    const result = await prepare(await input({ kind: 'accessibility', location: { ...baseLocation, source: { ...source, methodology: 'detailed-methodology-'.repeat(80) } }, routeRequests: [{ fromId: 'city', toId: 'site' }] }), { now, basemap, route: async () => route })
    const metadata = JSON.parse(await readFile(result.assets[0].metadataPath, 'utf8'))
    const svg = await readFile(metadata.svgPath, 'utf8')
    expect(svg).not.toContain('路网吸附')
    expect(await readFile(metadata.attributionHtmlPath, 'utf8')).toContain('路网吸附')
    expect(svg).not.toContain('detailed-methodology-')
    expect(metadata.locations[0].source.methodology).toContain('detailed-methodology-')
  })
})
