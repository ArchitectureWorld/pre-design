import { describe, expect, it } from 'vitest'
import { SCENE_SPEC_VERSION, needsSceneSpecification, resolveSceneSpecification, sceneSpecContext } from '../src/report/manuscript/scene-spec.ts'
import type { PlanningManuscriptPage } from '../src/report/manuscript/types.ts'
import type { ImageSlotBrief } from '../src/visual/image-policy.ts'

const phaseSubject = '首期、中期、远期三阶段的建设内容与成立条件对照'
const fundingSubject = '公共服务投入、经营主体投入与后续扩展资金的分工'
function brief(subject = phaseSubject): ImageSlotBrief {
  return { id: 'delivery:main', pageId: 'delivery', version: 'image-policy', conclusion: '保留正文的阶段判断',
    subjects: [subject], activities: [], environment: '原视觉说明', scale: 'scene',
    allowedKinds: ['photo', 'render'], allowedSources: ['project', 'web', 'generated'], locale: 'domestic', aspectRatio: 1.5 }
}
function page(subject = phaseSubject): PlanningManuscriptPage {
  return { id: 'delivery', kind: 'delivery', title: '公共空间建设安排', claim: '分阶段完善服务', sourceRefs: [], notes: [],
    body: ['首期建设连续无障碍步道、带靠背的树荫座椅和临水安全护栏。', '游客沿步道步行，在树荫座椅休息。', '场地位于滨水绿带。'],
    visual: { kind: 'concept', subject, purpose: '说明实施要求', caption: '公共空间使用场景' } }
}
const citation = (text: string, sourcePath: string) => ({ text, sourcePath })
function proposal() {
  return { usageId: 'delivery:main',
    subjects: [citation('连续无障碍步道、带靠背的树荫座椅和临水安全护栏', 'body[0]')],
    activities: [citation('游客沿步道步行', 'body[1]'), citation('在树荫座椅休息', 'body[1]')],
    environment: citation('滨水绿带', 'body[2]') }
}
function rejectionMessage(action: () => unknown): string {
  try { action() } catch (error) { return (error as Error).message }
  throw new Error('Expected scene specification rejection')
}

describe('scene specification source context', () => {
  it('provides full original source fields with stable paths and only the selected node label', () => {
    const input: PlanningManuscriptPage = { ...page(),
      product: { name: '旧厂房参观', audience: '家庭', experience: '沿生产线参观', location: '保留厂房内部', scale: '小组参观', operations: '预约开放' },
      table: { columns: ['阶段', '设施'], rows: [['首期', '入口接待台'], ['中期', '带护栏的参观走廊']] },
      visual: { ...page().visual, kind: 'diagram', diagram: {
        nodes: [{ id: 'a', label: '场所与管理条件', column: 0, row: 0 }, { id: 'b', label: '家庭林下休息', column: 1, row: 0 }],
        edges: [{ from: 'a', to: 'b' }] } } }
    const before = JSON.stringify(input)
    const context = sceneSpecContext(input, 'delivery:a', 'a')
    expect(context).toMatchObject({ usageId: 'delivery:a', pageTitle: '公共空间建设安排', intent: '分阶段完善服务', nodeLabel: '场所与管理条件' })
    expect(context.sources).toEqual(expect.arrayContaining([
      { path: 'title', text: '公共空间建设安排' }, { path: 'claim', text: '分阶段完善服务' },
      { path: 'body[0]', text: '首期建设连续无障碍步道、带靠背的树荫座椅和临水安全护栏。' },
      { path: 'product.location', text: '保留厂房内部' }, { path: 'product.operations', text: '预约开放' },
      { path: 'table.columns[1]', text: '设施' }, { path: 'table.rows[1][1]', text: '带护栏的参观走廊' },
      { path: 'visual.subject', text: phaseSubject }, { path: 'visual.purpose', text: '说明实施要求' },
      { path: 'visual.caption', text: '公共空间使用场景' }, { path: 'visual.diagram.nodes[0].label', text: '场所与管理条件' },
    ]))
    expect(context.sources.some(source => source.path === 'visual.diagram.nodes[1].label')).toBe(false)
    expect(new Set(context.sources.map(source => source.path)).size).toBe(context.sources.length)
    expect(JSON.stringify(input)).toBe(before)
  })
  it('rejects an unknown node instead of replacing it with an adjacent scene', () => {
    expect(() => sceneSpecContext(page(), 'delivery:missing', 'missing')).toThrow(/SCENE_SPEC_/)
  })
})

