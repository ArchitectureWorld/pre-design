import type { FrozenReportEntry, FrozenReportSection } from './types.ts'

const OMITTED_FIELDS = new Set([
  'id', 'object_id', 'objectId', 'object_type', 'project_id', 'chapter_id', 'work_item_id',
  'schema_version', 'revision', 'created_at', 'updated_at', 'created_by', 'source_snapshot',
  'approval', 'prompt', 'promptSummary', 'actor_id', 'event_type', 'event_id', 'scope_type',
  'version_id', 'asset_id', 'evidence_id', 'quote_hash', 'captured_at', 'admin_codes',
  'geometry_refs', 'data_versions', 'evaluation_model_version', 'snapshot_id', 'contact_ref',
])

const EVIDENCE_FIELDS = new Set([
  'basis', 'source_ref', 'source', 'sources', 'evidence_refs', 'confidence', 'as_of', 'method',
  'data_sources', 'survey_refs', 'photo_refs', 'locator', 'reliability', 'claim_class',
])

// These labels describe professional content, not the workflow's storage vocabulary.
const LABELS: Readonly<Record<string, string>> = {
  name: '名称', title: '标题', label: '指标名称', description: '内容说明', summary: '综合判断',
  conclusion: '结论', recommendation: '建议', statement: '说明', value: '指标值', unit: '单位',
  min: '下限', max: '上限', formula: '计算方法', formulas: '计算关系', method: '调查与计算方法',
  expression: '计算表达式', numerator: '分子', denominator: '分母', variables: '计算变量',
  basis: '依据', source_ref: '资料来源', source: '资料来源', sources: '资料来源',
  notes: '补充说明', limitations: '适用限制', confidence: '证据可信度', level: '可信程度',
  score: '评估值', status: '当前状态', claim_class: '内容性质', reliability: '来源可靠性',
  evidence_refs: '证据说明', locator: '资料定位', section: '章节位置', page: '页码',
  as_of: '数据时点', type: '类型', kind: '类型', role: '承担角色', origin_mode: '启动类型',
  mandatory_level: '约束性质', decision_scope: '决策范围', subquestions: '需回答的问题',
  excluded_decisions: '本轮不决策事项', decision_owner: '决策主体', decision_question: '核心决策问题',
  urgency: '紧迫性', acceptance_criteria: '成果验收标准', content_scope: '研究内容',
  exclusions: '不纳入范围', impact_scope: '影响范围', study_scope: '研究范围',
  phase_scope: '阶段范围', implementation_scope: '实施范围', influence: '主体影响力',
  roles: '职责分工', decision_edges: '决策关系', engagement_priority: '参与优先级',
  actors: '参与主体', interests: '主体利益', confirmation_owner: '确认主体',
  category: '条件分类', route_tags: '适用路径', flexibility: '可调整程度',
  effective_status: '条件有效性', source_level: '依据层级', validation_tasks: '待验证事项',
  constraints: '约束条件', spatial_scope: '空间范围', deadline: '完成期限',
  decision_to_support: '需支持的决策', depth_level: '研究深度', precision: '精度要求',
  required_disciplines: '专业协同要求', formats: '成果形式', use_case: '成果用途',
  audience: '汇报对象', review_criteria: '评审标准', quality_profile: '资料质量',
  relevance: '资料关联性', version_relations: '资料版本关系', gaps: '资料与能力缺口',
  blocking_level: '缺口影响程度', downstream_task: '受影响任务', due_date: '补充期限',
  conflicts: '矛盾与冲突', owner: '责任主体', asset_index: '资料目录',
  leases: '租赁关系', right_types: '权利类型', disposition_constraints: '处置约束',
  parcel_ids: '涉及地块', objects: '涉及对象', building_ids: '涉及建筑',
  mortgages: '抵押情况', verification_status: '权属核实情况', areas: '面积与规模',
  current_use: '现状使用', ecology: '生态条件', climate: '气候条件', terrain: '地形地貌',
  resolution: '调查精度', hazards: '灾害风险', contamination: '污染状况', hydrology: '水文条件',
  sensitivity_zones: '生态敏感区', geology: '地质条件', age: '建成年代', heights: '建筑高度',
  photo_refs: '现场照片依据', vacancy: '闲置情况', condition: '现状状况', building_use: '建筑使用',
  geometry: '空间形态', occupancy: '使用强度', heritage: '历史文化资源', groups: '使用人群',
  population: '人口规模', demographics: '人口特征', samples: '调查样本', peak_periods: '高峰时段',
  time_patterns: '时间规律', origins: '人群来源', households: '户数与家庭结构',
  shareability: '共享条件', utilization: '利用率', pricing: '收费现状', facilities: '设施现状',
  types: '设施类型', hours: '开放时间', operator: '运营主体', accessibility: '可达性与无障碍',
  capacity: '供给能力', coverage: '服务覆盖', sales: '经营销售', footfall: '客流现状',
  time_range: '统计时段', businesses: '经营业态', rents: '租金水平', pois: '周边设施',
  competitors: '竞争供给', operators: '运营机构', supply_structure: '供给结构', sectors: '产业结构',
  structural_safety: '结构安全', risk_points: '风险点位', fire_safety: '消防安全', traffic: '交通现状',
  parking: '停车供给', survey_refs: '调查依据', utilities: '市政设施', mobility_network: '出行网络',
  transit: '公共交通', severity: '问题严重程度', location: '空间位置', conflict_type: '冲突类型',
  rights: '主体权利', negotiability: '可协商空间', claims: '主体诉求', evidence_strength: '因果证据强度',
  cause_nodes: '问题根因', feedback_loops: '反馈回路', alternative_explanations: '其他可能成因',
  leverage_points: '关键干预点', edges: '因果关系', effect_nodes: '影响后果', problem_nodes: '问题链',
  from: '起点', to: '指向', relation: '作用关系', strength: '关联强度',
  activation_conditions: '资源激活条件', resource_type: '资源类型', potential: '发展潜力',
  resources: '资源清单', current_state: '当前状态', cost_risks: '成本与风险', uniqueness: '独特性',
  geography: '区域范围', linked_opportunities: '相关机会', topics: '关键策划议题', equity: '公平性',
  strategic_fit: '战略契合度', leverage: '带动作用', score_range: '评价区间', linked_issues: '关联问题',
  feasibility: '可行条件', desired_direction: '目标方向', objectives: '目标体系', baseline_refs: '目标基线',
  horizons: '目标时限', parents: '层级关系', definitions: '定义与口径', frequency: '监测频次',
  baselines: '基线值', targets: '目标值', kpis: '绩效指标', units: '计量单位', tolerances: '容许偏差',
  test_methods: '校核方法', waiver_authority: '例外审批主体', veto_rules: '否决条件',
  thresholds: '控制阈值', breach_consequences: '突破约束的后果', target_groups: '目标人群',
  value_propositions: '价值主张', differentiation: '差异化方向', risks: '主要风险',
  role_boundaries: '角色边界', directions: '候选方向', version: '评价口径版本', weights: '评价权重',
  sensitivity_ranges: '敏感性区间', scoring_rules: '评分规则', data_sources: '数据来源',
  metrics: '比较指标', criteria: '评价准则', price_base_date: '价格基准日',
  implementation_logic: '实施逻辑', options: '备选方案', operating_logic: '运营逻辑',
  intervention_intensity: '干预强度', difference_fingerprint: '实质差异', omitted_measures: '不采用措施',
  logic: '方案逻辑', core_measures: '核心措施', target_issues: '目标问题', option_id: '对应方案',
  phasing: '分期安排', preconditions: '前置条件', implementation_packages: '实施组合',
  spatial_carriers: '空间载体', function_packages: '功能组合', capacity_flags: '容量校核结论',
  area_ranges: '面积区间', capacity_ranges: '容量区间', capex_range: '建设投资区间',
  funding_ideas: '资金筹措设想', revenue_or_benefits: '收入与效益', opex_range: '运营成本区间',
  stress_cases: '压力情景', mitigations: '应对措施', expert_tasks: '专项论证任务', dimensions: '审查维度',
  blockers: '阻断条件', authority_feedback: '主管部门意见', rules_or_conditions: '规则与条件',
  criteria_scores: '分项评价', robustness: '推荐稳健性', veto_results: '底线审查结果',
  evidence_coverage: '依据覆盖程度', tradeoffs: '方案取舍', rank_intervals: '排名区间',
  sensitivity_results: '敏感性比较', recommended_option: '推荐方案', backup_option: '备选方案',
  rejected_options: '不推荐方案', service_links: '服务关联', functions: '功能构成',
  optional_conditions: '可选功能条件', priorities: '优先次序', served_groups: '服务人群',
  function_types: '功能层级', parameter_sources: '计算参数来源', throughput: '单位时间服务量',
  gross_factors: '面积系数', peak: '高峰需求', gross_areas: '总面积', demand: '需求规模',
  turnover: '周转频次', net_areas: '净面积', function_links: '功能关联', brand_level: '品牌要求',
  time_schedules: '分时安排', separation_rules: '分离规则', distribution_mode: '配置方式',
  shared_resources: '共享资源', adjacency_scores: '邻接要求', flexibility_modules: '弹性模块',
  flows: '使用流线', capacity_protection: '公益容量保障', service_class: '服务性质',
  subsidy_or_cross_support: '补贴与交叉支持', approval_status: '审批落实情况',
  pricing_principles: '收费原则', asset_class: '资产性质', maintenance_responsibility: '维护责任',
  funding_restrictions: '资金用途限制', capacities: '容量指标', function_schedule: '功能配置表',
  master_data_version: '策划依据版本', equipment: '设备要求', adjacencies: '功能邻接',
  operating_hours: '运营时段', staffing: '人员配置', service_standards: '服务标准',
  parcel_building_floor_refs: '地块建筑与楼层', placements: '功能落位',
  height_load_requirements: '高度与荷载要求', alternative_carriers: '备选载体',
  required_inspections: '必需检测', heritage_value: '文化价值', ownership: '产权条件',
  action: '干预方式', cost_range: '成本区间', use_fit: '使用适应性', building_refs: '相关建筑',
  safety: '安全条件', bottlenecks: '交通瓶颈', external_access: '对外接驳', fire_access: '消防通达',
  peak_scenarios: '高峰情景', pedestrian: '步行流线', bicycle: '骑行流线', vehicles: '机动车流线',
  loading: '后勤装卸', shared_parking: '共享停车', maintenance: '日常管护', event_spaces: '活动空间',
  service_nodes: '服务节点', resilience: '韧性措施', green_blue_system: '蓝绿生态系统',
  rainwater: '雨洪管理', shade_heat: '遮荫与热环境', open_space_network: '公共空间网络',
  solutions: '技术方案', systems: '专项系统', existing_capacity: '现有能力', required_capacity: '所需能力',
  authorities: '主管部门', tests: '专项校核', temporary_uses: '临时利用', future_reserve: '远期预留',
  relocations: '搬迁与转移', access: '施工期间通达', handover: '交接安排',
  independent_operation: '独立运营条件', base_date: '估算基准日', timelines: '筹资时序',
  funding_gap: '资金缺口', asset_type: '资产类型', package_id: '对应项目包', amounts: '资金规模',
  eligible_sources: '可申请资金', fallbacks: '替代资金安排', policy_matches: '政策适配',
  approval_items: '报批事项', property_actions: '产权处置', social_risks: '社会影响风险',
  relocation: '征迁安置', durations: '预计耗时', sequence: '办理次序',
  governance: '建设运营协同机制', lifecycle_tasks: '全周期职责', maintenance_entity: '维护主体',
  raci: '职责分工', procurement_or_contract: '采购与合同机制', capability_gaps: '能力缺口',
  delivery_entity: '建设主体', taxes: '税费', subsidies: '补贴假设', triggers: '风险触发条件',
  probability: '发生可能性', post_evaluation: '后评估安排', kpi_monitoring: '绩效监测',
  rollback_actions: '回退措施', review_cycle: '复核周期', organization: '所属机构',
  authority_scope: '职责权限', title_ref: '参考名称', url: '资料链接',
  ranges: '数值区间', scenarios: '情景分析', npv: '财务净现值', irr: '内部收益率',
  dscr: '偿债备付率', financing: '资金结构',
}

