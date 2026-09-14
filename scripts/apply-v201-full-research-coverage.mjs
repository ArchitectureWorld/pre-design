import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'))
const writeJson = async (path, value) => writeFile(resolve(root, path), `${JSON.stringify(value, null, 2)}\n`)

const NEW_SOURCES = [
  {
    sourceId: 'project-state-store', name: 'Pre-design 已确认 Project State', publisher: 'Pre-design / DSH Project State Store',
    priority: 'P0', authorityLevel: 'project_official', homepage: null, allowedDomains: [], accessModes: ['project_state'],
    supportedDataKinds: ['*'], freshnessPolicy: { maxAgeDays: null, refreshOnProjectStart: false, notes: '必须读取明确 Revision；任一上游语义变化后当前证据自动 stale。' },
    reliabilityGrade: 'A', notes: '只读取已通过当前自动质量策略的上游 Project State，并保留底层 EvidenceRef/AnalysisTrace；不得把上游 inference 升级为 fact。',
  },
  {
    sourceId: 'professional-tool-output', name: '确定性专业工具输出', publisher: 'Pre-design Professional Tool Runtime',
    priority: 'P0', authorityLevel: 'project_official', homepage: null, allowedDomains: [], accessModes: ['professional_tool'],
    supportedDataKinds: ['*'], freshnessPolicy: { maxAgeDays: null, refreshOnProjectStart: false, notes: '工具输出与输入 Revision、参数、软件/算法版本绑定；输入变化后自动重算。' },
    reliabilityGrade: 'A', notes: 'GIS/BIM/几何、统计、造价、财务、优化等确定性计算输出；必须记录输入证据、参数、方法版本和可复算步骤。',
  },
  {
    sourceId: 'cn-local-gov-official', name: '项目所在地政府及主管部门官网', publisher: '项目所在地人民政府/主管部门',
    priority: 'P1', authorityLevel: 'government_official', homepage: 'https://www.gov.cn/', allowedDomains: ['gov.cn'], accessModes: ['web_page', 'web_search'],
    supportedDataKinds: ['local_policy', 'local_planning', 'land', 'population', 'public_service', 'market', 'industry', 'transport', 'utilities', 'environment', 'safety', 'cost_policy', 'finance', 'education', 'health', 'civil_affairs', 'culture', 'energy'],
    freshnessPolicy: { maxAgeDays: 30, refreshOnProjectStart: true, notes: '运行时按项目行政区发现并锁定具体 *.gov.cn 官方域名；每条 Evidence 必须保存具体发布机关和页面 URL。' },
    reliabilityGrade: 'A', notes: '用于地方统计、公服、规划、交通、市政、政策、造价信息等。全国层面信息不得替代具体地块/具体设施/具体容量事实。',
  },
  {
    sourceId: 'cn-mee', name: '生态环境部', publisher: '中华人民共和国生态环境部', priority: 'P1', authorityLevel: 'government_official',
    homepage: 'https://www.mee.gov.cn/', allowedDomains: ['mee.gov.cn'], accessModes: ['web_page', 'web_search'],
    supportedDataKinds: ['environment', 'ecology', 'contamination', 'environmental_policy', 'environmental_standard', 'environmental_quality'],
    freshnessPolicy: { maxAgeDays: 30, refreshOnProjectStart: true, notes: '环境质量、环评、生态保护和污染相关政策按最新发布期核验。' }, reliabilityGrade: 'A',
    notes: '国家生态环境政策、标准、环境质量和审批信息的官方入口；具体项目地块污染/环评事实仍须项目或地方正式资料。',
  },
  {
    sourceId: 'cn-mwr', name: '水利部', publisher: '中华人民共和国水利部', priority: 'P1', authorityLevel: 'government_official',
    homepage: 'https://www.mwr.gov.cn/', allowedDomains: ['mwr.gov.cn'], accessModes: ['web_page', 'web_search'],
    supportedDataKinds: ['hydrology', 'flood', 'water_resource', 'water_policy', 'water_safety'],
    freshnessPolicy: { maxAgeDays: 30, refreshOnProjectStart: true, notes: '流域、水文、防洪及水资源政策按最新公开资料核验。' }, reliabilityGrade: 'A',
    notes: '国家水利、水文、防洪和水资源官方来源；项目场地高程、管线或具体洪水位需项目/地方正式成果。',
  },
  {
    sourceId: 'cn-mot', name: '交通运输部', publisher: '中华人民共和国交通运输部', priority: 'P1', authorityLevel: 'government_official',
    homepage: 'https://www.mot.gov.cn/', allowedDomains: ['mot.gov.cn'], accessModes: ['web_page', 'web_search'],
    supportedDataKinds: ['transport', 'mobility', 'traffic_policy', 'transport_standard', 'transit'],
    freshnessPolicy: { maxAgeDays: 30, refreshOnProjectStart: true, notes: '交通政策、行业统计与技术要求按最新公开版本核验。' }, reliabilityGrade: 'A',
    notes: '国家交通运输政策与行业数据官方来源；项目道路流量、停车周转和公交站点状态需地方/项目证据。',
  },
  {
    sourceId: 'cn-mem', name: '应急管理部', publisher: '中华人民共和国应急管理部', priority: 'P1', authorityLevel: 'government_official',
    homepage: 'https://www.mem.gov.cn/', allowedDomains: ['mem.gov.cn'], accessModes: ['web_page', 'web_search'],
    supportedDataKinds: ['safety', 'hazard', 'disaster', 'emergency', 'resilience', 'fire_policy'],
    freshnessPolicy: { maxAgeDays: 30, refreshOnProjectStart: true, notes: '安全生产、灾害、应急政策和公开信息按最新状态核验。' }, reliabilityGrade: 'A',
    notes: '国家应急、安全和自然灾害相关官方来源；具体建筑消防/结构安全不能由宏观网站信息替代检测或审查。',
  },
  {
    sourceId: 'cn-moe', name: '教育部', publisher: '中华人民共和国教育部', priority: 'P1', authorityLevel: 'government_official',
    homepage: 'https://www.moe.gov.cn/', allowedDomains: ['moe.gov.cn'], accessModes: ['web_page', 'web_search'],
    supportedDataKinds: ['education', 'public_service', 'education_policy', 'education_statistics'],
    freshnessPolicy: { maxAgeDays: 90, refreshOnProjectStart: true, notes: '教育政策、学校设置和统计口径按最新公开期核验。' }, reliabilityGrade: 'A',
    notes: '教育设施、教育服务和相关政策的国家级官方来源；项目周边具体学校容量与开放状态优先地方官方数据。',
  },
  {
    sourceId: 'cn-nhc', name: '国家卫生健康委员会', publisher: '中华人民共和国国家卫生健康委员会', priority: 'P1', authorityLevel: 'government_official',
    homepage: 'https://www.nhc.gov.cn/', allowedDomains: ['nhc.gov.cn'], accessModes: ['web_page', 'web_search'],
    supportedDataKinds: ['health', 'public_service', 'health_policy', 'health_facility', 'health_statistics'],
    freshnessPolicy: { maxAgeDays: 90, refreshOnProjectStart: true, notes: '卫生健康政策、机构目录和统计口径按最新公开期核验。' }, reliabilityGrade: 'A',
    notes: '卫生健康与医疗服务国家级官方来源；具体医疗机构能力优先地方卫健部门或机构正式数据。',
  },
  {
    sourceId: 'cn-mca', name: '民政部', publisher: '中华人民共和国民政部', priority: 'P1', authorityLevel: 'government_official',
    homepage: 'https://www.mca.gov.cn/', allowedDomains: ['mca.gov.cn'], accessModes: ['web_page', 'web_search'],
    supportedDataKinds: ['civil_affairs', 'public_service', 'elderly_care', 'community_service', 'social_service'],
    freshnessPolicy: { maxAgeDays: 90, refreshOnProjectStart: true, notes: '养老、社区、社会服务政策和公开统计按最新期核验。' }, reliabilityGrade: 'A',
    notes: '养老、社区和社会服务国家级官方来源；具体设施容量与运营状态优先地方民政部门/项目资料。',
  },
  {
    sourceId: 'cn-ndrc', name: '国家发展和改革委员会', publisher: '中华人民共和国国家发展和改革委员会', priority: 'P1', authorityLevel: 'government_official',
    homepage: 'https://www.ndrc.gov.cn/', allowedDomains: ['ndrc.gov.cn'], accessModes: ['web_page', 'web_search'],
    supportedDataKinds: ['industry', 'market', 'investment', 'finance', 'project_policy', 'development_strategy', 'price_policy'],
    freshnessPolicy: { maxAgeDays: 30, refreshOnProjectStart: true, notes: '产业、投资、价格与发展政策按最新发布状态核验。' }, reliabilityGrade: 'A',
    notes: '产业、投资、价格和重大项目政策官方来源；项目自身收益/投资数字仍须项目数据与确定性模型。',
  },
  {
    sourceId: 'cn-mof', name: '财政部', publisher: '中华人民共和国财政部', priority: 'P1', authorityLevel: 'government_official',
    homepage: 'https://www.mof.gov.cn/', allowedDomains: ['mof.gov.cn'], accessModes: ['web_page', 'web_search'],
    supportedDataKinds: ['finance', 'fiscal_policy', 'government_investment', 'procurement', 'tax_policy'],
    freshnessPolicy: { maxAgeDays: 30, refreshOnProjectStart: true, notes: '财政、政府采购、政府投资相关政策按最新状态核验。' }, reliabilityGrade: 'A',
    notes: '财政、政府采购和政府投资政策官方来源；具体融资方案和现金流需项目资料与财务模型。',
  },
  {
    sourceId: 'cn-mct', name: '文化和旅游部', publisher: '中华人民共和国文化和旅游部', priority: 'P1', authorityLevel: 'government_official',
    homepage: 'https://www.mct.gov.cn/', allowedDomains: ['mct.gov.cn'], accessModes: ['web_page', 'web_search'],
    supportedDataKinds: ['culture', 'tourism', 'heritage', 'public_service', 'culture_policy'],
    freshnessPolicy: { maxAgeDays: 90, refreshOnProjectStart: true, notes: '文旅、公共文化和文化遗产政策按最新公开状态核验。' }, reliabilityGrade: 'A',
    notes: '文化、旅游、公共文化与文保相关国家级官方来源；具体保护对象和级别以项目/地方正式名录为准。',
  },
  {
    sourceId: 'cn-miit', name: '工业和信息化部', publisher: '中华人民共和国工业和信息化部', priority: 'P1', authorityLevel: 'government_official',
    homepage: 'https://www.miit.gov.cn/', allowedDomains: ['miit.gov.cn'], accessModes: ['web_page', 'web_search'],
    supportedDataKinds: ['industry', 'market', 'industrial_policy', 'digital_infrastructure', 'enterprise_statistics'],
    freshnessPolicy: { maxAgeDays: 90, refreshOnProjectStart: true, notes: '产业政策、行业运行和信息基础设施公开信息按最新期核验。' }, reliabilityGrade: 'A',
    notes: '产业与信息化国家级官方来源；本地产业供需需结合地方统计和项目市场资料。',
  },
  {
    sourceId: 'cn-nea', name: '国家能源局', publisher: '国家能源局', priority: 'P1', authorityLevel: 'government_official',
    homepage: 'https://www.nea.gov.cn/', allowedDomains: ['nea.gov.cn'], accessModes: ['web_page', 'web_search'],
    supportedDataKinds: ['energy', 'utilities', 'energy_policy', 'power', 'energy_statistics'],
    freshnessPolicy: { maxAgeDays: 90, refreshOnProjectStart: true, notes: '能源、电力和相关基础设施政策按最新公开期核验。' }, reliabilityGrade: 'A',
    notes: '能源、电力和相关政策国家级官方来源；项目接入容量与管线条件必须使用地方/项目正式资料。',
  },
]

