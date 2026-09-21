import { describe, expect, it } from 'vitest'
import { compileContentPlan, contentUnits, defaultContentPlan } from '../src/report/manuscript/content-plan.ts'
import type { PlanningManuscript, PlanningManuscriptPage } from '../src/report/manuscript/types.ts'

const page = (id: string, body: string[], extra: Partial<PlanningManuscriptPage> = {}): PlanningManuscriptPage => ({
  id, kind: 'argument', title: id, claim: '串联场所形成完整游览体验。', body, sourceRefs: ['s'], notes: [],
  visual: { kind: 'concept', subject: '公园游览', purpose: '空间与活动', caption: '公园游览' }, ...extra,
})
const manuscript = (pages: PlanningManuscriptPage[]): PlanningManuscript => ({ schemaVersion: 'pre-design.planning-manuscript.v1', policyVersion: 'fixture',
  projectId: 'p', sourceRevision: 1, sourceFingerprint: 'source', generatedAt: '2026-09-21', title: '公园策划',
  chapters: [{ id: 'products', title: '体验产品', thesis: '完整体验', pages }],
})
describe('whole report argument and source planning', () => {
  it('keeps facts stated only in the title of a merged page in visible copy', () => {
    const source = manuscript([page('a', ['利用现有场地。'], { title: '空间安排' }), page('b', ['分期实施。'], { title: '首期投资上限200万元' })])
    const plan = defaultContentPlan(source)
    const result = compileContentPlan(source, { ...plan, groups: [{ ...plan.groups[0]!, pageIds: ['a', 'b'] }] })
    expect(result.manuscript.chapters[0]!.pages[0]!.body).toContain('首期投资上限200万元')
    expect(result.coverage.find(unit => unit.unitId === 'b/title')?.presentedOn).toEqual(['a'])
  })
  it('preserves directed relationships when a geographic diagram becomes map copy', () => {
    const source = manuscript([page('a', [], { title: '区域联系', visual: { kind: 'diagram', subject: '区域', purpose: '关系', caption: '区域',
      diagram: { nodes: [{ id: 'from', label: '甲城', column: 0, row: 0 }, { id: 'to', label: '乙城', column: 1, row: 0 }], edges: [{ from: 'from', to: 'to', label: '客流' }] } } })])
    const result = compileContentPlan(source, defaultContentPlan(source))
    expect(result.manuscript.chapters[0]!.pages[0]!.body).toContain('甲城 → 乙城（客流）')
    expect(result.manuscript.chapters[0]!.pages[0]!.visual.diagram).toBeUndefined()
  })
  it('merges/reorders display pages, conserves every fact, and leaves authored source untouched', () => {
    const source = manuscript([page('p1', ['连接入口与展厅。']), page('p2', ['沿原有设备组织参观。']), page('p3', ['保留工人生活的展示内容。'])])
    const before = JSON.stringify(source), plan = defaultContentPlan(source)
    const result = compileContentPlan(source, { ...plan, groups: [{ ...plan.groups[2]!, pageIds: ['p3', 'p2'] }, plan.groups[0]!] })
    expect(result.manuscript.chapters[0]!.pages.map(p => p.id)).toEqual(['p3', 'p1'])
    expect(result.manuscript.chapters[0]!.pages[0]!.body.join('')).toContain('沿原有设备组织参观。')
    expect(result.coverage).toHaveLength(contentUnits(source).length)
    expect(result.coverage.every(c => c.presentedOn.length > 0)).toBe(true)
    expect(JSON.stringify(source)).toBe(before)
  })
  it('removes an explicit semantic duplicate across prose and a product field, with a retained unit mapping', () => {
    const source = manuscript([page('p', ['在老厂房内参观保留的生产设备。'], { kind: 'product', product: {
      name: '工业展览', audience: '预约团队', experience: '沿老厂房保留的生产设备参观。', location: '老厂房', scale: '每场20人', operations: '设备检修期间暂停开放。',
    } })])
    const units = contentUnits(source), body = units.find(u => u.path === 'body[0]')!, experience = units.find(u => u.path === 'product.experience')!
    const result = compileContentPlan(source, { ...defaultContentPlan(source), equivalents: [{ duplicateId: body.id, keepId: experience.id, reason: '同一场所同一参观体验' }] }, [body.id])
    const output = result.manuscript.chapters[0]!.pages[0]!
    expect(output.body.join('')).not.toContain(body.text)
    expect(output.body.join('')).toContain(experience.text)
    expect(output.body.join('')).toContain('每场20人')
    expect(output.body.join('')).toContain('设备检修期间暂停开放')
    expect(result.coverage.find(c => c.unitId === body.id)?.equivalentTo).toBe(experience.id)
  })
  it.each([
    ['正常天气每场500人。', '雨天每场50人。'],
    ['允许开展露营活动。', '不允许开展露营活动。'],
    ['投资20.0万元。', '投资200万元。'],
    ['未经检测的建筑不开放。', '检测通过后开放。'],
  ])('retains different conditions, negations or quantities despite a model equivalence suggestion: %s', (a, b) => {
    const source = manuscript([page('p', [a, b])]), units = contentUnits(source).filter(u => u.path.startsWith('body'))
    const result = compileContentPlan(source, { ...defaultContentPlan(source), equivalents: [{ duplicateId: units[0]!.id, keepId: units[1]!.id, reason: '相似' }] })
    expect(result.manuscript.chapters[0]!.pages[0]!.body).toEqual(expect.arrayContaining([a, b]))
    expect(result.rejectedEquivalences).toHaveLength(1)
  })
  it('rejects omitted pages, duplicate page membership, and merging distinct core products', () => {
    const p = { name: '展览', audience: '市民', experience: '观看生产线', location: '厂房', scale: '每场20人', operations: '预约参观' }
    const source = manuscript([page('a', [], { kind: 'product', product: p }), page('b', [], { kind: 'product', product: { ...p, name: '社区书房' } })])
    const plan = defaultContentPlan(source)
    expect(() => compileContentPlan(source, { ...plan, groups: [plan.groups[0]!] })).toThrow('COVERAGE')
    expect(() => compileContentPlan(source, { ...plan, groups: [plan.groups[0]!, plan.groups[0]!] })).toThrow('COVERAGE')
    expect(() => compileContentPlan(source, { ...plan, groups: [{ ...plan.groups[0]!, pageIds: ['a', 'b'] }] })).toThrow('PRODUCT')
  })
  it('retains complete comparative rows and never borrows one cell as unconditional prose coverage', () => {
    const source = manuscript([page('a', ['暂停接待。'], { table: { columns: ['条件', '安排'], rows: [['暴雨期间', '暂停接待。']] } })])
    const units = contentUnits(source), body = units.find(u => u.path === 'body[0]')!, row = units.find(u => u.path === 'table.rows[0]')!
    const result = compileContentPlan(source, { ...defaultContentPlan(source), equivalents: [{ duplicateId: body.id, keepId: row.id, reason: '同样暂停' }] })
    expect(result.manuscript.chapters[0]!.pages[0]!.table?.rows).toEqual([['暴雨期间', '暂停接待。']])
    expect(result.manuscript.chapters[0]!.pages[0]!.body).toContain('暂停接待。')
  })
  it('geographic tasks cannot request generated scene evidence', () => {
    const source = manuscript([page('a', ['武汉主城区是客源方向。'], { title: '区域区位与城市联系' })])
    const result = compileContentPlan(source, defaultContentPlan(source))
    expect(result.manuscript.chapters[0]!.pages[0]!.task?.kind).toBe('regional-context')
    expect(result.manuscript.chapters[0]!.pages[0]!.task?.preferredTemplate).toBe('map-analysis')
  })
  it('keeps same-source, differently worded claims without an independent semantic review', () => {
    const source = manuscript([page('p', ['展厅面向儿童。', '展厅位于老厂房。'])]), units = contentUnits(source).filter(u => u.path.startsWith('body'))
    const result = compileContentPlan(source, { ...defaultContentPlan(source), equivalents: [{ duplicateId: units[0]!.id, keepId: units[1]!.id, reason: '同主题' }] })
    expect(result.manuscript.chapters[0]!.pages[0]!.body).toEqual(expect.arrayContaining(['展厅面向儿童。', '展厅位于老厂房。']))
  })
  it('cannot hide a relationship diagram by merging it with an independent source map', () => {
    const source = manuscript([page('map', [], { visual: { kind: 'source', subject: '场地', purpose: '条件', caption: '场地', sourceMaterialKey: 'map-original' } }),
      page('flow', [], { visual: { kind: 'diagram', subject: '游程', purpose: '顺序', caption: '游程', diagram: { nodes: [{ id: 'n', label: '入口接待', column: 0, row: 0 }], edges: [] } } })])
    const plan = defaultContentPlan(source)
    expect(() => compileContentPlan(source, { ...plan, groups: [{ ...plan.groups[0]!, pageIds: ['map', 'flow'] }] })).toThrow('DIAGRAM')
  })
})