describe('abstract scene demand detection', () => {
  it.each([phaseSubject, fundingSubject, '以收入构成表和计算关系说明茶叶销售、茶事体验及配套服务的经营方式',
    '场所与管理条件', '首期游程衔接', '运营职责与管理制度', '项目收益指标和投资测算', '公共服务',
    '第一阶段实施计划', '建设时序安排', '基本公共服务、配套服务与零售经营的价格和费用关系',
    '服务价格安排与费用承担', '公共服务收费边界', '经营收益分配', '成本与收支核算', '产品定价规则'])('detects an unobservable demand: %s', subject => {
    expect(needsSceneSpecification(brief(subject))).toBe(true)
  })
  it.each(['白茶梯田中的轻量步道、观景停留点与品茶廊亭', '茶园漫行', '家庭林下休息',
    '新建垃圾分类收集设施与污水处理设施', '旧厂房内的无障碍参观步道和安全护栏', '游客在入口服务台办理预约登记',
    '入口收费岗亭与候车区', '产品价格牌与展示货架', '收费岗亭与入口之间的空间关系'])('keeps concrete scene requirements: %s', subject => {
    expect(needsSceneSpecification(brief(subject))).toBe(false)
  })
  it('detects abstract node activities even when its subject is physical', () => {
    expect(needsSceneSpecification({ ...brief('入口接待台'), activities: ['经营主体投入与分工'] })).toBe(true)
  })
  it.each(['定位关系示意；说明各片区关系', '概念剖面', '功能对比图'])('detects an abstract environment with a concrete subject: %s', environment => {
    expect(needsSceneSpecification({ ...brief('入口接待台'), environment })).toBe(true)
  })
  it('keeps a concrete environment that normally mentions construction and operation', () => {
    expect(needsSceneSpecification({ ...brief('入口接待台'), environment: '新建游客中心周边的日常运营场景' })).toBe(false)
  })
  it.each(['接到天气或防汛预警', '检查场所与服务条件', '茶园漫行'])('requires source-based translation for every scene diagram node: %s', subject => {
    expect(needsSceneSpecification({ ...brief(subject), id: 'delivery:check', nodeId: 'check', environment: '公园入口' })).toBe(true)
  })
  it.each([{ activities: [] }, { activities: ['国家法律法规优先于地方指引，未经主管部门许可不得启动'] }])('requires source-based translation for the main cover regardless of its activity wording', ({ activities }) => {
    expect(needsSceneSpecification({ ...brief('树荫下的连续步道'), id: 'cover:main', pageId: 'cover',
      activities, environment: '公园绿地', scale: 'area' })).toBe(true)
  })
  it.each([
    { id: 'delivery:survey', pageId: 'delivery', nodeId: 'survey' },
    { id: 'cover:main', pageId: 'cover' },
  ])('does not force a source-required analysis image into a scene because of its position: $id', position => {
    expect(needsSceneSpecification({ ...brief('真实测绘总平图'), ...position,
      allowedKinds: ['photo', 'plan', 'map', 'section', 'diagram', 'composite'], allowedSources: ['project', 'web'] })).toBe(false)
  })
  it('leaves explicit analysis-image slots outside scene translation', () => {
    expect(needsSceneSpecification({ ...brief('收入构成表'), allowedKinds: ['diagram', 'composite'] })).toBe(false)
  })
  it('uses original visual captions to detect relation diagrams without nodes', () => {
    const original = { ...brief('首期完整游线所需的到达、体验、卫生与安全条件'), environment: '公园绿地' }
    const input = { ...page(), visual: { kind: 'diagram' as const, subject: original.subjects[0]!, purpose: '说明游线与服务同步就绪',
      caption: '实施关系示意：游线与服务同步就绪，未使用建筑另行管理' } }
    expect(needsSceneSpecification(original, sceneSpecContext(input, original.id))).toBe(true)
  })
  it('does not turn a concrete ordinary scene into a diagram because other context contains financial text', () => {
    const original = { ...brief('树荫下的连续步道'), environment: '公园绿地' }
    const input = { ...page(), title: '预算指标', claim: '明确资金分工', body: ['建设资金分期落实。'],
      visual: { kind: 'concept' as const, subject: '树荫下的连续步道', purpose: '日间休息空间', caption: '树荫下的散步活动' } }
    expect(needsSceneSpecification(original, sceneSpecContext(input, original.id))).toBe(false)
  })
})

