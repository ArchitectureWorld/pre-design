import { describe, expect, it } from 'vitest'
import { sceneRequirements } from '../src/report/manuscript/visual-scenes.ts'
import { manuscriptSourceFingerprint } from '../src/report/manuscript/source.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'
import type { PlanningManuscriptPage } from '../src/report/manuscript/types.ts'

function fixture(recommendation = '滨水休闲公园'): FrozenProjectInput {
  const input: FrozenProjectInput = { projectId: 'coastal', projectName: '滨水公园', revision: 3, generatedAt: '2026-09-19', recommendation,
    decisionItems: [], gates: [], visualAssets: [], stateObjects: [{ objectId: 's', chapterId: '01', workItemId: '01-01', title: '案例资料', summary: '国际滨水案例全球比较', facts: [] }] }
  const page = (id: string): PlanningManuscriptPage => ({ id, kind: 'argument', title: '滨水休憩', claim: '树荫座椅连接日间步道', body: ['保留树荫和座椅。'], sourceRefs: [], notes: [],
    visual: { kind: 'concept', subject: '河岸树荫座椅', purpose: '日间休憩空间', caption: '林下休憩' } })
  const flow = { ...page('flow'), visual: { ...page('flow').visual, kind: 'diagram' as const, diagram: { nodes: [
    { id: 'a', label: '家庭林下休息', column: 0, row: 0 }, { id: 'b', label: '步道观景休憩', column: 1, row: 0 }], edges: [{ from: 'a', to: 'b' }] } } }
  return { ...input, manuscript: { schemaVersion: 'pre-design.planning-manuscript.v1', projectId: input.projectId, sourceRevision: 3, policyVersion: 'test',
    sourceFingerprint: manuscriptSourceFingerprint(input), generatedAt: input.generatedAt, title: input.projectName, chapters: [{ id: 'spatial', title: '场景', thesis: recommendation, pages: [page('a'), page('b'), flow] }] } }
}
describe('independent report image demands', () => {
  it('keeps same-topic positions independent and avoids an extra image behind illustrated stages', () => {
    const demands = sceneRequirements(fixture())
    expect(demands).toHaveLength(4)
    expect(demands.every(d => d.bindings.length === 1 && (d.bindings[0]!.nodeIds?.length ?? 1) === 1)).toBe(true)
    expect(new Set(demands.map(d => d.brief.id)).size).toBe(4)
    expect(demands.find(d => d.brief.nodeId === 'a')!.brief.subjects).toContain('家庭林下休息')
  })
  it('does not let international words in references change a domestic project', () => {
    expect(sceneRequirements(fixture()).every(d => d.brief.locale === 'domestic' && d.prompt.includes('中文'))).toBe(true)
    expect(sceneRequirements(fixture('打造国际滨水交流公园')).every(d => d.brief.locale === 'international')).toBe(true)
    for (const positioning of ['不采用国际化定位，仅服务中国本地居民', '借鉴国际案例但服务本地', '参考全球经验，营造社区公共空间']) {
      expect(sceneRequirements(fixture(positioning)).every(d => d.brief.locale === 'domestic')).toBe(true)
    }
  })
})
