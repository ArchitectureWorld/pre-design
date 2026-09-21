import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { geodesicDistanceMeters, toWgs84 } from './geometry.ts'
import { downloadMapSource } from './providers.ts'
import type { AnalysisGap, AnalysisLocation, AnalysisReceipt, PlanningGeocodeCandidate, PlanningLocationEvidence, PlanningLocationResolution, PlanningLocationResolverDependencies, PlanningLocationSourceFact, ResolvePlanningLocationInput } from './types.ts'

const digest = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex')
const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s,，。·._()（）-]/g, '')
const validEvidence = (evidence: PlanningLocationEvidence) => Boolean(evidence && evidence.text?.trim() && evidence.source?.label?.trim() && evidence.source?.locator?.trim()
  && (!evidence.source.sha256 || /^[a-f0-9]{64}$/i.test(evidence.source.sha256))
  && (evidence.contextTerms ?? []).every(term => term.trim().length > 0 && normalized(evidence.text).includes(normalized(term))))

/** Consume the upstream source map's explicit fact roles; generated tasks/scenes are excluded. */
export function planningLocationEvidenceFromSources(facts: readonly PlanningLocationSourceFact[]): PlanningLocationEvidence[] {
  return facts.filter(fact => fact.role === 'project-location').map(({ role: _role, ...evidence }) => evidence)
}

let nextGeocodeAt = 0
let geocodeQueue: Promise<unknown> = Promise.resolve()

async function publicGeocode(query: string, dependencies: PlanningLocationResolverDependencies, signal?: AbortSignal) {
  // Nominatim's public service requires <= 1 request/second. Serialize across projects.
  const work = geocodeQueue.catch(() => {}).then(async () => {
    const pause = Math.max(0, nextGeocodeAt - Date.now())
    if (pause) await new Promise(resolve => setTimeout(resolve, pause))
    signal?.throwIfAborted()
    nextGeocodeAt = Date.now() + 1100
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=5&addressdetails=1`
    const receipt = await downloadMapSource(url, 'application/json', 2 * 1024 * 1024, dependencies, signal)
    const response: unknown = JSON.parse(Buffer.from(receipt.bytes).toString('utf8'))
    if (!Array.isArray(response)) throw new Error('GEOCODE_RESPONSE_INVALID')
    const candidates: PlanningGeocodeCandidate[] = []
    for (const item of response) {
      if (!item || typeof item !== 'object' || !['node', 'way', 'relation'].includes(item.osm_type) || !Number.isSafeInteger(item.osm_id)
        || typeof item.name !== 'string' || typeof item.display_name !== 'string'
        || ![item.lon, item.lat].every(value => (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)) || (typeof value === 'number' && Number.isFinite(value)))) continue
      const coordinate = { longitude: Number(item.lon), latitude: Number(item.lat), crs: 'EPSG:4326' as const }
      try { toWgs84(coordinate) } catch { continue }
      candidates.push({ id: `osm-${item.osm_type}-${item.osm_id}`, name: item.name, displayName: item.display_name, coordinate,
        source: { label: 'OpenStreetMap / Nominatim geographic record', locator: `https://www.openstreetmap.org/${item.osm_type}/${item.osm_id}`, observedAt: receipt.retrievedAt,
          methodology: 'Public mapped feature representative point; name and administrative context checked against project source; not a site entrance or legal boundary' } })
    }
    return { candidates, receipts: [receipt] }
  })
  geocodeQueue = work
  return work
}