describe('grounded observable scene resolution', () => {
  it('resolves pricing intent to an evidenced service scene and rejects financial relations as depicted subjects', () => {
    const subject = '公共服务价格安排与费用承担', input = page(subject), context = sceneSpecContext(input, 'delivery:main')
    expect(needsSceneSpecification(brief(subject), context)).toBe(true)
    expect(resolveSceneSpecification(proposal(), brief(subject), context).subjects).toEqual(proposal().subjects.map(item => item.text))
    expect(() => resolveSceneSpecification({ ...proposal(), subjects: [citation(subject, 'visual.subject')] }, brief(subject), context))
      .toThrow('SCENE_SPEC_UNOBSERVABLE: subjects[0].text')
  })
  it.each([
    { label: '茶园步行', subject: '茶园', activity: '步行' },
    { label: '厂房参观', subject: '厂房', activity: '参观' },
  ])('uses the selected node label as original evidence for $label', ({ label, subject, activity }) => {
    const input: PlanningManuscriptPage = { ...page(), visual: { ...page().visual, kind: 'diagram', diagram: {
      nodes: [{ id: 'other', label: '其他节点', column: 0, row: 0 }, { id: 'walk', label, column: 1, row: 0 }], edges: [] } } }
    const original = { ...brief(), id: 'delivery:walk', nodeId: 'walk' }, sourcePath = 'visual.diagram.nodes[1].label'
    const resolved = resolveSceneSpecification({ usageId: original.id, subjects: [citation(subject, sourcePath)],
      activities: [citation(activity, sourcePath)], environment: citation(subject, sourcePath) }, original, sceneSpecContext(input, original.id, 'walk'))
    expect(resolved).toMatchObject({ subjects: [subject], activities: [activity], environment: subject,
      sceneGrounding: { nodeLabel: label, sources: [{ path: sourcePath, text: label }] } })
  })
  it.each([phaseSubject, fundingSubject])('resolves %s from concrete body evidence without modifying the manuscript', subject => {
    const original = brief(subject), input = page(subject), context = sceneSpecContext(input, original.id)
    const before = JSON.stringify({ input, original, context })
    const resolved = resolveSceneSpecification(proposal(), original, context)
    expect(resolved).toEqual({ ...original, version: `image-policy+${SCENE_SPEC_VERSION}`,
      subjects: ['连续无障碍步道、带靠背的树荫座椅和临水安全护栏'],
      activities: ['游客沿步道步行', '在树荫座椅休息'], environment: '滨水绿带',
      sceneGrounding: { sources: [
        { path: 'body[0]', text: '首期建设连续无障碍步道、带靠背的树荫座椅和临水安全护栏。' },
        { path: 'body[1]', text: '游客沿步道步行，在树荫座椅休息。' },
        { path: 'body[2]', text: '场地位于滨水绿带。' },
      ] } })
    expect(JSON.stringify({ input, original, context })).toBe(before)
    expect(needsSceneSpecification(resolved)).toBe(false)
  })
  it('preserves multiple entities with their qualifiers when cited separately from the same list', () => {
    const original = { ...brief(), nodeId: 'phase-one' }, context = sceneSpecContext(page(), original.id)
    const value = { ...proposal(), subjects: [citation('连续无障碍步道', 'body[0]'), citation('带靠背的树荫座椅', 'body[0]'), citation('临水安全护栏', 'body[0]')] }
    expect(resolveSceneSpecification(value, original, context)).toMatchObject({ nodeId: 'phase-one',
      subjects: ['连续无障碍步道', '带靠背的树荫座椅', '临水安全护栏'] })
  })
  it('uses the same contract for an industrial project and product or table sources', () => {
    const input: PlanningManuscriptPage = { ...page(fundingSubject), title: '工业遗产开放安排',
      body: ['公众沿生产线参观。'], product: { name: '工业遗产参观', audience: '公众', experience: '沿生产线参观',
        location: '保留厂房内部', scale: '小组参观', operations: '预约开放' },
      table: { columns: ['建设内容'], rows: [['带独立护栏的参观走廊与透明观察窗']] } }
    const result = resolveSceneSpecification({ usageId: 'delivery:main', subjects: [citation('带独立护栏的参观走廊与透明观察窗', 'table.rows[0][0]')],
      activities: [citation('公众沿生产线参观', 'body[0]')], environment: citation('保留厂房内部', 'product.location') }, brief(fundingSubject), sceneSpecContext(input, 'delivery:main'))
    expect(result.subjects).toEqual(['带独立护栏的参观走廊与透明观察窗'])
    expect(result.environment).toBe('保留厂房内部')
  })
  it.each([
    { source: '游客卫生设施和处置服务可结合适用的人居环境与公共服务政策研究资金安排', subjects: ['游客卫生设施和处置服务'] },
    { source: '公共服务投入用于建设停车区和游客中心', subjects: ['停车区和游客中心'] },
    { source: '财政预算主要用于设置无障碍坡道和带扶手的台阶', subjects: ['无障碍坡道', '带扶手的台阶'] },
    { source: '首期建设带护栏的参观走廊与透明观察窗可申请专项建设资金', subjects: ['带护栏的参观走廊与透明观察窗'] },
    { source: '社会资本投入用于改造保留厂房内的展厅和带安全护栏的观察廊并纳入年度财政预算', subjects: ['保留厂房内的展厅和带安全护栏的观察廊'] },
    { source: '拟以周末自驾家庭及自然研学团队为主要服务对象', subjects: ['周末自驾家庭及自然研学团队'] },
    { source: '接驳至茶山入口后步行游览', subjects: ['茶山入口'] },
  ])('retains the complete visible entity phrase without administrative predicates: $source', ({ source, subjects }) => {
    const input = { ...page(fundingSubject), body: [source, ...page().body] }, before = JSON.stringify(input)
    const resolved = resolveSceneSpecification({ ...proposal(), subjects: subjects.map(text => citation(text, 'body[0]')),
      activities: [], environment: citation('滨水绿带', 'body[3]') }, brief(fundingSubject), sceneSpecContext(input, 'delivery:main'))
    expect(resolved.subjects).toEqual(subjects)
    expect(needsSceneSpecification(resolved)).toBe(false)
    expect(JSON.stringify(input)).toBe(before)
  })
  it('preserves complete cited context for semantic review instead of asserting a free-prose sentence was fully selected', () => {
    const input: PlanningManuscriptPage = { ...page(),
      visual: { ...page().visual, kind: 'diagram', purpose: '通过接驳至工业遗产入口后步行参观体现到访过程',
        diagram: { nodes: [{ id: 'arrival', label: '首期游程衔接', column: 0, row: 0 }], edges: [] } },
      table: { columns: ['到访过程'], rows: [['到达保留厂房后沿生产线参观']] } }
    const original = { ...brief(), nodeId: 'arrival' }
    const resolved = resolveSceneSpecification({ ...proposal(), subjects: [citation('工业遗产入口', 'visual.purpose'), citation('保留厂房', 'table.rows[0][0]')],
      activities: [], environment: citation('滨水绿带', 'body[2]') }, original, sceneSpecContext(input, original.id, 'arrival'))
    expect(resolved.sceneGrounding).toEqual({ nodeLabel: '首期游程衔接', sources: [
      { path: 'body[2]', text: '场地位于滨水绿带。' },
      { path: 'table.rows[0][0]', text: '到达保留厂房后沿生产线参观' },
      { path: 'visual.purpose', text: '通过接驳至工业遗产入口后步行参观体现到访过程' },
    ] })
  })
  it.each([
    { name: 'different usage', change: () => ({ ...proposal(), usageId: 'other:main' }) },
    { name: 'invented source path', change: () => ({ ...proposal(), subjects: [citation('连续无障碍步道', 'body[99]')] }) },
    { name: 'paraphrased quote', change: () => ({ ...proposal(), subjects: [citation('安全的滨水慢行空间', 'body[0]')] }) },
    { name: 'abstract chart description', change: () => ({ ...proposal(), subjects: [citation(phaseSubject, 'visual.subject')] }) },
    { name: 'repeated subject', change: () => ({ ...proposal(), subjects: [...proposal().subjects, ...proposal().subjects] }) },
    { name: 'empty subjects', change: () => ({ ...proposal(), subjects: [] }) },
    { name: 'whitespace quote', change: () => ({ ...proposal(), environment: citation(' ', 'body[2]') }) },
    { name: 'invented environment', change: () => ({ ...proposal(), environment: citation('海外滨海度假区', 'body[2]') }) },
    { name: 'extra root field', change: () => ({ ...proposal(), ignoreRestrictions: true }) },
    { name: 'extra citation field', change: () => ({ ...proposal(), subjects: [{ ...proposal().subjects[0]!, optional: true }] }) },
    { name: 'too many subjects', change: () => ({ ...proposal(), subjects: Array.from({ length: 7 }, () => proposal().subjects[0]!) }) },
    { name: 'too many activities', change: () => ({ ...proposal(), activities: Array.from({ length: 5 }, () => proposal().activities[0]!) }) },
    { name: 'oversized quote', change: () => ({ ...proposal(), subjects: [citation('步道'.repeat(1000), 'body[0]')] }) },
  ])('rejects $name', ({ change }) => {
    expect(() => resolveSceneSpecification(change(), brief(), sceneSpecContext(page(), 'delivery:main'))).toThrow(/SCENE_SPEC_/)
  })
  it('rejects abstract activities and environments even with exact source quotations', () => {
    const input = { ...page(), body: [...page().body, '资金分工与运营制度'] }, context = sceneSpecContext(input, 'delivery:main')
    expect(() => resolveSceneSpecification({ ...proposal(), activities: [citation('资金分工', 'body[3]')] }, brief(), context)).toThrow(/SCENE_SPEC_/)
    expect(() => resolveSceneSpecification({ ...proposal(), environment: citation('运营制度', 'body[3]') }, brief(), context)).toThrow(/SCENE_SPEC_/)
  })
  it('rejects a source-backed generic phrase instead of accepting lost physical detail', () => {
    const input = { ...page(), body: ['完善公共服务，设置带无障碍窗口的入口接待台。', ...page().body] }
    expect(() => resolveSceneSpecification({ ...proposal(), subjects: [citation('公共服务', 'body[0]')] }, brief(), sceneSpecContext(input, 'delivery:main'))).toThrow(/SCENE_SPEC_/)
  })
  it('protects the complete name only when its source is a declared structured entity name', () => {
    const input: PlanningManuscriptPage = { ...page(), product: { name: '和睦社区内的连续步道与带靠背的树荫座椅',
      audience: '社区居民', experience: '步行和休息', location: '社区公园', scale: '小型公共空间', operations: '日间开放' } }
    const context = sceneSpecContext(input, 'delivery:main')
    expect(resolveSceneSpecification({ ...proposal(), subjects: [citation('和睦社区内的连续步道与带靠背的树荫座椅', 'product.name')] }, brief(), context).subjects)
      .toEqual(['和睦社区内的连续步道与带靠背的树荫座椅'])
    for (const text of ['睦社区内的连续步道与带靠背的树荫座椅', '连续步道', '带靠背的树荫座椅']) {
      expect(() => resolveSceneSpecification({ ...proposal(), subjects: [citation(text, 'product.name')] }, brief(), context)).toThrow(/SCENE_SPEC_/)
    }
  })
  it('rejects a context for another usage', () => {
    expect(() => resolveSceneSpecification(proposal(), brief(), sceneSpecContext(page(), 'other:main'))).toThrow(/SCENE_SPEC_/)
  })
})

