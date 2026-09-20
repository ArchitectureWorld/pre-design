import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlanningManuscriptService, type PlanningManuscriptServiceOptions } from '../src/report/manuscript/service.ts'
import { PlanningManuscriptEditor } from '../src/report/manuscript/editorial-service.ts'
import { PLANNING_EDITORIAL_VERSION } from '../src/report/manuscript/editorial-prompt.ts'
import { clientPlanningManuscript, MATERIAL_EXPLANATION } from '../src/report/manuscript/client-copy.ts'
import { makeSourceIndex, manuscriptSourceFingerprint } from '../src/report/manuscript/source.ts'
import { PLANNING_CHAPTER_IDS, PLANNING_MANUSCRIPT_POLICY_VERSION, PLANNING_MANUSCRIPT_SCHEMA_VERSION, type PlanningManuscript } from '../src/report/manuscript/types.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'

const input: FrozenProjectInput = { projectId: 'cached-project', projectName: '林间漫游', revision: 103,
  generatedAt: '2026-09-18T00:00:00.000Z', recommendation: '沿现有路径组织日间休闲', decisionItems: [], gates: [], visualAssets: [],
  stateObjects: [{ objectId: 'PG04', chapterId: '06', title: '林间漫游', summary: '利用现有步道串联观察与休憩活动。', facts: [] }] }