const AUDIT_ROWS = [
  { sourceId: 'project-state-store', status: 'local_source', checkedUrl: null, workingUrl: null, note: '项目内部结构化状态源；按 Project State Revision、Quality Report、EvidenceRef 与 AnalysisTrace 机械核验。' },
  { sourceId: 'professional-tool-output', status: 'local_source', checkedUrl: null, workingUrl: null, note: '项目内部专业计算源；按输入 Revision、参数、工具版本和可复算输出核验。' },
  { sourceId: 'cn-local-gov-official', status: 'verified_official_domain_pattern', checkedUrl: 'https://www.gov.cn/', workingUrl: 'https://www.gov.cn/', note: '运行时只接受 *.gov.cn 官方域名，并记录具体地方政府/主管部门发布机关；搜索结果转载页不升级为官方证据。' },
  { sourceId: 'cn-mee', status: 'verified_public_access', checkedUrl: 'https://www.mee.gov.cn/', workingUrl: 'https://www.mee.gov.cn/', note: '生态环境部主页和政策/公告内容已公开访问核查。' },
  { sourceId: 'cn-mwr', status: 'verified_official_content_direct_probe_limited', checkedUrl: 'https://www.mwr.gov.cn/', workingUrl: 'https://www.mwr.gov.cn/', note: '水利部官方域名和公开内容可确认；部分主页自动探测有限，运行时优先具体公开页面并记录可访问状态。' },
  { sourceId: 'cn-mot', status: 'verified_public_access', checkedUrl: 'https://www.mot.gov.cn/', workingUrl: 'https://www.mot.gov.cn/', note: '交通运输部主页已公开访问核查。' },
  { sourceId: 'cn-mem', status: 'verified_public_access', checkedUrl: 'https://www.mem.gov.cn/', workingUrl: 'https://www.mem.gov.cn/', note: '应急管理部主页已公开访问核查。' },
  { sourceId: 'cn-moe', status: 'verified_public_access', checkedUrl: 'https://www.moe.gov.cn/', workingUrl: 'https://www.moe.gov.cn/', note: '教育部政府门户和公开文件入口已核查可访问。' },
  { sourceId: 'cn-nhc', status: 'verified_official_service_via_subdomain', checkedUrl: 'https://www.nhc.gov.cn/', workingUrl: 'https://zwfw.nhc.gov.cn/', note: '国家卫健委官方域名及政务服务/政策查询子域可公开访问；具体页面运行时复核。' },
  { sourceId: 'cn-mca', status: 'verified_public_access', checkedUrl: 'https://www.mca.gov.cn/', workingUrl: 'https://www.mca.gov.cn/', note: '民政部主页已公开访问核查。' },
  { sourceId: 'cn-ndrc', status: 'verified_public_access', checkedUrl: 'https://www.ndrc.gov.cn/', workingUrl: 'https://www.ndrc.gov.cn/', note: '国家发展改革委主页已公开访问核查。' },
  { sourceId: 'cn-mof', status: 'verified_public_access', checkedUrl: 'https://www.mof.gov.cn/', workingUrl: 'https://www.mof.gov.cn/', note: '财政部官方主页可到达；具体政策页面运行时继续核查。' },
  { sourceId: 'cn-mct', status: 'verified_public_access', checkedUrl: 'https://www.mct.gov.cn/', workingUrl: 'https://www.mct.gov.cn/', note: '文化和旅游部主页已公开访问核查。' },
  { sourceId: 'cn-miit', status: 'verified_public_access', checkedUrl: 'https://www.miit.gov.cn/', workingUrl: 'https://www.miit.gov.cn/', note: '工业和信息化部主页已公开访问核查。' },
  { sourceId: 'cn-nea', status: 'verified_public_access', checkedUrl: 'https://www.nea.gov.cn/', workingUrl: 'https://www.nea.gov.cn/', note: '国家能源局主页已公开访问核查。' },
]

