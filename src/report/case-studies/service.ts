import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FrozenProjectInput } from '../types.ts'
import { makeSourceIndex, manuscriptSourceFingerprint } from '../manuscript/source.ts'
import type { PlanningManuscriptSource } from '../manuscript/types.ts'
import { VERIFIED_CASE_STUDIES } from './catalog.ts'
import { BUNDLED_CASE_STUDY_IMAGES } from './catalog-images.ts'
import { caseStudySourceGaps, validateCaseStudyImageUses, validateCaseStudySpatialCoverage } from './coverage.ts'
import { CASE_STUDIES_CATALOG_VERSION, CASE_STUDIES_SCHEMA_VERSION,
  type CaseStudyEvidence, type CaseStudyFeature, type CaseStudyFeatureId, type CaseStudyImage,
  type CaseStudySimilarity, type ReportCaseStudies, type SelectedCaseStudy, type VerifiedCaseStudy } from './types.ts'

const signals: Readonly<Record<CaseStudyFeatureId, RegExp>> = {
  'tea-landscape': /茶园|茶山|茶田|茶林|白茶基地/,
  'tea-experience': /品茶|品茗|品饮|茶饮|茶艺|茶事|茶室|采茶|茶咖|冲泡品鉴/,
  'slow-travel': /慢行|步道|步行|漫游|徒步|栈道|骑行/,
  waterfront: /水库|湖泊|湖岸|滨水|湖畔|库岸|湖滨|沿湖|亲水/,
  viewing: /观景|观湖|眺望|远眺|观茶|看水|赏景/,
  'adaptive-reuse': /存量建筑|既有建筑|闲置建筑|旧厂房|建筑活化|老建筑|管理房改造|房屋改造|旧房|存量空间/,
  'visitor-service': /集散|游客中心|游客服务|服务驿站|接待|候车|游客等候/,
}
const hex = /^[a-f0-9]{64}$/
const dimensions = new Set(['function', 'scene', 'environment', 'operation'])
const preferredObjects: Readonly<Record<CaseStudyFeatureId, readonly string[]>> = {
  'tea-landscape': ['BL03', 'BL02', 'PG04', 'SP05'], 'tea-experience': ['PG04', 'PG01', 'PG02'],
  'slow-travel': ['PG04', 'SP04', 'SP05'], waterfront: ['BL03', 'PS03', 'PS01'],
  viewing: ['PG01', 'SP05', 'PG04', 'BL05'], 'adaptive-reuse': ['BL02', 'BL04', 'PG04'],
  'visitor-service': ['PG04', 'PG02', 'SP04'],
}
const http = (value: string) => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password } catch { return false } }
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)])) : value
const digest = (value: unknown) => hash(JSON.stringify(stable(value)))
const withoutSourcePath = <T extends CaseStudyImage>(image: T): Omit<T, 'sourcePath'> => {
  const { sourcePath: _path, ...definition } = image
  return definition
}
const canonicalText = (value: string) => value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
const fail = (code: string, message: string): never => { throw new Error(`${code}: ${message}`) }

function uniqueStrings(values: readonly string[], code: string, label: string): void {
  if (!Array.isArray(values) || !values.length || values.some(value => typeof value !== 'string' || !value.trim())) fail(code, label)
  if (new Set(values).size !== values.length) fail(code, `${label} contains duplicates`)
}

function validateEvidence(evidence: CaseStudyEvidence): void {
  if (!evidence || !evidence.evidenceId || !http(evidence.sourceUrl) || !evidence.sourceTitle?.trim() || !evidence.publisher?.trim()
      || !Number.isFinite(Date.parse(evidence.capturedAt)) || !hex.test(evidence.contentHash)) fail('CASE_STUDY_EVIDENCE', 'source identity, access date and content hash are required')
  if (!evidence.excerpt?.trim() || evidence.excerptHash !== hash(evidence.excerpt)
      || evidence.locator?.kind !== 'exact-text' || evidence.locator.text !== evidence.excerpt) fail('CASE_STUDY_EVIDENCE', `invalid exact excerpt: ${evidence.evidenceId}`)
}

