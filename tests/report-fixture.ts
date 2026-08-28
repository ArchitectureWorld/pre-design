export const REPORT_INPUT = {
  projectId: 'golden-project',
  projectName: '滨江文化活力区前期策划',
  revision: 57,
  generatedAt: '2026-08-28T09:00:00.000Z',
  recommendationId: 'recommendation-r57-cultural-riverfront',
  recommendation: '以公共文化主轴串联滨水开放空间，分期导入复合业态。',
  decisionItems: ['确认总体定位与首期建设边界', '确认概念方案 A 作为深化基础'],
  stateObjects: Array.from({ length: 8 }, (_, index) => ({
    objectId: `CH${index + 1}`,
    chapterId: String(index + 1).padStart(2, '0'),
    title: `第 ${index + 1} 章确认成果`,
    summary: `第 ${index + 1} 章已完成并形成可追溯结论。`,
    facts: [{ label: '确认状态', value: '已确认', basis: `Gate G${index + 1}` }],
  })),
  gates: Array.from({ length: 8 }, (_, index) => ({
    gateId: `G${index + 1}`, decision: 'approved' as const, revision: 57,
  })),
  visualAssets: [{
    assetId: 'concept-1', kind: 'concept' as const, caption: '滨水公共空间概念表现图（AI 生成）',
    sourcePath: 'C:/fixtures/concept-1.png', mimeType: 'image/png' as const,
  }],
  adoptedAssetIds: ['concept-1'],
}
