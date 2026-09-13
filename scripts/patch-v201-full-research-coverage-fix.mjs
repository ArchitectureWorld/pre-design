import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const path = resolve(import.meta.dirname, 'apply-v201-full-research-coverage.mjs')
let text = await readFile(path, 'utf8')

function replaceRequired(pattern, replacement, label) {
  if (!pattern.test(text)) throw new Error(`V2.0.1 generator patch target not found: ${label}`)
  text = text.replace(pattern, replacement)
}

if (!text.includes('const HUMAN_FIELD_LABELS = {')) {
  replaceRequired(
    /const labelField = field => FIELD_LABEL_OVERRIDES\[field\] \?\? field\.split\('_'\)\.map\(token => TOKEN_LABELS\[token\] \?\? token\)\.join\(''\)/u,
    `const HUMAN_FIELD_LABELS = {
  issues: '问题清单', baseline: '现状基线', reference_standard: '参考标准', gap_value: '差距值', location: '位置', affected_groups: '受影响人群', severity: '严重度',
  mission: '项目使命', service_objects: '服务对象', beneficiaries: '受益人群', public_value: '公共价值', strategic_role: '战略角色', problem_links: '问题关联', opportunity_links: '机会关联', non_goals: '非目标',
  data_versions: '数据版本', common_assumptions: '共同假设', price_base_date: '价格基准日', evaluation_model_version: '评价模型版本', fixed_conditions: '固定条件', variable_list: '变量清单', units: '单位口径', snapshot_id: '快照标识',
  user_groups: '使用人群', needs: '需求', day_types: '日期类型', time_slots: '使用时段', peak_demands: '峰值需求', seasons: '季节情景', inclusion_needs: '包容性需求',
  centers: '空间中心', axes: '空间轴线', networks: '空间网络', intensity: '开发强度', area_balance: '面积平衡', public_space: '公共空间', planning_alignment: '规划衔接',
  packages: '项目包', object_refs: '对象引用', problems: '对应问题', scope: '实施范围', measures: '实施措施', dependencies: '前后依赖', expected_outcomes: '预期成果', boundary: '实施边界',
  evidence_refs: '证据引用', confidence: '置信度', status: '状态', method: '方法', assumptions: '假设',
}

const labelField = field => {
  if (HUMAN_FIELD_LABELS[field] !== undefined) return HUMAN_FIELD_LABELS[field]
  if (FIELD_LABEL_OVERRIDES[field] !== undefined) return FIELD_LABEL_OVERRIDES[field]
  const tokens = field.split('_')
  if (tokens.every(token => TOKEN_LABELS[token] !== undefined)) return tokens.map(token => TOKEN_LABELS[token]).join('')
  return \`字段 \${field}\`
}`,
    'labelField',
  )
}