/** These structural checks supplement, rather than substitute for, the catalog's live source verification. */
export function validateCatalogCase(row: VerifiedCaseStudy): void {
  if (!row || !/^[a-z0-9-]+$/.test(row.caseId) || !row.name?.trim() || !row.location?.trim()) fail('CASE_STUDY_IDENTITY', 'case identity is required')
  if (!Array.isArray(row.evidence) || !row.evidence.length) fail('CASE_STUDY_EVIDENCE', row.caseId)
  row.evidence.forEach(validateEvidence)
  const evidence = new Map(row.evidence.map(item => [item.evidenceId, item]))
  if (evidence.size !== row.evidence.length) fail('CASE_STUDY_EVIDENCE', `${row.caseId} has duplicate evidence ids`)
  const refs = (ids: readonly string[], label: string) => {
    uniqueStrings(ids, 'CASE_STUDY_EVIDENCE', label)
    if (ids.some(id => !evidence.has(id))) fail('CASE_STUDY_EVIDENCE', `${row.caseId}/${label} cites an unknown source`)
    return ids.map(id => evidence.get(id)!.excerpt).join('\n')
  }
  if (!row.delivery || !['completed', 'operating'].includes(row.delivery.status)) fail('CASE_STUDY_DELIVERY', `${row.caseId} is not completed or operating`)
  const deliveryText = refs(row.delivery.evidenceIds, 'delivery')
  if (row.delivery.proof === 'completion-record') {
    if (row.delivery.status !== 'completed' || !/(?:竣工时间|完成年份|Completion(?: Time| Year)?).{0,30}(?:19|20)\d{2}/i.test(deliveryText)) fail('CASE_STUDY_DELIVERY', `${row.caseId} lacks a dated completion record`)
  } else if (row.delivery.proof === 'current-opening-hours') {
    if (row.delivery.status !== 'operating' || !/open year-round|全年开放|全年開放|营业时间|營業時間/i.test(deliveryText)) fail('CASE_STUDY_DELIVERY', `${row.caseId} lacks documented operating hours`)
  } else fail('CASE_STUDY_DELIVERY', `${row.caseId} has no delivery proof`)
  if (!Array.isArray(row.features) || row.features.length < 2) fail('CASE_STUDY_FEATURE', `${row.caseId} needs distinct supported features`)
  if (new Set(row.features.map(feature => feature.id)).size !== row.features.length) fail('CASE_STUDY_FEATURE', `${row.caseId} repeats a feature`)
  if (new Set(row.features.map(feature => canonicalText(feature.fact))).size !== row.features.length) fail('CASE_STUDY_FEATURE', `${row.caseId} repeats the same fact`)
  for (const feature of row.features) {
    if (!(feature.id in signals) || !dimensions.has(feature.dimension) || !feature.fact?.trim() || !feature.label?.trim() || !feature.application?.trim()) fail('CASE_STUDY_FEATURE', row.caseId)
    refs(feature.evidenceIds, feature.id)
  }
  if (!row.summary?.trim() || !row.lesson?.trim() || !row.boundary?.fact?.trim() || !row.boundary.applicationLimit?.trim()) fail('CASE_STUDY_COPY', row.caseId)
  refs(row.boundary.evidenceIds, 'application boundary')
  const validateImage = (image: CaseStudyImage, code: string) => {
    if (!image || !http(image.sourceUrl) || !http(image.sourcePageUrl) || !hex.test(image.sha256)
        || !Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width < 1 || image.height < 1
        || !['image/jpeg', 'image/png'].includes(image.mimeType) || !image.credit?.trim() || !image.description?.trim()
        || !row.evidence.some(item => item.sourceUrl === image.sourcePageUrl)) fail(code, `${row.caseId} requires a photograph from its verified project source`)
    refs(image.locationEvidenceIds ?? [], 'source location')
    if (image.legendLocalization && (image.legendLocalization.sourceSha256 !== image.sha256
      || image.legendLocalization.width !== image.width || image.legendLocalization.height !== image.height))
      fail('CASE_STUDY_LEGEND_SOURCE', `${row.caseId} legend does not match its intact source`)
  }
  if (row.image) validateImage(row.image, 'CASE_STUDY_IMAGE')
  if (!Array.isArray(row.analysis) || row.analysis.length < 2 || row.analysis.length > 3
      || !row.analysis.some(section => section.focus === 'site') || !row.analysis.some(section => section.focus === 'experience')
      || new Set(row.analysis.map(section => section.focus)).size !== row.analysis.length) fail('CASE_STUDY_ANALYSIS', `${row.caseId} needs independent site and experience analysis`)
  for (const section of row.analysis!) {
    if (!['site', 'experience', 'organization'].includes(section.focus) || !section.title?.trim() || !section.claim?.trim()
        || !Array.isArray(section.body) || section.body.length < 2 || section.body.length > 3
        || section.body.some(paragraph => typeof paragraph !== 'string' || !paragraph.trim())) fail('CASE_STUDY_ANALYSIS', `${row.caseId} has incomplete analytical copy`)
    refs(section.evidenceIds, `${section.focus} analysis`)
  }
  if (new Set(row.analysis!.map(section => canonicalText(section.body.join('')))).size !== row.analysis!.length) fail('CASE_STUDY_ANALYSIS', `${row.caseId} repeats the same analysis`)
  const expectedImages = new Set([...row.analysis!.map(section => section.focus), 'application'])
  if (!Array.isArray(row.gallery) || row.gallery.length !== expectedImages.size
      || new Set(row.gallery.map(image => image.imageId)).size !== row.gallery.length) fail('CASE_STUDY_GALLERY', `${row.caseId} requires one source image for each analytical page`)
  for (const image of row.gallery!) {
    if (!expectedImages.has(image.imageId)) fail('CASE_STUDY_GALLERY', `${row.caseId} has an unknown photographic focus`)
    validateImage(image, 'CASE_STUDY_GALLERY')
    refs(image.evidenceIds, `${image.imageId} photograph`)
    const section = row.analysis!.find(section => section.focus === image.imageId)
    if (section && !image.evidenceIds.some(id => section.evidenceIds.includes(id))) fail('CASE_STUDY_GALLERY', `${row.caseId}/${image.imageId} does not support the corresponding analysis`)
  }
  validateCaseStudyImageUses(row.gallery!, row.caseId)
  const { imageId: _imageId, evidenceIds: _ids, ...siteImage } = row.gallery!.find(image => image.imageId === 'site')!
  if (!row.image || digest(withoutSourcePath(row.image)) !== digest(withoutSourcePath(siteImage))) fail('CASE_STUDY_GALLERY', `${row.caseId} must retain its site photograph as the compatible primary image`)
  validateCaseStudySpatialCoverage(row)
}

