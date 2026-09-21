import sharp from 'sharp'
import type { AnalysisBasemap, AnalysisReceipt, AnalysisRoute, AnalysisRouteQuery, MapViewport, PlanningAnalysisDependencies, Wgs84Point } from './types.ts'

const USER_AGENT = 'ArchitectureWorld-Preplanning/2.0.1 (bounded static planning map; OpenStreetMap attribution retained)'
const MAX_TILE_BYTES = 2 * 1024 * 1024
const MAX_ROUTE_BYTES = 8 * 1024 * 1024

export async function downloadMapSource(url: string, mediaType: string, limit: number, dependencies: PlanningAnalysisDependencies, signal?: AbortSignal): Promise<AnalysisReceipt> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted()
    try { return await downloadMapSourceOnce(url, mediaType, limit, dependencies, signal) }
    catch (error) {
      const failure = error as { code?: string; cause?: { code?: string } }
      const code = failure?.cause?.code ?? failure?.code ?? ''
      if (attempt >= 2 || signal?.aborted || !['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) throw error
      // Keep retries bounded and at least one second apart for public geocoding policy.
      await new Promise<void>((resolve, reject) => {
        const aborted = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); reject(signal?.reason) }
        const timer = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve() }, 1100 * (attempt + 1))
        signal?.addEventListener('abort', aborted, { once: true })
        if (signal?.aborted) aborted()
      })
    }
  }
}

async function downloadMapSourceOnce(url: string, mediaType: string, limit: number, dependencies: PlanningAnalysisDependencies, signal?: AbortSignal): Promise<AnalysisReceipt> {
  const timeout = AbortSignal.timeout(20_000)
  const response = await (dependencies.fetch ?? fetch)(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    redirect: 'error', headers: { 'User-Agent': USER_AGENT, Accept: mediaType } })
  if (!response.ok) throw new Error(`MAP_HTTP_${response.status}`)
  if (!response.headers.get('content-type')?.toLowerCase().includes(mediaType)) throw new Error('MAP_CONTENT_TYPE_INVALID')
  const size = Number(response.headers.get('content-length') ?? 0)
  if (size > limit) throw new Error('MAP_RESPONSE_TOO_LARGE')
  const chunks: Uint8Array[] = [], reader = response.body?.getReader()
  if (!reader) throw new Error('MAP_RESPONSE_EMPTY')
  let received = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      received += chunk.value.byteLength
      if (received > limit) throw new Error('MAP_RESPONSE_TOO_LARGE')
      chunks.push(chunk.value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally { reader.releaseLock() }
  if (!received) throw new Error('MAP_RESPONSE_EMPTY')
  return { url, retrievedAt: (dependencies.now ?? (() => new Date()))().toISOString(), mediaType, bytes: Buffer.concat(chunks) }
}

