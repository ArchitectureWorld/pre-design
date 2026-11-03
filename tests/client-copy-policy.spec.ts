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
  it('retains the referenced development questions as page notes while keeping the proposed report body intact', () => {
    const source = { ...page, body: ['在入口集中组织集散、导览与休息。'], notes: ['按目标场景表达策划方案。'] }
    const qualified = [
      { ...sources[0]!, moduleLineage: { limitations: ['地块权属由业主确认。', '开发许可由主管部门确认。'] } as any },
      { ...sources[0]!, id: 'unused', moduleLineage: { limitations: ['另一地块的事项。'] } as any },
    ]
    const projected = clientPlanningPage(source, qualified)
    expect(projected.body).toEqual(source.body)
    expect(projected.notes).toContain('来源备注：地块权属由业主确认。')
    expect(projected.notes).toContain('来源备注：开发许可由主管部门确认。')
    expect(projected.notes.join('\n')).not.toContain('另一地块')
    expect(source.notes).toEqual(['按目标场景表达策划方案。'])
    expect(clientPlanningPage(projected, qualified)).toEqual(projected)
  })
})
import { clientCopyText as normalizeReportCopy } from '../src/report/manuscript/client-copy.ts'
import { it as copyIt, expect as copyExpect } from 'vitest'
copyIt('normalizes page-relative editorial phrases without changing scenario scope or values',()=>{
 copyExpect(normalizeReportCopy('按本页情景，年度投入50,000元。')).toBe('按拟定情景，年度投入50,000元。')
 copyExpect(normalizeReportCopy('该预算只覆盖本页列明项目，其他费用另行计入。')).toBe('该预算只覆盖所列项目，其他费用另行计入。')
})