function projectSupport(feature: CaseStudyFeature, sources: readonly PlanningManuscriptSource[]): { sourceRef: string; excerpt: string } | undefined {
  const expression = signals[feature.id]
  const priority = (source: PlanningManuscriptSource) => {
    const at = preferredObjects[feature.id].indexOf(source.objectId)
    return at === -1 ? 100 : at
  }
  for (const source of [...sources].sort((a, b) => priority(a) - priority(b))) {
    if (/benchmark|caseStud|referenceCase|比较案例|对标案例|evidence_refs|non_goals|prohibition/i.test(source.fieldPath)) continue
    for (const sentence of source.text.split(/[。；;\n]+/)) {
      if (/^(?:规划依据|法律依据|法规依据|政策依据)[：:]/.test(sentence.trim())) continue
      const match = expression.exec(sentence)
      if (!match) continue
      const fullPrefix = sentence.slice(0, match.index)
      if (fullPrefix.lastIndexOf('《') > fullPrefix.lastIndexOf('》')) continue
      const before = sentence.slice(Math.max(0, match.index - 16), match.index)
      // A missing resource or an explicitly rejected product cannot qualify as a similarity.
      if (/(?:没有|不含|不设|不做|禁止|不宜|排除|缺少|缺乏|尚无|未有|无)(?:[^，,：:]{0,10})$/.test(before)) continue
      if (/是否|有无|尚待核实|暂无依据/.test(before)) continue
      const start = Math.max(0, match.index - 60)
      const excerpt = sentence.slice(start, Math.max(start + 160, match.index + match[0].length)).trim()
      if (excerpt) return { sourceRef: source.id, excerpt }
    }
  }
  return undefined
}