if (!text.includes('const FIELD_KIND_OVERRIDES = {')) {
  replaceRequired(
    /function inferDataKind\(field, contract\) \{[\s\S]*?\n\}\n\nconst QUERY_HINTS/u,
    `const FIELD_KIND_OVERRIDES = {
  reference_standard: 'standard', applicable_standards: 'standard', standard_refs: 'standard',
  parcel_ids: 'land', land_use: 'land', owners: 'land', right_types: 'land', current_use: 'land', leases: 'land', mortgages: 'land', disposition_constraints: 'land', boundary: 'land',
  terrain: 'natural_resource', geology: 'natural_resource', hydrology: 'hydrology', ecology: 'environment', contamination: 'environment', climate: 'climate', hazards: 'safety', sensitivity_zones: 'environment',
  fire_safety: 'safety', structural_safety: 'safety', risk_points: 'safety',
  groups: 'population', population: 'population', demographics: 'population', households: 'population', origins: 'population', time_patterns: 'population', journeys: 'population', peak_periods: 'population', samples: 'population', affected_groups: 'population', beneficiaries: 'population',
  user_groups: 'population', needs: 'population', day_types: 'population', time_slots: 'population', peak_demands: 'population', seasons: 'population', inclusion_needs: 'population',
  facilities: 'public_service', service_objects: 'public_service', capacity: 'public_service', hours: 'public_service', pricing: 'public_service', operator: 'public_service', coverage: 'public_service', accessibility: 'public_service', utilization: 'public_service', shareability: 'public_service',
  sectors: 'market', businesses: 'market', pois: 'market', rents: 'market', vacancy: 'market', footfall: 'market', sales: 'market', competitors: 'market', operators: 'market', supply_structure: 'market',
  mobility_network: 'transport', traffic: 'transport', parking: 'transport', transit: 'transport', utilities: 'utilities', heritage: 'culture',
  geometry: 'spatial_planning', building_use: 'spatial_planning', areas: 'spatial_planning', heights: 'spatial_planning', centers: 'spatial_planning', axes: 'spatial_planning', networks: 'spatial_planning', zones: 'spatial_planning', intensity: 'spatial_planning', area_balance: 'spatial_planning', public_space: 'spatial_planning', planning_alignment: 'spatial_planning',
  quantities: 'cost', unit_rates: 'cost', package_costs: 'cost', price_base_date: 'cost', base_date: 'cost', tax_basis: 'cost', contingency: 'cost', capex: 'cost', opex: 'cost', lifecycle_cost: 'cost',
  funding: 'finance', financing: 'finance', cashflow: 'finance', returns: 'finance', financing_cost: 'finance',
  packages: 'implementation', scope: 'implementation', measures: 'implementation', dependencies: 'implementation', expected_outcomes: 'implementation', schedule: 'implementation', phases: 'implementation', milestones: 'implementation', procurement: 'implementation', governance: 'implementation',
}

function inferDataKind(field, contract) {
  const normalized = field.toLowerCase()
  if (FIELD_KIND_OVERRIDES[normalized] !== undefined) return FIELD_KIND_OVERRIDES[normalized]
  const tokens = new Set(normalized.split('_'))
  const has = (...values) => values.some(value => tokens.has(value))
  if (has('parcel', 'land', 'redline', 'right', 'rights', 'lease', 'leases', 'mortgage', 'mortgages')) return 'land'
  if (has('terrain', 'topography', 'geology')) return 'natural_resource'
  if (has('hydrology', 'flood', 'water')) return 'hydrology'
  if (has('ecology', 'contamination', 'environment')) return 'environment'
  if (has('climate', 'temperature', 'precipitation', 'wind')) return 'climate'
  if (has('hazard', 'hazards', 'safety', 'resilience', 'fire')) return 'safety'
  if (has('population', 'demographics', 'households', 'groups', 'journeys', 'people', 'users')) return 'population'
  if (has('facilities', 'service', 'capacity', 'coverage', 'accessibility', 'utilization', 'shareability')) return 'public_service'
  if (has('sectors', 'businesses', 'pois', 'rents', 'footfall', 'sales', 'competitors', 'market')) return 'market'
  if (has('traffic', 'parking', 'transit', 'mobility')) return 'transport'
  if (has('utilities', 'energy', 'power')) return 'utilities'
  if (has('heritage', 'culture', 'tourism')) return 'culture'
  if (has('quantity', 'quantities', 'rates', 'cost', 'costs', 'capex', 'opex', 'tax', 'contingency')) return 'cost'
  if (has('finance', 'financing', 'funding', 'cashflow', 'return', 'returns')) return 'finance'
  if (has('standard', 'standards')) return 'standard'
  if (has('policy', 'policies', 'regulation', 'regulations')) return 'policy'
  if (has('planning', 'spatial', 'layout', 'geometry', 'area', 'areas', 'height', 'heights', 'building', 'site', 'zones')) return 'spatial_planning'
  if (has('schedule', 'phase', 'phases', 'milestone', 'milestones', 'procurement', 'governance', 'package', 'packages')) return 'implementation'
  if (has('industry', 'sector', 'sectors')) return 'industry'

  const chapter = Number(contract.chapter_id)
  if (chapter === 6) return 'public_service'
  if (chapter === 7) return 'spatial_planning'
  if (chapter === 8) return 'implementation'
  return 'project_analysis'
}

const QUERY_HINTS`,
    'inferDataKind',
  )
}

