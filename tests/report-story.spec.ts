import { describe, expect, it } from 'vitest'
import { summarizeReportPage } from '../src/report/manuscript/report-story.ts'
import type { PlanningManuscriptPage } from '../src/report/manuscript/types.ts'

const page: PlanningManuscriptPage = { id: 'p', kind: 'comparison', title: '服务组织', claim: '预约换乘连接茶园体验。',
  body: ['预约换乘连接茶园体验。', '卫生保障中断且无替代安排时暂停接待。'], sourceRefs: ['s'], notes: [],
  visual: { kind: 'concept', subject: '茶园', purpose: '体验', caption: '茶园体验' } }
describe('client report story composition', () => {
  it('removes repeated claim sentences without dropping their source archive or mutating the original', () => {
    const original = JSON.stringify(page), result = summarizeReportPage(page)
    expect(result.body).toEqual(['卫生保障中断且无替代安排时暂停接待。'])
    expect(result.notes.join('\n')).toContain(page.body.join('\n'))
    expect(JSON.stringify(page)).toBe(original)
    expect(summarizeReportPage(result)).toBe(result)
  })
  it('presents a matrix once and preserves the complete author text as supporting material', () => {
    const table = { columns: ['环节', '实施条件'], rows: [['卫生服务', '中断且无替代安排时暂停接待']] }
    const result = summarizeReportPage({ ...page, body: [page.claim, '卫生服务｜中断且无替代安排时暂停接待。'], table })
    expect(result.body).toEqual([])
    expect(result.table).toBe(table)
    expect(result.notes.join('\n')).toContain('卫生服务｜中断且无替代安排时暂停接待。')
    expect(result.notes.join('\n')).toContain('卫生服务｜中断且无替代安排时暂停接待')
  })
  it('keeps whole sentences including conditions and does not append ellipses', () => {
    const sentence = '场所条件成立后再开放，未具备条件的路段不纳入首期。'
    const result = summarizeReportPage({ ...page, body: [sentence.repeat(20)] })
    expect(result.body).toEqual([sentence])
    expect(result.notes.join('\n')).toContain(sentence.repeat(20))
  })
  it('retains a distinct qualification beside a table in a different project theme', () => {
    const result = summarizeReportPage({ ...page, title: '海滨体验', claim: '以岸上慢行串联公共空间。',
      body: ['大风天气停止栈桥通行。'], table: { columns: ['产品', '体验'], rows: [['海岸步道', '观景与休憩']] } })
    expect(result.body).toEqual(['大风天气停止栈桥通行。'])
  })
  it('keeps different weather conditions and capacities even when almost all words repeat', () => {
    const result = summarizeReportPage({ ...page, claim: '正常天气每日接待上限为500人，采用线上预约并分时入园。',
      body: ['雨天每日接待上限为50人，采用线上预约并分时入园。'] })
    expect(result.body).toEqual(['雨天每日接待上限为50人，采用线上预约并分时入园。'])
  })
  it('preserves decimal punctuation that changes the magnitude of a number', () => {
    const result = summarizeReportPage({ ...page, claim: '先期设施总投入控制在200万元。', body: ['先期设施总投入控制在20.0万元。'] })
    expect(result.body).toEqual(['先期设施总投入控制在20.0万元。'])
  })
  it('does not treat an affirmative sentence inside a negative one as full coverage', () => {
    const result = summarizeReportPage({ ...page, claim: '不允许开展露营活动。', body: ['允许开展露营活动。'] })
    expect(result.body).toEqual(['允许开展露营活动。'])
  })
  it('does not remove a table qualification through fuzzy similarity or combine different rows into coverage', () => {
    const result = summarizeReportPage({ ...page, claim: '按天气调整接待强度。',
      body: ['雨天每日接待上限为50人，采用线上预约并分时入园。'],
      table: { columns: ['时段', '接待安排'], rows: [['正常天气', '每日接待上限为500人，采用线上预约并分时入园。'], ['雨天', '预约通知']] } })
    expect(result.body).toEqual(['雨天每日接待上限为50人，采用线上预约并分时入园。'])
  })
  it('does not broaden scoped table data into an unconditional sentence', () => {
    const result = summarizeReportPage({ ...page, claim: '按实际条件组织接待。', body: ['暂停接待。'],
      table: { columns: ['条件', '安排'], rows: [['暴雨期间', '暂停接待。']] } })
    expect(result.body).toEqual(['暂停接待。'])
  })
  it('retains every unique condition beyond earlier sentence and character budgets', () => {
    const body = [
      '配电系统未通过安全检测时不得开放室内活动。',
      '夜间开放应单独核实照明、工作人员配置与紧急疏散条件，未经核实的区域维持关闭。',
      '暴雨预警期间暂停临水活动，恢复开放之前完成对岸坡、护栏、铺装及排水设施的巡检。',
      '施工车辆进入时暂停相邻步行通道，并由现场人员组织临时绕行，保障游客与作业区域分离。',
      '预约人数超过核定容量时停止新增名额，已经到达的游客按时段分流，禁止以临时加位突破容量上限。',
      '疏散通道必须保持畅通。',
    ]
    expect(body.join('').length).toBeGreaterThan(190)
    expect(summarizeReportPage({ ...page, body }).body).toEqual(body)
    const table = { columns: ['产品', '体验'], rows: [['展览', '工业遗产展示']] }
    expect(summarizeReportPage({ ...page, body, table }).body).toEqual(body)
    expect(summarizeReportPage({ ...page, body, visual: { ...page.visual, kind: 'diagram', diagram: { nodes: [], edges: [] } } }).body).toEqual(body)
  })
  it('retains unique product capacity and operating conditions in the visible summary', () => {
    const product = { name: '工业展览', audience: '预约团队', experience: '沿原有设备参观', location: '一层厂房', scale: '每场最多20人', operations: '设备检修期间暂停开放' }
    const result = summarizeReportPage({ ...page, title: product.name, body: [], product })
    for (const value of [product.audience, product.experience, product.location, product.scale, product.operations]) expect(result.body.join('\n')).toContain(value)
    expect(result.notes.join('\n')).toContain(product.scale)
    expect(result.editorialSummary).toBe(true)
  })
})