const ENUMS: Readonly<Record<string, string>> = {
  pending: '待审批', pending_review: '待复核', provisional: '初步成果', confirmed: '已确认',
  approved: '已批准', approved_with_conditions: '附条件批准', rejected: '未通过',
  blocked: '受阻', not_started: '尚未启动', in_progress: '进行中', completed: '已完成',
  planned: '方案建议', active: '现行有效', inactive: '尚未生效', unknown: '尚待核实',
  missing: '资料缺失', not_provided: '尚未提供', not_verified: '尚未核实', verified: '已核实',
  high: '高', medium: '中等', low: '低', very_high: '很高', very_low: '很低',
  strong: '较强', weak: '较弱', mandatory: '强制要求', recommended: '建议采用', optional: '可选',
  mixed: '综合驱动', public_need: '公共需求驱动', market_opportunity: '市场机会驱动',
  user_statement: '用户陈述', fact: '资料事实', professional_judgement: '专业判断',
  assumption: '待验证假设', recommendation: '方案建议', decision: '决策意见',
  operational_mechanism: '运营机制', guideline: '设计原则', identified_risk: '已识别风险',
  resilience_measure: '韧性措施', principle: '基本原则', priority_node: '优先试点',
  contributes_to: '促成', leads_to: '导致', causes: '引起', mitigates: '缓解',
  decision_owner: '决策负责人', project_owner: '项目负责人', agent: '策划助手',
  propose: '提出建议', review: '审查', approve: '批准', confirm: '确认',
  ratio: '比例', yuan: '元', percentage: '%', baseline: '基准情景', conservative: '保守情景',
  optimistic: '乐观情景', pessimistic: '不利情景', public: '公益', commercial: '经营',
  core: '核心', support: '支撑', shared: '共享', retain: '保留', renovate: '改造',
  demolish: '拆除', new_build: '新建', responsible: '执行责任', accountable: '最终负责',
  consulted: '参与协商', informed: '知会', A: '较高可靠性', B: '一般可靠性', C: '待补证',
  active_sourcing: '主动收集资料', affected_group: '受影响群体', water_use: '用水',
  beneficiary_group: '受益群体', spatial_compliance: '空间合规审查', compliance_reviewer: '合规审查主体',
  beneficiary_and_affected: '兼具受益与受影响关系', public_policy: '公共政策', non_blocking: '不构成当前阻断',
  partially_verified: '部分已核实', source_conclusion: '资料结论', agent_inference: '推导判断',
  agricultural_user: '农业用水主体', downstream_beneficiary: '下游受益主体', proxy_estimated: '替代指标估算',
  proxy_sample: '替代样本', planned_survey: '计划调查', exploratory_sample: '探索性样本',
  seasonal_flood: '汛期', seasonal_drought: '枯水期', seasonal_recreation: '季节性游憩',
  observed_remote_sensing: '遥感判读', not_applicable: '不适用', daily_operation: '日常运营',
  individual_operator: '个体经营者', collective_asset_management: '集体资产管理', land_circulation: '土地流转',
  collective_operator: '集体运营主体', project_governance_authority: '项目主管部门',
  water_project_planning: '水利工程规划', reservoir_protection_regulation: '水库保护管理',
  conditional_shared: '满足条件后共享', conditional_regulated: '按条件管控',
  collective_electricity_cost: '集体承担用电费用', free_public: '公益免费', unpriced_free: '暂未定价，免费使用',
  operational_degraded: '运行能力退化', operational_rudimentary: '基础运行条件简陋',
  operational_constrained: '运行受限', operational_limited: '运行能力有限', unmanaged_informal: '自发使用，缺乏管理',
  primary_functional: '主要功能可用', safety_critical: '安全关键项', basic_access: '基本通达',
  informal_provision: '非正式供给', seasonal_intermittent: '季节性间歇使用', flood_season_24h: '汛期全天值守',
  continuous_conditional: '满足条件后连续运行', irrigation_dispatch: '灌溉调度', flood_patrol: '防汛巡查',
  limited_heavy_vehicle: '重载车辆通行受限', pedestrian_rudimentary: '步行条件简陋',
  hazardous_unregulated: '存在危险且管控不足', provisional_reach_only: '初步确认可到达',
  provisional_point_source: '初步点位供给', provisional_topographic_constrained: '初步判断受地形限制',
  policy_aligned: '符合政策方向', demographics_and_peaks: '人口与高峰特征',
  local_demand_backed: '有本地需求支撑', weak_opportunity: '机会依据偏弱', competitors_and_vacancy: '竞争与空置情况',
  construction_execution: '施工组织实施', active_conflict: '现存冲突', critical_gap: '关键缺口',
  critical_bottleneck: '关键瓶颈', infrastructure_gap: '基础设施缺口', safety_hazard: '安全隐患',
  data_gap_blocker: '资料缺口阻断', precondition_engineering: '工程前置条件',
  precondition_renovation: '改造前置条件', precondition_survey_verification: '调查核实前置条件',
  precondition_ecological_compliance: '生态合规前置条件', precondition_governance_sharing: '管理与共享前置条件',
  precondition_safety_facilities: '安全设施前置条件', candidate_verified: '候选资源已核实',
  candidate_degraded: '候选资源现状退化', candidate_unverified: '候选资源待核实',
  candidate_provisional: '初步候选资源', candidate_unique: '具有独特性的候选资源',
  candidate_low_efficiency: '低效候选资源', candidate_underutilized: '利用不足的候选资源',
  candidate_unmanaged: '管理缺位的候选资源', cost_risk_high: '成本风险高',
  compliance_risk_high: '合规风险高', financial_risk_medium: '财务风险中等',
  legal_safety_risk_medium: '法律与安全风险中等', geotechnical_ecological_risk_medium: '地质生态风险中等',
  automated_test: '自动校核', manual_review: '人工复核', field_physical_test: '现场实体检测',
  model_simulation_test: '模型模拟校核', statutory_approval_authority: '法定审批机关',
  statutory_waiver_hearing: '法定例外听证', ecological_redline_special_approval: '生态红线专项审批',
  permanent_farmland_state_council_approval: '永久基本农田国务院审批',
  industry_regulator: '行业监管部门', local_government: '地方政府', affected_community: '受影响社区',
  beneficiary_community: '受益社区', provisional_task_bound: '初步任务约束',
  task_bound_target_empty: '任务已界定，目标值待明确', zero_tolerance: '零容忍',
  conditional_tolerance: '附条件容许偏差', water_quality_controlled_buffer: '水质管控缓冲区',
  beneficiary_residents: '受益居民', water_utilization: '水资源利用', water_consumer: '用水单位',
  affected_stakeholder: '受影响主体', resettlement_negotiation: '安置协商', public_visitor: '公众访客',
  passive_visitation: '低干预参访', mandatory_prerequisite: '强制前置条件',
  active_proposition: '当前价值主张', active_differentiation: '当前差异化方向', active_risk: '现存风险',
  active_boundary: '现行边界', candidate_hypothesis: '候选假设', active_signal: '当前监测信号',
  ranking_stable: '排序稳定', official_standard: '正式标准', generic_type: '通用类型',
  high_priority: '高优先级', medium_priority: '中优先级', low_priority: '低优先级',
  public_free: '公益免费', public_low_fee: '公益低收费', market_rate: '市场定价',
  public_service: '公共服务', revenue_asset: '经营性资产', pending_commission: '待委托',
  preliminary_unlisted_requires_field_survey: '初步未列名，需现场调查',
  preliminary_cultural_memory_cataloging: '初步文化记忆建档', ordinary_non_heritage_eligible_for_reuse: '普通非遗产对象，可评估再利用',
  collective_private_partially_verified_frozen: '集体与私人权属部分核实，范围已冻结',
  ownership_boundary_verification_pending: '产权边界待核实', land_conversion_and_allocation_pathway_defined: '用地转用与划拨路径已界定',
  preliminary_frozen_relocation_planned_demolition_forbidden_now: '初步冻结并计划迁移，现阶段禁止拆除',
  conditional_adaptive_reuse_with_dual_track_contingency: '附条件适应性再利用，预留替代安排',
  planned_new_construction: '拟新建', contingent_new_construction: '满足前提后新建',
  reversible_lightweight_installation: '可逆轻型设施', preservation_and_relocation_retention: '原址保护或迁移保留',
  inundation_unfit_relocation_required: '淹没影响下不适合保留，需迁移',
  conditionally_fit_requires_hybrid_adaptation: '附条件适用，需组合改造', optimally_fit: '适用性较好',
  mandatory_precondition: '必需前置条件', provisional_preliminary_classification: '暂定初步分类',
  provisional_alternative_carrier: '暂定备选载体', planned_contingent_construction: '附前提建设计划',
  planned_resettlement_construction: '拟建设安置设施', planned_reversible_installation: '拟设置可逆设施',
  preliminary_sampling_unverified: '初步抽样，尚待核实', pre_inspection_required: '必须先行检测',
  designed_for_compliance: '以满足合规为设计目标', approve_internal: '内部审定', admin_petition: '行政申报',
  land_pre_review: '用地预审', spatial_planning: '空间规划', land_conversion_approval: '用地转用审批',
  property_registration: '产权登记', project_approval: '项目审批', investment_review: '投资审查',
  feasibility_study_approval: '可研审批', eia_review: '环评审查', ecological_supervision: '生态监管',
  forest_land_approval: '林地审批', timber_cutting_license: '林木采伐许可',
  heritage_investigation: '文化遗产调查', archaeological_exploration: '考古勘探',
  relocation_implementation: '征迁实施', social_stability_maintenance: '社会稳定维护',
  collective_agreement: '集体协商协议', commercial_operation: '商业运营', recreation_management: '游憩管理',
  hybrid_public_commercial_infrastructure: '公益与经营复合基础设施', eligible_uncommitted: '符合申请条件，尚未落实',
  dam_safety_monitoring: '大坝安全监测', hydraulic_facility_maintenance: '水工设施维护',
  flood_gate_operation: '闸门运行', reservoir_clearing: '库区清理', emergency_repair: '应急抢修',
  project_legal_person: '项目法人', technical_investigation: '技术调查', engineering_design: '工程设计',
  technical_consultant: '技术顾问', regulator_and_sponsor: '监管与发起主体', project_review: '项目审查',
  project_approver: '项目审批主体', environmental_regulator: '环境监管部门', forestry_regulator: '林业监管部门',
  affected_entity: '受影响单位', field_action_team: '现场工作组', agreement_signing: '协议签署',
  social_stability: '社会稳定', housing_construction: '住房建设', general_contractor: '总承包单位',
  relocation_fund_supervision: '征迁资金监管', land_authority: '自然资源主管部门', village_site_approval: '村庄选址审批',
  relocation_execution: '征迁执行', relocation_authority: '征迁主管部门', quality_supervisor: '质量监督单位',
  quality_safety_inspection: '质量安全检查', technical_advisor: '技术顾问', technical_review: '技术审查',
  project_delivery: '项目交付', quality_supervision: '质量监督', engineering_construction: '工程建设',
  construction_supervision: '施工监理', investment_supervision: '投资监督', investment_regulator: '投资监管部门',
  safety_regulator: '安全监管部门', flood_supervision: '防汛监管', cultural_regulator: '文化主管部门',
  heritage_supervision: '文化遗产监管', forest_asset_supervision: '林业资产监管', asset_owner: '资产所有者',
  requirement_feedback: '需求反馈', candidate_operator: '候选运营主体', specialty_construction: '专项施工',
  testing_agency: '检测机构', structural_inspection: '结构检测', package_coordination: '项目包协调',
  acceptance_authority: '验收主管部门', acceptance_organization: '组织验收', appraisal_agency: '鉴定机构',
  dam_safety_identification: '大坝安全鉴定', environmental_acceptance: '环境验收', environmental_authority: '环境主管部门',
  takeover_readiness: '接管准备', acceptance_reporting: '验收报告', as_built_transfer: '竣工移交',
  daily_dispatch_control: '日常调度管理', flood_command_center: '防汛指挥中心', flood_dispatch_command: '防汛调度指挥',
  operating_team: '运行团队', field_operation_maintenance: '现场运行维护', it_maintenance_service: '信息系统运维服务',
  it_system_maintenance: '信息系统维护', irrigation_notice: '灌溉通知', local_notice: '属地告知',
  local_authority: '属地主管部门', contract_supervision: '合同监督', commercial_operational_responsibility: '商业运营责任',
  field_operation_team: '现场运行团队', tourism_study_operation: '文旅研学运营', tourism_industry_supervision: '旅游行业监管',
  industry_supervisor: '行业主管部门', safety_boundary_control: '安全边界管控', reservoir_cleaning: '库区保洁',
  greenway_cleaning: '绿道保洁', maintenance_service_provider: '维护服务单位', water_quality_supervision: '水质监管',
  forest_conservation: '森林管护', reservoir_conservation: '水库保护', community_partner: '社区合作方',
  village_cooperation: '村级协作', study_tour_services: '研学服务', campsite_management: '营地管理',
  brand_marketing: '品牌推广', visitor_services: '游客服务', procurement_and_tendering: '采购招标',
  construction_management: '建设管理', quality_safety_supervision: '质量安全监督', handover_and_acceptance: '验收移交',
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>> : {}
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function entityName(value: unknown): string | undefined {
  const record = asRecord(value)
  return stringOf(record.name) ?? stringOf(record.title) ?? stringOf(record.label)
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/** Resolve machine references without losing the professional relationship they represent. */
export function reportReferenceNames(
  snapshot: Readonly<Record<string, unknown>>,
  titles: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const names = new Map(titles)
  const ambiguous = new Set<string>()
  const register = (id: string, name: string): void => {
    if (ambiguous.has(id)) return
    if (names.has(id) && names.get(id) !== name) {
      names.delete(id)
      ambiguous.add(id)
    } else names.set(id, name)
  }
  const visit = (value: unknown, objectId: string): void => {
    if (Array.isArray(value)) { value.forEach(child => visit(child, objectId)); return }
    const record = asRecord(value)
    const id = stringOf(record.id)
    const name = entityName(record)
    if (id !== undefined && name !== undefined) {
      register(id, name)
      register(`${objectId}.${id}`, name)
    }
    for (const [key, child] of Object.entries(record)) if (!OMITTED_FIELDS.has(key)) visit(child, objectId)
  }
  Object.entries(snapshot).forEach(([objectId, value]) => visit(asRecord(value).data ?? value, objectId))
  return names
}

function evidenceReferences(value: unknown): NonNullable<FrozenReportEntry['evidenceRefs']> {
  const refs = new Map<string, NonNullable<FrozenReportEntry['evidenceRefs']>[number]>()
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) { candidate.forEach(visit); return }
    const record = asRecord(candidate)
    const evidenceId = stringOf(record.evidence_id)
    if (evidenceId !== undefined) {
      const assetId = stringOf(record.asset_id)
      const versionId = stringOf(record.version_id)
      const locator = asRecord(record.locator)
      const ref = { evidenceId,
        ...(assetId === undefined ? {} : { assetId }),
        ...(versionId === undefined ? {} : { versionId }),
        ...(Object.keys(locator).length === 0 ? {} : { locator: { ...locator } }),
      }
      refs.set(JSON.stringify(ref), ref)
    }
    for (const [key, child] of Object.entries(record)) {
      if (!OMITTED_FIELDS.has(key)) visit(child)
    }
  }
  visit(value)
  return [...refs.values()]
}