const TOKEN_LABELS = {
  object: '对象', objects: '对象', parcel: '地块', parcels: '地块', building: '建筑', buildings: '建筑', owner: '权属主体', owners: '权属主体',
  right: '权利', rights: '权利', type: '类型', types: '类型', current: '现状', use: '使用', leases: '租赁', mortgages: '抵押', area: '面积', areas: '面积',
  disposition: '处置', constraints: '约束', verification: '核验', status: '状态', terrain: '地形', hydrology: '水文', ecology: '生态', climate: '气候', geology: '地质',
  contamination: '污染', hazards: '灾害', sensitivity: '敏感', zones: '分区', resolution: '精度', scenarios: '情景', confidence: '置信度', geometry: '几何', land: '土地',
  building_use: '建筑使用', heights: '高度', height: '高度', age: '年代', condition: '状况', occupancy: '使用率', heritage: '文保', vacancy: '空置', photo: '照片', refs: '引用',
  groups: '人群', population: '人口', demographics: '人口结构', households: '家庭', origins: '来源地', time: '时间', patterns: '模式', journeys: '出行', peak: '高峰', periods: '时段',
  samples: '样本', method: '方法', facilities: '设施', capacity: '容量', hours: '开放时间', pricing: '价格', operator: '运营主体', coverage: '覆盖', accessibility: '可达性', utilization: '利用率',
  shareability: '共享条件', evidence: '证据', sectors: '产业', businesses: '企业/商户', pois: 'POI', rents: '租金', footfall: '客流', sales: '销售', competitors: '竞品', operators: '运营主体', supply: '供给', structure: '结构', range: '范围',
  mobility: '交通', network: '网络', traffic: '交通量', parking: '停车', transit: '公共交通', utilities: '市政', fire: '消防', structural: '结构', safety: '安全', risk: '风险', points: '点位', survey: '调查',
  target: '目标', targets: '目标', objective: '目标', objectives: '目标', goal: '目标', goals: '目标', principle: '原则', principles: '原则', strategy: '策略', strategies: '策略', option: '方案', options: '方案',
  score: '评分', scores: '评分', ranking: '排序', recommendation: '推荐', recommendations: '推荐', function: '功能', functions: '功能', program: '功能规模', scale: '规模', room: '空间单元', rooms: '空间单元',
  layout: '布局', circulation: '流线', technical: '技术', system: '系统', systems: '系统', quantity: '工程量', quantities: '工程量', rate: '单价', rates: '单价', cost: '成本', costs: '成本', capex: 'CAPEX', opex: 'OPEX',
  tax: '税费', contingency: '预备费', finance: '融资', funding: '资金', cashflow: '现金流', return: '回报', schedule: '进度', phase: '阶段', phases: '阶段', milestone: '里程碑', milestones: '里程碑',
  procurement: '采购', governance: '治理', role: '角色', roles: '角色', strategic: '战略', fit: '适配度', evaluation: '评价', model: '模型', version: '版本', demands: '需求', balance: '平衡', responsibility: '责任', risks: '风险', assumptions: '假设', decision: '决策', decisions: '决策', indicators: '指标', metrics: '指标', metric: '指标',
}

