import { REPORT_INPUT as LEGACY_REPORT_INPUT } from './report-fixture.ts'

const ROLES = [
  'brief',
  'diagnosis',
  'opportunity',
  'positioning',
  'strategy',
  'product',
  'spatial',
  'operation',
  'implementation',
  'decision',
] as const

const HEADLINES = [
  '滨江更新需要从单点改造转向城市价值重构',
  '空间割裂与活力不足是当前最需要解决的矛盾',
  '滨水公共界面能够转化为持续运营的城市资产',
  '以文化主轴建立可传播的滨江项目身份',
  '公共价值与经营活力必须由同一策略统筹',
  '三类核心产品共同支撑全天候滨水体验',
  '连续开放空间让产品、活动和人流真正发生',
  '公益服务与市场运营形成可持续组合',
  '首期启动区优先验证公共界面与运营模型',
  '本次决策应锁定定位、首期边界与实施机制',
] as const

const chapterBlocks = (index: number) => {
  const base = [
    {
      type: 'narrative' as const,
      statement: HEADLINES[index] + '，并以可核验依据支撑后续行动。',
      evidenceIds: ['evidence-' + String((index % 12) + 1)],
    },
    {
      type: 'evidence' as const,
      headline: '关键依据支撑本章判断',
      evidenceIds: ['evidence-' + String(((index + 1) % 12) + 1)],
      assetIds: index === 5 ? ['concept-1'] : [],
    },
  ]
  return index === 9
    ? [...base, {
      type: 'decision' as const,
      headline: '形成三项可执行决策',
      asks: ['确认总体定位', '确认首期启动边界', '确认建设与运营协同机制'],
      rationaleEvidenceIds: ['evidence-12'],
    }]
    : base
}

export const REPORT_INPUT = LEGACY_REPORT_INPUT

export const CLIENT_PROFILE = {
  identity: {
    projectId: 'golden-project',
    projectName: '滨江文化活力区前期策划',
    reportTitle: '滨江文化活力区价值重构提案',
    reportDate: '2026-08-29',
    audience: 'executive-and-professional' as const,
    locale: 'zh-CN' as const,
  },
  proposition: {
    projectDefinition: '面向城市更新与滨水生活方式升级的复合型公共项目',
    urgency: '存量提质阶段需要尽快把滨水资源转化为可使用、可运营的城市界面',
    coreValue: '以公共文化主轴串联滨水开放空间，形成持续发生的城市生活目的地',
    positioning: '城市滨水文化生活新客厅',
    keywords: ['滨水开放', '文化体验', '复合运营', '分期实施'],
  },
  themeOverrides: {
    colors: { primary: '0D5D66', accent: 'B85C3A' },
  },
  chapters: ROLES.map((role, index) => ({
    id: 'chapter-' + String(index + 1).padStart(2, '0'),
    role,
    headline: HEADLINES[index],
    claim: HEADLINES[index],
    sourceObjectIds: ['CH' + String(Math.min(index + 1, 8))],
    blocks: chapterBlocks(index),
  })),
  products: [{
    productId: 'product-waterfront-hall',
    name: '滨水文化生活客厅',
    valueProposition: '把公共开放空间转化为全天候文化、社交与轻消费目的地',
    audiences: ['周边居民', '城市家庭', '青年客群'],
    contents: ['公共展演', '滨水休闲', '文化零售'],
    usageScenarios: ['日常休闲', '周末活动', '城市节庆'],
    spatialCarrier: '滨水首层公共界面与连续步行空间',
    operatingModel: '公共服务保底、主题活动引流、轻商业补充运营',
    valueContribution: '提升公共空间使用率并建立项目持续传播能力',
    evidenceIds: ['evidence-6', 'evidence-7'],
  }],
  evidence: Array.from({ length: 12 }, (_, index) => ({
    evidenceId: 'evidence-' + String(index + 1),
    kind: index === 11 ? 'calculation' as const : 'fact' as const,
    statement: '项目证据 ' + String(index + 1) + ' 支撑对应的客户判断。',
    sourceLabel: 'Golden Project 冻结资料',
    sourceDate: '2026-08-28',
    locator: 'project-brief.json#evidence-' + String(index + 1),
    ...(index === 11 ? { unit: '万元', assumption: '按冻结输入口径测算' } : {}),
  })),
  assetBindings: [{
    assetId: 'concept-1',
    role: 'product-scene' as const,
    chapterId: 'chapter-06',
    productId: 'product-waterfront-hall',
    sha256: 'a'.repeat(64),
    width: 1920,
    height: 1080,
    disclosure: '概念示意' as const,
  }],
  requiredVisualRoles: ['product-scene' as const],
}