export function createFrozenReportSections(
  source: Readonly<Record<string, unknown>>,
  objectTitle: string,
  inheritedLabels: Readonly<Record<string, string>> = {},
  references: ReadonlyMap<string, string> = new Map(),
): readonly FrozenReportSection[] {
  const data = asRecord(source.data)
  const hasData = Object.keys(data).length > 0
  const record = hasData ? data : source
  const label = (key: string, value?: unknown): string => LABELS[key] ?? inheritedLabels[key]
    ?? entityName(Array.isArray(value) ? value[0] : value)
    ?? (/\p{Script=Han}/u.test(key) ? key : `${objectTitle}补充内容`)
  const scopedReferences = new Map([...references, ...reportReferenceNames({ local: source }, new Map())])
  const referencePattern = scopedReferences.size === 0 ? undefined : new RegExp(
    `(?<![A-Za-z0-9_-])(?:${[...scopedReferences.keys()].sort((a, b) => b.length - a.length).map(escapePattern).join('|')})(?![A-Za-z0-9_-])`, 'gu')
  const verbatimFields = new Set(['formula', 'formulas', 'expression', 'numerator', 'denominator', 'variables', 'unit', 'url'])

  const readable = (value: string, field = ''): string => {
    if (verbatimFields.has(field)) return value
    if (ENUMS[value] !== undefined && (!/^[ABC]$/u.test(value) || field === 'reliability')) return ENUMS[value]!
    if (/^[a-z]+(?:_[a-z0-9]+)+$/u.test(value) && LABELS[value] === undefined && inheritedLabels[value] === undefined) {
      return `${value}（含义待核对）`
    }
    // Links, local paths and formulas are source material: translating their tokens corrupts them.
    const segments = value.split(/(https?:\/\/[^\s<>"'，；）)]+|[A-Za-z]:[\\/][^\r\n;；]+|(?:\.{0,2}\/|\\\\)[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+)/gu)
    return segments.map((segment, index) => {
      if (index % 2 === 1) return segment
      let text = referencePattern === undefined ? segment
        : segment.replace(referencePattern, id => scopedReferences.get(id)!)
      text = text
        .replace(/\bOPT[-_]([A-Z])(?:_(RECOMMENDED|CONSERVATIVE))?\b/gu, (_, option: string) => `方案${option}`)
        .replace(/\b(?:asset|ev|evidence|dsh-actor)[-:][A-Za-z0-9_.:-]+\b/gu, '项目资料')
        .replace(/\bCAPEX\b/gu, '建设投资')
        .replace(/\bOPEX\b/gu, '运营成本')
        .replace(/\bLCC\b/gu, '全生命周期成本')
        .replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/gu,
          token => ENUMS[token] ?? LABELS[token] ?? inheritedLabels[token] ?? token)
      return text
    }).join('').trim()
  }

  const scalar = (value: unknown, field: string): string | undefined => {
    if (typeof value === 'string') return value.trim() === '' ? undefined : readable(value.trim(), field)
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined
    if (typeof value === 'boolean') return value ? '是' : '否'
    return undefined
  }

  const describe = (value: unknown, field: string, contentOnly = false): string => {
    const simple = scalar(value, field)
    if (simple !== undefined) return simple
    if (Array.isArray(value)) return value.map(child => describe(child, field, contentOnly)).filter(Boolean).join('；')
    const nested = asRecord(value)
    const parts: string[] = []
    const name = entityName(nested)
    if (name !== undefined) parts.push(readable(name))
    const number = scalar(nested.value, 'value')
    const unit = scalar(nested.unit, 'unit')
    if (number !== undefined) parts.push(`${number}${unit === undefined ? '' : ` ${unit}`}`)
    for (const [key, child] of Object.entries(nested)) {
      if (OMITTED_FIELDS.has(key) || ['name', 'title', 'label'].includes(key)) continue
      if (key === 'value' && number !== undefined) continue
      if (contentOnly && EVIDENCE_FIELDS.has(key)) continue
      if (key === 'unit' && number !== undefined) continue
      const content = describe(child, key, contentOnly)
      if (content === '') continue
      if (['description', 'summary', 'conclusion', 'statement'].includes(key)) parts.push(content)
      else parts.push(`${label(key, child)}：${content}`)
    }
    return parts.join('；')
  }

  const basisOf = (value: unknown): string => {
    const parts: string[] = []
    const visit = (child: unknown): void => {
      if (Array.isArray(child)) { child.forEach(visit); return }
      for (const [key, nested] of Object.entries(asRecord(child))) {
        if (OMITTED_FIELDS.has(key)) continue
        if (EVIDENCE_FIELDS.has(key) || key === 'parameter_sources') {
          const content = describe(nested, key)
          if (content !== '') parts.push(`${label(key, nested)}：${content}`)
        } else visit(nested)
      }
    }
    visit(value)
    return parts.length === 0 ? '项目成果资料' : [...new Set(parts)].join('；')
  }

  return Object.entries(record).flatMap(([key, value]) => {
    if (OMITTED_FIELDS.has(key) || key === 'status') return []
    const title = readable(label(key, value))
    const candidates = Array.isArray(value) ? value : [value]
    const usedKeys = new Set<string>()
    const entries = candidates.flatMap((candidate, index): FrozenReportEntry[] => {
      const content = describe(candidate, key)
      if (content === '') return []
      const professionalContent = EVIDENCE_FIELDS.has(key) ? '' : describe(candidate, key, true)
      const evidenceRefs = evidenceReferences([candidate, record.evidence_refs])
      const nested = asRecord(candidate)
      const id = stringOf(nested.id)
      const candidateKey = id ?? `${key}-${index + 1}`
      const entryKey = usedKeys.has(candidateKey) ? `${candidateKey}-${index + 1}` : candidateKey
      usedKeys.add(entryKey)
      const metricValue = nested.value ?? (typeof candidate === 'number' ? candidate : undefined)
      const metric = typeof metricValue === 'number' || typeof metricValue === 'string'
        ? { label: readable(entityName(nested) ?? title), value: typeof metricValue === 'string' ? readable(metricValue) : metricValue,
          ...(typeof nested.unit === 'string' ? { unit: readable(nested.unit, 'unit') } : {}) }
        : undefined
      return [{
        key: entryKey,
        text: `${title}：${content}`,
        contentText: professionalContent === '' ? '' : `${title}：${professionalContent}`,
        basis: basisOf(candidate),
        fieldPath: `${hasData ? 'data.' : ''}${key}${Array.isArray(value) ? `[${index}]` : ''}`,
        ...(evidenceRefs.length === 0 ? {} : { evidenceRefs }),
        ...(metric === undefined ? {} : { metric }),
      }]
    })
    return entries.length === 0 ? [] : [{ key, title, entries }]
  })
}