function matchCase(row: VerifiedCaseStudy, sources: readonly PlanningManuscriptSource[]): SelectedCaseStudy {
  const matched = row.features.flatMap(feature => {
    const support = projectSupport(feature, sources)
    if (!support) return []
    const similarity: CaseStudySimilarity = { featureId: feature.id, dimension: feature.dimension,
      statement: feature.label, projectSourceRefs: [support.sourceRef], projectExcerpts: [support.excerpt], caseEvidenceIds: [...feature.evidenceIds] }
    return [{ feature, similarity }]
  })
  return { ...row, similarities: matched.map(item => item.similarity), applications: matched.map(item => item.feature.application) }
}

function withoutLocalImage(row: SelectedCaseStudy | VerifiedCaseStudy): unknown {
  return { ...row, image: row.image ? withoutSourcePath(row.image) : undefined,
    gallery: row.gallery?.map(withoutSourcePath) }
}
function definitionOf(row: SelectedCaseStudy): VerifiedCaseStudy {
  const { similarities: _similarities, applications: _applications, ...definition } = row
  return definition
}
function bundleFingerprint(bundle: Omit<ReportCaseStudies, 'caseStudiesFingerprint'> | ReportCaseStudies): string {
  return digest({ schemaVersion: bundle.schemaVersion, catalogVersion: bundle.catalogVersion, projectId: bundle.projectId,
    sourceRevision: bundle.sourceRevision, baseSourceFingerprint: bundle.baseSourceFingerprint,
    cases: bundle.cases.map(withoutLocalImage) })
}

/** Select from independently verified facts; there is no LLM or fabricated web_search dependency. */
export function selectCaseStudies(input: FrozenProjectInput): ReportCaseStudies {
  const sources = makeSourceIndex(input)
  const complete = VERIFIED_CASE_STUDIES.filter(row => !caseStudySourceGaps(row).some(gap => gap.blocking))
  complete.forEach(validateCatalogCase)
  const cases = complete.map(row => matchCase(row, sources)).filter(row => row.similarities.length >= 2)
    .sort((a, b) => b.similarities.length - a.similarities.length || a.caseId.localeCompare(b.caseId)).slice(0, 5)
  if (cases.length < 3) throw Object.assign(new Error(`CASE_STUDIES_INSUFFICIENT: 现有已核实案例库仅找到 ${cases.length} 个具备点线面依据且具有至少两项共同点的案例；补充来源或改选案例，至少达到 3 个后才能导出。`), {
    code: 'CASE_STUDIES_INSUFFICIENT', sourceGaps: VERIFIED_CASE_STUDIES.map(row => ({ caseId: row.caseId, gaps: caseStudySourceGaps(row) })).filter(row => row.gaps.length),
  })
  const basis = { schemaVersion: CASE_STUDIES_SCHEMA_VERSION, catalogVersion: CASE_STUDIES_CATALOG_VERSION,
    projectId: input.projectId, sourceRevision: input.revision, baseSourceFingerprint: manuscriptSourceFingerprint(input),
    generatedAt: input.generatedAt, cases }
  const bundle = { ...basis, caseStudiesFingerprint: bundleFingerprint(basis) }
  return validateCaseStudies(bundle, input)
}

