import { expect, it } from 'vitest'
import { buildPlanningChapterPrompt, planningChapterSources } from '../src/report/manuscript/prompts.ts'
import type { PlanningSource } from '../src/report/manuscript/index.ts'
import { createStandardFrozenProject } from './presentation-standard-fixture.ts'

const source = (id: string, objectId: string, field: string, text: string, basis = '规划设想，尚未建成'): PlanningSource => ({ id, objectId, fieldPath: `data.${field}`, text, basis, evidenceIds: [] })

it('selects whole business statements for the chapter and excludes duplicated audit context', () => {
  const entries = [source('terrain', 'BL03', 'terrain[0]', '现状为缓坡；坡度没有实测，不作为施工指标。'),
    source('audit', 'BL03', 'confidence', '工作过程'.repeat(10000)), source('brief', 'PS06', 'formats', '内部讨论稿'),
    source('product', 'PG04', 'products[0]', '拟采用预约制组织体验，容量由场地与带领人员共同决定。')]
  expect(planningChapterSources('site', entries).map(s => s.id)).toEqual(['terrain', 'product'])
  const prompt = buildPlanningChapterPrompt(createStandardFrozenProject(), 'site', entries)
  expect(prompt).toContain(entries[0]!.text)
  expect(prompt).toContain(entries[3]!.text)
  expect(prompt).not.toContain(entries[1]!.text)
  expect(prompt.length).toBeLessThan(7000)
})

it('keeps exact evidence qualifications once and references them without losing text or provenance', () => {
  const qualification = '原资料为历史记录，尚未完成现状核验。'
  const entries = [source('a', 'BL03', 'terrain[0]', '缓坡地形', qualification), source('b', 'BL03', 'hydrology[0]', '季节水位变化', qualification)]
  const prompt = buildPlanningChapterPrompt(createStandardFrozenProject(), 'site', entries)
  const payload = JSON.parse(prompt.split('\n\n').at(-1)!)
  expect(payload.bases).toEqual([qualification])
  expect(payload.sources.map((s: { basis: number }) => payload.bases[s.basis])).toEqual([qualification, qualification])
  expect(payload.sources.map((s: { id: string }) => s.id)).toEqual(['a', 'b'])
})