const FIELD_LABEL_OVERRIDES = {
  parcel_ids: '地块标识', building_ids: '建筑标识', right_types: '权利类型', current_use: '现状用途', disposition_constraints: '资产处置约束', verification_status: '核验状态',
  sensitivity_zones: '生态/环境敏感分区', building_use: '建筑现状功能', photo_refs: '现场影像证据', time_patterns: '时段使用规律', peak_periods: '高峰时段', evidence_refs: '证据引用',
  supply_structure: '供给结构', time_range: '数据时间范围', mobility_network: '交通网络', fire_safety: '消防安全', structural_safety: '结构安全', risk_points: '风险点', survey_refs: '调查/检测证据',
}

const labelField = field => FIELD_LABEL_OVERRIDES[field] ?? field.split('_').map(token => TOKEN_LABELS[token] ?? token).join('')

function inferDataKind(field, contract) {
  const fieldText = field.toLowerCase().replace(/[_-]+/gu, ' ')
  const contextText = `${contract.title} ${contract.purpose}`.toLowerCase()
  const fieldMatches = regex => regex.test(fieldText)
  const contextMatches = regex => regex.test(contextText)

  if (fieldMatches(/\b(?:parcel|parcels|land|redline|boundary|boundaries|right|rights|lease|leases|mortgage|mortgages|ownership)\b/u) || contextMatches(/产权|土地|权属|红线/u)) return 'land'
  if (fieldMatches(/\b(?:terrain|topography|topographic)\b/u) || contextMatches(/地形/u)) return 'natural_resource'
  if (fieldMatches(/\b(?:hydrology|hydrologic|flood|flooding)\b/u) || contextMatches(/水文|洪涝|防洪|水系/u)) return 'hydrology'
  if (fieldMatches(/\b(?:ecology|ecological|contamination|contaminated|environment|environmental)\b/u) || contextMatches(/环境|生态|污染/u)) return 'environment'
  if (fieldMatches(/\b(?:climate|temperature|precipitation|wind)\b/u) || contextMatches(/气候|温度|降水|风/u)) return 'climate'
  if (fieldMatches(/\b(?:hazard|hazards|disaster|disasters|fire safety|structural safety|resilience)\b/u) || contextMatches(/安全|消防|灾害|韧性/u)) return 'safety'
  if (fieldMatches(/\b(?:population|demographic|demographics|household|households|group|groups|journey|journeys)\b|\b(?:peak periods?|time patterns?)\b/u) || contextMatches(/人群|人口|客流|行为/u)) return 'population'
  if (fieldMatches(/\b(?:facility|facilities|service|services|capacity|capacities|utilization|shareability|education|health|elderly)\b/u) || contextMatches(/社区|公共服务|教育|医疗|养老/u)) return 'public_service'
  if (fieldMatches(/\b(?:sector|sectors|business|businesses|poi|pois|rent|rents|footfall|sales|competitor|competitors|market|operator|operators|supply)\b/u) || contextMatches(/产业|市场|商业|运营|租金|竞品/u)) return 'market'
  if (fieldMatches(/\b(?:traffic|parking|transit|mobility)\b/u) || contextMatches(/交通|停车|公交/u)) return 'transport'
  if (fieldMatches(/\b(?:utilities|utility|energy|power)\b/u) || contextMatches(/市政|能源|电力|管线/u)) return 'utilities'
  if (fieldMatches(/\b(?:heritage|culture|tourism)\b/u) || contextMatches(/文保|文化|旅游/u)) return 'culture'
  if (fieldMatches(/\b(?:cost|costs|capex|opex|rate|rates|quantity|quantities|tax|taxes|contingency|contingencies)\b/u) || contextMatches(/造价|投资|成本|单价|工程量/u)) return 'cost'
  if (fieldMatches(/\b(?:finance|financing|fund|funding|cashflow|cashflows|return|returns|revenue|revenues|npv|irr|dscr)\b/u) || contextMatches(/财政|融资|资金|收益/u)) return 'finance'
  if (fieldMatches(/\b(?:standard|standards)\b/u) || contextMatches(/标准|规范/u)) return 'standard'
  if (fieldMatches(/\b(?:policy|policies|regulation|regulations)\b/u) || contextMatches(/法规|政策/u)) return 'policy'
  if (fieldMatches(/\b(?:planning|spatial|layout|zone|zones|geometry|area|areas|height|heights|building|buildings|site)\b/u) || contextMatches(/空间|规划|建筑|场地|面积|布局/u)) return 'spatial_planning'
  if (fieldMatches(/\b(?:schedule|schedules|phase|phases|milestone|milestones|procurement|governance|implementation)\b/u) || contextMatches(/实施|进度|采购|治理|分期|时序|启动计划/u)) return 'implementation'
  if (fieldMatches(/\b(?:industry|industrial)\b/u) || contextMatches(/产业/u)) return 'industry'
  return 'project_analysis'
}