/** Reuse this factory across pages to reuse already fetched tiles without repeat downloads. */
export function createPublicMapProviders(dependencies: Pick<PlanningAnalysisDependencies, 'fetch' | 'now'> = {}): Required<Pick<PlanningAnalysisDependencies, 'basemap' | 'route'>> {
  const tileCache = new Map<string, Promise<AnalysisReceipt>>()
  return {
    async basemap(viewport: MapViewport, signal?: AbortSignal): Promise<AnalysisBasemap> {
      const x0 = Math.floor(viewport.worldLeft / 256), y0 = Math.floor(viewport.worldTop / 256)
      const x1 = Math.floor((viewport.worldLeft + viewport.width - 1) / 256), y1 = Math.floor((viewport.worldTop + viewport.height - 1) / 256)
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 35) throw new Error('MAP_TILE_LIMIT_EXCEEDED')
      const receipts: AnalysisReceipt[] = [], overlays: sharp.OverlayOptions[] = []
      // At most two requests at a time. This is one bounded static viewport, not a tile crawler.
      const positions: { x: number; y: number }[] = []
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) positions.push({ x, y })
      for (let index = 0; index < positions.length; index += 2) {
        const batch = await Promise.all(positions.slice(index, index + 2).map(async ({ x, y }) => {
          const url = `https://tile.openstreetmap.org/${viewport.zoom}/${x}/${y}.png`
          let cached = tileCache.get(url)
          if (!cached) {
            cached = downloadMapSource(url, 'image/png', MAX_TILE_BYTES, dependencies, signal)
            tileCache.set(url, cached)
            cached.catch(() => tileCache.delete(url))
          }
          const receipt = await cached, metadata = await sharp(receipt.bytes).metadata()
          if (metadata.width !== 256 || metadata.height !== 256 || metadata.format !== 'png') throw new Error('MAP_TILE_DIMENSIONS_INVALID')
          return { receipt, x, y }
        }))
        for (const { receipt, x, y } of batch) {
          receipts.push(receipt)
          overlays.push({ input: Buffer.from(receipt.bytes), left: (x - x0) * 256, top: (y - y0) * 256 })
        }
      }
      const png = await sharp({ create: { width: (x1 - x0 + 1) * 256, height: (y1 - y0 + 1) * 256, channels: 3, background: '#eeeeee' } })
        .composite(overlays).png().toBuffer()
      const cropped = await sharp(png).extract({ left: viewport.worldLeft - x0 * 256, top: viewport.worldTop - y0 * 256, width: viewport.width, height: viewport.height }).png().toBuffer()
      return { png: cropped, width: viewport.width, height: viewport.height, crs: 'EPSG:3857', attribution: '© OpenStreetMap contributors · ODbL',
        source: { label: 'OpenStreetMap Standard tiles', locator: 'https://www.openstreetmap.org/copyright', observedAt: receipts[0].retrievedAt,
          methodology: `Standard Web Mercator tiles, zoom ${viewport.zoom}; map data completeness varies by region` }, receipts }
    },
    async route(query: AnalysisRouteQuery, signal?: AbortSignal): Promise<AnalysisRoute> {
      const coordinate = (point: Wgs84Point) => `${point.longitude.toFixed(7)},${point.latitude.toFixed(7)}`
      const url = `https://router.project-osrm.org/route/v1/driving/${coordinate(query.from.wgs84)};${coordinate(query.to.wgs84)}?overview=full&geometries=geojson&steps=false&alternatives=false`
      const receipt = await downloadMapSource(url, 'application/json', MAX_ROUTE_BYTES, dependencies, signal)
      const body = JSON.parse(Buffer.from(receipt.bytes).toString('utf8')) as Record<string, any>
      const route = body.routes?.[0]
      if (body.code !== 'Ok' || !route || route.geometry?.type !== 'LineString' || !Array.isArray(route.geometry.coordinates) || !Array.isArray(body.waypoints)) throw new Error('ROUTE_RESPONSE_INVALID')
      return { fromId: query.from.id, toId: query.to.id, mode: 'driving', distanceMeters: route.distance, durationSeconds: route.duration,
        geometry: route.geometry.coordinates.map((pair: unknown) => pairPoint(pair)),
        waypoints: body.waypoints.map((waypoint: Record<string, unknown>) => ({ coordinate: pairPoint(waypoint.location), snapDistanceMeters: waypoint.distance as number, name: typeof waypoint.name === 'string' ? waypoint.name : '' })),
        traffic: 'not-included', source: { label: 'OSRM driving routing / OpenStreetMap road network', locator: url, observedAt: receipt.retrievedAt,
          methodology: 'OSRM public service: modelled road-network driving distance and duration; no live traffic, access permissions or current closures verified' }, receipts: [receipt] }
    },
  }
}

function pairPoint(pair: unknown): Wgs84Point {
  if (!Array.isArray(pair) || pair.length < 2 || typeof pair[0] !== 'number' || typeof pair[1] !== 'number') throw new Error('ROUTE_COORDINATE_INVALID')
  return { longitude: pair[0], latitude: pair[1] }
}
