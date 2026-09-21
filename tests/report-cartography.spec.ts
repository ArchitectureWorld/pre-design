import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it } from 'vitest'
import * as helper from '../src/presentation/report-cartography.ts'
import type { ReportImageDemand } from '../src/presentation/report-image-pipeline.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'
import type { PlanningLocationResolverDependencies, PlanningAnalysisDependencies } from '../src/report/cartography/types.ts'
import { REPORT_IMAGE_POLICY_VERSION } from '../src/visual/image-policy.ts'

const roots: string[] = []
const now = () => new Date('2026-09-21T02:00:00Z')
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const signal = () => new AbortController().signal

afterEach(async () => { for (const root of roots.splice(0)) {
  if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}report-cartography-`)) throw new Error('UNSAFE_TEST_CLEANUP')
  await rm(root, { recursive: true, force: true })
} })

async function root() { const path = await mkdtemp(join(tmpdir(), 'report-cartography-')); roots.push(path); return path }
function project(location = '湖北省武汉市新洲区旧街街，沙河支流少潭河上。', projectName = '少潭河水库'): FrozenProjectInput {
  return { projectId: 'project-a', projectName, revision: 2, generatedAt: now().toISOString(), recommendation: '区域联系', decisionItems: [], gates: [], visualAssets: [],
    stateObjects: [{ objectId: 'PS01', chapterId: '01', title: '项目基本情况', summary: '项目基本情况', facts: [], reportSections: [{ key: 'location', title: '空间位置',
      entries: [{ key: 'location', fieldPath: 'data.location', text: `空间位置：${location}`, basis: '原始PDF第11页', evidenceRefs: [{ evidenceId: 'location-source' }] }] }] }] }
}
function demand(kind: 'regional-context' | 'accessibility' | 'competitor-distribution' = 'regional-context'): ReportImageDemand {
  return { findingId: 'finding-geography', analysis: { kind, title: '核对真实地域联系', requiredEvidence: kind === 'accessibility' ? ['basemap', 'location', 'driving-route', 'driving-time'] : ['basemap', 'location'] },
    brief: { id: 'geography:main', pageId: 'geography', version: REPORT_IMAGE_POLICY_VERSION, conclusion: '说明来源支持的真实位置关系', subjects: ['区域交通'], activities: [], environment: '区域', scale: 'area', locale: 'domestic', allowedKinds: ['map'], allowedSources: ['project'] } }
}

it('uses an explicit canonical project name with location sources when the workspace identity is a slug', async () => {
  const prepare = helper.createReportCartographyPreparer(dependencies()), workspace = await root(), source = project()
  const input: FrozenProjectInput = { ...source, projectName: 'shaotanhe', stateObjects: source.stateObjects.map(object => ({ ...object,
    reportSections: object.reportSections!.map(section => ({ ...section, entries: [...section.entries,
      { key: 'canonical-name', fieldPath: 'data.canonical_name', text: '项目名称：少潭河水库', basis: '原资料PDF封面' }] })) })) }
  const result = await prepare(demand(), input, workspace, signal())
  expect(result).toHaveLength(1)
  const metadata = JSON.parse(await readFile(result[0].analysisEvidencePath!, 'utf8'))
  expect(metadata.locations[0].label).toBe('少潭河水库')
  const directory = join(workspace, '.pre-design', 'report-cartography')
  const snapshot = JSON.parse(await readFile(join(directory, (await readdir(directory)).find(name => /^source-.+\.json$/.test(name))!), 'utf8'))
  expect(snapshot.projectName).toBe('shaotanhe')
  expect(snapshot.canonicalName).toBe('少潭河水库')
  expect(snapshot.names[0].fieldPath).toBe('data.canonical_name')
})

it('uses a real near-site extent for site scale and wider sourced town context for regional scale', async () => {
  const prepare = helper.createReportCartographyPreparer(dependencies()), workspace = await root()
  const near = await prepare({ ...demand(), analysis: { ...demand().analysis!, scale: 'site' } }, project(), workspace, signal())
  const wide = await prepare({ ...demand(), analysis: { ...demand().analysis!, scale: 'regional' } }, project(), workspace, signal())
  const nearMap = JSON.parse(await readFile(near[0].analysisEvidencePath!, 'utf8'))
  const wideMap = JSON.parse(await readFile(wide[0].analysisEvidencePath!, 'utf8'))
  expect(nearMap.locations).toHaveLength(1)
  expect(wideMap.locations.length).toBeGreaterThan(1)
  expect(nearMap.viewport.east - nearMap.viewport.west).toBeLessThan(0.15)
  expect(wideMap.viewport.east - wideMap.viewport.west).toBeGreaterThan(0.5)
  expect(near[0].sourcePath).not.toBe(wide[0].sourcePath)
})

it('derives supported inspection location claims from the verified map manifest and rejects edited claim caches', async () => {
  const prepare = helper.createReportCartographyPreparer(dependencies()), workspace = await root()
  const result = await prepare(demand(), project(), workspace, signal())
  const method = JSON.parse(result[0].origin.method)
  expect(method.sourceClaims.sourceLocation).toMatchObject({ status: 'supported', value: result[0].imageQuality!.sourceLocation })
  expect(method.sourceClaims.sourceLocation.evidenceSha256).toBe(hash(await readFile(result[0].analysisEvidencePath!)))
  const directory = join(workspace, '.pre-design', 'report-cartography')
  const cachePath = join(directory, (await readdir(directory)).find(name => name.endsWith('.cache.json'))!)
  const cache = JSON.parse(await readFile(cachePath, 'utf8'))
  method.sourceClaims.sourceLocation.value = 'unverified-other-place'
  cache.materials[0].origin.method = JSON.stringify(method)
  await writeFile(cachePath, JSON.stringify(cache))
  const refreshed = await prepare(demand(), project(), workspace, signal())
  expect(refreshed[0].sourcePath).not.toBe(result[0].sourcePath)
  expect(JSON.parse(refreshed[0].origin.method).sourceClaims.sourceLocation.value).toBe('少潭河水库')
})
function dependencies(): PlanningLocationResolverDependencies & PlanningAnalysisDependencies {
  const points: Record<string, { longitude: number; latitude: number }> = { '少潭河水库': { longitude: 114.9720824, latitude: 30.8404159 }, '新洲区': { longitude: 114.7960013, latitude: 30.8437702 }, '武汉市': { longitude: 114.30, latitude: 30.60 },
    '西湖': { longitude: 120.15, latitude: 30.24 }, '西湖区': { longitude: 120.13, latitude: 30.26 }, '杭州市': { longitude: 120.20, latitude: 30.25 } }
  return { now,
    geocode: async query => {
      const name = query.split(' ')[0], point = points[name]
      const context = ['西湖', '西湖区', '杭州市'].includes(name) ? '浙江省杭州市西湖区' : '湖北省武汉市新洲区'
      return { candidates: point ? [{ id: `place-${name}`, name, displayName: `${name} ${context}`, coordinate: { ...point, crs: 'EPSG:4326' },
        source: { label: 'OSM geographic record', locator: `https://www.openstreetmap.org/node/${encodeURIComponent(name)}`, observedAt: now().toISOString() } }] : [],
        receipts: [{ url: 'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(query), retrievedAt: now().toISOString(), mediaType: 'application/json', bytes: Buffer.from(JSON.stringify({ name, point })) }] }
    },
    basemap: async viewport => { const png = await sharp({ create: { width: viewport.width, height: viewport.height, channels: 3, background: '#cbe2ca' } }).png().toBuffer()
      return { png, width: viewport.width, height: viewport.height, crs: 'EPSG:3857', attribution: '© OpenStreetMap contributors', source: { label: 'OSM tiles', locator: 'https://www.openstreetmap.org/copyright', observedAt: now().toISOString() },
        receipts: [{ url: 'https://tile.openstreetmap.org/10/1/1.png', retrievedAt: now().toISOString(), mediaType: 'image/png', bytes: png }] } },
    route: async query => ({ fromId: query.from.id, toId: query.to.id, mode: 'driving', distanceMeters: 21452, durationSeconds: 1448.1, geometry: [query.from.wgs84, query.to.wgs84],
      waypoints: [{ coordinate: query.from.wgs84, snapDistanceMeters: 0, name: '' }, { coordinate: query.to.wgs84, snapDistanceMeters: 0, name: '' }], traffic: 'not-included',
      source: { label: 'OSRM', locator: 'https://router.project-osrm.org/route/v1/driving/route', observedAt: now().toISOString() },
      receipts: [{ url: 'https://router.project-osrm.org/route/v1/driving/route', retrievedAt: now().toISOString(), mediaType: 'application/json', bytes: Buffer.from('{"code":"Ok"}') }] }),
  }
}

it('prepares a page-bound map from formal source locations and retains client evidence and cartography', async () => {
  expect(helper.createReportCartographyPreparer).toBeTypeOf('function')
  const prepare = helper.createReportCartographyPreparer(dependencies()), workspace = await root()
  const result = await prepare(demand(), project(), workspace, signal())
  expect(result).toHaveLength(1)
  expect(result[0].pageBindings).toEqual([{ findingId: 'finding-geography', role: 'primary' }])
  expect(result[0].analysisKind).toBe('regional-context')
  expect(result[0].cartography?.northArrow).toBe('present')
  expect(result[0].analysisEvidence?.some(item => item.kind === 'calculation' && item.statement.includes('直线'))).toBe(true)
  const manifest = JSON.parse(await readFile(result[0].analysisEvidencePath!, 'utf8'))
  expect(manifest.locations[0].label).toBe('少潭河水库')
  expect(manifest.locations.map((item: any) => item.label)).toContain('新洲区（公开地图代表点）')
  expect(manifest.routes).toEqual([])
  expect(result[0].provenance?.sourceFileSha256).toBe(hash(await readFile(result[0].analysisEvidencePath!)))
})

it('reuses only matching source fingerprints and verified files; tampering reacquires and other projects do not inherit coordinates', async () => {
  const workspace = await root(), prepare = helper.createReportCartographyPreparer(dependencies())
  const first = await prepare(demand(), project(), workspace, signal()), second = await prepare(demand(), project(), workspace, signal())
  expect(second[0].sourcePath).toBe(first[0].sourcePath)
  await writeFile(first[0].sourcePath, 'corrupted raster')
  const repaired = await prepare(demand(), project(), workspace, signal())
  expect(repaired[0].sourcePath).not.toBe(first[0].sourcePath)
  const other = { ...project('浙江省杭州市西湖区。', '西湖'), projectId: 'project-b' }
  const next = await prepare(demand(), other, workspace, signal())
  expect(next[0].sourcePath).not.toBe(repaired[0].sourcePath)
  expect(JSON.parse(await readFile(next[0].analysisEvidencePath!, 'utf8')).locations[0].wgs84.longitude).toBe(120.15)
  const changed = await prepare({ ...demand(), analysis: { ...demand().analysis!, title: '另一个分析问题' } }, project(), workspace, signal())
  expect(changed[0].sourcePath).not.toBe(repaired[0].sourcePath)
})

it('uses driving routes only for accessibility and never invents competitors from city labels', async () => {
  const workspace = await root(), prepare = helper.createReportCartographyPreparer(dependencies())
  const result = await prepare(demand('accessibility'), project(), workspace, signal())
  expect(result).toHaveLength(1)
  const metadata = JSON.parse(await readFile(result[0].analysisEvidencePath!, 'utf8'))
  expect(metadata.routes).toHaveLength(1)
  expect(metadata.routes[0].distanceMeters).toBe(21452)
  const competitor = await prepare(demand('competitor-distribution'), project(), workspace, signal())
  expect(competitor).toHaveLength(0)
  const files = await readdir(join(workspace, '.pre-design', 'report-cartography', 'issues'))
  expect(files.length).toBeGreaterThan(0)
})

it('does not trust cached editorial claims or bindings merely because the image file hash still matches', async () => {
  const workspace = await root(), prepare = helper.createReportCartographyPreparer(dependencies())
  const first = await prepare(demand(), project(), workspace, signal())
  const directory = join(workspace, '.pre-design', 'report-cartography')
  const cachePath = join(directory, (await readdir(directory)).find(name => name.endsWith('.cache.json'))!)
  const cache = JSON.parse(await readFile(cachePath, 'utf8'))
  cache.materials[0].analysisEvidence[0].statement = 'Fabricated population of 99999999'
  cache.materials[0].pageBindings = [{ findingId: 'another-page', role: 'primary' }]
  await writeFile(cachePath, JSON.stringify(cache))
  const restored = await prepare(demand(), project(), workspace, signal())
  expect(restored[0].pageBindings).toEqual([{ findingId: 'finding-geography', role: 'primary' }])
  expect(restored[0].analysisEvidence!.some(item => item.statement.includes('99999999'))).toBe(false)
  expect(restored[0].sourcePath).not.toBe(first[0].sourcePath)
})

it('refreshes geographic evidence after raw location receipts are damaged instead of rehashing altered source bytes', async () => {
  const workspace = await root(), deps = dependencies(), originalGeocode = deps.geocode!
  let longitudeOffset = 0
  const prepare = helper.createReportCartographyPreparer({ ...deps, geocode: async (query, signal) => {
    const result = await originalGeocode(query, signal)
    return { ...result, candidates: result.candidates.map(candidate => candidate.name === '少潭河水库'
      ? { ...candidate, coordinate: { ...candidate.coordinate, longitude: candidate.coordinate.longitude + longitudeOffset } } : candidate) }
  } })
  const first = await prepare(demand(), project(), workspace, signal())
  const directory = join(workspace, '.pre-design', 'report-cartography')
  const cachePath = join(directory, (await readdir(directory)).find(name => name.endsWith('.cache.json'))!)
  const cache = JSON.parse(await readFile(cachePath, 'utf8'))
  const receipt = cache.files.find((file: { path: string }) => /location-/.test(file.path) && !file.path.endsWith('location.evidence.json'))
  await writeFile(receipt.path, 'altered-source')
  longitudeOffset = 0.001
  const refreshed = await prepare(demand(), project(), workspace, signal())
  expect(refreshed[0].sourcePath).not.toBe(first[0].sourcePath)
  expect(JSON.parse(await readFile(refreshed[0].analysisEvidencePath!, 'utf8')).locations[0].wgs84.longitude).toBeCloseTo(114.9730824, 7)
})

it('fails closed on missing formal location, ignores scene locations and isolates errors', async () => {
  const workspace = await root(), prepare = helper.createReportCartographyPreparer(dependencies()), input = project()
  const objects = input.stateObjects.map(object => ({ ...object, reportSections: object.reportSections!.map(section => ({ ...section,
    entries: section.entries.map(entry => ({ ...entry, fieldPath: 'data.resources[0].location' })) })) }))
  const missing = await prepare(demand(), { ...input, stateObjects: objects }, workspace, signal())
  expect(missing).toHaveLength(0)
  const errors = await readdir(join(workspace, '.pre-design', 'report-cartography', 'issues'))
  expect(errors).toHaveLength(1)
  expect(JSON.parse(await readFile(join(workspace, '.pre-design', 'report-cartography', 'issues', errors[0]), 'utf8')).gaps[0].code).toBe('LOCATION_EVIDENCE_MISSING')
  const recovered = await prepare(demand(), input, workspace, signal())
  expect(recovered).toHaveLength(1)
})
