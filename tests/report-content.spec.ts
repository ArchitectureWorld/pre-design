import { describe, expect, it } from 'vitest'
import { createFrozenProjectInput } from '../src/report/source.ts'
import { createFrozenReportSections, reportReferenceNames } from '../src/report/report-content.ts'

function freeze(data: Record<string, unknown>) {
  return createFrozenProjectInput('project-1', 59, {
    repository: { readProjectRevision: () => ({
      project: { projectId: 'project-1', name: '测试水库' },
      revision: { revision: 59, committedAt: '2026-09-05T10:00:00Z' },
      stateSnapshot: { IM03: { data } },
    }) } as never,
    governance: { readProject: () => ({ gateDecisions: [], visualAssets: [] }) } as never,
    registry: { workflows: () => [{ targetObjectId: 'IM03', chapterId: '08', title: '资金筹措与政策适配' }] } as never,
    visualStore: { resolveAsset: () => '' } as never,
  }).stateObjects[0]!
}

describe('完整报告内容提取', () => {
  it('保留超过八条的成果及每条描述、条件和来源，不把完整材料缩成名称摘要', () => {
    const source = freeze({
      conditions: Array.from({ length: 12 }, (_, index) => ({
        id: `condition-${index + 1}`, name: `筹资条件${index + 1}`,
        description: `必须先完成专项核验${index + 1}`, basis: '项目投资专项资料',
        assumptions: [{ name: '审批前提', description: '尚未获得资金批复' }],
      })),
    })
    const section = source.reportSections?.find(item => item.key === 'conditions')
    expect(section?.entries).toHaveLength(12)
    expect(section?.entries[11]).toMatchObject({
      key: 'condition-12', fieldPath: 'data.conditions[11]', basis: expect.stringContaining('项目投资专项资料'),
      text: expect.stringContaining('必须先完成专项核验12'),
    })
    expect(section?.entries[11]?.text).toContain('尚未获得资金批复')
    expect(source.facts.length).toBeLessThanOrEqual(8)
  })

  it('保留零值、数值区间、专业标量指标及度量原单位，不把预期筹资当作到位资金', () => {
    const source = freeze({
      amounts: [{ id: 'current', name: '已落实资金', value: 0, unit: '万元',
        basis: '未签署拨款批复', confidence: { level: 'medium', score: 0.8, limitations: ['预期资金不计入到位'] } }],
      ranges: [{ min: 40000, max: 49000, unit: '万元', basis: '前期估算区间' }],
      npv: 0, approval_status: 'pending',
    })
    const sections = source.reportSections!
    expect(sections.find(item => item.key === 'amounts')?.entries[0]?.metric)
      .toEqual({ label: '已落实资金', value: 0, unit: '万元' })
    const visible = sections.flatMap(item => item.entries.map(entry => `${entry.text} ${entry.basis}`)).join('\n')
    expect(visible).toContain('0 万元')
    expect(visible).toContain('40000')
    expect(visible).toContain('49000')
    expect(visible).toContain('预期资金不计入到位')
    expect(visible).toContain('待审批')
    expect(sections.find(item => item.key === 'npv')?.entries[0]?.metric?.value).toBe(0)
    expect(sections.find(item => item.key === 'npv')?.entries[0]?.text).toBe('财务净现值：0')
    expect(sections.find(item => item.key === 'approval_status')?.entries[0]?.text).toContain('审批落实情况：待审批')
  })

  it('实体重排保持来源键稳定，保留未知专业字段的语义名称，隔离内部治理和标识', () => {
    const entity = { id: 'survey-2', name: '库岸沉降复测', description: '需复测第二监测断面',
      status: 'planned', evidence_refs: [{ evidence_id: 'ev-private', asset_id: 'asset-private', notes: '勘测说明第3节', claim_class: 'assumption' }] }
    const source = freeze({ custom_survey: [entity], prompt: '私有提示词不得展示', source_snapshot: { BL03: 12 },
      approval: { approver: 'internal-account', status: 'pending' }, recommended_option: 'OPT-B' })
    const reordered = freeze({ custom_survey: [{ id: 'survey-1', name: '先行监测' }, entity] })
    const section = source.reportSections?.find(item => item.key === 'custom_survey')
    expect(section?.title).toContain('库岸沉降复测')
    expect(section?.entries[0]?.key).toBe(reordered.reportSections?.find(item => item.key === 'custom_survey')?.entries[1]?.key)
    const visible = source.reportSections?.map(item => `${item.title} ${item.entries.map(entry => `${entry.text} ${entry.basis}`).join(' ')}`).join('\n')
    expect(visible).toContain('需复测第二监测断面')
    expect(visible).toContain('勘测说明第3节')
    expect(visible).toContain('假设')
    expect(visible).not.toMatch(/custom_survey|survey-2|ev-private|asset-private|internal-account|planned|OPT-B|私有提示词/u)
  })

  it('把专业状态和正文中的来源字段翻成可读中文，未知标记保留原值并显式待核对', () => {
    const source = freeze({
      amounts: [{ name: '社会资本筹资方案', value: 0, unit: '万元', status: 'eligible_uncommitted',
        description: '根据IM03.approval_status核实资金状态',
        evidence_refs: [{ claim_class: 'source_conclusion', notes: '尚无投资协议' }] }],
      owner: { name: '水库管理单位', role: 'project_legal_person', authority_scope: ['dam_safety_monitoring'] },
      verification_status: 'new_unrecognized_status',
    })
    const visible = source.reportSections!.map(item => `${item.title} ${item.entries.map(entry => `${entry.text} ${entry.basis}`).join(' ')}`).join('\n')
    expect(visible).toContain('符合申请条件，尚未落实')
    expect(visible).toContain('项目法人')
    expect(visible).toContain('大坝安全监测')
    expect(visible).toContain('资料结论')
    expect(visible).toContain('待核对')
    expect(visible).toContain('new_unrecognized_status')
    expect(visible).not.toMatch(/eligible_uncommitted|approval_status|source_conclusion|project_legal_person|dam_safety_monitoring/u)
  })

  it('正文保留完整专业实体与风险条件，独立依据承载重复的来源和可信度说明', () => {
    const source = freeze({ amounts: [{ id: 'capital', name: '已落实资金', value: 0, unit: '万元',
      description: '无拨款凭证的拟争取资金不计入到位金额', conditions: ['需取得书面批复'],
      risks: [{ name: '审批风险', description: '未获批时须调整建设时序' }],
      source_ref: 'IM03', basis: '资金台账第2页', method: '资金到位核查', as_of: '2026-09-05',
      confidence: { level: 'medium', basis: '凭证核查', limitations: ['还需取得部门确认'] },
    }], confidence: { level: 'medium', basis: '方案阶段' } })
    const entry = source.reportSections!.find(item => item.key === 'amounts')!.entries[0]!
    expect(entry.contentText).toContain('资金规模：已落实资金；0 万元')
    expect(entry.contentText).toContain('无拨款凭证的拟争取资金不计入到位金额')
    expect(entry.contentText).toContain('需取得书面批复')
    expect(entry.contentText).toContain('未获批时须调整建设时序')
    expect(entry.contentText).not.toMatch(/资金台账第2页|凭证核查|2026-09-05|资金到位核查/u)
    expect(entry.text).toContain('还需取得部门确认')
    expect(entry.basis).toContain('资金台账第2页')
    expect(entry.basis).toContain('资金到位核查')
    expect(source.reportSections!.find(item => item.key === 'confidence')!.entries[0]!.contentText).toBe('')
  })

  it('保持来源网址、查询参数、文件路径和公式变量原样，不把专业表达式当成枚举翻译', () => {
    const source = freeze({
      formulas: [{ name: '容量计算', expression: 'net_area / gross_factor',
        formula: 'gross_areas / gross_factors', unit: 'm2' }],
      amounts: [{ name: '估算依据', source_ref: 'https://gov.example.cn/reports/flood_risk_2026.pdf?report_id=12',
        basis: '本地来源 C:\\research_data\\flood_risk_2026.pdf',
        description: '详见 https://gov.example.cn/reports/approval_status.pdf?report_id=12' }],
    })
    const visible = source.reportSections!.flatMap(item => item.entries.map(entry => `${entry.text} ${entry.basis}`)).join('\n')
    expect(visible).toContain('net_area / gross_factor')
    expect(visible).toContain('gross_areas / gross_factors')
    expect(visible).toContain('https://gov.example.cn/reports/flood_risk_2026.pdf?report_id=12')
    expect(visible).toContain('https://gov.example.cn/reports/approval_status.pdf?report_id=12')
    expect(visible).toContain('C:\\research_data\\flood_risk_2026.pdf')
  })

  it('同名实体ID按所属成果解析，跨成果的明确引用不被另一个同名实体替换', () => {
    const snapshot = {
      BL03: { data: { ecology: [{ id: 'eco-01', name: '山地林地', description: '保护eco-01' }] } },
      SP05: { data: { ecology: [{ id: 'eco-01', name: '生态修复带', description: '修复eco-01，衔接BL03.eco-01' }] } },
    }
    const refs = reportReferenceNames(snapshot, new Map([['BL03', '自然生态本底'], ['SP05', '公共空间生态']]))
    const base = createFrozenReportSections(snapshot.BL03, '自然生态本底', {}, refs)[0]!.entries[0]!.text
    const plan = createFrozenReportSections(snapshot.SP05, '公共空间生态', {}, refs)[0]!.entries[0]!.text
    expect(base).toContain('保护山地林地')
    expect(plan).toContain('修复生态修复带')
    expect(plan).toContain('衔接山地林地')
  })

  it('度量value为区间对象时保留上下限和单位，并保留机器可追溯的证据身份', () => {
    const source = freeze({ amounts: [{ id: 'earth', name: '工程量', value: { min: 12, max: 15, unit: '公顷' },
      evidence_refs: [{ evidence_id: 'ev-earth', asset_id: 'asset-survey', version_id: 'v3', locator: { page: 7, section: '实测量表' } }],
    }], evidence_refs: [{ evidence_id: 'ev-project', asset_id: 'asset-project', version_id: 'v2', locator: { page: 1 } }] })
    const entry = source.reportSections!.find(item => item.key === 'amounts')!.entries[0]!
    expect(entry.contentText).toContain('12')
    expect(entry.contentText).toContain('15')
    expect(entry.contentText).toContain('公顷')
    expect(entry.metric).toBeUndefined()
    expect(entry.evidenceRefs).toEqual(expect.arrayContaining([
      { evidenceId: 'ev-earth', assetId: 'asset-survey', versionId: 'v3', locator: { page: 7, section: '实测量表' } },
      { evidenceId: 'ev-project', assetId: 'asset-project', versionId: 'v2', locator: { page: 1 } },
    ]))
    expect(`${entry.text} ${entry.basis}`).not.toMatch(/ev-earth|asset-survey|ev-project|asset-project/u)
  })
})