/** Public export validation rejects stale project links and unverified substitutions in saved bundles. */
export function validateCaseStudies(value: ReportCaseStudies, input?: FrozenProjectInput): ReportCaseStudies {
  if (!value || value.schemaVersion !== CASE_STUDIES_SCHEMA_VERSION || value.catalogVersion !== CASE_STUDIES_CATALOG_VERSION) fail('CASE_STUDIES_SCHEMA', 'unrecognized case-study contract or catalog')
  if (!Array.isArray(value.cases) || value.cases.length < 3 || value.cases.length > 5) fail('CASE_STUDIES_COUNT', 'the report needs 3–5 real project cases')
  if (new Set(value.cases.map(row => row.caseId)).size !== value.cases.length
      || new Set(value.cases.map(row => canonicalText(`${row.location}${row.name}`))).size !== value.cases.length) fail('CASE_STUDIES_DUPLICATE', 'duplicate projects cannot satisfy the minimum')
  if (!hex.test(value.baseSourceFingerprint) || !Number.isFinite(Date.parse(value.generatedAt))) fail('CASE_STUDIES_IDENTITY', 'source identity and capture date are required')
  if (input && (value.projectId !== input.projectId || value.sourceRevision !== input.revision
      || value.baseSourceFingerprint !== manuscriptSourceFingerprint(input))) fail('CASE_STUDIES_STALE', 'the project or its professional source revision has changed')
  const sources = input ? makeSourceIndex(input) : undefined
  for (const row of value.cases) {
    validateCatalogCase(row)
    const verified = VERIFIED_CASE_STUDIES.find(item => item.caseId === row.caseId) ?? fail('CASE_STUDY_UNVERIFIED', `${row.caseId} is absent from the verified catalog`)
    if (digest(withoutLocalImage(definitionOf(row))) !== digest(withoutLocalImage(verified))) fail('CASE_STUDY_UNVERIFIED', `${row.caseId} differs from its verified catalog record`)
    if (!Array.isArray(row.similarities) || row.similarities.length < 2
        || new Set(row.similarities.map(item => item.featureId)).size !== row.similarities.length
        || new Set(row.similarities.map(item => canonicalText(item.statement))).size !== row.similarities.length) fail('CASE_STUDY_SIMILARITIES', `${row.caseId} requires at least two distinct similarities`)
    for (const item of row.similarities) {
      const feature = row.features.find(entry => entry.id === item.featureId)
      if (!feature || feature.dimension !== item.dimension || feature.label !== item.statement
          || digest(feature.evidenceIds) !== digest(item.caseEvidenceIds)) fail('CASE_STUDY_UNSUPPORTED_MATCH', `${row.caseId}/${item.featureId} lacks feature evidence`)
      uniqueStrings(item.projectSourceRefs, 'CASE_STUDY_UNSUPPORTED_MATCH', `${row.caseId} project references`)
      if (item.projectExcerpts?.length !== item.projectSourceRefs.length || item.projectExcerpts.some(excerpt => !excerpt.trim() || !signals[item.featureId].test(excerpt))) fail('CASE_STUDY_UNSUPPORTED_MATCH', `${row.caseId} lacks project support`)
      if (sources && item.projectSourceRefs.some((id, index) => !sources.find(source => source.id === id)?.text.includes(item.projectExcerpts[index]!))) fail('CASE_STUDY_UNSUPPORTED_MATCH', `${row.caseId} cites a missing project excerpt`)
    }
    if (sources) {
      const expected = matchCase(verified, sources)
      if (digest(expected.similarities) !== digest(row.similarities) || digest(expected.applications) !== digest(row.applications)) fail('CASE_STUDY_UNSUPPORTED_MATCH', `${row.caseId} no longer matches the current project`)
    } else {
      const expectedApplications = row.similarities.map(item => row.features.find(feature => feature.id === item.featureId)!.application)
      if (digest(expectedApplications) !== digest(row.applications)) fail('CASE_STUDY_UNSUPPORTED_MATCH', `${row.caseId} includes an unsupported application`)
    }
  }
  validateCaseStudyImageUses(value.cases.flatMap(row => row.gallery!), 'report case-study pages')
  if (value.caseStudiesFingerprint !== bundleFingerprint(value)) fail('CASE_STUDIES_FINGERPRINT', 'case-study evidence or matching changed')
  return value
}

