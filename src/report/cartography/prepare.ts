import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import sharp from 'sharp'
import type { ClientCartography, ClientSiteAnalysisKind } from '../client-types.ts'
import { fitViewport, geodesicDistanceMeters, geodesicRing, scaleBar, toWgs84 } from './geometry.ts'
import { createPublicMapProviders } from './providers.ts'
import { renderAnalysisHtml, renderAnalysisSvg } from './render.ts'
import type { AnalysisBoundary, AnalysisEvidence, AnalysisGap, AnalysisLocation, AnalysisNode, AnalysisReceipt, AnalysisRoute, AnalysisSource, PlanningAnalysisDependencies, PlanningAnalysisInput, PlanningAnalysisResult, Wgs84Point } from './types.ts'

const digest = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex')
const hasText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const validSource = (source: AnalysisSource): boolean => Boolean(source && hasText(source.label) && hasText(source.locator)
  && (!source.sha256 || /^[a-f0-9]{64}$/i.test(source.sha256))
  && !/[?&](?:key|token|secret|authorization|access_token)=/i.test(source.locator))

interface NormalizedLocation extends AnalysisLocation { readonly role?: AnalysisNode['role']; readonly comparisonBasis?: AnalysisSource; readonly wgs84: Wgs84Point }
interface NormalizedBoundary { readonly status: AnalysisBoundary['status']; readonly coordinates: readonly Wgs84Point[]; readonly source: AnalysisSource }

