import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ClientVisualAsset } from '../src/report/client-types.ts'
import type { PlanningManuscriptPage, PlanningPageTask } from '../src/report/manuscript/types.ts'
import { planRegularManuscriptPage, regularImageGeometry, REGULAR_CANVAS } from '../src/report/regular/layout.ts'
import { planRegularPages } from '../src/report/regular/plan.ts'
import { auditRegularVisuals } from '../src/report/regular/visual-audit.ts'

const page = (body: readonly string[], task: PlanningPageTask): PlanningManuscriptPage => ({
  id: 'public-space', kind: 'argument', title: '连续的公共空间', claim: '入口与沿线活动应构成可达的完整游程。', body,
  sourceRefs: ['source-1'], notes: ['原始依据保持可追溯。'], task,
  visual: { kind: 'concept', subject: '公共空间', purpose: '日常步行与停留', caption: '公共空间组织' },
})
const task = (preferredTemplate: PlanningPageTask['preferredTemplate'] = 'split-right'): PlanningPageTask => ({
  kind: 'scene', question: '怎样组织游程？', scale: 'scene', requiredEvidence: ['活动场景'], preferredTemplate,
})
const photo = (id: string, ratio: number, usageId?: string, nodeId?: string): ClientVisualAsset => ({
  assetId: id, chapterId: 'chapter', role: 'product-scene', sourceKind: 'ai-concept', sourcePath: `${id}.png`,
  sha256: createHash('sha256').update(id).digest('hex'), width: ratio * 1200, height: 1200, caption: '公共空间',
  ...(nodeId ? { stageNodeIds: [nodeId] } : {}),
  ...(usageId ? { imageQuality: { requirement: { id: usageId, pageId: 'public-space', version: '1', conclusion: '公共空间',
    subjects: ['公众'], activities: ['步行'], environment: '中国公园', scale: 'scene', allowedKinds: ['photo', 'render'],
    allowedSources: ['generated'], locale: 'domestic', ...(nodeId ? { nodeId } : {}) } } } : {}),
})

