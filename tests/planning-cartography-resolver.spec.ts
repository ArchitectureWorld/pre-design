import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import * as cartography from '../src/report/cartography/index.ts'
import type { PlanningGeocodeCandidate, PlanningLocationEvidence, ResolvePlanningLocationInput, PlanningLocationResolverDependencies } from '../src/report/cartography/types.ts'

const source = { label: 'Project source document, page 11', locator: 'C:/project/source.pdf', sha256: 'a'.repeat(64) }
const evidence: PlanningLocationEvidence = { text: '湖北省武汉市新洲区旧街街，沙河支流少潭河上。项目为少潭河水库。', source, placeName: '少潭河水库', contextTerms: ['武汉市', '新洲区'] }
const candidate: PlanningGeocodeCandidate = { id: 'osm-way-947987687', name: '少潭河水库', displayName: '少潭河水库, 新洲区, 武汉市, 湖北省, 中国',
  coordinate: { longitude: 114.9720824, latitude: 30.8404159, crs: 'EPSG:4326' }, source: { label: 'OpenStreetMap / Nominatim', locator: 'https://www.openstreetmap.org/way/947987687' } }
const rootPaths: string[] = []
const geocode = async () => ({ candidates: [candidate], receipts: [{ url: 'https://nominatim.openstreetmap.org/search?q=example', retrievedAt: '2026-09-21T00:00:00Z', mediaType: 'application/json', bytes: Buffer.from('[]') }] })

afterEach(async () => { for (const root of rootPaths.splice(0)) {
  if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}planning-map-resolver-`)) throw new Error('UNSAFE_TEST_CLEANUP')
  await rm(root, { recursive: true, force: true })
} })

function run(input: ResolvePlanningLocationInput, dependencies?: PlanningLocationResolverDependencies) {
  expect(cartography.resolvePlanningLocation).toBeTypeOf('function')
  return cartography.resolvePlanningLocation(input, dependencies)
}

it('resolves a geographic candidate only after name and source location context agree and archives raw evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'planning-map-resolver-')); rootPaths.push(root)
  const result = await run({ projectName: '少潭河文旅项目', evidence: [evidence], outputDirectory: root }, { geocode })
  expect(result.status).toBe('resolved')
  expect(result.location?.coordinate).toEqual(candidate.coordinate)
  expect(result.location?.source.locator).toBe(candidate.source.locator)
  expect(result.evidence[0].source.locator).toBe(source.locator)
  expect(await readFile(result.receiptPaths[0], 'utf8')).toBe('[]')
  expect(JSON.parse(await readFile(result.manifestPath!, 'utf8')).location.id).toBe(candidate.id)
})

it('never chooses the first or most popular candidate across contradictory or ambiguous locations', async () => {
  const foreign = { ...candidate, id: 'other', displayName: '少潭河水库, 鄂州市, 湖北省, 中国' }
  const mismatch = await run({ projectName: '少潭河水库', evidence: [evidence] }, { geocode: async () => ({ ...(await geocode()), candidates: [foreign] }) })
  expect(mismatch.status).toBe('missing')
  expect(mismatch.location).toBeUndefined()
  const ambiguous = await run({ projectName: '少潭河水库', evidence: [evidence] }, { geocode: async () => ({ ...(await geocode()), candidates: [candidate, { ...candidate, id: 'second-place' }] }) })
  expect(ambiguous.status).toBe('ambiguous')
  expect(ambiguous.location).toBeUndefined()
})

it('rejects empty, invented context or source-free model briefs before geographic lookup', async () => {
  for (const entries of [[], [{ ...evidence, source: { label: '', locator: '' } }], [{ ...evidence, contextTerms: ['not-in-source'] }]]) {
    const result = await run({ projectName: 'Project', evidence: entries }, { geocode: async () => { throw new Error('should not run') } })
    expect(result.status).toBe('missing')
    expect(result.location).toBeUndefined()
  }
})

it('accepts source coordinates for another project and keeps incompatible coordinate systems missing', async () => {
  const london = { text: 'London riverside parcel; source WGS84 position.', source, placeName: 'London project', coordinate: { longitude: -0.1, latitude: 51.5, crs: 'WGS84' as const } }
  const result = await run({ projectName: 'London project', evidence: [london] })
  expect(result.status).toBe('resolved')
  expect(result.location?.coordinate.longitude).toBe(-0.1)
  const incompatible = await run({ projectName: 'London project', evidence: [{ ...london, coordinate: { ...london.coordinate, crs: 'BD-09' } }] })
  expect(incompatible.status).toBe('missing')
})

it('reads only explicitly mapped project location facts and never treats a proposed scene as evidence', () => {
  expect(cartography.planningLocationEvidenceFromSources).toBeTypeOf('function')
  const facts = [{ ...evidence, role: 'project-location' as const }, { ...evidence, text: '假想湖畔场景', role: 'other' as const }]
  expect(cartography.planningLocationEvidenceFromSources(facts)).toEqual([evidence])
})