const QUERY_HINTS = {
  'cn-local-gov-official': '{project_location} {workflow_title} 官方 数据 规划 政策',
  'cn-gov-policy': '{project_type} {project_location} {workflow_title} 政策 法规',
  'cn-mnr': '{project_location} {workflow_title} 国土空间 土地 规划',
  'cn-mohurd': '{project_type} {workflow_title} 住房城乡建设 工程 标准 管理',
  'cn-standards': '{workflow_title} 标准 规范 {standard_keyword_or_number}',
  'cn-cma': '{project_location} 气候 温度 降水 风 数据',
  'cn-gsxt': '{project_owner_name} {operator_name}',
  'cn-mee': '{project_location} {workflow_title} 生态 环境 污染 环评',
  'cn-mwr': '{project_location} {workflow_title} 水文 防洪 水资源',
  'cn-mot': '{project_location} {workflow_title} 交通 运输 公交 停车',
  'cn-mem': '{project_location} {workflow_title} 安全 应急 灾害 消防',
  'cn-moe': '{project_location} {workflow_title} 教育 学校 设施',
  'cn-nhc': '{project_location} {workflow_title} 医疗 卫生 健康 设施',
  'cn-mca': '{project_location} {workflow_title} 养老 社区 民政 服务',
  'cn-ndrc': '{project_location} {workflow_title} 产业 投资 市场 价格',
  'cn-mof': '{workflow_title} 财政 政府投资 采购 资金',
  'cn-mct': '{project_location} {workflow_title} 文旅 文化 遗产',
  'cn-miit': '{project_location} {workflow_title} 产业 工业 信息化 市场',
  'cn-nea': '{project_location} {workflow_title} 能源 电力 基础设施',
  'cn-nbs': '{project_location} {workflow_title} 人口 经济 产业 统计',
}

function externalSourcesFor(contract) {
  const text = `${contract.title} ${contract.purpose}`
  const ids = new Set(['cn-local-gov-official'])
  if (/政策|法规|制度|审批|合规/u.test(text)) ids.add('cn-gov-policy')
  if (/土地|权属|规划|空间|用地|场地|边界|红线/u.test(text)) ids.add('cn-mnr')
  if (/建筑|工程|建设|城市|空间|功能|规模|造价|市政/u.test(text)) ids.add('cn-mohurd')
  if (/标准|指标|规范|规模|技术|安全|功能/u.test(text)) ids.add('cn-standards')
  if (/自然|生态|环境|污染/u.test(text)) ids.add('cn-mee')
  if (/水系|水文|洪涝|防洪|水资源/u.test(text)) ids.add('cn-mwr')
  if (/气候|天气|风|热环境/u.test(text)) ids.add('cn-cma')
  if (/安全|灾害|韧性|消防|应急/u.test(text)) ids.add('cn-mem')
  if (/人口|人群|需求|客流|产业|市场|经济/u.test(text)) ids.add('cn-nbs')
  if (/公共服务|教育|学校/u.test(text)) ids.add('cn-moe')
  if (/公共服务|医疗|卫生|健康/u.test(text)) ids.add('cn-nhc')
  if (/公共服务|养老|社区|民政|福利/u.test(text)) ids.add('cn-mca')
  if (/文化|文保|遗产|旅游|文旅/u.test(text)) ids.add('cn-mct')
  if (/产业|市场|商业|投资|价格|运营|经济|融资/u.test(text)) ids.add('cn-ndrc')
  if (/产业|工业|信息化|数字/u.test(text)) ids.add('cn-miit')
  if (/企业|主体|运营方|商户|产权/u.test(text)) ids.add('cn-gsxt')
  if (/交通|停车|公交|出行|道路/u.test(text)) ids.add('cn-mot')
  if (/能源|电力|市政|基础设施/u.test(text)) ids.add('cn-nea')
  if (/财政|融资|资金|政府投资|采购|实施/u.test(text)) ids.add('cn-mof')
  return [...ids]
}

