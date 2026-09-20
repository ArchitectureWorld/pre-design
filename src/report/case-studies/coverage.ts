import { MAX_ORIGINAL_IMAGE_USES } from '../../visual/image-policy.ts'
import type { CaseStudyImage, CaseStudyRouteMode, CaseStudySourceGap, CaseStudySpatialScale, VerifiedCaseStudy } from './types.ts'

const scales = ['area', 'line', 'point'] as const
const routeModes: readonly CaseStudyRouteMode[] = ['arrival', 'visitor', 'vehicle', 'service']
const sourceSignals: Readonly<Record<CaseStudyRouteMode, RegExp>> = {
  arrival: /抵达|到达|下车|入口|出入口|entry|entrance|arrival|between|连接|連結/i,
  visitor: /游客|遊客|走道|走廊|步行|回路|路径|路徑|樓梯|楼梯|自行車|自行车|cycl|pedestrian|walk|bikeway/i,
  vehicle: /机动车|機動車|车辆|車輛|停车|停車|巴士|公交|下车|下車|车行|車行|motor|parking|bus|vehicl/i,
  service: /办公|辦公|工作人|后勤|後勤|货运|貨運|服务通道|服務通道|staff|office|service access/i,
}
const fail = (code: string, message: string): never => { throw new Error(`${code}: ${message}`) }
const validIds = (ids: readonly string[] | undefined, known: ReadonlySet<string>) => Array.isArray(ids)
  && ids.length > 0 && new Set(ids).size === ids.length && ids.every(id => known.has(id))

/** Acquisition-facing gaps are independent of the client prose and do not silently certify historical records. */
export function caseStudySourceGaps(row: VerifiedCaseStudy): CaseStudySourceGap[] {
  const gaps: CaseStudySourceGap[] = [...(row.spatial?.sourceGaps ?? [])]
  const evidenceIds = new Set(row.evidence?.map(item => item.evidenceId) ?? [])
  for (const scale of scales) {
    const layer = row.spatial?.[scale]
    if (!layer || !validIds(layer.evidenceIds, evidenceIds) || !Array.isArray(layer.imageIds) || !layer.imageIds.length) {
      gaps.push({ scale, blocking: true, reason: `${scale} 缺少可追溯的整体、流线或节点资料；补充来源或改选案例。` })
    }
  }
  if (row.spatial && (!row.spatial.line?.routes?.length || !row.spatial.line.routes.some(route => route.mode === 'visitor'))) {
    gaps.push({ scale: 'line', mode: 'visitor', blocking: true, reason: '游客通行关系缺少来源；补充来源或改选案例。' })
  }
  return gaps
}

/** Family links are transitive: a crop and its differently encoded parent still share one allowance. */
export function validateCaseStudyImageUses(images: readonly CaseStudyImage[], label: string): void {
  const parents = new Map<string, string>()
  const root = (key: string): string => { const parent = parents.get(key); if (!parent) { parents.set(key, key); return key }; return parent === key ? key : root(parent) }
  const join = (a: string, b: string) => { const x = root(a), y = root(b); if (x !== y) parents.set(y, x) }
  for (const image of images) {
    const key = `sha:${image.sha256}`, identity = image.imageIdentity
    root(key)
    if (identity) {
      if (!identity.originalId?.trim() || identity.fileSha256 !== image.sha256) fail('CASE_STUDY_GALLERY_REUSE', `${label} has an inconsistent original identity`)
      join(key, `original:${identity.originalId}`)
      if (identity.pixelFingerprint) join(key, `pixels:${identity.pixelFingerprint}`)
      if (identity.derivedFromSha256) join(key, `sha:${identity.derivedFromSha256}`)
    }
  }
  const counts = new Map<string, number>()
  for (const image of images) { const key = root(`sha:${image.sha256}`); counts.set(key, (counts.get(key) ?? 0) + 1) }
  if ([...counts.values()].some(count => count > MAX_ORIGINAL_IMAGE_USES)) fail('CASE_STUDY_GALLERY_REUSE', `${label} exceeds ${MAX_ORIGINAL_IMAGE_USES} appearances of an original image`)
}

