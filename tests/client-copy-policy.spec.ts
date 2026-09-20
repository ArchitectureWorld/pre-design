import { describe, expect, it } from 'vitest'
import { clientPlanningPage, clientPlanningManuscript, MATERIAL_EXPLANATION } from '../src/report/manuscript/client-copy.ts'
import { validatePlanningChapter } from '../src/report/manuscript/validation.ts'
import type { PlanningManuscriptPage } from '../src/report/manuscript/types.ts'

const page: PlanningManuscriptPage = { id: 'opportunity-tea', kind: 'argument', title: '茶园漫游', claim: '沿茶园布置步行游线与停留节点。', body: ['未满足安全使用条件的建筑不纳入首期开放。'], sourceRefs: ['s1'], notes: [], visual: { kind: 'concept', subject: '茶园漫游', purpose: '表达游览体验', caption: '茶园漫游' } }
const sources = [{ id: 's1', objectId: 'test', fieldPath: 'proposal', text: '茶园步行游线', basis: '项目方案', evidenceIds: [] }]
const chapter = (p: PlanningManuscriptPage) => ({ id: 'opportunity' as const, title: '茶园游览与休憩', thesis: page.claim, pages: [p] })
describe('client copy production policy', () => {
  it.each(['存量建筑活化与日间草地休憩概念示意图（概念意向，非现场实景）', '拟议关系示意；不表示实际地理位置、测绘范围或已建成状态。', '茶园漫游场景意向；具体线位以设计为准。'])('rejects new material explanation and migrates archived caption without changing proposal: %s', caption => {
    const source = { ...page, visual: { ...page.visual, caption } }
    expect(() => validatePlanningChapter(chapter(source), 'opportunity', sources)).toThrow('MANUSCRIPT_AUDIENCE')
    const projected = clientPlanningPage(source)
    expect(MATERIAL_EXPLANATION.test(projected.visual.caption)).toBe(false)
    expect(projected.visual.caption).toBe('茶园漫游')
    expect(projected.notes).toContain(`原图注：${caption}`)
    expect(source.visual.caption).toBe(caption)
    expect(projected.body).toEqual(page.body)
    expect(() => validatePlanningChapter(chapter(projected), 'opportunity', sources)).not.toThrow()
    expect(clientPlanningPage(projected)).toEqual(projected)
  })
  it('checks visible table/product/diagram labels, and leaves specific planning conditions intact', () => {
    expect(() => validatePlanningChapter(chapter({ ...page, table: { columns: ['材料说明'], rows: [['非现场实景']] } }), 'opportunity', sources)).toThrow('MANUSCRIPT_AUDIENCE')
    expect(() => validatePlanningChapter(chapter({ ...page, visual: { ...page.visual, kind: 'diagram', diagram: { nodes: [{ id: 'a', column: 0, row: 0, label: '空间意向' }], edges: [] } } }), 'opportunity', sources)).toThrow('MANUSCRIPT_AUDIENCE')
    expect(clientPlanningPage(page).body[0]).toBe('未满足安全使用条件的建筑不纳入首期开放。')
  })
  it('preserves source identity and editorial identity during the presentation migration', () => {
    const manuscript = { schemaVersion: 'pre-design.planning-manuscript.v1', policyVersion: 'old-cache-policy', projectId: 'p', sourceRevision: 103, sourceFingerprint: 'x', generatedAt: '2026-09-18', title: '少潭河', chapters: [chapter(page)], editorial: { version: 'old-editor', draftFingerprint: 'y', editedAt: '2026-09-18' } } as const
    const migrated = clientPlanningManuscript(manuscript)
    expect(migrated.sourceFingerprint).toBe(manuscript.sourceFingerprint)
    expect(migrated.editorial).toEqual(manuscript.editorial)
    expect(migrated.policyVersion).toBe(manuscript.policyVersion)
  })
})
