import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FrozenProjectInput } from '../src/report/types.ts'
import type {
  PresentationAdoptedAssetInput,
  PresentationRulesInput,
  PresentationSourceMaterialInput,
} from '../src/presentation/standard-project-types.ts'

export const STANDARD_TEST_TIME = '2026-09-03T00:00:00.000Z'

export const STANDARD_TEST_RULES: PresentationRulesInput = {
  audiences: ['项目决策团队', '设计与运营团队'],
  purposes: ['前期策划决策汇报'],
  language: 'zh-CN',
  writingRules: ['结论优先', '每页只表达一个核心结论'],
  terminology: { FAR: '容积率' },
  truthConstraints: ['事实、判断、假设和建议必须明确区分'],
  visualIntent: ['优先使用项目证据、指标和正式采用素材'],
  prohibitedContent: ['不得虚构缺失数据'],
}

export function createStandardFrozenProject(
  overrides: Partial<FrozenProjectInput> = {},
): FrozenProjectInput {
  return {
    projectId: 'preplan-project-campus-renewal',
    projectName: 'Campus Renewal Brief',
    revision: 7,
    generatedAt: STANDARD_TEST_TIME,
    recommendationId: 'recommendation-r7',
    recommendation: '以公共空间重构带动校园更新。',
    decisionItems: ['确认一期实施范围。'],
    stateObjects: [
      {
        objectId: 'PS01',
        chapterId: '01',
        workItemId: 'W01',
        title: '项目任务',
        summary: '形成可用于决策的校园更新前期策划。',
        facts: [{ label: '汇报对象', value: '项目决策团队', basis: '项目任务书' }],
      },
      {
        objectId: 'BL01',
        chapterId: '02',
        workItemId: 'W02',
        title: '场地基线',
        summary: '现状公共空间连续性不足。',
        facts: [{ label: '场地面积', value: '12.4', basis: '测绘资料' }],
      },
      {
        objectId: 'DG01',
        chapterId: '03',
        workItemId: 'W03',
        title: '核心问题',
        summary: '步行系统与主要公共节点缺少连续联系。',
        facts: [{ label: '主要断点', value: '3', basis: '现场调研' }],
      },
      {
        objectId: 'DG05',
        chapterId: '03',
        workItemId: 'W04',
        title: '发展机会',
        summary: '教学组团之间具备形成共享轴线的空间条件。',
        facts: [{ label: '机会窗口', value: '一期建设期', basis: '实施计划' }],
      },
      {
        objectId: 'OB01',
        chapterId: '04',
        workItemId: 'W05',
        title: '定位目标',
        summary: '建设全天候共享学习与交流网络。',
        facts: [{ label: '服务对象', value: '师生及访客', basis: '项目定位' }],
      },
      {
        objectId: 'OP07',
        chapterId: '05',
        workItemId: 'W06',
        title: '总体策略',
        summary: '以一轴多节点组织更新行动。',
        facts: [{ label: '策略单元', value: '4', basis: '策略草案' }],
      },
      {
        objectId: 'PG04',
        chapterId: '06',
        workItemId: 'W07',
        title: '产品体系',
        summary: '构建学习、交流、展示与服务四类场景。',
        facts: [{ label: '场景类型', value: '4', basis: '产品策划' }],
      },
      {
        objectId: 'SP07',
        chapterId: '07',
        workItemId: 'W08',
        title: '空间策略',
        summary: '建立连续慢行轴与复合公共节点。',
        facts: [{ label: '重点节点', value: '5', basis: '空间草案' }],
      },
      {
        objectId: 'IM06',
        chapterId: '08',
        workItemId: 'W09',
        title: '实施模式',
        summary: '采用分期建设与运营同步校准。',
        facts: [{ label: '实施分期', value: '2', basis: '实施建议' }],
      },
      {
        objectId: 'IM02',
        chapterId: '08',
        workItemId: 'W10',
        title: '决策事项',
        summary: '一期范围需要项目负责人确认。',
        facts: [{ label: '待决事项', value: '1', basis: '决策清单' }],
      },
    ],
    gates: [],
    visualAssets: [],
    adoptedAssetIds: [],
    siteBoundary: { status: 'not_provided' },
    ...overrides,
  }
}

export async function createStandardManagedFiles(root: string): Promise<{
  readonly sourceMaterials: readonly PresentationSourceMaterialInput[]
  readonly assets: readonly PresentationAdoptedAssetInput[]
  readonly sourceBytes: Buffer
  readonly assetBytes: Buffer
}> {
  await mkdir(root, { recursive: true })
  const sourcePath = join(root, 'site-metrics.csv')
  const assetPath = join(root, 'site-area-summary.svg')
  const duplicateSourcePath = join(root, 'site-metrics-copy.csv')
  const sourceBytes = Buffer.from('metric,value\nsite_area,12.4\n', 'utf8')
  const assetBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900"/><text x="40" y="80">12.4 ha</text></svg>\n', 'utf8')
  await writeFile(sourcePath, sourceBytes)
  await writeFile(duplicateSourcePath, sourceBytes)
  await writeFile(assetPath, assetBytes)

  return {
    sourceBytes,
    assetBytes,
    sourceMaterials: [
      {
        sourceKey: 'upload:site-metrics-primary',
        sourcePath,
        originalFileName: 'site-metrics.csv',
        mimeType: 'text/csv',
        importedAt: STANDARD_TEST_TIME,
      },
      {
        sourceKey: 'upload:site-metrics-duplicate',
        sourcePath: duplicateSourcePath,
        originalFileName: 'site-metrics-copy.csv',
        mimeType: 'text/csv',
        importedAt: STANDARD_TEST_TIME,
      },
    ],
    assets: [
      {
        sourceKey: 'visual:site-area-summary',
        sourcePath: assetPath,
        displayName: '场地面积摘要',
        originalFileName: 'site-area-summary.svg',
        mimeType: 'image/svg+xml',
        semanticRole: 'chart',
        widthPx: 1600,
        heightPx: 900,
        createdAt: STANDARD_TEST_TIME,
        adoptedAt: STANDARD_TEST_TIME,
        origin: {
          type: 'generated_by_plugin',
          sourceMaterialKeys: ['upload:site-metrics-primary'],
          parentAssetKeys: [],
          method: 'pre-design deterministic chart generation',
          sourceTool: { name: '@architectureworld/dsh-preplanning-agent', version: '2.0.0' },
        },
        objectIds: ['BL01'],
        evidenceIds: [],
      },
    ],
  }
}