/** Read-only source acquisition; all outputs go to a new, immutable run directory. */
export async function preparePlanningAnalysis(input: PlanningAnalysisInput, dependencies: PlanningAnalysisDependencies = {}): Promise<PlanningAnalysisResult> {
  const gaps: AnalysisGap[] = [], evidence: AnalysisEvidence[] = []
  const gap = (code: string, message: string, blocking = false, subjectId?: string) => gaps.push({ code, message, blocking, ...(subjectId ? { subjectId } : {}) })
  if (![input.projectId, input.pageId, input.title].every(hasText) || !isAbsolute(input.outputDirectory)
    || !['regional-context', 'accessibility', 'audience-catchment', 'competitor-distribution', 'site-analysis'].includes(input.kind)) {
    gap('ANALYSIS_INPUT_INVALID', '缺少项目 / 页面身份或绝对成果路径', true)
    return { status: 'blocked', assets: [], evidence, gaps }
  }
  const location = normalizeLocation(input.location, true, gap)
  if (!location) return { status: 'blocked', assets: [], evidence, gaps }
  const locations: NormalizedLocation[] = [location], seen = new Set([location.id])
  for (const node of input.nodes ?? []) {
    const normalized = normalizeLocation(node, false, gap)
    if (!normalized) continue
    if (seen.has(node.id)) { gap('NODE_ID_DUPLICATE', '地点身份重复', false, node.id); continue }
    if (node.role === 'competitor' && !validSource(node.comparisonBasis!)) { gap('COMPETITOR_BASIS_MISSING', `${node.label}缺少竞品判定依据`, false, node.id); continue }
    seen.add(node.id); locations.push(normalized)
  }
  if (locations.length > 16) { gap('NODE_COUNT_EXCEEDED', '单张地图最多支持 16 个可核验地点，请分图', true); return { status: 'blocked', assets: [], evidence, gaps } }
  for (const [index, item] of locations.entries()) evidence.push({ evidenceId: `map-location-${digest(`${input.projectId}:${item.id}:${JSON.stringify(item)}`).slice(0, 20)}`,
    kind: index === 0 ? 'location' : 'node', statement: `${item.label}：WGS84 ${item.wgs84.longitude.toFixed(7)}, ${item.wgs84.latitude.toFixed(7)}；地域代表点，不代表开发边界`, source: item.source })
  const boundary = normalizeBoundary(input.boundary, gap)
  if ((input.radiusKm?.length ?? 0) > 6) gap('DISTANCE_RADIUS_COUNT_EXCEEDED', '每图最多六个直线半径圈，其余范围需要分图')
  const rings = (input.radiusKm ?? []).filter(kilometers => {
    if (!Number.isFinite(kilometers) || kilometers <= 0 || kilometers > 1000) { gap('DISTANCE_RADIUS_INVALID', '直线圈半径须为 0–1000 km 范围内的正数'); return false }
    return true
  }).slice(0, 6).map(kilometers => ({ kilometers, basis: 'geodesic-straight-line' as const, coordinates: geodesicRing(location.wgs84, kilometers * 1000) }))
  const publicProviders = createPublicMapProviders(dependencies), routeProvider = dependencies.route ?? publicProviders.route
  const routes: AnalysisRoute[] = []
  if ((input.routeRequests?.length ?? 0) > 6) gap('ROUTE_COUNT_EXCEEDED', '每图最多支持六条驾车路线；其余路线须分图')
  for (const query of input.routeRequests?.slice(0, 6) ?? []) {
    const from = locations.find(item => item.id === query.fromId), to = locations.find(item => item.id === query.toId)
    if (!from || !to || from.id === to.id) { gap('ROUTE_ENDPOINT_MISSING', '驾车路线缺少有效起终点', false, `${query.fromId}:${query.toId}`); continue }
    try {
      const route = await routeProvider({ from, to }, input.signal)
      validateRoute(route, from, to, input.maximumRouteSnapMeters ?? 1000)
      routes.push(route)
    } catch (error) {
      if (input.signal?.aborted) throw error
      gap('DRIVING_ROUTE_UNAVAILABLE', `${from.label}至${to.label}未取得有效驾车路线（${safeError(error)}）`, false, `${from.id}:${to.id}`)
    }
  }
  if (input.kind === 'accessibility' && !routes.length) gap('DRIVING_ROUTE_MISSING', '缺少可追溯驾车路线与时间')
  if (input.kind === 'audience-catchment') gap('AUDIENCE_EVIDENCE_MISSING', '地点与距离不能证明实际客源量或到访范围，需客源 / 人口 / 调研证据')
  if (input.kind === 'competitor-distribution' && !locations.some(item => item.role === 'competitor')) gap('COMPETITORS_MISSING', '缺少经来源核验并说明比较依据的竞品地点')
  if (input.kind === 'site-analysis' && !boundary) gap('SITE_BOUNDARY_MISSING', '场地分析缺少核验边界，仅可展示地域背景')
  const straightDistances = locations.slice(1).map(item => ({ fromId: location.id, toId: item.id, distanceMeters: geodesicDistanceMeters(location.wgs84, item.wgs84), basis: 'geodesic-straight-line' as const }))
  for (const measurement of straightDistances) evidence.push({ evidenceId: `map-distance-${digest(`${input.projectId}:${JSON.stringify(measurement)}`).slice(0, 20)}`,
    kind: 'distance', statement: `${location.label}至${locations.find(item => item.id === measurement.toId)!.label}：地表直线 ${(measurement.distanceMeters / 1000).toFixed(2)} km；不是道路里程或驾车时间`,
    source: { label: 'Geodesic calculation from sourced WGS84 points', locator: 'https://www.movable-type.co.uk/scripts/latlong.html', methodology: 'Haversine great-circle distance, mean Earth radius 6371008.8 m; coordinate uncertainty retained' } })
  let viewport
  try {
    const minimumExtentKm = input.minimumExtentKm ?? 3
    if (!Number.isFinite(minimumExtentKm) || minimumExtentKm <= 0 || minimumExtentKm > 1000) throw new Error('MAP_EXTENT_INVALID')
    viewport = fitViewport([...locations.map(item => item.wgs84), ...routes.flatMap(route => route.geometry), ...rings.flatMap(ring => ring.coordinates),
      ...(boundary?.coordinates ?? []), ...geodesicRing(location.wgs84, minimumExtentKm * 500)])
  } catch (error) { gap('MAP_EXTENT_INVALID', `地图范围无法可靠绘制（${safeError(error)}）`, true); return { status: 'blocked', assets: [], evidence, gaps } }
  let basemap
  try {
    basemap = await (dependencies.basemap ?? publicProviders.basemap)(viewport, input.signal)
    const dimensions = await sharp(basemap.png).metadata()
    if (basemap.crs !== 'EPSG:3857' || basemap.width !== viewport.width || basemap.height !== viewport.height || dimensions.width !== viewport.width || dimensions.height !== viewport.height
      || !hasText(basemap.attribution) || !validSource(basemap.source) || !basemap.receipts.length) throw new Error('BASEMAP_METADATA_INVALID')
    basemap.receipts.forEach(validateReceipt)
  } catch (error) {
    if (input.signal?.aborted) throw error
    gap('BASEMAP_UNAVAILABLE', `真实底图不可用（${safeError(error)}）`, true)
    return { status: 'blocked', assets: [], evidence, gaps }
  }
  const supported = new Set(['basemap', 'location', ...(locations.length > 1 ? ['nodes', 'straight-distance'] : []), 'roads',
    ...(routes.length ? ['driving-route', 'driving-time'] : []), ...(boundary ? ['boundary'] : []), ...(locations.some(item => item.role === 'competitor') ? ['competitors'] : [])])
  for (const requirement of input.requiredEvidence ?? []) if (!supported.has(requirement)) gap('REQUIRED_EVIDENCE_MISSING', `缺少要求的证据：${requirement}`)
  const disclosures = ['项目点仅代表地域位置，非开发红线；公开底图不是测绘成果', '距离为地表直线计算；半径圈不是驾车等时圈',
    ...(routes.length ? ['驾车时间为道路网络模型估计，不含实时路况；道路通行和项目入口仍须核验'] : []),
    ...(boundary?.status === 'research' ? ['研究范围（待核）；非法定红线；非测绘成果'] : [])]
  const scale = scaleBar(viewport), cartography: ClientCartography = { boundary: boundary?.status ?? 'not-applicable', legend: 'present', northArrow: 'present', scale: { kind: 'scale-bar', label: scale.label }, disclosures }
  await mkdir(input.outputDirectory, { recursive: true })
  const identity = digest(`${input.projectId}:${input.pageId}:${input.kind}`).slice(0, 16)
  const directory = await mkdtemp(join(input.outputDirectory, `map-${identity}-`))
  const receipts: { url: string; retrievedAt: string; mediaType: string; path: string; sha256: string; sizeBytes: number }[] = []
  const allReceipts = [...basemap.receipts, ...routes.flatMap(route => route.receipts)]
  const hashes = new Set<string>()
  for (const receipt of allReceipts) {
    const sha256 = digest(receipt.bytes), extension = receipt.mediaType === 'image/png' ? 'png' : 'json'
    const path = join(directory, `source-${sha256}.${extension}`)
    if (!hashes.has(sha256)) { await writeFile(path, receipt.bytes, { flag: 'wx' }); hashes.add(sha256) }
    receipts.push({ url: receipt.url, retrievedAt: receipt.retrievedAt, mediaType: receipt.mediaType, path, sha256, sizeBytes: receipt.bytes.byteLength })
  }
  const createdAt = (dependencies.now ?? (() => new Date()))().toISOString()
  evidence.push({ evidenceId: `map-basemap-${identity}`, kind: 'basemap', statement: `真实公开底图；显示投影 EPSG:3857；缩放级别 ${viewport.zoom}；${basemap.attribution}`, source: basemap.source,
    rawPath: receipts[0].path, sha256: receipts[0].sha256 })
  routes.forEach((route, index) => { const receipt = receipts.find(item => item.url === route.receipts[0].url)!; evidence.push({ evidenceId: `map-route-${identity}-${index + 1}`, kind: 'route',
    statement: `${locations.find(item => item.id === route.fromId)!.label}至${locations.find(item => item.id === route.toId)!.label}：道路驾车 ${(route.distanceMeters / 1000).toFixed(2)} km，模型估计 ${(route.durationSeconds / 60).toFixed(1)} 分钟；无实时路况`, source: route.source,
    rawPath: receipt.path, sha256: receipt.sha256 }) })
  if (boundary) evidence.push({ evidenceId: `map-boundary-${identity}`, kind: 'boundary', statement: '研究范围（待核）；非法定红线；非测绘成果', source: boundary.source })
  const renderInput = { request: input, viewport, basemap, locations, routes, rings, boundary, straightDistances, disclosures, gaps }
  const svg = renderAnalysisSvg(renderInput)
  const svgPath = join(directory, 'analysis.svg'), sourcePath = join(directory, 'analysis.png'), metadataPath = join(directory, 'analysis.evidence.json')
  const attributionHtmlPath = join(directory, 'analysis.html')
  const png = await sharp(Buffer.from(svg)).png().toBuffer(), sha256 = digest(png)
  await writeFile(svgPath, svg, { flag: 'wx' }); await writeFile(sourcePath, png, { flag: 'wx' })
  await writeFile(attributionHtmlPath, renderAnalysisHtml(renderInput, png), { flag: 'wx' })
  const status = gaps.length ? 'partial' : 'ready'
  const metadata = { schemaVersion: 'pre-design.planning-cartography.v1', projectId: input.projectId, pageId: input.pageId, kind: input.kind, title: input.title, createdAt, status,
    coordinateSystem: { input: input.location!.coordinate.crs, geographic: 'EPSG:4326', display: 'EPSG:3857' }, viewport, scale,
    locations, boundary, distanceRings: rings, straightDistances, routes: routes.map(({ receipts: _receipts, ...route }) => route),
    receipts, evidence, disclosures, gaps, cartography, sourcePath, svgPath, attributionHtmlPath, attribution: basemap.attribution, sha256 }
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), { flag: 'wx' })
  const analysisKind: ClientSiteAnalysisKind = input.kind === 'accessibility' || input.kind === 'audience-catchment' ? 'accessibility' : input.kind === 'site-analysis' ? 'existing-condition' : 'regional-context'
  return { status, evidence, gaps, manifestPath: metadataPath, assets: [{ sha256, width: 1800, height: 1120, analysisKind, cartography, metadataPath,
    adoptedAsset: { sourceKey: `planning-map-${identity}-${sha256.slice(0, 16)}`, sourcePath, displayName: input.title, originalFileName: basename(sourcePath), mimeType: 'image/png', semanticRole: 'map',
      widthPx: 1800, heightPx: 1120, createdAt, adoptedAt: createdAt, origin: { type: 'generated_by_tool', sourceMaterialKeys: [], parentAssetKeys: [],
        method: 'Deterministic geographic rendering of sourced coordinates, real basemap and independently measured routes; evidence manifest: ' + metadataPath,
        sourceTool: { name: 'planning-cartography', version: '1.0.0' } }, objectIds: input.chapterId ? [input.chapterId] : [], evidenceIds: evidence.map(item => item.evidenceId),
      pageBindingOnly: true, pageBindings: [{ findingId: input.pageId, role: 'primary' }], role: 'primary' } }] }
}

