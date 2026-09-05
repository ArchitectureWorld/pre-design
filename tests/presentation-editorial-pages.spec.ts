import { describe, expect, it } from 'vitest'
import { compileReportOutline } from '../src/presentation/projector/report-outline.ts'
import { buildPresentationStandardProject } from '../src/presentation/standard-project-adapter.ts'
import type { DraftPageDocument } from '@architectureworld/presentation-contracts'
import type { FrozenReportSection, FrozenStateObject } from '../src/report/types.ts'
import { createStandardFrozenProject } from './presentation-standard-fixture.ts'

const section = (key: string, title: string, texts: readonly string[]): FrozenReportSection => ({
  key, title, entries: texts.map((text, i) => ({ key: `${key}-${i}`, text: `${title}：${text}`,
    contentText: `${title}：${text}`, basis: '前期专项调查，最终参数待复核', fieldPath: `data.${key}[${i}]` })),
})
const object = (id: string, title: string, sections: readonly FrozenReportSection[]): FrozenStateObject => ({
  objectId: id, chapterId: id.startsWith('IM') ? '08' : id.startsWith('OP') ? '05' : id.startsWith('PG') ? '06' : '01',
  title, summary: sections[0]?.entries[0]?.text ?? title, facts: [], reportSections: sections,
})
const plan = (objects: readonly FrozenStateObject[]) => compileReportOutline(createStandardFrozenProject({ stateObjects: objects }))
const mainText = (finding: ReturnType<typeof plan>[number]) => [finding.keyMessage, ...finding.supportingBlocks.flatMap(block => block.type === 'list' ? block.items : block.type === 'text' && block.role !== 'source_note' ? [block.content] : [])].join('\n')