function sourcePurpose(sourceId, contract) {
  const base = `${contract.work_item_id} ${contract.title}`
  const purposes = {
    'project-state-store': `读取 ${base} 所需的已确认上游 Project State、Revision、EvidenceRef 与 AnalysisTrace。`,
    'workspace-project-files': `提取 ${base} 相关任务书、图纸、测绘、台账、调查、会议纪要、正式表格和实测资料。`,
    'professional-tool-output': `对 ${base} 中可确定性计算的空间、统计、规模、造价、财务或优化指标进行可复算计算。`,
    'cn-local-gov-official': `查询项目所在地政府和主管部门发布的与 ${base} 直接相关的地方正式数据、规划、名录和政策。`,
    'cn-gov-policy': `核验 ${base} 涉及的国家层面政策、行政法规和国务院文件。`,
    'cn-mnr': `核验 ${base} 涉及的自然资源、土地和国土空间规划政策/公开数据。`,
    'cn-mohurd': `核验 ${base} 涉及的建设管理、城市建设、工程标准和造价政策。`,
    'cn-standards': `核验 ${base} 所引用国家/行业/地方标准的编号、名称、状态和实施日期。`,
    'cn-cma': `获取 ${base} 所需的官方气象/气候数据。`,
    'cn-gsxt': `核验 ${base} 涉及企业、运营主体或项目主体的法定身份。`,
    'cn-mee': `核验 ${base} 涉及生态环境、污染、环评和环境质量信息。`,
    'cn-mwr': `核验 ${base} 涉及水文、防洪、水资源和水安全信息。`,
    'cn-mot': `核验 ${base} 涉及交通运输、出行和行业政策信息。`,
    'cn-mem': `核验 ${base} 涉及安全、灾害、应急和韧性政策信息。`,
    'cn-moe': `核验 ${base} 涉及教育服务和教育设施政策/统计。`,
    'cn-nhc': `核验 ${base} 涉及医疗卫生和健康服务政策/机构信息。`,
    'cn-mca': `核验 ${base} 涉及养老、社区和社会服务政策/公开数据。`,
    'cn-ndrc': `核验 ${base} 涉及产业、投资、价格、市场和发展政策。`,
    'cn-mof': `核验 ${base} 涉及财政、政府投资、采购和资金政策。`,
    'cn-mct': `核验 ${base} 涉及文化、旅游、公共文化和遗产政策/名录。`,
    'cn-miit': `核验 ${base} 涉及产业、工业和信息基础设施政策/统计。`,
    'cn-nea': `核验 ${base} 涉及能源、电力和相关基础设施政策/统计。`,
    'cn-nbs': `获取 ${base} 所需的人口、经济、产业和统计基准。`,
  }
  return purposes[sourceId] ?? `为 ${base} 提供可追溯数据。`
}

function sourceSupports(source, dataKind) {
  return source.supportedDataKinds.includes('*') || source.supportedDataKinds.includes(dataKind)
}

function needsTool(field, dataKind) {
  return /area|height|capacity|coverage|accessibility|utilization|traffic|parking|quantity|rate|cost|capex|opex|finance|cashflow|score|ranking|geometry|spatial|scale|指标|面积|容量|成本|投资|交通|空间/u.test(`${field} ${dataKind}`)
}

function exactSiteData(field, dataKind) {
  return /parcel|boundary|geometry|area|building|owner|right|lease|mortgage|condition|occupancy|capacity|traffic|parking|utilities|fire|structural|risk_point|site|land/u.test(field) || ['land', 'spatial_planning', 'transport', 'utilities', 'safety'].includes(dataKind)
}

function dataPoint(field, contract) {
  const kind = inferDataKind(field, contract)
  return {
    dataPointId: field.replaceAll('_', '-'),
    label: labelField(field),
    dataKind: kind,
    description: `${contract.work_item_id} ${contract.title} 中“${labelField(field)}”的数据/判断输入；必须保留来源、时间、口径与限制。`,
    unit: null,
  }
}