function normalizeLocation(location: AnalysisLocation | undefined, primary: boolean, gap: (code: string, message: string, blocking?: boolean, subjectId?: string) => void): NormalizedLocation | undefined {
  if (!location || !hasText(location.id) || !hasText(location.label) || !validSource(location.source)) {
    gap(primary ? 'LOCATION_SOURCE_MISSING' : 'NODE_SOURCE_MISSING', primary ? '缺少有来源的项目坐标' : '地点缺少名称、身份或来源', primary, location?.id); return
  }
  try { return { ...location, wgs84: toWgs84(location.coordinate) } }
  catch (error) { gap(safeError(error), '坐标无效或坐标系尚未可靠转换为 WGS84', primary, location.id); return }
}

function normalizeBoundary(boundary: AnalysisBoundary | undefined, gap: (code: string, message: string) => void): NormalizedBoundary | undefined {
  if (!boundary) return
  // Confirmation is governed by the project boundary service. This standalone acquisition
  // module cannot grant it from user/model-supplied labels or matching hash strings.
  if (boundary.status === 'confirmed') { gap('BOUNDARY_CONFIRMATION_UNAVAILABLE', '本模块不能核验法定边界确认记录；需由项目边界服务提供正式图'); return }
  try {
    if (boundary.status !== 'research' || !validSource(boundary.source) || boundary.coordinates.length < 4) throw new Error('BOUNDARY_INVALID')
    const coordinates = boundary.coordinates.map(toWgs84)
    if (geodesicDistanceMeters(coordinates[0], coordinates[coordinates.length - 1]) > 0.01) throw new Error('BOUNDARY_NOT_CLOSED')
    const signedArea = coordinates.slice(1).reduce((sum, point, index) => sum + coordinates[index].longitude * point.latitude - point.longitude * coordinates[index].latitude, 0)
    if (new Set(coordinates.map(point => `${point.longitude}:${point.latitude}`)).size < 3 || Math.abs(signedArea) < 1e-12) throw new Error('BOUNDARY_INVALID')
    return { status: 'research', coordinates, source: boundary.source }
  } catch { gap('BOUNDARY_INVALID', '边界缺少有效来源或闭合坐标'); return }
}