async function atomicWrite(path: string, content: string | Uint8Array): Promise<void> {
  const staging = `${path}.${randomUUID()}.tmp`
  await writeFile(staging, content)
  await rename(staging, path)
}

async function downloadPhoto<T extends CaseStudyImage>(image: T, target: string, fetcher: typeof fetch, refresh = false): Promise<T> {
  if (!refresh) {
    try { if (hash(await readFile(target)) === image.sha256) return { ...image, sourcePath: target } }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const encoded = BUNDLED_CASE_STUDY_IMAGES[image.sha256]
    if (encoded) {
      const bytes = Buffer.from(encoded, 'base64')
      if (hash(bytes) !== image.sha256) fail('CASE_STUDY_IMAGE_HASH', 'bundled project photograph was altered')
      await atomicWrite(target, bytes)
      return { ...image, sourcePath: target }
    }
  }
  const original = new URL(image.sourceUrl)
  let url = image.sourceUrl
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(25_000), headers: { 'User-Agent': 'PreDesign-CaseEvidence/1.0' } })
    if (response.status >= 300 && response.status < 400) {
      const destination = new URL(response.headers.get('location') ?? '', url)
      if (destination.protocol !== 'https:' || destination.hostname !== original.hostname || destination.username || destination.password) fail('CASE_STUDY_IMAGE_REDIRECT', original.hostname)
      url = destination.href
      continue
    }
    if (!response.ok) fail('CASE_STUDY_IMAGE_FETCH', `${original.hostname} returned ${response.status}`)
    if (Number(response.headers.get('content-length') ?? 0) > 24_000_000) fail('CASE_STUDY_IMAGE_SIZE', original.hostname)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > 24_000_000 || hash(bytes) !== image.sha256) fail('CASE_STUDY_IMAGE_HASH', `the published photograph changed: ${image.sourcePageUrl}`)
    await atomicWrite(target, bytes)
    return { ...image, sourcePath: target }
  }
  return fail('CASE_STUDY_IMAGE_REDIRECT', 'too many redirects')
}

export function caseStudyEvidenceMarkdown(bundle: ReportCaseStudies): string {
  validateCaseStudies(bundle)
  const lines = ['# 真实项目对比案例依据', '', `项目：${bundle.projectId}`, `专业版本：${bundle.sourceRevision}`,
    `案例目录：${bundle.catalogVersion}`, `专业来源指纹：${bundle.baseSourceFingerprint}`, `案例证据指纹：${bundle.caseStudiesFingerprint}`, '',
    '案例资料来自实际发布的项目记录；应用建议为本项目的策划判断。原始网页日期、证据片段及摄影版权在本文件保存。', '']
  for (const row of bundle.cases) {
    lines.push(`## ${row.name}`, '', `${row.location}；${row.delivery.status === 'completed' ? `建成 ${row.delivery.date}` : '运营中（按资料抓取时的官方开放信息）'}`, '',
      `差异与应用条件：${row.boundary.fact}${row.boundary.applicationLimit}`, '')
    lines.push('### 点线面分析范围', '', `真实项目范围：${row.spatial!.scope.statement}`,
      `规模依据：${row.spatial!.scope.measurements.map(item => `${item.label} ${item.value} ${item.unit}（${item.evidenceIds.join('、')}）`).join('；')}`)
    for (const route of row.spatial!.line.routes) lines.push(`- ${route.mode}：${route.claim}；依据 ${route.evidenceIds.join('、')}；原文 ${route.sourceQuote}`)
    for (const gap of caseStudySourceGaps(row)) lines.push(`- 待补来源 ${gap.scale}/${gap.mode ?? 'overall'}：${gap.reason}`)
    lines.push('')
    for (const evidence of row.evidence) lines.push(`### ${evidence.evidenceId}`, '', `[${evidence.sourceTitle}](${evidence.sourceUrl})`,
      `发布者：${evidence.publisher}；发布日期：${evidence.publishedAt ?? '原文未标注'}；访问日期：${evidence.capturedAt}`,
      `来源快照 SHA-256：${evidence.contentHash}`, `证据片段 SHA-256：${evidence.excerptHash}`, '', `> ${evidence.excerpt}`, '')
    lines.push('### 与本项目的对应关系', '')
    row.similarities.forEach(item => lines.push(`- ${item.statement}：${item.projectExcerpts.join('；')}。项目来源 ${item.projectSourceRefs.join(', ')}；案例证据 ${item.caseEvidenceIds.join(', ')}`))
    lines.push('', '### 分页分析依据', '')
    for (const section of row.analysis!) lines.push(`- ${section.focus}｜${section.title}：${section.evidenceIds.join('、')}`)
    for (const image of row.gallery!) lines.push('', `### ${image.imageId} 摄影／图片来源`, '', image.description,
      `摄影／图片来源：${image.credit}`, `[原图](${image.sourceUrl})`, `[原始项目发布页](${image.sourcePageUrl})`,
      `图片 SHA-256：${image.sha256}`, `相关事实：${image.evidenceIds.join('、')}`)
    lines.push('')
  }
  return lines.join('\n')
}