describe('safe scene specification diagnostics', () => {
  it('identifies every empty required field with its constraint while retaining the error code', () => {
    const value = { ...proposal(), subjects: [], environment: { text: '', sourcePath: '' } }
    const message = rejectionMessage(() => resolveSceneSpecification(value, brief(), sceneSpecContext(page(), 'delivery:main')))
    expect(message).toMatch(/^SCENE_SPEC_INVALID:/u)
    expect(message).toMatch(/subjects:.*至少\s*1/u)
    expect(message).toMatch(/environment\.text:.*非空/u)
    expect(message).toMatch(/environment\.sourcePath:.*非空/u)
  })
  it('points to the exact generic subject without echoing its text or the source paragraph', () => {
    const paragraph = 'PRIVATE_SOURCE_SENTINEL：服务设施待进一步明确。'
    const input = { ...page(), body: [...page().body, paragraph] }
    const value = { ...proposal(), subjects: [...proposal().subjects, citation('服务设施', 'body[3]')] }
    const message = rejectionMessage(() => resolveSceneSpecification(value, brief(), sceneSpecContext(input, 'delivery:main')))
    expect(message).toMatch(/^SCENE_SPEC_UNOBSERVABLE: subjects\[1\]\.text:/u)
    expect(message).not.toContain('服务设施')
    expect(message).not.toContain('PRIVATE_SOURCE_SENTINEL')
    expect(message).not.toContain(paragraph)
  })
  it.each([
    { field: 'activities[0].text', value: { ...proposal(), activities: [citation('资金分工', 'body[3]')] } },
    { field: 'environment.text', value: { ...proposal(), environment: citation('资金分工', 'body[3]') } },
  ])('identifies the abstract $field without echoing the quote', ({ field, value }) => {
    const input = { ...page(), body: [...page().body, '资金分工'] }
    const message = rejectionMessage(() => resolveSceneSpecification(value, brief(), sceneSpecContext(input, 'delivery:main')))
    expect(message).toContain(`SCENE_SPEC_UNOBSERVABLE: ${field}:`)
    expect(message).not.toContain('资金分工')
  })
  it.each([
    { field: 'subjects[0].sourcePath', item: citation('连续无障碍步道', 'MODEL_SECRET_PATH') },
    { field: 'subjects[0].text', item: citation('MODEL_SECRET_QUOTE', 'body[0]') },
  ])('identifies a bad reference at $field without echoing model-supplied values', ({ field, item }) => {
    const message = rejectionMessage(() => resolveSceneSpecification({ ...proposal(), subjects: [item] }, brief(), sceneSpecContext(page(), 'delivery:main')))
    expect(message).toContain(`SCENE_SPEC_CITATION_INVALID: ${field}:`)
    expect(message).not.toContain('MODEL_SECRET')
  })
  it('reports schema constraints without exposing unknown keys or raw model output', () => {
    const value = { ...proposal(), subjects: [{ text: 123, sourcePath: 'body[0]', PRIVATE_UNKNOWN_KEY: 'PRIVATE_VALUE' }], PRIVATE_ROOT_KEY: 'PRIVATE_ROOT_VALUE' }
    const message = rejectionMessage(() => resolveSceneSpecification(value, brief(), sceneSpecContext(page(), 'delivery:main')))
    expect(message).toMatch(/^SCENE_SPEC_INVALID:/u)
    expect(message).toContain('subjects[0].text:')
    expect(message).toContain('subjects[0]:')
    expect(message).toContain('$:')
    expect(message).not.toContain('PRIVATE_')
    expect(message).not.toContain('123')
    expect(message).not.toContain(JSON.stringify(value))
  })
})