export async function resolvePlanningLocation(input: ResolvePlanningLocationInput, dependencies: PlanningLocationResolverDependencies = {}): Promise<PlanningLocationResolution> {
  const gaps: AnalysisGap[] = [], candidates: PlanningGeocodeCandidate[] = [], receipts: AnalysisReceipt[] = []
  const evidence = input.evidence.filter(validEvidence)
  let location: AnalysisLocation | undefined
  let status: PlanningLocationResolution['status'] = 'missing'
  if (!input.projectName?.trim() || evidence.length !== input.evidence.length || !evidence.length) {
    gaps.push({ code: 'LOCATION_EVIDENCE_MISSING', message: '缺少来源位置事实，或检索语境不在资料原文中', blocking: true })
  } else {
    const explicit = evidence.filter(item => item.coordinate)
    if (explicit.length) {
      try {
        const positions = explicit.map(item => toWgs84(item.coordinate!))
        if (positions.some(point => geodesicDistanceMeters(point, positions[0]) > 100)) {
          status = 'ambiguous'
          gaps.push({ code: 'LOCATION_COORDINATES_CONFLICT', message: '不同来源坐标存在空间冲突，未自动挑选', blocking: true })
        } else {
          location = { id: `source-location-${digest(JSON.stringify(explicit[0])).slice(0, 16)}`, label: explicit[0].placeName ?? input.projectName,
            coordinate: explicit[0].coordinate!, source: explicit[0].source }
          status = 'resolved'
        }
      } catch { gaps.push({ code: 'LOCATION_CRS_UNSUPPORTED', message: '资料坐标无效或尚未可靠转换到 WGS84', blocking: true }) }
    } else {
      const contexts = evidence.map(item => ({ item, name: item.placeName ?? input.projectName, terms: item.contextTerms ?? [] }))
      if (contexts.some(context => !context.terms.length || (context.item.placeName && !normalized(context.item.text).includes(normalized(context.name))))) {
        gaps.push({ code: 'LOCATION_CONTEXT_MISSING', message: '文字位置检索需要资料中的地名及明确行政语境，以防同名误配', blocking: true })
      } else {
        const queries = [...new Set(contexts.map(({ name, terms }) => `${name} ${terms.join(' ')}`))].slice(0, 3)
        for (const query of queries) {
          try {
            const result = await (dependencies.geocode ? dependencies.geocode(query, input.signal) : publicGeocode(query, dependencies, input.signal))
            if (!result.receipts.length) throw new Error('GEOCODE_RECEIPT_MISSING')
            receipts.push(...result.receipts)
            for (const candidate of result.candidates) {
              try { toWgs84(candidate.coordinate) } catch { continue }
              if (!candidate.source?.label || !candidate.source?.locator || !candidate.id || !candidate.name || !candidate.displayName) continue
              if (!candidates.some(item => item.id === candidate.id)) candidates.push(candidate)
            }
          } catch (error) {
            if (input.signal?.aborted) throw error
            gaps.push({ code: 'GEOCODER_UNAVAILABLE', message: '公开地理检索未取得有效数据', blocking: true })
          }
        }
        const matches = candidates.filter(candidate => contexts.every(({ name, terms }) => normalized(candidate.name) === normalized(name)
          && terms.every(term => normalized(candidate.displayName).includes(normalized(term)))))
        if (matches.length === 1 && !gaps.length) {
          const candidate = matches[0]
          location = { id: candidate.id, label: candidate.name, coordinate: candidate.coordinate, source: candidate.source }
          status = 'resolved'
        } else if (matches.length > 1) {
          status = 'ambiguous'
          gaps.push({ code: 'LOCATION_AMBIGUOUS', message: '检索到多个名称与资料语境匹配的地点，未按排序猜测', blocking: true })
        } else if (!gaps.length) gaps.push({ code: 'LOCATION_NOT_CORROBORATED', message: '检索结果与资料地名或行政语境不一致', blocking: true })
      }
    }
  }
  const receiptPaths: string[] = []
  const result: PlanningLocationResolution = { status, ...(location ? { location } : {}), candidates, evidence, gaps, receiptPaths }
  if (input.outputDirectory) {
    if (!isAbsolute(input.outputDirectory)) throw new Error('LOCATION_OUTPUT_PATH_MUST_BE_ABSOLUTE')
    await mkdir(input.outputDirectory, { recursive: true })
    const directory = await mkdtemp(join(input.outputDirectory, 'location-'))
    const archivedReceipts = []
    for (const [index, receipt] of receipts.entries()) {
      const sha256 = digest(receipt.bytes), path = join(directory, `${index}-${sha256}.json`)
      await writeFile(path, receipt.bytes, { flag: 'wx' }); receiptPaths.push(path)
      archivedReceipts.push({ url: receipt.url, retrievedAt: receipt.retrievedAt, sha256, path, mediaType: receipt.mediaType })
    }
    const manifestPath = join(directory, 'location.evidence.json')
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 'pre-design.planning-location.v1', ...result, receipts: archivedReceipts }, null, 2), { flag: 'wx' })
    return { ...result, manifestPath }
  }
  return result
}