export function validateCaseStudySpatialCoverage(row: VerifiedCaseStudy): void {
  const missing = caseStudySourceGaps(row).filter(gap => gap.blocking)
  if (missing.length) fail('CASE_STUDY_COVERAGE', `${row.caseId}: ${missing.map(gap => gap.reason).join(' ')}`)
  const spatial = row.spatial!
  const evidence = new Map(row.evidence.map(item => [item.evidenceId, item]))
  const known = new Set(evidence.keys())
  const refs = (ids: readonly string[], code: string): string => {
    if (!validIds(ids, known)) fail(code, `${row.caseId} has unsupported spatial evidence`)
    return ids.map(id => evidence.get(id)!.excerpt).join('\n')
  }
  if (!spatial.scope || !['building-site', 'landscape-route', 'district'].includes(spatial.scope.kind)
      || !spatial.scope.statement?.trim() || !spatial.scope.measurements?.length) fail('CASE_STUDY_SCALE', `${row.caseId} needs a documented true project extent`)
  const scopeText = refs(spatial.scope.evidenceIds, 'CASE_STUDY_SCALE')
  for (const measurement of spatial.scope.measurements) {
    const text = refs(measurement.evidenceIds, 'CASE_STUDY_SCALE').replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '')
    const units = { m2: /㎡|平方米|m[²2]|square\s*met(?:er|re)s?/, ha: /公顷|公頃|hectares?|\bha\b/,
      m: /米|公尺|met(?:er|re)s?|\bm\b/, km: /公里|千米|公裏|\bkm\b|kilomet(?:er|re)s?/ }
    const quantity = new RegExp(`(?<![\\d.])${String(measurement.value).replace('.', '\\.')}\\s*-?\\s*(?:${units[measurement.unit]?.source ?? '(?!)'})`, 'i')
    if (!measurement.label?.trim() || !Number.isFinite(measurement.value) || measurement.value <= 0
        || !(measurement.unit in units) || !quantity.test(text)) {
      fail('CASE_STUDY_SCALE', `${row.caseId} includes a quantity or unit absent from its project record`)
    }
  }
  if (spatial.scope.kind === 'district' && !/片区|片區|园区|園區|总体规划|總體規劃|master\s*plan|district|park/i.test(scopeText)) {
    fail('CASE_STUDY_SCALE', `${row.caseId} cannot promote a small building to a district`)
  }
  const purposes: Readonly<Record<CaseStudySpatialScale, readonly string[]>> = {
    area: ['area-overview', 'area-circulation'], line: ['circulation', 'area-circulation'], point: ['representative-point'],
  }
  for (const scale of scales) {
    const layer = spatial[scale]
    refs(layer.evidenceIds, 'CASE_STUDY_COVERAGE')
    if (new Set(layer.imageIds).size !== layer.imageIds.length) fail('CASE_STUDY_GALLERY_REUSE', `${row.caseId}/${scale} repeats media on one page`)
    for (const imageId of layer.imageIds) {
      const image = row.gallery?.find(image => image.imageId === imageId)
      const section = row.analysis?.find(section => section.focus === imageId)
      if (!image || !purposes[scale].includes(image.mediaPurpose ?? '') || !section?.scales?.includes(scale)
          || image.analysisScale !== (image.mediaPurpose === 'area-circulation' ? 'area' : scale)
          || !image.evidenceIds.some(id => layer.evidenceIds.includes(id))) fail('CASE_STUDY_COVERAGE', `${row.caseId}/${scale} needs source media for the actual analytical scale; 补充来源或改选案例。`)
      const kind = image!.imageQuality?.contentKind
      if (scale === 'line' && !['plan', 'map', 'diagram'].includes(kind ?? '')
          || scale === 'area' && !['photo', 'plan', 'map'].includes(kind ?? '')
          || scale === 'point' && kind !== 'photo') fail('CASE_STUDY_COVERAGE', `${row.caseId}/${scale} uses the wrong source-media type; 补充来源。`)
    }
  }
  for (const route of spatial.line.routes) {
    const text = refs(route.evidenceIds, 'CASE_STUDY_ROUTE')
    if (!routeModes.includes(route.mode) || !route.claim?.trim() || !route.sourceQuote?.trim()
        || !route.evidenceIds.every(id => spatial.line.evidenceIds.includes(id))
        || !route.evidenceIds.some(id => evidence.get(id)!.excerpt.includes(route.sourceQuote))
        || !sourceSignals[route.mode].test(route.sourceQuote)) fail('CASE_STUDY_ROUTE', `${row.caseId} has a route claim without the corresponding source passage`)
    // A walking loop does not support bus/parking or staff circulation, even when its label says 'visitor'.
    for (const mode of ['vehicle', 'service'] as const) {
      if (sourceSignals[mode].test(route.claim) && !sourceSignals[mode].test(text)) fail('CASE_STUDY_ROUTE', `${row.caseId} has an unsupported ${mode} claim`)
    }
  }
  for (const gap of spatial.sourceGaps) {
    if (!scales.includes(gap.scale) || !gap.reason?.trim() || typeof gap.blocking !== 'boolean'
        || gap.mode !== undefined && !routeModes.includes(gap.mode)) fail('CASE_STUDY_COVERAGE', `${row.caseId} has an invalid source gap`)
  }
}
