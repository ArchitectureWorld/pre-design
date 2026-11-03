import { expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { buildPlanningChapterPrompt, planningChapterSources } from '../src/report/manuscript/prompts.ts'
import type { PlanningSource } from '../src/report/manuscript/index.ts'
import { createStandardFrozenProject } from './presentation-standard-fixture.ts'
import { buildEditorialPrompt } from '../src/report/manuscript/editorial-prompt.ts'
import type { PlanningManuscript } from '../src/report/manuscript/types.ts'
import { buildReportContentReviewPrompt } from '../src/report/content-review.ts'
import { expandPlanningSourcePrompt, sharePlanningSourcePrompt } from '../src/report/manuscript/source-prompt.ts'

const source = (id: string, objectId: string, field: string, text: string, basis = '规划设想，尚未建成'): PlanningSource => ({ id, objectId, fieldPath: `data.${field}`, text, basis, evidenceIds: [] })

it('constructs a large shared chapter within a bounded heap without full-size JSON copies', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--max-old-space-size=128', '--import', 'tsx',
    fileURLToPath(new URL('./fixtures/manuscript-prompt-memory.mts', import.meta.url))], { timeout: 30_000, maxBuffer: 32_000 })
  expect(JSON.parse(stdout.trim())).toMatchObject({ sources: 100 })
}, 35_000)

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

function inheritedQualifications() {
  const common = Array.from({ length: 120 }, (_, index) => `历史资料第${index}项：仅支持原记录所述条件方案，场地使用、现行管理条件及参与方意愿尚待确认，不能证明现状许可，也不能将沟通费用当作完整投资`)
  return Array.from({ length: 60 }, (_, index) => {
    const basisParts = ['proposal', ...common, `对象${index}独有条件：年度沟通费用为${index + 1} CNY，季节活动另行确定`]
    return { ...source(`source-${index}`, 'BL03', `terrain[${index}]`, `对象${index}拟组织保护主题知识服务`, basisParts.join('；')), basisParts }
  })
}

it('keeps a large chapter request within a usable size without dropping whole sources', () => {
  const entries = inheritedQualifications()
  const prompt = buildPlanningChapterPrompt(createStandardFrozenProject(), 'site', entries)
  expect(prompt.length).toBeLessThan(120_000)
  const payload = JSON.parse(expandPlanningSourcePrompt(prompt).split('\n\n').at(-1)!)
  expect(payload.sources).toHaveLength(entries.length)
  for (const [index, entry] of entries.entries()) {
    expect(payload.sources[index]).toMatchObject({ id: entry.id, text: entry.text })
    expect(payload.bases[payload.sources[index].basis]).toBe(entry.basis)
  }
})

it('also shares inherited qualifications when editing the same large chapter', () => {
  const entries = inheritedQualifications()
  const draft: PlanningManuscript = { schemaVersion: 'pre-design.planning-manuscript.v1', policyVersion: 'planning-manuscript-2026-10-09.1',
    projectId: 'project', sourceRevision: 1, sourceFingerprint: 'a'.repeat(64), generatedAt: '2026-10-14T00:00:00Z', title: '策划汇报',
    chapters: [{ id: 'site', title: '场地条件', thesis: '据历史资料提出方案', pages: [{ id: 'site-origin', kind: 'evidence', title: '场地条件',
      claim: '拟组织保护主题知识服务', body: ['各对象分别确认参与条件'], sourceRefs: entries.map(entry => entry.id),
      visual: { kind: 'none', subject: '场地条件', purpose: '说明条件方案', caption: '场地条件' }, notes: ['保留对象级条件'] }] }] }
  const prompt = buildEditorialPrompt(draft, entries, undefined, undefined, 'site')
  expect(prompt.length).toBeLessThan(120_000)
  for (const entry of entries) expect(prompt).toContain(entry.id)
})

it('fits independent content review without changing its input hash or evidence packet', () => {
  const entries = inheritedQualifications()
  const packet = { inputHash: 'a'.repeat(64), requirement: { id: 'site' }, chapters: [{ id: 'site', pages: [{ id: 'site-origin' }] }],
    sources: entries.map(({ id, text, basis }) => ({ id, text, basis })), literal: { '@planningBasisParts': ['this', 'is original data'] } }
  const prompt = buildReportContentReviewPrompt(packet, entries)
  expect(prompt.length).toBeLessThan(120_000)
  expect(JSON.parse(expandPlanningSourcePrompt(prompt).split('\n\n').at(-1)!)).toEqual(packet)
})

it('rejects inconsistent component metadata instead of changing a source qualification', () => {
  const entries = inheritedQualifications()
  entries[0]!.basisParts[0] = 'source_conclusion'
  expect(() => sharePlanningSourcePrompt('资料必须保持原样', entries)).toThrow('MANUSCRIPT_PROMPT_TRANSPORT_INVALID')
})