export interface PrepareCaseStudiesOptions {
  readonly fetch?: typeof fetch
  /** Evidence-only preparation is useful for tools; formal report export uses the default true. */
  readonly downloadImages?: boolean
  /** Explicit source-image audit; ordinary exports reuse the verified bundled bytes. */
  readonly refreshImages?: boolean
}

/** Independently prepares reusable cases and real photographs without rewriting any manuscript chapter. */
export async function prepareCaseStudies(input: FrozenProjectInput, workspaceRoot?: string, options: PrepareCaseStudiesOptions = {}): Promise<ReportCaseStudies> {
  let bundle = selectCaseStudies(input)
  if (!workspaceRoot) return bundle
  const directory = join(workspaceRoot, '.pre-design')
  await mkdir(directory, { recursive: true })
  const target = join(directory, 'report-case-studies.json')
  try {
    const cached = JSON.parse(await readFile(target, 'utf8')) as ReportCaseStudies
    if (cached.caseStudiesFingerprint === bundle.caseStudiesFingerprint) {
      validateCaseStudies(cached, input)
      bundle = { ...bundle, generatedAt: cached.generatedAt }
    }
  } catch (error) {
    // A missing or stale optional cache is rebuilt from verified catalog facts, never from generated claims.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)
        && !(error instanceof Error && error.message.startsWith('CASE_STUD'))) throw error
  }
  if (options.downloadImages !== false) {
    const assets = join(directory, 'report-case-studies', 'assets')
    await mkdir(assets, { recursive: true })
    const materialized = new Map<string, Promise<string>>()
    const cases = await Promise.all(bundle.cases.map(async row => {
      const gallery = await Promise.all(row.gallery!.map(async image => {
        const target = join(assets, `${row.caseId}-${image.sha256.slice(0, 12)}.${image.mimeType === 'image/png' ? 'png' : 'jpg'}`)
        let pending = materialized.get(target)
        if (!pending) {
          pending = downloadPhoto(image, target, options.fetch ?? fetch, options.refreshImages).then(saved => saved.sourcePath!)
          materialized.set(target, pending)
        }
        // Two allowed uses share original bytes, while retaining their independent analytical purpose/caption.
        return { ...image, sourcePath: await pending }
      }))
      const { imageId: _imageId, evidenceIds: _ids, ...image } = gallery.find(image => image.imageId === 'site')!
      return { ...row, gallery, image }
    }))
    bundle = { ...bundle, cases }
  }
  validateCaseStudies(bundle, input)
  await atomicWrite(target, JSON.stringify(bundle, null, 2) + '\n')
  await atomicWrite(join(directory, 'report-case-studies.evidence.md'), caseStudyEvidenceMarkdown(bundle))
  return bundle
}
