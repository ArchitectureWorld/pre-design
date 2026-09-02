import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { validateClientReportPolicy } from '../src/report/client-policy.ts'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import { planClientPages, validateClientPagePlan } from '../src/report/page-plan.ts'
import { createFrozenProjectInput, loadClientProjectProfile } from '../src/report/source.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

describe('createFrozenProjectInput', () => {
  it('freezes not_provided, pending_confirmation, synthetic_research, and confirmed as four explicit states', () => {
    const owner = { actorId: 'owner-1', name: '项目负责人', role: 'decision_owner' as const }
    const assetSha256 = 'a'.repeat(64)
    const base = {
      boundaryId: 'boundary-1', projectId: 'project-1', submittedRevision: 5,
      source: 'approved_redline' as const, submittedBy: owner, submittedAt: '2026-08-30T08:00:00.000Z',
      sourceAsset: {
        assetId: 'boundary-asset-1', fileName: 'project-1/evidence/boundary-asset-1.png', sha256: assetSha256,
        attachment: {
          origin: 'user_image' as const, attachmentId: 'attachment-1', mediaType: 'image/png' as const,
          displayName: 'redline.png', bytes: 68, width: 1, height: 1, storageSha256: assetSha256,
          submittedBy: owner, submittedRevision: 5,
        },
      },
    }
    const pending = { ...base, status: 'pending_confirmation' as const, origin: 'user_image' as const, submissionChannel: 'dsh_human_command' as const }
    const synthetic = { ...base, boundaryId: 'synthetic-1', status: 'pending_confirmation' as const, origin: 'synthetic' as const, submissionChannel: 'synthetic_fixture' as const }
    const confirmed = {
      ...pending, status: 'confirmed_formal_boundary' as const, confirmedBy: owner,
      confirmedAt: '2026-08-30T09:00:00.000Z', confirmedRevision: 5,
      confirmationChannel: 'dsh_human_command' as const,
      confirmationStatement: '该图是本项目采用的总平图或红线图，且图中明确表达项目边界',
      confirmationSourceSha256: assetSha256,
    }
    const visualAsset = {
      assetId: 'boundary-asset-1', taskId: 'boundary-asset-1', projectId: 'project-1', kind: 'evidence' as const,
      required: true, status: 'adopted' as const, adoptedRevision: 5,
      fileName: 'project-1/evidence/boundary-asset-1.png', mimeType: 'image/png' as const,
      sha256: assetSha256, width: 1, height: 1, createdAt: '2026-08-30T08:00:00.000Z',
    }
    const freeze = (siteBoundaries: readonly unknown[]) => createFrozenProjectInput('project-1', 5, {
      repository: { readProjectRevision: vi.fn(() => ({
        project: { projectId: 'project-1', name: '边界四态测试' },
        revision: { revision: 5, committedAt: '2026-08-30T10:00:00.000Z' }, stateSnapshot: {},
      })) } as never,
      governance: { readProject: vi.fn(() => ({
        gateDecisions: [], visualTasks: [],
        visualAssets: siteBoundaries.some(record => (record as { readonly status?: unknown }).status === 'confirmed_formal_boundary') ? [visualAsset] : [],
        siteBoundaries,
      })) } as never,
      registry: { workflows: vi.fn(() => []) } as never,
      visualStore: { resolveAsset: vi.fn(() => 'C:/fixtures/boundary-asset-1.png') } as never,
    }).siteBoundary
    const states = [
      { records: [], expected: { status: 'not_provided' } },
      { records: [pending], expected: { status: 'pending_confirmation', boundaryId: 'boundary-1', source: 'approved_redline' } },
      { records: [synthetic], expected: {
        status: 'synthetic_research', boundaryId: 'synthetic-1', source: 'approved_redline',
        declarations: ['研究范围（待核）', '非法定红线', '非测绘成果'],
      } },
      { records: [confirmed], expected: {
        status: 'confirmed', boundaryId: 'boundary-1', assetId: 'boundary-asset-1',
        assetSha256, sourceSha256: assetSha256,
      } },
    ] as const

    for (const state of states) expect(freeze(state.records)).toMatchObject(state.expected)
  })

  it('freezes the latest confirmed boundary no later than the requested revision and never infers one from location text', () => {
    const source = createFrozenProjectInput('project-1', 5, {
      repository: { readProjectRevision: vi.fn(() => ({
        project: { projectId: 'project-1', name: '边界测试项目' }, revision: { revision: 5, committedAt: '2026-08-30T08:00:00.000Z' },
        stateSnapshot: { PS01: { data: { location: { name: '湖北省鄂州市', geometry_refs: ['ordinary-map'] } } } },
      })) } as never,
      governance: { readProject: vi.fn(() => ({ gateDecisions: [], visualAssets: [{
        assetId: 'redline-2', taskId: 'redline-2', projectId: 'project-1', kind: 'evidence', status: 'adopted', adoptedRevision: 3,
        fileName: 'project-1/evidence/redline-2.png', mimeType: 'image/png', sha256: 'c'.repeat(64), width: 1, height: 1,
        createdAt: '2026-08-30T02:00:00.000Z',
      }], visualTasks: [], siteBoundaries: [
        { boundaryId: 'old', projectId: 'project-1', submittedRevision: 2, status: 'confirmed_formal_boundary', source: 'approved_redline', sourceAsset: { assetId: 'redline-1', fileName: 'redline.pdf', sha256: 'a'.repeat(64) }, submittedBy: { actorId: 'u', name: '人', role: 'decision_owner' }, submittedAt: '2026-08-30T01:00:00.000Z', confirmedBy: { actorId: 'u', name: '人', role: 'decision_owner' }, confirmedAt: '2026-08-30T01:00:00.000Z', confirmedRevision: 3 },
        { boundaryId: 'later', projectId: 'project-1', submittedRevision: 2, status: 'confirmed_formal_boundary', source: 'approved_redline', origin: 'user_image', submissionChannel: 'dsh_human_command', sourceAsset: { assetId: 'redline-2', fileName: 'project-1/evidence/redline-2.png', sha256: 'c'.repeat(64), attachment: { origin: 'user_image', attachmentId: 'attachment-2', mediaType: 'image/png', displayName: 'redline.png', bytes: 68, width: 1, height: 1, storageSha256: 'c'.repeat(64), submittedBy: { actorId: 'u', name: '人', role: 'decision_owner' }, submittedRevision: 2 } }, submittedBy: { actorId: 'u', name: '人', role: 'decision_owner' }, submittedAt: '2026-08-30T02:00:00.000Z', confirmedBy: { actorId: 'u', name: '人', role: 'decision_owner' }, confirmedAt: '2026-08-30T03:00:00.000Z', confirmedRevision: 3, confirmationChannel: 'dsh_human_command', confirmationStatement: '该图是本项目采用的总平图或红线图，且图中明确表达项目边界', confirmationSourceSha256: 'c'.repeat(64) },
        { boundaryId: 'pending-after', projectId: 'project-1', submittedRevision: 6, status: 'pending_confirmation', source: 'approved_redline', sourceAsset: { assetId: 'pending', fileName: 'pending.pdf', sha256: 'd'.repeat(64) }, submittedBy: { actorId: 'u', name: '人', role: 'decision_owner' }, submittedAt: '2026-08-30T04:00:00.000Z' },
        { boundaryId: 'future', projectId: 'project-1', submittedRevision: 6, status: 'confirmed_formal_boundary', source: 'approved_site_plan', sourceAsset: { assetId: 'plan-1', fileName: 'plan.pdf', sha256: 'b'.repeat(64) }, submittedBy: { actorId: 'u', name: '人', role: 'decision_owner' }, submittedAt: '2026-08-30T02:00:00.000Z', confirmedBy: { actorId: 'u', name: '人', role: 'decision_owner' }, confirmedAt: '2026-08-30T02:00:00.000Z', confirmedRevision: 6 },
      ] })) } as never,
      registry: { workflows: vi.fn(() => []) } as never,
      visualStore: { resolveAsset: vi.fn() } as never,
    })
    expect(source.siteBoundary).toMatchObject({ boundaryId: 'later', status: 'confirmed', sourceSha256: 'c'.repeat(64) })
    expect(source.siteBoundary?.status === 'confirmed' ? source.siteBoundary.boundaryId : undefined).not.toBe('future')
  })

  it('loads a replaceable client profile by safe project id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-profile-'))
    try {
      await writeFile(join(root, 'golden-project.json'), JSON.stringify(CLIENT_PROFILE), 'utf8')
      await expect(loadClientProjectProfile(root, 'golden-project'))
        .rejects.toThrow(/architectural visual contract/u)
      await writeFile(join(root, 'golden-project.json'), JSON.stringify({
        ...CLIENT_PROFILE,
        visualContractVersion: 'architectural-v1',
      }), 'utf8')
      await expect(loadClientProjectProfile(root, 'golden-project')).resolves.toMatchObject({
        identity: { projectId: 'golden-project' },
        proposition: { coreValue: CLIENT_PROFILE.proposition.coreValue },
        visualContractVersion: 'architectural-v1',
      })
      await expect(loadClientProjectProfile(root, '../escape')).rejects.toThrow(/unsafe project id/u)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('activates the architectural visual contract for a real project without a profile file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-profile-'))
    const input = {
      ...REPORT_INPUT,
      visualAssets: REPORT_INPUT.visualAssets.map(asset => ({
        ...asset,
        sha256: 'd'.repeat(64),
        width: 1024,
        height: 1024,
      })),
    }
    try {
      const profile = await Reflect.apply(loadClientProjectProfile, undefined, [root, input.projectId, input])
      const report = createClientReportBundle(input, profile).report

      expect(profile).toMatchObject({
        identity: { projectId: input.projectId },
        assetBindings: [{ assetId: 'concept-1' }],
        visualContractVersion: 'architectural-v1',
      })
      expect(profile.chapters).toHaveLength(10)
      expect(validateClientReportPolicy(report).map(row => row.code)).toEqual(expect.arrayContaining([
        'DATA_CHART_COUNT_LOW',
        'SITE_ANALYSIS_SERIES_INCOMPLETE',
      ]))
      expect(validateClientPagePlan(planClientPages(report, 'pptx')).map(row => row.code))
        .toContain('VISUAL_PAGE_COVERAGE_LOW')
      expect(validateClientPagePlan(planClientPages(report, 'pdf')).map(row => row.code))
        .toContain('VISUAL_PAGE_COVERAGE_LOW')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('distributes adopted chapter visuals to distinct product and spatial pages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-profile-visual-distribution-'))
    const visualAssets = [
      { assetId: 'hero', chapterId: '07' },
      { assetId: 'mingtang', chapterId: '06' },
      { assetId: 'waterfront', chapterId: '06' },
      { assetId: 'events', chapterId: '06' },
      { assetId: 'spatial', chapterId: '07' },
    ].map(({ assetId, chapterId }, index) => ({
      ...REPORT_INPUT.visualAssets[0]!,
      assetId,
      chapterId,
      workItemId: chapterId === '06' ? '06-04' : '07-08',
      taskId: `visual-${index + 1}`,
      sha256: String(index + 1).repeat(64),
      width: 1920,
      height: 1080,
    }))
    try {
      const input = { ...REPORT_INPUT, visualAssets }
      const profile = await loadClientProjectProfile(root, input.projectId, input)
      const productChapter = profile.chapters.find(chapter => chapter.id === 'chapter-06')
      const spatialChapter = profile.chapters.find(chapter => chapter.id === 'chapter-07')
      const report = createClientReportBundle(input, profile).report
      const usedAssets = planClientPages(report, 'pptx').pages.flatMap(page => page.assetIds)

      expect(profile.assetBindings).toEqual([
        expect.objectContaining({ assetId: 'hero', role: 'hero', chapterId: 'chapter-07' }),
        expect.objectContaining({ assetId: 'mingtang', role: 'product-scene', chapterId: 'chapter-06', productId: 'product-cultural-district' }),
        expect.objectContaining({ assetId: 'waterfront', role: 'product-scene', chapterId: 'chapter-06', productId: 'product-waterfront' }),
        expect.objectContaining({ assetId: 'events', role: 'product-scene', chapterId: 'chapter-06', productId: 'product-city-events' }),
        expect.objectContaining({ assetId: 'spatial', role: 'product-scene', chapterId: 'chapter-07' }),
      ])
      expect(productChapter?.blocks.slice(2)).toEqual([
        { type: 'product', productId: 'product-cultural-district', assetIds: ['mingtang'] },
        { type: 'scene', headline: '滨水生活客厅', productIds: ['product-waterfront'], assetIds: ['waterfront'] },
        { type: 'product', productId: 'product-city-events', assetIds: ['events'] },
      ])
      expect(spatialChapter?.blocks.find(block => block.type === 'evidence')).toMatchObject({ assetIds: ['spatial'] })
      expect(usedAssets).toEqual(expect.arrayContaining(['hero', 'mingtang', 'waterfront', 'events', 'spatial']))
      expect(new Set(usedAssets).size).toBe(usedAssets.length)
      expect(validateClientPagePlan(planClientPages(report, 'pptx')).map(row => row.code))
        .toContain('VISUAL_PAGE_COVERAGE_LOW')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('把冻结状态、Gate 和采用视觉资产转换为同一 Revision 的甲方报告输入', () => {
    const source = createFrozenProjectInput('project-1', 3, {
      repository: {
        readProjectRevision: vi.fn(() => ({
          project: { projectId: 'project-1', name: '滨江文化活力区' },
          revision: { revision: 3, committedAt: '2026-08-28T10:00:00.000Z' },
          stateSnapshot: { PS01: { title: '项目身份', conclusion: '以公共文化主轴串联滨水开放空间', location: '鄂州' } },
        })),
      } as never,
      governance: {
        readProject: vi.fn(() => ({
          gateDecisions: [{ gateId: 'G1', revision: 3, decision: 'approved' }],
          visualAssets: [{
            assetId: 'asset-1', taskId: 'visual-task-1', projectId: 'project-1', kind: 'deterministic', status: 'adopted',
            adoptedRevision: 3, fileName: 'project-1/candidates/asset-1.png', mimeType: 'image/png',
            sha256: 'e'.repeat(64), width: 1280, height: 720, boundaryGeometrySha256: 'f'.repeat(64),
            promptSummary: '滨水公共空间概念表现图',
          }],
          visualTasks: [{
            taskId: 'visual-task-1', projectId: 'project-1', chapterId: '06', workItemId: '06-04',
            kind: 'concept', required: true, status: 'adopted', attempts: 1, updatedAt: '2026-08-28T10:00:00.000Z',
          }],
        })),
      } as never,
      registry: {
        workflows: vi.fn(() => [{ targetObjectId: 'PS01', chapterId: '01', title: '项目身份校准' }]),
      } as never,
      visualStore: { resolveAsset: vi.fn(() => 'C:/visual/asset-1.png') } as never,
    })

    expect(source).toMatchObject({
      projectId: 'project-1', projectName: '滨江文化活力区', revision: 3,
      recommendation: '以公共文化主轴串联滨水开放空间',
      stateObjects: [{ objectId: 'PS01', chapterId: '01', title: '项目身份' }],
      gates: [{ gateId: 'G1', revision: 3, decision: 'approved' }],
        visualAssets: [{
          assetId: 'asset-1', sourcePath: 'C:/visual/asset-1.png',
          taskId: 'visual-task-1', chapterId: '06', workItemId: '06-04',
          boundaryGeometrySha256: 'f'.repeat(64),
        }],
    })
  })

  it('从嵌套成果数据提取客户可读结论与指标，并把生图提示词隔离在客户图注之外', () => {
    const source = createFrozenProjectInput('project-1', 57, {
      repository: {
        readProjectRevision: vi.fn(() => ({
          project: { projectId: 'project-1', name: '明塘＋洋澜湖' },
          revision: { revision: 57, committedAt: '2026-08-29T10:00:00.000Z' },
          stateSnapshot: {
            SP07: {
              title: '设计控制与典型节点',
              data: {
                typical_sections: [{ name: '明塘核心步行街：8米街巷＋3米外摆区' }],
                height_far: { name: '明塘建筑限高', value: 18, unit: '米' },
              },
            },
          },
        })),
      } as never,
      governance: {
        readProject: vi.fn(() => ({
          gateDecisions: [],
          visualAssets: [{
            assetId: 'asset-1', projectId: 'project-1', kind: 'concept', status: 'adopted',
            adoptedRevision: 57, fileName: 'project-1/candidates/asset-1.png', mimeType: 'image/png',
            promptSummary: '生成一张明塘文化街区概念场景，苹果产品发布式清晰层级，无文字、无 Logo。',
          }],
        })),
      } as never,
      registry: {
        workflows: vi.fn(() => [{ targetObjectId: 'SP07', chapterId: '07', title: '设计控制风貌与典型节点' }]),
      } as never,
      visualStore: { resolveAsset: vi.fn(() => 'C:/visual/asset-1.png') } as never,
    })

    expect(source.stateObjects[0]?.summary).toBe('明塘核心步行街：8米街巷＋3米外摆区；明塘建筑限高')
    expect(source.stateObjects[0]?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: '明塘核心步行街：8米街巷＋3米外摆区' }),
      expect.objectContaining({ label: '明塘建筑限高', value: '18 米' }),
    ]))
    expect(source.stateObjects[0]?.summary).not.toContain('成果版本 R57')
    expect(source.visualAssets[0]?.caption).toBe('明塘＋洋澜湖项目场景图')
    expect(source.visualAssets[0]?.caption).not.toMatch(/生成一张|苹果产品发布式/u)
  })

  it('把真实冻结字段投影成中文客户语言，并隔离内部键名与枚举值', () => {
    const source = createFrozenProjectInput('project-1', 57, {
      repository: {
        readProjectRevision: vi.fn(() => ({
          project: { projectId: 'project-1', name: '明塘＋洋澜湖' },
          revision: { revision: 57, committedAt: '2026-08-29T10:00:00.000Z' },
          stateSnapshot: {
            PS01: { data: {
              location: { name: '湖北省鄂州市', admin_codes: [], geometry_refs: [] },
              origin_mode: 'mixed',
              start_reason: '形成明塘文化核心区与洋澜湖西岸的一体化更新策划成果',
            } },
            BL01: { data: {
              allowed: [{ name: '明塘地块存量建筑改造、文旅商业功能置换与微循环更新', id: 'allow-01' }],
              mandatory_level: 'mandatory',
            } },
            DG01: { data: {
              confidence: { level: 'medium', score: 0.8 },
              gap_value: { name: '文旅公共空间及配套服务达标综合缺口率', value: 45, unit: '%' },
            } },
            IM01: { data: {
              measures: { id: 'meas-01', name: '明塘存量建筑加固修缮与沿湖生态驳岸改造' },
              dependencies: { id: 'dep-01', name: '市政管网改造与地勘勘察为主体施工的前置条件' },
            } },
            SP07: { data: {
              typical_sections: [{ name: '明塘核心步行街采用8米街巷＋3米外摆区', id: 'sec-01' }],
              height_far: { name: '明塘建筑限高≤18米、容积率≤1.2', value: 1.2, unit: '综合指标' },
            } },
            OP07: { data: {
              decision_snapshot: 'OPT-B在多维度综合评价中表现最优，作为首选推荐路径',
              rationale: [{ name: '平衡文化原真性传承与现代滨水活力激活，投资强度可控，社会与经济效益最优化', id: 'rat-01' }],
            } },
            IM02: { data: {
              contingency: '基本预备费按工程费用的8%计取',
              capex: { name: '全口径工程总建设投资', value: 10500, unit: '万元' },
            } },
            IM06: { data: {
              capex: { name: '总建设投资', value: 10500, unit: '万元' },
              npv: 1280,
              scenarios: [{ name: '基准情景下IRR为6.8%，DSCR为1.35', id: 'BASE' }],
            } },
            IM07: { data: {
              critical_path: '项目立项 -> 示范区建设 -> 全面开业',
              phases: [{ name: '一期示范、二期成型、三期提升', id: 'phase-01' }],
            } },
          },
        })),
      } as never,
      governance: { readProject: vi.fn(() => ({ gateDecisions: [], visualAssets: [] })) } as never,
      registry: {
        workflows: vi.fn(() => [
          { targetObjectId: 'PS01', chapterId: '01', title: '项目身份校准' },
          { targetObjectId: 'BL01', chapterId: '02', title: '规划政策与法定条件' },
          { targetObjectId: 'DG01', chapterId: '03', title: '显性问题识别' },
          { targetObjectId: 'IM01', chapterId: '08', title: '实施项目与工程包' },
          { targetObjectId: 'SP07', chapterId: '07', title: '设计控制风貌与典型节点' },
          { targetObjectId: 'OP07', chapterId: '05', title: '推荐方案与回退条件' },
          { targetObjectId: 'IM02', chapterId: '08', title: '投资估算与成本基线' },
          { targetObjectId: 'IM06', chapterId: '08', title: '收入成本现金流与平衡' },
          { targetObjectId: 'IM07', chapterId: '08', title: '分期时序依赖与启动计划' },
        ]),
      } as never,
      visualStore: { resolveAsset: vi.fn() } as never,
    })

    expect(source.stateObjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectId: 'PS01', facts: expect.arrayContaining([
        expect.objectContaining({ label: '项目地点', value: '湖北省鄂州市' }),
      ]) }),
      expect.objectContaining({ objectId: 'BL01', facts: expect.arrayContaining([
        expect.objectContaining({ label: '可实施方向', value: '明塘地块存量建筑改造、文旅商业功能置换与微循环更新' }),
      ]) }),
      expect.objectContaining({ objectId: 'DG01', facts: expect.arrayContaining([
        expect.objectContaining({ label: '文旅公共空间及配套服务达标综合缺口率', value: '45 %' }),
      ]) }),
      expect.objectContaining({ objectId: 'IM01', facts: expect.arrayContaining([
        expect.objectContaining({ label: '建设内容', value: '明塘存量建筑加固修缮与沿湖生态驳岸改造' }),
        expect.objectContaining({ label: '前置条件', value: '市政管网改造与地勘勘察为主体施工的前置条件' }),
      ]) }),
    ]))
    expect(source.stateObjects.find(object => object.objectId === 'SP07')?.summary)
      .toBe('明塘核心步行街采用8米街巷＋3米外摆区；明塘建筑限高≤18米、容积率≤1.2')
    expect(source.stateObjects.find(object => object.objectId === 'OP07')?.summary)
      .toBe('平衡文化原真性传承与现代滨水活力激活，投资强度可控，社会与经济效益最优化')
    expect(source.stateObjects.find(object => object.objectId === 'IM02')?.summary)
      .toBe('全口径工程总建设投资约1.05亿元')
    expect(source.stateObjects.find(object => object.objectId === 'IM02')?.facts)
      .toContainEqual(expect.objectContaining({ label: '全口径工程总建设投资', value: '10500 万元' }))
    expect(source.stateObjects.find(object => object.objectId === 'IM06')?.summary)
      .toBe('基准情景下IRR为6.8%，DSCR为1.35')
    expect(source.stateObjects.find(object => object.objectId === 'IM06')?.facts)
      .not.toContainEqual(expect.objectContaining({ label: '财务净现值', value: '1280' }))
    expect(source.stateObjects.find(object => object.objectId === 'IM07')?.summary)
      .toBe('一期示范、二期成型、三期提升')
    expect(JSON.stringify(source.stateObjects)).not.toMatch(
      /origin mode|origin_mode|allowed|mandatory level|mandatory_level|level|score|measures|dependencies|mixed|medium|mandatory|OPT-B/iu,
    )
  })

  it('用冻结结论和事实生成互不复写的客户证据', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-default-evidence-'))
    const stateObjects = Array.from({ length: 4 }, (_, objectIndex) => ({
      objectId: `SP0${objectIndex + 1}`,
      chapterId: String(objectIndex + 1).padStart(2, '0'),
      title: `专题 ${objectIndex + 1}`,
      summary: `专题 ${objectIndex + 1} 的客户结论`,
      facts: Array.from({ length: 4 }, (_, factIndex) => ({
        label: `指标 ${objectIndex + 1}-${factIndex + 1}`,
        value: `${(objectIndex + 1) * 10 + factIndex} 米`,
        basis: '项目冻结资料',
      })),
    }))
    try {
      const profile = await loadClientProjectProfile(root, REPORT_INPUT.projectId, {
        ...REPORT_INPUT,
        stateObjects,
      })
      const statements = profile.evidence.map(item => item.statement)

      expect(statements).toHaveLength(13)
      expect(new Set(statements).size).toBe(13)
      expect(statements).toEqual(expect.arrayContaining([
        '专题 1 的客户结论',
        '指标 1-1：10 米',
      ]))
      expect(statements.join('\n')).not.toContain('为本章判断提供了可核验的项目依据')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('按产品册叙事角色选取关键成果对象，并让核心尺度投资与分期进入客户证据', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-role-evidence-'))
    const specs = [
      ['PS01', '01', '项目身份', '形成湖街一体化城市更新产品'],
      ['DG01', '03', '核心诊断', '空间割裂与业态低效共同限制资源价值'],
      ['DG05', '03', '机会识别', '武鄂同城化微度假形成发展窗口'],
      ['OB01', '04', '项目定位', '定位为城市文化与滨水生活新客厅'],
      ['OP07', '05', '推荐路径', '采用有机更新与微度假活化组合'],
      ['PG04', '06', '产品体系', '形成文化街区、滨水生活客厅与落日剧场'],
      ['SP07', '07', '空间场景', '明塘核心步行街采用8米街巷＋3米外摆区'],
      ['IM06', '08', '运营平衡', '专业运营支撑长期现金流平衡'],
      ['IM07', '08', '分期路径', '一期示范、二期成型、三期提升'],
      ['IM02', '08', '投资基线', '全口径建设投资约1.05亿元'],
    ] as const
    const stateObjects = specs.map(([objectId, chapterId, title, summary], index) => ({
      objectId,
      chapterId,
      title,
      summary,
      facts: [
        { label: '关键结论', value: summary, basis: '项目冻结资料' },
        { label: '补充依据', value: `${title}补充依据${index + 1}`, basis: '项目冻结资料' },
      ],
    }))
    try {
      const profile = await loadClientProjectProfile(root, REPORT_INPUT.projectId, {
        ...REPORT_INPUT,
        stateObjects,
      })
      const statements = profile.evidence.map(item => item.statement).join('\n')

      expect(profile.chapters.map(chapter => chapter.sourceObjectIds[0])).toEqual([
        'PS01', 'DG01', 'DG05', 'OB01', 'OP07', 'PG04', 'SP07', 'IM06', 'IM07', 'IM02',
      ])
      expect(profile.chapters.map(chapter => chapter.blocks.find(block => block.type === 'narrative')))
        .toEqual(specs.map(([, , , summary], index) => ({
          type: 'narrative',
          statement: summary,
          evidenceIds: ['evidence-' + String(index + 1).padStart(2, '0')],
        })))
      const spatialEvidence = profile.chapters.find(chapter => chapter.role === 'spatial')
        ?.blocks.find(block => block.type === 'evidence')
      expect(spatialEvidence?.type === 'evidence'
        ? spatialEvidence.evidenceIds.map(id => profile.evidence.find(item => item.evidenceId === id)?.statement)
        : []).toEqual(['补充依据：空间场景补充依据7'])
      expect(statements).toContain('明塘核心步行街采用8米街巷＋3米外摆区')
      expect(statements).toContain('全口径建设投资约1.05亿元')
      expect(statements).toContain('一期示范、二期成型、三期提升')
      const decision = profile.chapters.find(chapter => chapter.role === 'decision')
        ?.blocks.find(block => block.type === 'decision')
      expect(decision?.type === 'decision'
        ? decision.rationaleEvidenceIds.map(id => profile.evidence.find(item => item.evidenceId === id)?.statement)
        : []).toEqual([
        '定位为城市文化与滨水生活新客厅',
        '一期示范、二期成型、三期提升',
        '专业运营支撑长期现金流平衡',
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