function validateReceipt(receipt: AnalysisReceipt): void {
  if (!receipt || !hasText(receipt.url) || !/^https:\/\//.test(receipt.url) || !Number.isFinite(Date.parse(receipt.retrievedAt)) || !receipt.bytes?.byteLength) throw new Error('MAP_RECEIPT_INVALID')
}

function validateRoute(route: AnalysisRoute, from: NormalizedLocation, to: NormalizedLocation, maxSnap: number): void {
  if (!route || route.fromId !== from.id || route.toId !== to.id || route.mode !== 'driving' || route.traffic !== 'not-included' || !validSource(route.source)
    || !Number.isFinite(route.distanceMeters) || !Number.isFinite(route.durationSeconds) || route.distanceMeters <= 0 || route.durationSeconds <= 0
    || route.distanceMeters / route.durationSeconds > 70 || !Array.isArray(route.geometry) || route.geometry.length < 2 || route.geometry.length > 100000
    || route.waypoints?.length !== 2 || !route.receipts?.length || !Number.isFinite(maxSnap) || maxSnap < 0 || maxSnap > 5000) throw new Error('ROUTE_RESPONSE_INVALID')
  route.receipts.forEach(validateReceipt)
  route.geometry.forEach(point => toWgs84({ ...point, crs: 'EPSG:4326' }))
  const endpoints = [from.wgs84, to.wgs84]
  route.waypoints.forEach((waypoint, index) => {
    toWgs84({ ...waypoint.coordinate, crs: 'EPSG:4326' })
    if (!Number.isFinite(waypoint.snapDistanceMeters) || waypoint.snapDistanceMeters < 0 || waypoint.snapDistanceMeters > maxSnap
      || geodesicDistanceMeters(endpoints[index], waypoint.coordinate) > maxSnap + 10
      || Math.abs(geodesicDistanceMeters(endpoints[index], waypoint.coordinate) - waypoint.snapDistanceMeters) > 25
      || geodesicDistanceMeters(route.geometry[index === 0 ? 0 : route.geometry.length - 1], waypoint.coordinate) > 100) throw new Error('ROUTE_SNAP_INVALID')
  })
  if (route.distanceMeters < geodesicDistanceMeters(route.waypoints[0].coordinate, route.waypoints[1].coordinate) * 0.9) throw new Error('ROUTE_DISTANCE_INVALID')
  const polylineLength = route.geometry.slice(1).reduce((sum, point, index) => sum + geodesicDistanceMeters(route.geometry[index], point), 0)
  if (route.distanceMeters < polylineLength * 0.9) throw new Error('ROUTE_GEOMETRY_DISTANCE_CONFLICT')
}

function safeError(error: unknown): string {
  return error instanceof Error && /^[A-Z_0-9]+$/.test(error.message) ? error.message : 'SOURCE_REQUEST_FAILED'
}