function buildSpec(contract, stateSchema, sourceById) {
  const dataSchema = stateSchema?.properties?.data
  const properties = dataSchema?.properties ?? {}
  const requiredFields = Array.isArray(dataSchema?.required) ? dataSchema.required : Object.keys(properties)
  const optionalFields = Object.keys(properties).filter(field => !requiredFields.includes(field))
  const requiredDataPoints = requiredFields.map(field => dataPoint(field, contract))
  const optionalDataPoints = optionalFields.map(field => dataPoint(field, contract))
  const allDataPoints = [...requiredDataPoints, ...optionalDataPoints]
  const fieldByDataPointId = new Map([...requiredFields, ...optionalFields].map(field => [field.replaceAll('_', '-'), field]))

  const sourceIds = new Set()
  if ((contract.reads ?? []).length > 0) sourceIds.add('project-state-store')
  sourceIds.add('workspace-project-files')
  for (const sourceId of externalSourcesFor(contract)) sourceIds.add(sourceId)
  if (allDataPoints.some(point => needsTool(fieldByDataPointId.get(point.dataPointId) ?? '', point.dataKind))) sourceIds.add('professional-tool-output')

  const preferredSources = [...sourceIds].map(sourceId => ({
    sourceId,
    purpose: sourcePurpose(sourceId, contract),
    required: sourceId === 'project-state-store' && Number(contract.chapter_id) >= 3
      ? true
      : sourceId === 'workspace-project-files' && Number(contract.chapter_id) === 2,
  }))

  const queryTemplates = [...sourceIds]
    .filter(sourceId => QUERY_HINTS[sourceId] !== undefined)
    .map(sourceId => ({ sourceId, template: QUERY_HINTS[sourceId] }))

  const workItem = contract.work_item_id
  const steps = []
  const sourceStepIds = []
  let order = 1
  const pushStep = (title, dependsOnStepIds, dataPointIds, stepSourceIds, action, produces, notes) => {
    const stepId = `${workItem}-S${String(order).padStart(2, '0')}`
    steps.push({ stepId, order, title, dependsOnStepIds, dataPointIds, sourceIds: stepSourceIds, action, produces, ...(notes ? { notes } : {}) })
    order += 1
    return stepId
  }

  if (sourceIds.has('project-state-store')) {
    const id = pushStep('读取已确认上游 Project State 与证据链', [], requiredDataPoints.map(point => point.dataPointId), ['project-state-store'], 'upstream_state_read', 'evidence', '只读取明确 Revision；保留底层 EvidenceRef/AnalysisTrace，不改变原 claimClass。')
    sourceStepIds.push(id)
  }

  const workspacePointIds = allDataPoints.filter(point => exactSiteData(fieldByDataPointId.get(point.dataPointId) ?? '', point.dataKind) || Number(contract.chapter_id) === 2).map(point => point.dataPointId)
  if (workspacePointIds.length > 0) {
    const id = pushStep('读取项目正式资料、调查与实测', [], workspacePointIds, ['workspace-project-files'], 'workspace_extract', 'evidence', '优先项目正式资料；文件必须记录版本、页码/表格/图层/对象定位与内容哈希。')
    sourceStepIds.push(id)
  }

  for (const sourceId of [...sourceIds].filter(id => !['project-state-store', 'workspace-project-files', 'professional-tool-output'].includes(id))) {
    const source = sourceById.get(sourceId)
    if (!source) continue
    const pointIds = allDataPoints.filter(point => sourceSupports(source, point.dataKind)).map(point => point.dataPointId)
    if (pointIds.length === 0) continue
    const id = pushStep(`查询 ${source.name}`, [...sourceStepIds], pointIds, [sourceId], 'official_source_lookup', 'evidence', `只采信 ${source.allowedDomains.join(' / ') || '登记来源'} 内的原始官方页面；搜索摘要和转载只作发现线索。`)
    sourceStepIds.push(id)
  }

  const normalizeId = pushStep('统一时间、空间、单位与对象口径', [...sourceStepIds], allDataPoints.map(point => point.dataPointId), [], 'normalize', 'normalized_data', '不得通过标准化改变原始事实含义；所有换算保留原值、公式和目标单位。')
  let previousIds = [normalizeId]

  const toolPointIds = allDataPoints.filter(point => needsTool(fieldByDataPointId.get(point.dataPointId) ?? '', point.dataKind)).map(point => point.dataPointId)
  if (sourceIds.has('professional-tool-output') && toolPointIds.length > 0) {
    const calcId = pushStep('执行确定性专业计算/复算', [normalizeId], toolPointIds, ['professional-tool-output'], 'deterministic_calculation', 'calculation_result', 'GIS/BIM/统计/造价/财务等计算必须记录输入 Evidence、参数、公式/算法版本和输出。')
    previousIds = [normalizeId, calcId]
  }

  const crossId = pushStep('交叉核验证据、来源与冲突', previousIds, allDataPoints.map(point => point.dataPointId), [], 'cross_check', 'cross_check_result', '冲突证据保留 conflict；全国宏观资料不得覆盖项目地块/建筑/设施的地方或项目正式事实。')
  const aggregateId = pushStep('按权威等级与统一口径汇总', [crossId], allDataPoints.map(point => point.dataPointId), [], 'aggregate', 'aggregated_data', '按 P0>P1>P2>P3>P4>P5 合并；同级冲突不静默择一。')
  const analysisId = pushStep(`形成“${contract.title}”专业分析`, [aggregateId], allDataPoints.map(point => point.dataPointId), [], 'professional_analysis', 'analysis_trace', `围绕“${contract.purpose}”解释证据、差异、限制和专业含义，不新增无来源事实。`)
  const validationId = pushStep('独立核验证据覆盖、时效与可追溯性', [analysisId], requiredDataPoints.map(point => point.dataPointId), [], 'evidence_validate', 'validated_evidence', 'Evidence Validator 独立检查必需数据项、来源等级、时效、域名、冲突和高风险 A 级证据。')
  pushStep('输出可追溯结论', [validationId], requiredDataPoints.map(point => point.dataPointId), [], 'produce_claims', 'claims', '每个结论必须可回溯到 ResearchStep、DataPoint、EvidenceRecord、方法版本和限制。')

  const risk = contract.risk ?? 'M'
  const hasMultipleSources = preferredSources.length >= 2
  const highRisk = risk === 'H'
  const outputClaims = [...requiredDataPoints.slice(0, 4).map(point => point.label), `${contract.title}综合研判与限制`]

  const exact = allDataPoints.some(point => exactSiteData(fieldByDataPointId.get(point.dataPointId) ?? '', point.dataKind))
  let fallbackPolicy = '缺失数据保持 unknown/limited，不由 LLM 补写事实；继续完成不受影响的并行项，并记录 blocked_external 或 quality_unresolved。'
  if (exact) fallbackPolicy = '缺少项目正式资料或项目所在地法定/实测证据时，具体地块、资产、建筑、容量、安全和空间结论保持 blocked_external/limited；不得用全国宏观资料或 LLM 推断具体项目事实。'
  if (/投资|造价|成本|财务|融资|资金/u.test(`${contract.title} ${contract.purpose}`)) fallbackPolicy = '缺少真实工程量、价格/费率、基准日或财务参数时，只输出缺口、公式和情景，不生成无来源金额；相关项保持 blocked_external/quality_unresolved。'

  return {
    workflowId: contract.workflow_id,
    requiredDataPoints,
    optionalDataPoints,
    preferredSources,
    queryTemplates,
    extractionRules: [
      `围绕“${contract.purpose}”只提取与当前 Workflow 直接相关的事实、材料原结论和可复算参数。`,
      '所有 fact/source_conclusion 必须绑定 EvidenceRecord；推断、假设和用户陈述保持原 claimClass。',
      '项目地块/建筑/资产/设施的具体事实优先项目正式资料或所在地官方数据，不用国家宏观口径代替。',
    ],
    normalizationRules: [
      '日期统一为 ISO 格式并保留统计期/基准日；单位换算保存原值、原单位和公式。',
      '空间数据保留 CRS、几何/对象哈希与来源定位；同名对象先做身份消歧再汇总。',
      '统计/市场/设施数据必须统一时间、空间范围、样本和指标定义后才允许比较。',
    ],
    researchSteps: steps,
    aggregationMethod: { methodId: `${workItem.toLowerCase().replace('-', '')}-authority-trace-merge`, version: '1.0.0', description: '按来源权威等级、时间有效性、对象一致性和口径一致性进行确定性去重、冲突保留与汇总。', deterministic: true },
    analysisMethod: { methodId: `${workItem.toLowerCase().replace('-', '')}-professional-analysis`, version: '1.0.0', description: `基于已核验证据和确定性计算，对“${contract.title}”进行专业解释、比较、约束/机会识别并形成可追溯结论。`, deterministic: false },
    crossCheckRules: [
      '全国/省级宏观信息只能提供背景、标准或基准，不得直接证明具体项目地块/建筑/设施事实。',
      'Project State 作为来源时必须继承底层 EvidenceRef/AnalysisTrace；不得因进入下游 Workflow 自动提升可靠等级或 claimClass。',
      '来源冲突不得静默覆盖；必须保留冲突项、来源、时间和影响范围。',
      '可确定性计算的指标必须由专业工具或明确公式复算，不由 LLM 心算生成。',
    ],
    freshnessRules: [
      'Project State 绑定精确 Revision；上游发生语义变化后当前结果自动 stale 并重算。',
      '政策、规划、标准、价格、设施开放状态和市场数据在项目启动、相关 Gate 前及来源更新后重新核验。',
    ],
    minimumEvidence: { minHighAuthority: highRisk ? 1 : 0, minIndependentSources: highRisk && hasMultipleSources ? 2 : 1, highRiskRequiresGradeA: highRisk },
    fallbackPolicy,
    outputClaims: [...new Set(outputClaims)],
  }
}