describe('content-led report pages and spoken narration', () => {
  it('keeps a decision argument and its short tail and condition together instead of splitting at twelve items or by field class', () => {
    const input = object('PS02', '本轮决策', [
      section('subquestions', '决策问题', Array.from({ length: 13 }, (_, i) => `议题${i + 1}涉及方案选择与受益对象`)),
      section('acceptance_criteria', '决策标准', ['需要比较实施收益与受影响范围']),
      section('conditions', '成立条件', ['方案须经地质复核后方能确定']),
    ])
    const detail = plan([input]).filter(f => f.findingId.startsWith('pre-design:detail:mandate:'))
    expect(detail).toHaveLength(1)
    const all = JSON.stringify(detail[0]!.supportingBlocks)
    expect(all).toContain('议题13涉及方案选择与受益对象')
    expect(mainText(detail[0]!)).toContain('地质复核')
    expect(all).toContain('data.subquestions[12]')
  })

  it('deduplicates repeated points on the page without losing the two original source paths', () => {
    const text = '供水功能需要在防洪安全得到保障后实施'
    const input = object('PG02', '功能体系', [section('functions', '功能要求', [text, text]), section('dependencies', '成立条件', [text])])
    const detail = plan([input]).filter(f => f.findingId.startsWith('pre-design:detail:user-functions:'))
    const points = detail.flatMap(f => [f.keyMessage, ...f.supportingBlocks.flatMap(b => b.type === 'list' ? b.items : [])])
    expect(points.filter(item => item.includes(text))).toHaveLength(1)
    const sources = JSON.stringify(detail.map(f => f.supportingBlocks))
    expect(sources).toContain('data.functions[0]')
    expect(sources).toContain('data.functions[1]')
    expect(sources).toContain('data.dependencies[0]')
  })

  it('reserves room for a main visual while preserving every long source statement in structured evidence', () => {
    const rows = Array.from({ length: 24 }, (_, i) => `独立服务${i + 1}。${'这个功能服务周边居民并需要独立的容量校核。'.repeat(12)}`)
    const input = object('PG02', '功能体系', [section('functions', '功能要求', rows)])
    const detail = plan([input]).filter(f => f.findingId.startsWith('pre-design:detail:user-functions:'))
    expect(detail.length).toBeGreaterThan(1)
    for (const finding of detail) {
      const points = finding.supportingBlocks.flatMap(block => block.type === 'list' ? block.items : [])
      expect(points.join('').length).toBeLessThanOrEqual(1000)
    }
    const evidence = JSON.stringify(detail.map(f => f.supportingBlocks))
    for (const row of rows) expect(evidence).toContain(row)
  })

  it('writes audience-facing speech for overview, detail, agenda and synthesis without source dumps or author instructions', () => {
    const inputs = [
      object('PS01', '启动背景', [section('start_reason', '启动原因', ['枯水期供水能力不足，项目拟补充季节调蓄能力'])]),
      object('PS02', '本轮决策', [section('subquestions', '决策问题', ['坝址和库容需要共同比较']), section('conditions', '成立条件', ['选址须取得地质复核结果'])]),
      object('DG06', '关键议题', [section('topics', '策划议题', ['坝址比选与工程规模；在供水需求与淹没影响之间选择可行路径'])]),
      object('OP02', '路径备选', [section('options', '备选路径', ['上坝址拟减少淹没范围', '下坝址拟提升调蓄能力'])]),
      object('OP07', '推荐意见', [section('rationale', '推荐理由', ['暂推荐下坝址以提高供水保障']), section('conditions', '成立条件', ['地质条件仍需实测复核'])]),
    ]
    const findings = plan(inputs)
    for (const selector of ['pre-design:project-brief', 'pre-design:detail:mandate:', 'pre-design:agenda:', 'pre-design:analysis:path-response']) {
      const finding = findings.find(f => f.findingId.startsWith(selector))!
      expect(finding).toBeDefined()
      const speech = finding.speakerNotes!.join('\n')
      expect(speech.length).toBeGreaterThan(90)
      expect(speech.length).toBeLessThan(1800)
      expect(speech).not.toMatch(/本页回答|编写主线|编写建议|逐项说明|论证要求|来源成果|data\.|\/facts\[|PS0\d|OP0\d|speakerNotes/u)
      expect(mainText(finding)).not.toMatch(/本页回答|编写主线|编写建议|逐项说明|论证要求/u)
      expect(speech).toMatch(/因此|意味着|取决于|影响|前提|条件/u)
      expect(speech).toMatch(/接下来|进一步|随后|在此基础上/u)
    }
    expect(findings.find(f=>f.findingId.startsWith('pre-design:analysis:path-response'))!.speakerNotes!.join('')).toContain('地质')
  })

  it('keeps investment contradictions and option comparison as separate decision issues with qualified narration', () => {
    const cost = (id: string, value: number) => object(id, '投资估算', [{ key: 'capex', title: '建设投资', entries: [{ key: 'total', text: `建设投资暂估${value}万元`, contentText: `建设投资暂估${value}万元`, basis: '前期匡算', fieldPath: 'data.capex', metric: { label: '建设投资', value, unit: '万元' } }] }])
    const result = plan([cost('IM02', 44200), cost('IM06', 28500), object('IM03', '筹资情况', [section('funding_gap', '资金状态', ['现状已落实资金为0万元，拟争取资金尚待审批'])]), object('OP02','方案比较',[section('options','备选方案',['上坝址和下坝址均需按统一标准比较'])]), object('OP07','推荐意见',[section('conditions','成立条件',['推荐路径仍需地质复核'])])])
    const conflict = result.find(f => f.findingId === 'pre-design:analysis:investment-basis')!
    const speech = conflict.speakerNotes!.join('')
    expect(speech).toContain('44200')
    expect(speech).toContain('28500')
    expect(speech).toContain('待核对')
    expect(speech).toMatch(/尚待审批|未落实|已落实资金为0/u)
    expect(result.some(f=>f.findingId==='pre-design:analysis:path-response')).toBe(true)
    expect(conflict.contentNature).toBe('missing')
  })

  it('explains the actual funding prerequisite instead of reading an isolated approval enum or repeating the opening', () => {
    const sentence = '当前已落实资金为0万元，拟争取资金尚未取得批复'
    const input = object('IM03', '资金筹措', [section('approval_status', '审批落实情况', ['待审批']),
      section('funding_gap', '资金落实与缺口', [sentence]),
      section('timelines', '筹资安排', ['专项审批完成后才能进入出资安排']),
    ])
    const finding = plan([input]).find(f=>f.findingId==='pre-design:delivery')!
    const speech = finding.speakerNotes!.join('')
    expect(speech).toContain(sentence)
    expect(speech.split(sentence)).toHaveLength(2)
    expect(speech).not.toMatch(/同时，待审批|相关的是，待审批|当前状态：|完成期限：/u)
    expect(speech).toContain('专项审批完成后')
  })

  it('speaks metric units and source qualifications as readable sentences', () => {
    const input = object('BL01', '规划条件', [section('constraints', '规划约束', [
      '工程应服从水资源规划。；当前状态：初步成果',
      '规划用地范围；1720000m2；包含水库及施工范围。；当前状态：现行有效',
    ])])
    const finding = plan([input]).find(f => f.findingId.startsWith('pre-design:detail:planning-land:'))!
    const speech = finding.speakerNotes!.join('')
    expect(speech).toContain('1720000平方米')
    expect(speech).not.toMatch(/[。；][，；]|[，；]。|m2/u)
    expect(speech).toContain('初步判断')
    expect(mainText(finding)).not.toMatch(/现有成果提出|。。|。；/u)
    expect(mainText(finding)).toContain('初步判断')
  })

  it('opens a baseline overview with planning and land context rather than a long isolated building constraint', () => {
    const planning = { ...object('BL01', '规划管控', [section('planning_conditions', '规划条件', ['项目纳入流域水资源规划，需要落实库区用地审批'])]), chapterId: '02' }
    const buildings = { ...object('BL04', '空间现状', [section('constraints', '安全限制', ['既有房屋必须完成结构鉴定。'.repeat(8)])]), chapterId: '02' }
    const finding = plan([planning, buildings]).find(f => f.findingId === 'pre-design:baseline')!
    expect(finding.speakerNotes![0]).toContain('流域水资源规划')
    expect(finding.speakerNotes![0]).not.toContain('结构鉴定')
  })

  it('develops an option agenda through all alternatives, recommendation and its condition before unrelated road constraints', () => {
    const result = plan([
      object('DG06', '关键议题', [section('topics', '策划议题', ['坝址比选；共同检验供水效益与淹没影响'])]),
      object('OB04', '底线', [section('constraints', '底线约束', ['重载道路与桥涵安全限制。'.repeat(9)])]),
      object('OP02', '备选路径', [section('options', '备选方案', ['路径A采用上坝址减少淹没', '路径B采用下坝址适度调蓄', '路径C采用高坝扩大库容'])]),
      object('OP07', '推荐路径', [section('recommended_option', '推荐方案', ['暂推荐路径B']), section('conditions', '成立条件', ['下坝址需要地质钻探复核后才能确认'])]),
    ])
    for (const prefix of ['pre-design:agenda:', 'pre-design:analysis:path-response']) {
      const speech = result.find(f => f.findingId.startsWith(prefix))!.speakerNotes!.join('')
      for (const text of ['路径A', '路径B', '路径C', '暂推荐路径B', '地质钻探']) expect(speech).toContain(text)
      expect(speech.indexOf('路径A')).toBeLessThan(speech.indexOf('重载道路') < 0 ? Infinity : speech.indexOf('重载道路'))
      expect(speech).not.toMatch(/项目资料同时显示|与之相关的是|还需要关注|这一安排还取决于一个条件/u)
    }
  })

  it('does not recite the same cost again under formatted metric labels or imply that the actual funding gap is zero', () => {
    const cost = (id: string, value: number) => object(id, '投资估算', [{ key: 'capex', title: '建设投资', entries: [{ key: 'total', text: `建设投资；${value.toLocaleString('en-US')}万元`, contentText: `建设投资；${value.toLocaleString('en-US')}万元`, basis: '匡算', fieldPath: 'data.capex', metric: { label: '建设投资', value, unit: '万元' } }] }])
    const result = plan([cost('IM02', 44200), cost('IM06', 28500), object('IM03', '筹资', [section('funding_gap', '资金缺口', ['目前已落实资金0万元，实际资金缺口44200万元。拟争取资金须取得正式批复。'])])])
    const speech = result.find(f => f.findingId === 'pre-design:analysis:investment-basis')!.speakerNotes!.join('')
    expect(speech).not.toContain('44,200')
    expect(speech).not.toContain('28,500')
    expect(speech).not.toContain('测算资金缺口为零')
    expect(speech).toContain('已落实资金0万元')
    expect(speech).toContain('实际资金缺口44200万元')
  })

  it('associates an adopted visual only by the exact work item or evidence asset reference, not its chapter', () => {
    const obj = { ...object('PS02', '决策任务', [section('subquestions', '决策问题', ['需要共同校核建设边界与使用需求'])]), workItemId: '01-02' }
    const sourceSection = obj.reportSections![0]!
    const referenced = { ...obj, reportSections: [{ ...sourceSection, entries: sourceSection.entries.map(entry => ({ ...entry, evidenceRefs: [{ evidenceId: 'evidence-1', assetId: 'explicit' }] })) }] }
    const result = compileReportOutline(createStandardFrozenProject({ stateObjects: [referenced], adoptedAssetIds: ['same-chapter', 'same-item', 'explicit'], visualAssets: [
      { assetId: 'same-chapter', chapterId: '01', workItemId: '01-01', caption: '无关图片', sourcePath: 'none.png', mimeType: 'image/png', kind: 'evidence' },
      { assetId: 'same-item', chapterId: '01', workItemId: '01-02', caption: '同任务图片', sourcePath: 'none.png', mimeType: 'image/png', kind: 'evidence' },
      { assetId: 'explicit', chapterId: '08', caption: '明确证据关联', sourcePath: 'none.png', mimeType: 'image/png', kind: 'evidence' },
    ] }))
    const finding = result.find(f => f.findingId.startsWith('pre-design:detail:mandate:'))!
    expect(finding.assetIds).toEqual(['explicit', 'same-item'])
  })

  it('does not spread an entry evidence image to other detail pages of the same source object', () => {
    const input = object('PG02', '功能体系', [{ key: 'functions', title: '功能要求', entries: Array.from({ length: 3 }, (_, i) => ({
      key: `function-${i}`, text: `服务${i}。${'设施运行需要独立完成容量校核与维护评估。'.repeat(100)}`,
      basis: '专项成果', fieldPath: `data.functions[${i}]`,
      ...(i === 0 ? { evidenceRefs: [{ evidenceId: 'photo-evidence', assetId: 'photo' }] } : {}),
    })) }])
    const result = compileReportOutline(createStandardFrozenProject({ stateObjects: [input], adoptedAssetIds: ['photo'], visualAssets: [
      { assetId: 'photo', caption: '第一功能图片', sourcePath: 'none.png', mimeType: 'image/png', kind: 'evidence' },
    ] }))
    const pages = result.filter(f => f.findingId.startsWith('pre-design:detail:user-functions:'))
    expect(pages).toHaveLength(3)
    expect(pages.map(f => f.assetIds)).toEqual([['photo'], [], []])
  })

  it('does not repeat the long funding gap paragraph as a closing prerequisite', () => {
    const funding = '建设投资为44,200万元。当前已落实资金为0万元，名义资金缺口为44,200万元。基准情景预期资金缺口为0万元，但依赖专项申报获批。保守情景产生5,200万元缺口。该缺口需通过分期实施和缩减规模消纳。'
    const cost = (id: string, value: number) => object(id, '投资', [{ key: 'capex', title: '建设投资', entries: [{ key: 'total', text: `建设投资为${value}万元`, basis: '匡算', fieldPath: 'data.capex', metric: { label: '建设投资', value, unit: '万元' } }] }])
    const findings = plan([cost('IM02', 44200), cost('IM06', 28500), object('IM03', '筹资情况', [section('funding_gap', '资金缺口', [funding])])])
    const speech = findings.find(f => f.findingId === 'pre-design:analysis:investment-basis')!.speakerNotes!.join('')
    expect(speech.split('当前已落实资金为0万元')).toHaveLength(2)
  })

  it('retains the page key measure in spoken detail even when several constraints rank higher', () => {
    const obj = object('BL01', '规划条件', [section('constraints', '规划限制', ['建设须落实红线审批', '建设须完成地质调查', '建设须完成水土保持论证', '建设须完成征地协调', '建设须完成防洪安全论证', '建设须完成移民安置审批']),
      { key: 'area', title: '控制范围面积', entries: [{ key: 'area', text: '控制范围面积；1720000m2', basis: '测绘资料', fieldPath: 'data.area', metric: { label: '控制范围面积', value: 1720000, unit: 'm2' } }] },
    ])
    const speech = plan([obj]).find(f => f.findingId.startsWith('pre-design:detail:planning-land:'))!.speakerNotes!.join('')
    expect(speech).toContain('1720000平方米')
  })

  it('removes the internal data-gap editorial prefix without removing actual funding status', () => {
    const input = object('IM03', '资金筹措', [section('funding_gap', '资金缺口', [
      '依据前期策划缺失资料处理策略，未取得正式批准或协议的资金一律不作为已落实资金，当前实际已到位资金为0万元，名义资金缺口为44200万元。',
    ])])
    const speech = plan([input]).find(f => f.findingId === 'pre-design:delivery')!.speakerNotes!.join('')
    expect(speech).not.toContain('依据前期策划缺失资料处理策略')
    expect(speech).toContain('未取得正式批准或协议的资金一律不作为已落实资金')
    expect(speech).toContain('当前实际已到位资金为0万元')
    expect(speech).toContain('名义资金缺口为44200万元')
  })

  it('uses the complete governance argument before escaped source line breaks instead of a generic placeholder', () => {
    const argument = '少潭河水库工程构建政府领导、法人统筹、专业运营和联席共治的四级治理体系'
    const source = `${argument}：\\n1. 决策督导层：${'政府与相关部门共同负责重大建设方案和跨部门事项协调，'.repeat(15)}。\\n2. 建设统筹层：项目法人必须承担建设交付责任。`
    const input = object('IM05', '建设运营与维护主体', [section('governance', '建设运营协同机制', [source])])
    const finding = plan([input]).find(f => f.findingId.startsWith('pre-design:detail:approval-operator:'))!
    const points = [finding.keyMessage, ...finding.supportingBlocks.flatMap(b => b.type === 'list' ? b.items : [])]
    expect(points.join('')).not.toContain('涉及建设运营与维护主体的具体要求')
    expect(points.join('')).toContain(argument)
    expect(points.join('')).not.toContain('：；')
    expect(points.some(point => point.length < 165 && point.includes(argument))).toBe(true)
  })

  it('renders each key message once in canonical main content while retaining similar arguments, evidence and narration', async () => {
    const main = '建设边界需要同时校核用地条件和实际服务需求'
    const different = '建设边界需要同时校核用地条件和未来服务需求'
    const inputs = [
      object('PS02', '决策任务', [section('decision_question', '决策问题', [main, different])]),
      object('DG06', '策划议题', [section('topics', '核心议题', ['坝址比选；需要共同检验库容规模与淹没影响'])]),
      object('OP02', '备选方案', [section('options', '路径方案', ['路径A优先减少淹没范围', '路径B优先满足供水保障'])]),
      object('OP07', '推荐路径', [section('recommended_option', '推荐方案', ['暂推荐路径B']), section('conditions', '成立条件', ['推荐坝址必须取得地质复核结果'])]),
    ]
    const build = await buildPresentationStandardProject({ frozenProject: createStandardFrozenProject({ stateObjects: inputs }) })
    const drafts = Object.values(build.documents).filter((value): value is DraftPageDocument => typeof value === 'object'
      && value !== null && 'documentType' in value && value.documentType === 'DraftPageDocument')
    expect(drafts.length).toBeGreaterThan(4)
    const canonical = (value: string) => value.trim().replace(/。+$/u, '')
    for (const draft of drafts) {
      const key = draft.contentBlocks.find(block => block.type === 'text' && block.role === 'key_message')!
      const visible = draft.contentBlocks.flatMap(block => block.type === 'text' ? block.content.split('\n\n')
        : block.type === 'list' ? block.items.map(item => item.content) : [])
      expect(visible.filter(value => canonical(value) === canonical((key as { content: string }).content)), draft.pageId).toHaveLength(1)
      expect(draft.contentBlocks.some(block => block.type === 'table')).toBe(true)
      expect(draft.scriptBlocks[0]!.content.length).toBeGreaterThan(0)
    }
    const detailId = build.stableIds['page:finding:pre-design:detail:mandate:argument:PS02:decision_question:decision_question-0']
    const detail = drafts.find(draft => draft.pageId === detailId)!
    expect(detail.contentBlocks.find(block => block.type === 'text' && block.role === 'key_message')).toMatchObject({ content: `${main}。` })
    expect(detail.contentBlocks.flatMap(block => block.type === 'list' ? block.items.map(item => item.content) : [])).toContain(different)
    const evidence = JSON.stringify(detail.contentBlocks.filter(block => block.type === 'table'))
    expect(evidence).toContain(main)
    expect(evidence).toContain(different)
    expect(detail.scriptBlocks[0]!.content).toContain(main)
  })
})