const rootPaths: string[] = []
afterEach(async () => { await Promise.all(rootPaths.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function workspace() { const root = await mkdtemp(join(tmpdir(), 'manuscript-cache-migration-')); rootPaths.push(root); return root }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const agent = { id: 'parent' } as never
const signal = () => new AbortController().signal
const guard = () => {}

function legacyDraft(): PlanningManuscript {
  return { schemaVersion: PLANNING_MANUSCRIPT_SCHEMA_VERSION, policyVersion: PLANNING_MANUSCRIPT_POLICY_VERSION,
    projectId: input.projectId, sourceRevision: input.revision, sourceFingerprint: manuscriptSourceFingerprint(input), generatedAt: input.generatedAt,
    title: '林间漫游前期策划汇报', chapters: PLANNING_CHAPTER_IDS.map((id, index) => ({ id, title: '林间体验与场地组织', thesis: '利用现有路径串联观察与休息。',
      pages: [{ id: `${id}-walk`, kind: id === 'products' ? 'product' : 'argument', title: '林间漫游', claim: '以步行、自然观察和休息节点组织日间游览。',
        body: ['利用具备开放条件的现有道路，安排林木观察与小组休憩。'], sourceRefs: makeSourceIndex(input).map(source => source.id), notes: ['既有档案说明'],
        visual: { kind: 'concept', subject: index < 3 ? '林间漫游意向' : '林间漫游', purpose: index < 3 ? '表现林下休憩场景意向' : '表现林下休憩体验',
          caption: index < 3 ? '存量建筑活化与日间草地休憩概念示意图（概念意向，非现场实景）' : '林间漫游' },
        ...(id === 'products' ? { product: { name: '林间漫游', audience: '日间访客', experience: '步行与自然观察', location: '现有步道和林缘空间',
          scale: '按开放路径长度与带领人员数量安排分组', operations: '分组预约与日间导览' } } : {}),
      }] })) }
}
function runtime() {
  const start = vi.fn(async () => { throw new Error('UNEXPECTED_MODEL_DISPATCH') })
  const begin = vi.fn(async () => { throw new Error('UNEXPECTED_BUDGET_RESERVATION') })
  const dependencies: PlanningManuscriptServiceOptions = { now: () => '2030-01-01T00:00:00.000Z', maxConcurrency: 3,
    subagents: { getProvider: vi.fn(() => undefined), start }, agentClasses: { begin, attach: vi.fn(), finish: vi.fn() } }
  return { dependencies, begin, start }
}
async function json(path: string, value: unknown) {
  const text = JSON.stringify(value, null, 2); await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); return text
}
function chapterCheckpointPath(root: string, draft = legacyDraft()) {
  return join(root, '.pre-design', 'report-manuscript-checkpoints', `${draft.sourceFingerprint}-${hash(draft.policyVersion).slice(0, 12)}`, 'chapters.json')
}
function chapterCheckpoint(draft = legacyDraft()) {
  return { schemaVersion: 'pre-design.planning-manuscript-checkpoint.v1', policyVersion: draft.policyVersion,
    projectId: draft.projectId, sourceRevision: draft.sourceRevision, sourceFingerprint: draft.sourceFingerprint, correctionsUsed: 0,
    chapters: Object.fromEntries(draft.chapters.map(chapter => [chapter.id, { chapter,
      attempts: [{ id: `${chapter.id}-original`, status: 'completed', startedAt: draft.generatedAt, completedAt: draft.generatedAt, validationCorrection: false }] }])) }
}
function editorialIdentity(draft = legacyDraft()) {
  return { version: PLANNING_EDITORIAL_VERSION,
    draftFingerprint: hash(JSON.stringify({ version: PLANNING_EDITORIAL_VERSION, source: draft.sourceFingerprint, chapters: draft.chapters })),
    editedAt: '2026-09-18T00:10:00.000Z' }
}
async function editorialCheckpoints(root: string, draft = legacyDraft()) {
  const editorial = editorialIdentity(draft), files = new Map<string, string>()
  for (const id of PLANNING_CHAPTER_IDS) {
    const path = join(root, '.pre-design', 'report-manuscript-editorial', `${editorial.draftFingerprint}-${id}.json`)
    files.set(path, await json(path, { version: editorial.version, fingerprint: editorial.draftFingerprint,
      attempts: [{ status: 'completed', correction: false, childId: `${id}-original` }], manuscript: { ...draft, editorial } }))
  }
  return { files, editorial }
}
function expectMigrated(result: PlanningManuscript, original: PlanningManuscript) {
  expect(result.policyVersion).toBe(original.policyVersion)
  expect(result.sourceFingerprint).toBe(original.sourceFingerprint)
  expect(result.sourceRevision).toBe(original.sourceRevision)
  expect(result.projectId).toBe(original.projectId)
  expect(result.chapters).toEqual(clientPlanningManuscript(original).chapters)
  for (const chapter of result.chapters) for (const page of chapter.pages) {
    expect(MATERIAL_EXPLANATION.test(JSON.stringify({ ...page, notes: [] }))).toBe(false)
  }
}

describe('deterministic migration of archived manuscript caches', () => {
  it('loads the published cache safely without changing source/editorial identity, archive bytes or budget', async () => {
    const root = await workspace(), host = runtime(), draft = legacyDraft()
    const original = { ...draft, editorial: editorialIdentity(draft) }
    const path = join(root, '.pre-design', 'report-manuscript.json'), bytes = await json(path, original)
    const editor = new PlanningManuscriptEditor(host.dependencies)
    const service = new PlanningManuscriptService({ ...host.dependencies, editor })
    const result = await service.prepare(input, root, agent, signal(), guard)
    expectMigrated(result, original)
    expect(result.editorial).toEqual(original.editorial)
    expect(await readFile(path, 'utf8')).toBe(bytes)
    expect(host.begin).not.toHaveBeenCalled(); expect(host.start).not.toHaveBeenCalled()
  })

  it('restores old chapter and editorial checkpoints together with zero new dispatches and their original fingerprint', async () => {
    const root = await workspace(), host = runtime(), original = legacyDraft()
    const chapterPath = chapterCheckpointPath(root), chapterBytes = await json(chapterPath, chapterCheckpoint(original))
    const { files, editorial } = await editorialCheckpoints(root, original)
    expect(editorial.draftFingerprint).not.toBe(editorialIdentity(clientPlanningManuscript(original)).draftFingerprint)
    const editor = new PlanningManuscriptEditor(host.dependencies)
    const result = await new PlanningManuscriptService({ ...host.dependencies, editor }).prepare(input, root, agent, signal(), guard)
    expectMigrated(result, original)
    expect(result.editorial).toEqual(editorial)
    expect(host.begin).not.toHaveBeenCalled(); expect(host.start).not.toHaveBeenCalled()
    expect(await readFile(chapterPath, 'utf8')).toBe(chapterBytes)
    for (const [path, bytes] of files) expect(await readFile(path, 'utf8')).toBe(bytes)
    expect(JSON.parse(await readFile(join(root, '.pre-design', 'report-manuscript.json'), 'utf8')).editorial).toEqual(editorial)
  })

  it('restores all completed chapter caches without requiring an available model provider', async () => {
    const root = await workspace(), host = runtime(), original = legacyDraft()
    const path = chapterCheckpointPath(root), bytes = await json(path, chapterCheckpoint(original))
    const result = await new PlanningManuscriptService(host.dependencies).prepare(input, root, agent, signal(), guard)
    expectMigrated(result, original)
    expect(await readFile(path, 'utf8')).toBe(bytes)
    expect(host.begin).not.toHaveBeenCalled(); expect(host.start).not.toHaveBeenCalled()
  })

  it.each([
    ['missing chapters', (value: any) => { delete value.chapters }],
    ['null page', (value: any) => { value.chapters[0].pages[0] = null }],
    ['missing visual', (value: any) => { delete value.chapters[0].pages[0].visual }],
    ['non-string body', (value: any) => { value.chapters[0].pages[0].body = [42] }],
    ['invalid table row', (value: any) => { value.chapters[0].pages[0].table = { columns: ['A'], rows: [null] } }],
    ['invalid diagram', (value: any) => { value.chapters[0].pages[0].visual.diagram = { nodes: null, edges: [] } }],
  ] as const)('rejects damaged published cache (%s) with a stable error, never a TypeError or new model task', async (_label, mutate) => {
    const root = await workspace(), host = runtime(), original = structuredClone(legacyDraft()); mutate(original)
    const path = join(root, '.pre-design', 'report-manuscript.json'), bytes = await json(path, original)
    await expect(new PlanningManuscriptService(host.dependencies).prepare(input, root, agent, signal(), guard)).rejects.toThrow('MANUSCRIPT_CACHE_INVALID')
    expect(await readFile(path, 'utf8')).toBe(bytes)
    expect(host.begin).not.toHaveBeenCalled(); expect(host.start).not.toHaveBeenCalled()
  })

  it('rejects malformed completed chapter checkpoints without dispatching or modifying the archived record', async () => {
    const root = await workspace(), host = runtime(), checkpoint = chapterCheckpoint()
    Object.assign(checkpoint.chapters.site!, { chapter: null })
    const path = chapterCheckpointPath(root), bytes = await json(path, checkpoint)
    await expect(new PlanningManuscriptService(host.dependencies).prepare(input, root, agent, signal(), guard)).rejects.toThrow('MANUSCRIPT_CHECKPOINT_INVALID')
    expect(await readFile(path, 'utf8')).toBe(bytes)
    expect(host.begin).not.toHaveBeenCalled(); expect(host.start).not.toHaveBeenCalled()
  })

  it.each(['null checkpoint', 'null manuscript', 'broken chapters'])('rejects malformed editorial caches (%s) before starting children', async kind => {
    const root = await workspace(), host = runtime(), original = legacyDraft(), { files } = await editorialCheckpoints(root, original)
    const path = [...files.keys()][1]!, checkpoint = JSON.parse(files.get(path)!)
    if (kind === 'null manuscript') checkpoint.manuscript = null
    if (kind === 'broken chapters') checkpoint.manuscript.chapters = null
    const bytes = await json(path, kind === 'null checkpoint' ? null : checkpoint)
    await expect(new PlanningManuscriptEditor(host.dependencies).edit(original, input, root, agent, signal(), guard, 2)).rejects.toThrow('MANUSCRIPT_EDITORIAL_CHECKPOINT_INVALID')
    expect(await readFile(path, 'utf8')).toBe(bytes)
    expect(host.begin).not.toHaveBeenCalled(); expect(host.start).not.toHaveBeenCalled()
  })

  it('still rejects changed source references after presentation migration', async () => {
    const root = await workspace(), host = runtime(), checkpoint = chapterCheckpoint()
    Object.assign(checkpoint.chapters.site!.chapter.pages[0]!, { sourceRefs: ['unknown-source'] })
    await json(chapterCheckpointPath(root), checkpoint)
    await expect(new PlanningManuscriptService(host.dependencies).prepare(input, root, agent, signal(), guard)).rejects.toThrow('MANUSCRIPT_SOURCE')
    expect(host.begin).not.toHaveBeenCalled(); expect(host.start).not.toHaveBeenCalled()
  })
})
