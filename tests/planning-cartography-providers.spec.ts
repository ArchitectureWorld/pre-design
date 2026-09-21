import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { createPublicMapProviders, resolvePlanningLocation } from '../src/report/cartography/index.ts'
import { downloadMapSource } from '../src/report/cartography/providers.ts'
import { fitViewport, geodesicDistanceMeters, scaleBar } from '../src/report/cartography/geometry.ts'
import type { AnalysisRouteQuery } from '../src/report/cartography/index.ts'

const now = () => new Date('2026-09-21T00:00:00Z')
const query: AnalysisRouteQuery = { from: { id: 'a', label: 'A', coordinate: { longitude: 0, latitude: 0, crs: 'WGS84' }, wgs84: { longitude: 0, latitude: 0 }, source: { label: 'source', locator: 'https://example.com/a' } },
  to: { id: 'b', label: 'B', coordinate: { longitude: 0.1, latitude: 0, crs: 'WGS84' }, wgs84: { longitude: 0.1, latitude: 0 }, source: { label: 'source', locator: 'https://example.com/b' } } }

it('recovers a transient TLS reset with bounded retries and preserves the successful response bytes', async () => {
  vi.useFakeTimers()
  try {
    let attempts = 0
    const pending = downloadMapSource('https://example.com/map.json', 'application/json', 1000, { now, fetch: async () => {
      if (++attempts < 3) throw new TypeError('fetch failed', { cause: Object.assign(new Error('TLS reset'), { code: 'ECONNRESET' }) })
      return new Response('{"source":"original"}', { headers: { 'Content-Type': 'application/json' } })
    } })
    const result = expect(pending).resolves.toMatchObject({ mediaType: 'application/json' })
    await vi.runAllTimersAsync(); await result
    expect(attempts).toBe(3)
    expect(Buffer.from((await pending).bytes).toString('utf8')).toBe('{"source":"original"}')
  } finally { vi.useRealTimers() }
})

it('stops transport retries after three attempts and never retries aborts or invalid content', async () => {
  vi.useFakeTimers()
  try {
    let attempts = 0
    const error = new TypeError('fetch failed', { cause: Object.assign(new Error('TLS reset'), { code: 'ECONNRESET' }) })
    const failed = downloadMapSource('https://example.com/map.json', 'application/json', 1000, { fetch: async () => { attempts++; throw error } })
    const rejected = expect(failed).rejects.toBe(error)
    await vi.runAllTimersAsync(); await rejected
    expect(attempts).toBe(3)
    for (const failure of ['abort', 'invalid', 'forbidden']) {
      const controller = new AbortController(); attempts = 0
      const call = downloadMapSource('https://example.com/map.json', 'application/json', 1000, { fetch: async () => {
        attempts++
        if (failure === 'abort') { controller.abort(); throw error }
        return failure === 'forbidden' ? new Response('Forbidden', { status: 403 }) : new Response('not-json', { headers: { 'Content-Type': 'text/html' } })
      } }, controller.signal)
      await expect(call).rejects.toThrow()
      expect(attempts).toBe(1)
    }
  } finally { vi.useRealTimers() }
})

it('stitches only the requested geographic viewport and reuses original tile bytes across pages', async () => {
  const tile = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#abcdef' } }).png().toBuffer()
  const requested: string[] = []
  const providers = createPublicMapProviders({ now, fetch: async url => { requested.push(url); return new Response(Uint8Array.from(tile), { headers: { 'Content-Type': 'image/png' } }) } })
  const viewport = fitViewport([{ longitude: 0, latitude: 0 }, { longitude: 0.1, latitude: 0.1 }])
  const first = await providers.basemap(viewport), second = await providers.basemap(viewport)
  expect(first.crs).toBe('EPSG:3857')
  expect(first.receipts.length).toBeLessThanOrEqual(35)
  expect(requested).toHaveLength(first.receipts.length)
  expect(first.png).toEqual(second.png)
  expect((await sharp(first.png).metadata()).width).toBe(1280)
  expect(first.receipts.every(receipt => receipt.url.startsWith(`https://tile.openstreetmap.org/${viewport.zoom}/`))).toBe(true)
  expect(scaleBar(viewport).meters).toBeGreaterThan(0)
  expect(geodesicDistanceMeters({ longitude: 0, latitude: 0 }, { longitude: 1, latitude: 0 })).toBeCloseTo(111195.08, 1)
})

it('rejects HTML, HTTP errors and wrong-sized tiles instead of rendering an unavailable map', async () => {
  const viewport = fitViewport([{ longitude: 0, latitude: 0 }, { longitude: 0.1, latitude: 0.1 }])
  const tiny = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#fff' } }).png().toBuffer()
  for (const response of [() => new Response('<html>Error</html>', { headers: { 'Content-Type': 'text/html' } }), () => new Response('service unavailable', { status: 503 }),
    () => new Response(Uint8Array.from(tiny), { headers: { 'Content-Type': 'image/png' } })]) {
    const provider = createPublicMapProviders({ fetch: async () => response() })
    await expect(provider.basemap(viewport)).rejects.toThrow(/MAP_/)
  }
})

it('parses OSRM network distance, model duration, geometry and original response without a speed heuristic', async () => {
  const body = JSON.stringify({ code: 'Ok', routes: [{ distance: 13000, duration: 950, geometry: { type: 'LineString', coordinates: [[0, 0], [0.1, 0]] } }],
    waypoints: [{ location: [0, 0], distance: 1, name: 'First road' }, { location: [0.1, 0], distance: 2, name: 'Second road' }] })
  const provider = createPublicMapProviders({ now, fetch: async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }) })
  const route = await provider.route(query)
  expect(route).toMatchObject({ distanceMeters: 13000, durationSeconds: 950, traffic: 'not-included', waypoints: [{ snapDistanceMeters: 1 }, { snapDistanceMeters: 2 }] })
  expect(Buffer.from(route.receipts[0].bytes).toString('utf8')).toBe(body)
  expect(route.source.locator).toContain('/driving/0.0000000,0.0000000;0.1000000,0.0000000')
  const error = createPublicMapProviders({ fetch: async () => new Response('{"code":"NoRoute"}', { headers: { 'Content-Type': 'application/json' } }) })
  await expect(error.route(query)).rejects.toThrow('ROUTE_RESPONSE_INVALID')
})

it('requires coordinate values in geographic search responses instead of coercing null into a real point', async () => {
  const result = await resolvePlanningLocation({ projectName: 'Reservoir', evidence: [{ text: 'Reservoir in County', contextTerms: ['County'], source: { label: 'source', locator: 'C:/site.pdf' } }] },
    { fetch: async () => new Response(JSON.stringify([{ osm_type: 'way', osm_id: 123, name: 'Reservoir', display_name: 'Reservoir, County', lat: null, lon: null }]), { headers: { 'Content-Type': 'application/json' } }) })
  expect(result.status).toBe('missing')
  expect(result.location).toBeUndefined()
})
