import { describe, expect, it } from 'vitest'
import { compileReportOutline } from '../src/presentation/projector/report-outline.ts'
import { createStandardFrozenProject } from './presentation-standard-fixture.ts'
import type { FrozenStateObject } from '../src/report/types.ts'

function object(id: string, chapterId: string, field = 'needs', count = 2): FrozenStateObject {
  return {
    objectId: id, chapterId, title: `${id}专题成果`, summary: `${id}提出的项目判断`,
    facts: [{ label: '依据', value: `${id}原始依据`, basis: '项目调查' }],
    reportSections: [{ key: field, title: field === 'capex' ? '建设投资' : '需求与条件', entries: Array.from({ length: count }, (_, n) => ({
      key: `item-${n}`, text: `${id}第${n + 1}项具体内容：${'需要保留的论证和实施条件。'.repeat(12)}`,
      basis: '项目调查', fieldPath: `data.${field}[${n}]`,
    })) }],
  }
}

const families = [['PS', '01', 7], ['BL', '02', 8], ['DG', '03', 6], ['OB', '04', 6], ['OP', '05', 7], ['PG', '06', 7], ['SP', '07', 8], ['IM', '08', 8]] as const
const allObjects = () => families.flatMap(([prefix, chapter, count]) => Array.from({ length: count }, (_, n) => object(`${prefix}${String(n + 1).padStart(2, '0')}`, chapter)))
const plan = (stateObjects: readonly FrozenStateObject[]) => compileReportOutline(createStandardFrozenProject({ stateObjects }))

describe('formal report outline compilation', () => {
  it('organizes all 57成果 into editorial topics and detailed pages with real content, not a ten-page digest', () => {
    const objects = allObjects()
    const findings = plan(objects)
    expect(findings.length).toBeGreaterThan(10)
    expect(new Set(findings.flatMap(finding => finding.objectIds))).toEqual(new Set(objects.map(item => item.objectId)))
    for (const finding of findings) {
      expect(finding.sectionKey).toBeTruthy()
      expect(finding.sectionTitle).toBeTruthy()
      expect(JSON.stringify(finding.supportingBlocks)).not.toMatch(/本页回答|编写主线|编写建议/u)
    }
    const visible = JSON.stringify(findings.map(finding => finding.supportingBlocks))
    for (const item of objects) for (const section of item.reportSections ?? []) for (const entry of section.entries) expect(visible).toContain(entry.text)
    // 成本在投资专题中，而非把 IM02 错当作待决事项的唯一依据。
    expect(findings.some(f => f.topicKey === 'delivery_model' && f.objectIds.includes('IM02'))).toBe(true)
    expect(findings.find(f => f.findingId === 'pre-design:decision')?.objectIds).toContain('OP07')
  })

  it('grows with content volume, never drops the ninth or later item, and uses meaningful titles', () => {
    const small = plan([object('PG01', '06', 'needs', 2)])
    const large = plan([object('PG01', '06', 'needs', 40)])
    expect(large.length).toBeGreaterThan(small.length)
    const visible = JSON.stringify(large.map(f => f.supportingBlocks))
    expect(visible).toContain('PG01第40项具体内容')
    expect(large.every(f => !/续\d|第\d+页/u.test(f.title))).toBe(true)
  })

  it('has cross-result argument pages and stable identity when input order or wording changes', () => {
    const objects = allObjects()
    const normal = plan(objects)
    expect(plan([...objects].reverse())).toEqual(normal)
    const need = normal.find(f => f.findingId === 'pre-design:analysis:need-response')
    expect(need?.objectIds).toEqual(expect.arrayContaining(['BL05', 'BL06', 'DG01', 'DG03', 'OB01', 'PG03']))
    expect(JSON.stringify(need?.supportingBlocks)).toContain('建设必要性')
    const renamed = objects.map(item => ({ ...item, title: `${item.title}修订`, summary: `${item.summary}修订` }))
    expect(plan(renamed).map(f => f.findingId)).toEqual(normal.map(f => f.findingId))
  })

  it('preserves ten legacy page identities, but does not create empty chapters for partial projects', () => {
    const full = plan(allObjects()).map(f => f.findingId)
    for (const key of ['project-brief', 'baseline', 'diagnosis', 'opportunity', 'positioning', 'strategy', 'product', 'spatial', 'delivery', 'decision']) expect(full).toContain(`pre-design:${key}`)
    expect(plan([])).toEqual([])
    expect(new Set(plan([object('PS01', '01')]).map(f => f.topicKey))).toEqual(new Set(['project_brief']))
  })

  it('flags conflicting investment bases instead of claiming finance is settled, without changing source values', () => {
    const cost = (id: string, value: number): FrozenStateObject => ({ ...object(id, '08', 'capex'), reportSections: [{ key: 'capex', title: '建设投资', entries: [{ key: 'total', text: `总投资为${value}万元`, basis: '同一建设投资估算表', fieldPath: 'data.capex', metric: { label: '建设总投资', value, unit: '万元' } }] }] })
    const findings = plan([cost('IM02', 44200), cost('IM06', 28500), object('IM03', '08', 'funding_gap')])
    const check = findings.find(f => f.findingId === 'pre-design:analysis:investment-basis')
    expect(check?.contentNature).toBe('missing')
    expect(check?.keyMessage).toContain('待核对')
    expect(JSON.stringify(check?.supportingBlocks)).toContain('44200')
    expect(JSON.stringify(check?.supportingBlocks)).toContain('28500')
    expect(JSON.stringify(check?.supportingBlocks)).toContain('不等于资金已落实')
    // Studio edits the first body and list: critical conclusions must not live only in later text/table blocks.
    const body = check?.supportingBlocks.find(block => block.type === 'text' && block.role === 'body')
    expect(body?.type === 'text' ? body.content : '').toContain('投资口径待核对')
    const points = check?.supportingBlocks.find(block => block.type === 'list')
    expect(points?.type === 'list' ? points.items.length : 0).toBeGreaterThan(1)
  })

  it('turns the project own priority agenda into named cross-result report pages', () => {
    const agenda = { ...object('DG06', '03'), reportSections: [{ key: 'topics', title: '关键策划议题', entries: [
      { key: 'site-choice', text: '坝址比选与工程规模论证；比较回水影响和服务能力', basis: '策划议题', fieldPath: 'data.topics[0]' },
      { key: 'funding', text: '投融资与资金平衡筹措；区分资金落实与筹资假设', basis: '策划议题', fieldPath: 'data.topics[1]' },
    ] }] }
    const result = plan([...allObjects().filter(o => o.objectId !== 'DG06'), agenda])
    const choice = result.find(f => f.findingId === 'pre-design:agenda:site-choice')
    expect(choice?.title).toBe('坝址比选与工程规模论证')
    expect(choice?.objectIds).toEqual(expect.arrayContaining(['DG06', 'OP02', 'OP07']))
    expect(result.find(f => f.findingId === 'pre-design:agenda:funding')?.objectIds).toContain('IM03')
  })
})