describe('stable regular physical pages', () => {
  it('lists only a successfully bound cover image in the physical page asset IDs', () => {
    const report = { identity: { reportTitle: '公共空间方案' }, proposition: { coreValue: '公众可达' }, chapters: [], assets: [photo('square-cover', 1)] } as unknown as Parameters<typeof planRegularPages>[0]
    const plan = planRegularPages(report, 'html')
    expect(plan.pages[0]!.assetIds).toEqual([])
    expect(plan.pages[0]!.regularLayout!.imageSlots![0]!.usageId).toBe('cover:main')
  })
  it.each(['滨水公园', '产业园区'])('freezes %s content, physical pages and usage IDs before any image exists', project => {
    const source = page(Array.from({ length: 16 }, (_, i) => `${project}条件${i + 1}：保留公共通行与运营边界；按原始材料确认设施开放条件，不省略责任范围。`), task())
    const planned = planRegularManuscriptPage(source, project, [], 0)
    expect(planned.length).toBeGreaterThan(1)
    expect(planned.every(part => part.layout.imageSlots?.length === 1)).toBe(true)
    const images = planned.flatMap((part, index) => part.layout.imageSlots!.map(slot => photo(`photo-${index}`, slot.targetAspectRatio, slot.usageId)))
    const filled = planRegularManuscriptPage(source, project, images, 4)
    expect(filled.map(part => part.content)).toEqual(planned.map(part => part.content))
    expect(filled.map(part => part.layout.imageSlots)).toEqual(planned.map(part => part.layout.imageSlots))
    expect(filled.every(part => part.layout.media.length === 1)).toBe(true)
    expect(filled.flatMap(part => part.content.body).join('')).toBe(source.body.join(''))
    expect(filled.flatMap(part => part.layout.materialGaps ?? [])).toEqual([])
    const surplus = planRegularManuscriptPage(source, project, [...images, photo('unexpected-extra', 1)], 2)
    expect(surplus).toHaveLength(planned.length)
  })

  it.each([
    ['full-background', 'background'], ['split-left', 'left'], ['split-right', 'right'], ['split-top', 'top'], ['split-bottom', 'bottom'],
  ] as const)('uses the explicit %s task with visible pixels spanning its required edges', (template, mode) => {
    const source = page(['沿连续步行路径组织入口与休憩。'], task(template))
    const [planned] = planRegularManuscriptPage(source, '空间组织', [], 3)
    const slot = planned!.layout.imageSlots![0]!
    const asset = photo('exact-slot', slot.targetAspectRatio, slot.usageId)
    const [filled] = planRegularManuscriptPage(source, '空间组织', [asset], 0)
    expect(filled!.layout.mode).toBe(mode)
    const visible = regularImageGeometry(asset, filled!.layout.media[0]!).visible
    if (['left', 'right', 'background'].includes(mode)) { expect(visible.y).toBe(0); expect(visible.h).toBeCloseTo(7.5, 5) }
    if (['top', 'bottom', 'background'].includes(mode)) { expect(visible.x).toBeCloseTo(0, 5); expect(visible.w).toBeCloseTo(REGULAR_CANVAS.width, 5) }
    expect(regularImageGeometry(asset, filled!.layout.media[0]!).retainedArea).toBeGreaterThanOrEqual(0.8)
    expect(filled!.content.body).toEqual(source.body)
  })

  it.each(['array-horizontal', 'array-vertical'] as const)('keeps %s continuous and does not derive its slot count from image arrivals', template => {
    const source = page(['各场所共同构成完整活动体验。'], { ...task(template), imageCount: 3 })
    const empty = planRegularManuscriptPage(source, '空间组织', [], 0)
    expect(empty).toHaveLength(1)
    expect(empty[0]!.layout.imageSlots).toHaveLength(3)
    const assets = empty[0]!.layout.imageSlots!.map((slot, i) => photo(`array-${i}`, slot.targetAspectRatio, slot.usageId))
    const [filled] = planRegularManuscriptPage(source, '空间组织', assets, 3)
    expect(filled!.layout.media).toHaveLength(3)
    const boxes = filled!.layout.media.map((placement, i) => regularImageGeometry(assets[i]!, placement).visible)
    for (let i = 1; i < boxes.length; i++) {
      if (template === 'array-horizontal') expect(boxes[i]!.x).toBeCloseTo(boxes[i - 1]!.x + boxes[i - 1]!.w, 5)
      else expect(boxes[i]!.y).toBeCloseTo(boxes[i - 1]!.y + boxes[i - 1]!.h, 5)
    }
    if (template === 'array-horizontal') { expect(boxes[0]!.x).toBe(0); expect(boxes.at(-1)!.x + boxes.at(-1)!.w).toBeCloseTo(REGULAR_CANVAS.width, 5) }
    else { expect(boxes[0]!.y).toBe(0); expect(boxes.at(-1)!.y + boxes.at(-1)!.h).toBeCloseTo(7.5, 5) }
  })

  it('keeps an incompatible square as an explicit material gap without cropping it or creating another page', () => {
    const source = page(['保留所有条件与来源。'], task('full-background'))
    const before = planRegularManuscriptPage(source, '空间组织', [], 0)
    const after = planRegularManuscriptPage(source, '空间组织', [photo('square', 1, 'public-space:main')], 0)
    expect(after.map(part => part.content)).toEqual(before.map(part => part.content))
    expect(after[0]!.layout.media).toEqual([])
    expect(after[0]!.layout.materialGaps?.[0]?.reason).toBe('incompatible-image-slot')
  })

  it('packs mixed landscape, portrait and square originals continuously inside the fixed array band', () => {
    const source = page(['不同场所共同服务完整游程。'], { ...task('array-horizontal'), imageCount: 3 })
    const assets = [photo('landscape', 16 / 9), photo('portrait', 2 / 3), photo('square', 1)]
    const [part] = planRegularManuscriptPage(source, '活动组织', assets, 0)
    expect(part!.layout.media).toHaveLength(3)
    const visible = part!.layout.media.map((placement, i) => regularImageGeometry(assets[i]!, placement))
    expect(visible.every(image => image.retainedArea === 1 && Math.abs(image.visible.y) < 1e-6)).toBe(true)
    for (let i = 1; i < visible.length; i++) expect(visible[i]!.visible.x).toBeCloseTo(visible[i - 1]!.visible.x + visible[i - 1]!.visible.w, 5)
    expect(part!.layout.materialGaps).toBeUndefined()
  })

  it('reflows a short closing sentence into a fitting template before accepting a sparse continuation', () => {
    const source = page(['入口应保持公共通行。', '沿线设置停留节点。', '运营时段需结合实际条件核实。'], task('split-top'))
    const parts = planRegularManuscriptPage(source, '空间组织', [], 0)
    expect(parts).toHaveLength(1)
    expect(parts[0]!.content.body).toEqual(source.body)
    expect(parts[0]!.layout.texts.filter(text => text.role === 'body').every(text => text.size === 15)).toBe(true)
  })

  it('balances unavoidable long-copy continuations instead of stranding a closing fragment', () => {
    const source = page(Array.from({ length: 9 }, (_, i) => `条件${i + 1}：公众与维护路线分别组织，保留应急通行并明确开放时段和管理责任。`), task())
    const parts = planRegularManuscriptPage(source, '空间组织', [], 0)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.slice(1).every(part => part.content.body.join('').length > 100)).toBe(true)
    expect(parts.flatMap(part => part.content.body).join('')).toBe(source.body.join(''))
  })

  it.each([0.65, 1, 2.7])('keeps every map boundary visible at source ratio %s with its explanatory copy on the same physical page', ratio => {
    const source = { ...page(['标示项目、道路、服务节点与待核实范围。'], { ...task('map-analysis'), kind: 'accessibility', scale: 'city' }),
      visual: { kind: 'source' as const, subject: '区位交通', purpose: '交通关系分析', caption: '坐标与来源可追溯' } }
    const [planned] = planRegularManuscriptPage(source, '区位交通', [], 0)
    const asset = { ...photo('map', ratio, planned!.layout.imageSlots![0]!.usageId), role: 'map' as const, sourceKind: 'project-source' as const }
    const [filled] = planRegularManuscriptPage(source, '区位交通', [asset], 0)
    const geometry = regularImageGeometry(asset, filled!.layout.media[0]!)
    expect(geometry.source).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(filled!.content.body).toEqual(source.body)
    expect(filled!.layout.shade).toBeUndefined()
    for (const text of filled!.layout.texts) expect(text.box.x + text.box.w).toBeLessThanOrEqual(geometry.visible.x + 1e-6)
  })

  it('keeps a concise source-plan case on one analytical page when recovering its short tail', () => {
    const source: PlanningManuscriptPage = {
      id: 'case-study-tianhu-lodge', kind: 'comparison', title: '天湖小舍·水库管理房改造｜面｜库岸服务节点',
      claim: '以256平方米管理房改造承接环湖游线的抵达与停留。',
      body: ['福建福鼎嵛山岛，天湖小舍由原水库管理房改造，建筑面积256平方米，临湖而立，对岸是白茶茶园和草场。',
        '总平面保留建筑、相邻道路和湖岸的关系。', '节点位于游客下车点，为2.5公里环湖旅游线补入休憩和茶咖空间。'],
      sourceRefs: ['source:case-study:tianhu-lodge:site'], notes: [], editorialSummary: true,
      visual: { kind: 'source', subject: '天湖小舍·水库管理房改造', purpose: '承接环湖游线的抵达与停留。',
        caption: '天湖小舍、临湖前场与相邻道路总平面', sourceMaterialKey: 'case-study-photo:tianhu-lodge' },
    }
    const asset = { ...photo('tianhu-plan', 960 / 774), width: 960, height: 774,
      role: 'site-photo' as const, sourceKind: 'project-source' as const }
    const planned = planRegularManuscriptPage(source, '真实项目案例与借鉴', [], 0)
    const filled = planRegularManuscriptPage(source, '真实项目案例与借鉴', [asset], 0)
    expect(planned).toHaveLength(1)
    expect(filled.map(part => part.content)).toEqual(planned.map(part => part.content))
    expect(filled[0]!.content.body).toEqual(source.body)
    expect(filled[0]!.layout.imageSlots).toEqual([expect.objectContaining({ purpose: 'analysis', fit: 'contain' })])
    expect(filled[0]!.layout.media).toHaveLength(1)
    expect(filled[0]!.layout.materialGaps).toBeUndefined()
    expect(regularImageGeometry(asset, filled[0]!.layout.media[0]!).source).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  // These complete display strings come from the real manuscript after
  // compileContentPlan(source, defaultContentPlan(source)) and client projection.
  it.each([
    { id: 'opportunity-metropolitan-leisure-demand', count: 2, chapter: '发展机会与项目价值',
      title: '武汉主城与光谷方向的周末短途出行机会',
      claim: '拟面向武汉主城与光谷方向的周末出游客群，以茶园游览、茶事体验和户外休息组织半日至一日的近郊到访内容。',
      body: ['项目位于新洲区旧街街道，客源组织面向武汉主城与光谷方向，拟以周末自驾家庭及自然研学团队为主要服务对象。客群和停留时长为策划假设。',
        '到访内容将茶园观察、茶事讲解与品饮相衔接，使短途出游既有景观游览，也有参与和交流。',
        '到达拟采用预约与外围集散方式，接驳至茶山入口后步行游览，减少自驾车辆进入库岸和茶园生产地段。',
        '周末家庭客群', '预约与外围到达', '半日至一日体验', '选购与返程',
        '周末家庭客群 · 联系 · 预约与外围到达', '自然研学团队 · 联系 · 预约与外围到达',
        '预约与外围到达 · 联系 · 半日至一日体验', '半日至一日体验 · 联系 · 选购与返程'],
    },
    { id: 'site-location-hydrology', count: 1, chapter: '场地条件与发展判断',
      title: '区位水利本底与水库主导功能',
      claim: '水库以防洪与农业灌溉为主、兼顾旅游，茶旅活动只能布置在防洪调度与工程管护之外的地段。',
      body: ['少潭河水库位于武汉市新洲区旧街街道沙河支流少潭河上，周边为低丘缓坡与成片茶园，水体经下游通道与沙河灌区连通，承担流域防洪调蓄和农田灌溉供水职能。',
        '水库管理资料以2020年为基准，记载防洪与灌溉为主要功能、旅游为兼顾功能。方案不在行洪与调度空间安排经营设施，具体管理范围和开放条件以适用管理要求为准。',
        '拟将观景漫步、茶事体验和低扰动研学安排在符合使用条件的外围陆域与茶园，水面及水工调度区域不纳入常态经营。'],
    },
  ])('measures all of $id in the wide analytical template before committing map continuations', fixture => {
    const source: PlanningManuscriptPage = { ...page(fixture.body, { ...task('map-analysis'), kind: 'regional-context', scale: 'regional' }),
      id: fixture.id, title: fixture.title, claim: fixture.claim, editorialSummary: true,
      visual: { kind: 'source', subject: fixture.title, purpose: '以真实地图说明空间关系', caption: fixture.title } }
    const parts = planRegularManuscriptPage(source, fixture.chapter, [], 0)
    expect(parts).toHaveLength(fixture.count)
    expect(parts.flatMap(part => part.content.body).join('')).toBe(fixture.body.join(''))
    expect(parts.every(part => part.content.title === fixture.title && part.content.claim === fixture.claim)).toBe(true)
    expect(parts.flatMap(part => part.layout.imageSlots).every(slot => slot!.purpose === 'analysis' && slot!.fit === 'contain')).toBe(true)
    expect(parts.flatMap(part => part.layout.texts).filter(text => text.role === 'body').every(text => text.size === 15)).toBe(true)
    expect(parts.every(part => part.layout.texts.every(text => text.box.y + text.box.h <= REGULAR_CANVAS.height))).toBe(true)
  })

  it('plans stage photos and their explanations together before stage images are available', () => {
    const source = { ...page(['到达入口：检查导向与服务设施。', '滨水步行：保持路线连续。', '茶园停留：明确休息与生产的边界。'], { ...task(), kind: 'process' }),
      visual: { kind: 'diagram' as const, subject: '游程', purpose: '活动次序', caption: '完整游程', diagram: {
        nodes: ['到达入口', '滨水步行', '茶园停留'].map((label, i) => ({ id: `n${i}`, label, column: i, row: 0 })),
        edges: [{ from: 'n0', to: 'n1' }, { from: 'n1', to: 'n2' }],
      } } }
    const planned = planRegularManuscriptPage(source, '活动组织', [], 0)
    const assets = planned.flatMap(part => part.layout.imageSlots!.map(slot => photo(slot.nodeId!, slot.targetAspectRatio, slot.usageId, slot.nodeId)))
    const filled = planRegularManuscriptPage(source, '活动组织', assets, 0)
    expect(filled.map(part => part.content)).toEqual(planned.map(part => part.content))
    expect(filled.flatMap(part => part.layout.media).map(media => media.nodeId)).toEqual(['n0', 'n1', 'n2'])
    for (const part of filled) for (const slot of part.layout.imageSlots!) {
      const node = source.visual.diagram.nodes.find(node => node.id === slot.nodeId)!
      expect(part.content.body.some(text => text.startsWith(node.label))).toBe(true)
      expect(part.layout.texts.some(text => text.role === 'stage' && text.nodeId === slot.nodeId)).toBe(true)
    }
  })

  it('uses map evidence for a geographic task even when a legacy diagram contains stage-like nodes', () => {
    const source = { ...page(['项目与区域交通系统相互联系。'], { ...task('map-analysis'), kind: 'regional-context', scale: 'regional' }),
      visual: { kind: 'diagram' as const, subject: '区域联系', purpose: '区位分析', caption: '真实区位图', diagram: {
        nodes: [{ id: 'city', label: '城市中心', column: 0, row: 0 }, { id: 'site', label: '项目所在地', column: 1, row: 0 }], edges: [{ from: 'city', to: 'site' }],
      } } }
    const parts = planRegularManuscriptPage(source, '区位分析', [], 0)
    expect(parts.flatMap(part => part.layout.imageSlots).map(slot => slot!.purpose)).toEqual(['analysis'])
    expect(parts.flatMap(part => part.layout.imageSlots).every(slot => !slot!.nodeId)).toBe(true)
    const report = { chapters: [{ id: 'chapter', blocks: [{ type: 'planning-page', page: source }] }], assets: [] } as unknown as Parameters<typeof auditRegularVisuals>[1]
    const plan = { canvas: REGULAR_CANVAS, pages: parts.map(part => ({ chapterId: 'chapter', pageId: source.id, planningContent: part.content, regularLayout: part.layout })) } as unknown as Parameters<typeof auditRegularVisuals>[0]
    expect(auditRegularVisuals(plan, report).missingStages).toEqual([])
  })

  it('moves relationship endpoints with the actual continuous image array', () => {
    const source = { ...page([], { ...task(), kind: 'process' }), visual: { kind: 'diagram' as const, subject: '节点联系', purpose: '场所连接', caption: '空间关系', diagram: {
      nodes: [{ id: 'entry', label: '入口', column: 0, row: 0 }, { id: 'rest', label: '休憩', column: 1, row: 0 }],
      edges: [{ from: 'entry', to: 'rest', label: '步行' }],
    } } }
    const [part] = planRegularManuscriptPage(source, '活动组织', [photo('entry', 0.2, undefined, 'entry'), photo('rest', 16 / 9, undefined, 'rest')], 0)
    const caption = part!.layout.texts.find(text => text.role === 'stage' && text.nodeId === 'entry')!
    const path = part!.layout.connections![0]!.path, start = /^M ([\d.-]+) ([\d.-]+)/u.exec(path)!
    expect(Number(start[1])).toBeGreaterThanOrEqual(caption.box.x - 1e-6)
    expect(Number(start[1])).toBeLessThanOrEqual(caption.box.x + caption.box.w + 1e-6)
  })

  it('packs several long table rows per page together with their narrative at readable type size', () => {
    const source = { ...page(['设施与活动按服务对象统筹，保留各项开放条件。'], { ...task('data'), kind: 'comparison' }), table: {
      columns: ['活动场所', '组织方式', '开放条件'], rows: Array.from({ length: 6 }, (_, i) => [`空间${i + 1}`, '沿步行线路组织休憩与停留，结合现场地形保持可达性。', '运营时段、维护责任与应急通行条件应分别落实，并保留原有公众通行。']),
    } }
    const parts = planRegularManuscriptPage(source, '空间配置', [], 0)
    expect(parts.length).toBeLessThanOrEqual(3)
    expect(parts.flatMap(part => part.content.table?.rows ?? [])).toEqual(source.table.rows)
    expect(parts[0]!.content.body).toEqual(source.body)
    expect(parts.every(part => (part.content.table?.rows.length ?? 0) >= 2)).toBe(true)
    expect(parts.every(part => part.layout.imageSlots?.length === 1)).toBe(true)
  })

  it('gives legacy long tables a wide table template rather than treating a diagram label as a map', () => {
    const source = { ...page(Array.from({ length: 5 }, () => '服务设施、通行路线和管理条件应同步落实，结合现有公众使用组织开放范围。'), task()), task: undefined,
      claim: '首期先落实拟开放游线的用地、安全通行和卫生处置条件，再组织预约开放；未具备开放条件的建筑维持隔离。',
      visual: { kind: 'diagram' as const, subject: '服务组织', purpose: '说明服务对应关系', caption: '服务组织' },
      table: { columns: ['开放环节', '实施安排', '条件不足时的调整'], rows: Array.from({ length: 5 }, () => ['卫生服务', '收集设施、处置去向和持续服务能力同步落实', '启用可行替代服务；无替代安排时暂停接待']) },
    }
    const parts = planRegularManuscriptPage(source, '实施安排', [], 0)
    expect(parts.length).toBeLessThanOrEqual(3)
    expect(parts.flatMap(part => part.content.table?.rows ?? [])).toEqual(source.table.rows)
    expect(parts.flatMap(part => part.content.body).join('')).toBe(source.body.join(''))
  })

  it('does not append a second product field projection to an editorial summary', () => {
    const source = { ...page(['服务客群｜公众。', '体验内容｜步行与停留。'], task()), editorialSummary: true as const,
      product: { name: '公共游园', audience: '公众。', experience: '步行与停留。', location: '陆域。', scale: '按条件核定。', operations: '日间开放。' } }
    const parts = planRegularManuscriptPage(source, '公共游園', [], 0)
    expect(parts.flatMap(part => part.content.body)).toEqual(source.body)
  })

  it('uses available stage-page space before adding a short explanatory continuation', () => {
    const source = { ...page(Array.from({ length: 5 }, (_, i) => `条件${i + 1}：外围陆域保留公众通行与日常服务，运营时段结合现场管理明确；未满足安全条件的区域不纳入开放范围。其中安全通行与环境管理条件须同步满足，不得改变已明确的管理边界。`), { ...task(), kind: 'process' }),
      title: '外围陆域的观景与公共活动组织',
      claim: '相关管理功能保持优先，外围陆域的开阔视野与现有设施可作为观景和解说内容，管理范围不进入经营安排，开放范围应满足实际使用条件。',
      visual: { kind: 'diagram' as const, subject: '服务关系', purpose: '完整游程', caption: '服务关系', diagram: {
        nodes: Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, label: `服务阶段${i + 1}`, column: i, row: 0 })), edges: [{ from: 'n0', to: 'n1' }, { from: 'n1', to: 'n2' }, { from: 'n3', to: 'n4' }, { from: 'n4', to: 'n5' }],
      } } }
    const parts = planRegularManuscriptPage(source, '活动组织', [], 0)
    expect(parts).toHaveLength(2)
    expect(parts.every(part => part.layout.imageSlots?.some(slot => slot.nodeId))).toBe(true)
    expect(parts.flatMap(part => part.content.body).join('')).toBe(source.body.join(''))
  })
})