const sourceDoc = await readJson('research/v2.0.1/data-sources.json')
const sourceMap = new Map(sourceDoc.sources.map(row => [row.sourceId, row]))
for (const source of NEW_SOURCES) sourceMap.set(source.sourceId, source)
sourceDoc.sources = [...sourceMap.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId))
await writeJson('research/v2.0.1/data-sources.json', sourceDoc)

const auditDoc = await readJson('research/v2.0.1/source-audit-status.json')
const auditMap = new Map(auditDoc.checks.map(row => [row.sourceId, row]))
for (const row of AUDIT_ROWS) auditMap.set(row.sourceId, row)
auditDoc.checkedAt = '2026-09-13T04:00:00Z'
auditDoc.checks = [...auditMap.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId))
await writeJson('research/v2.0.1/source-audit-status.json', auditDoc)

const liveSourceById = new Map(sourceDoc.sources.map(row => [row.sourceId, row]))
const workflowDir = resolve(root, 'contracts/v0.6/workflows')
const workflowFiles = (await readdir(workflowDir)).filter(name => /^preplan\.wf\.\d{2}\.\d{2}\.contract\.json$/u.test(name)).sort()
const generatedByChapter = new Map()
const existingIds = new Set()
for (const name of ['workflow-research-specs.json', 'workflow-research-specs-ch01.json']) {
  const doc = await readJson(`research/v2.0.1/${name}`)
  for (const row of doc.workflows) existingIds.add(row.workflowId)
}

for (const name of workflowFiles) {
  const contract = await readJson(`contracts/v0.6/workflows/${name}`)
  if (existingIds.has(contract.workflow_id)) continue
  const statePath = `contracts/v0.6/state/${contract.writes}.schema.json`
  const stateSchema = await readJson(statePath)
  const spec = buildSpec(contract, stateSchema, liveSourceById)
  const chapter = contract.chapter_id
  const rows = generatedByChapter.get(chapter) ?? []
  rows.push(spec)
  generatedByChapter.set(chapter, rows)
}

for (const chapter of ['02', '03', '04', '05', '06', '07', '08']) {
  const rows = (generatedByChapter.get(chapter) ?? []).sort((a, b) => a.workflowId.localeCompare(b.workflowId))
  await writeJson(`research/v2.0.1/workflow-research-specs-ch${chapter}.json`, { schemaVersion: '2.0.1', workflows: rows })
}

const coverageIds = new Set(existingIds)
for (const rows of generatedByChapter.values()) for (const row of rows) coverageIds.add(row.workflowId)
if (coverageIds.size !== 57) throw new Error(`expected 57 workflow research specs, got ${coverageIds.size}`)
const missing = workflowFiles.map(name => name.replace('.contract.json', '')).filter(id => !coverageIds.has(id))
if (missing.length) throw new Error(`missing generated research specs: ${missing.join(', ')}`)
console.log(`PRE_V2_0_1_FULL_RESEARCH_COVERAGE_PASS workflows=${coverageIds.size} sources=${sourceDoc.sources.length}`)