if (!text.includes('const DETERMINISTIC_TOOL_FIELDS = new Set')) {
  replaceRequired(
    /function needsTool\(field, dataKind\) \{[\s\S]*?\n\}/u,
    `const DETERMINISTIC_TOOL_FIELDS = new Set([
  'geometry', 'areas', 'heights', 'capacity', 'coverage', 'accessibility', 'utilization', 'traffic', 'parking',
  'quantities', 'unit_rates', 'package_costs', 'capex', 'opex', 'lifecycle_cost', 'cashflow', 'scores', 'ranking',
  'intensity', 'area_balance', 'metrics', 'indicators',
])

function needsTool(field, dataKind) {
  const normalized = field.toLowerCase()
  if (DETERMINISTIC_TOOL_FIELDS.has(normalized)) return true
  const tokens = normalized.split('_')
  if (tokens.some(token => ['area', 'areas', 'height', 'heights', 'capacity', 'coverage', 'utilization', 'traffic', 'parking', 'quantity', 'quantities', 'cost', 'costs', 'capex', 'opex', 'cashflow', 'score', 'scores', 'ranking'].includes(token))) return true
  return false
}`,
    'needsTool',
  )
}

replaceRequired(
  /if \(\/土地\|权属\|规划\|空间\|用地\|场地\|边界\|红线\/u\.test\(text\)\) ids\.add\('cn-mnr'\)/u,
  `if (/土地|权属|规划|空间|用地|场地|地块|红线|总平|布局/u.test(text)) ids.add('cn-mnr')`,
  'MNR source selection',
)

replaceRequired(
  /for \(const sourceId of externalSourcesFor\(contract\)\) sourceIds\.add\(sourceId\)/u,
  `for (const sourceId of externalSourcesFor(contract)) {
    const source = sourceById.get(sourceId)
    if (source !== undefined && allDataPoints.some(point => sourceSupports(source, point.dataKind))) sourceIds.add(sourceId)
  }`,
  'external source filtering',
)

replaceRequired(
  /const workspacePointIds = allDataPoints\.filter\(point => exactSiteData\(fieldByDataPointId\.get\(point\.dataPointId\) \?\? '', point\.dataKind\) \|\| Number\(contract\.chapter_id\) === 2\)\.map\(point => point\.dataPointId\)/u,
  `const workspacePointIds = allDataPoints.map(point => point.dataPointId)`,
  'workspace evidence step',
)

if (!text.includes("const SOURCE_KIND_EXTENSIONS = {")) {
  replaceRequired(
    /const sourceDoc = await readJson\('research\/v2\.0\.1\/data-sources\.json'\)/u,
    `const SOURCE_KIND_EXTENSIONS = {
  'cn-local-gov-official': ['policy', 'standard', 'spatial_planning', 'cost', 'implementation'],
  'cn-standards': ['public_service', 'spatial_planning', 'safety', 'transport', 'utilities', 'cost', 'implementation'],
  'cn-mohurd': ['spatial_planning', 'public_service', 'safety', 'utilities', 'cost', 'implementation'],
  'cn-mnr': ['land', 'spatial_planning', 'natural_resource', 'environment'],
  'cn-nbs': ['population', 'market', 'industry', 'finance'],
  'cn-ndrc': ['market', 'industry', 'finance', 'cost', 'implementation'],
  'cn-mof': ['finance', 'cost', 'implementation'],
  'cn-mot': ['transport', 'safety', 'implementation'],
  'cn-mem': ['safety', 'implementation'],
  'cn-mee': ['environment', 'natural_resource', 'safety'],
  'cn-mwr': ['hydrology', 'natural_resource', 'safety'],
}

const sourceDoc = await readJson('research/v2.0.1/data-sources.json')`,
    'source kind extensions',
  )
  replaceRequired(
    /for \(const source of NEW_SOURCES\) sourceMap\.set\(source\.sourceId, source\)\nsourceDoc\.sources = \[\.\.\.sourceMap\.values\(\)\]/u,
    `for (const source of NEW_SOURCES) sourceMap.set(source.sourceId, source)
for (const [sourceId, kinds] of Object.entries(SOURCE_KIND_EXTENSIONS)) {
  const source = sourceMap.get(sourceId)
  if (source === undefined) continue
  sourceMap.set(sourceId, { ...source, supportedDataKinds: [...new Set([...source.supportedDataKinds, ...kinds])] })
}
sourceDoc.sources = [...sourceMap.values()]`,
    'source kind extension application',
  )
}

await writeFile(path, text)
console.log('PRE_V2_0_1_FULL_RESEARCH_PATCH_PASS')
