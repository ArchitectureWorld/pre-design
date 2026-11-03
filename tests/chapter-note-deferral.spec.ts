import { expect, it } from 'vitest'
import { validateChapterNoteDeferral } from '../src/report/chapter-note-deferral.ts'
import { sha256CanonicalJson as hash } from '../src/presentation/canonical-json.ts'

const note = 'W-4于2022-08-25说明水利背景，实施前确认现行水库管理资料。'
const draft: any = { chapterId: 'site', chapter: { pages: [{ id: 'site-01', sourceRefs: ['W-4'], notes: [note] }] } }
const review: any = { status: 'needs_revision', manuscriptHash: hash(draft.chapter), receipt: {
  outputHash: 'native-output', output: { findings: [{ pageId: 'site-01', code: 'FACT-TEMPORAL-QUALIFIER', reason: '确认现行功能时点' }] } } }
const request = () => ({ kind: 'dated-source-in-notes', chapterId: 'site', manuscriptHash: hash(draft.chapter),
  reviewOutputHash: 'native-output', pageId: 'site-01', sourceRefs: ['W-4'], noteQuote: note,
  rationale: '来源时点已在备注，依用户要求保留人工复核并继续出稿。', userDirection: '人工确认放备注；每三步回看。', recheckAfterSteps: 3 })

it('records a dated-source note deferral without changing the native rejection or manuscript', () => {
  const before = JSON.stringify({ draft, review })
  expect(validateChapterNoteDeferral(request(), draft, review)).toMatchObject({ status: 'conditional', nativeStatus: 'needs_revision', recheckAfterSteps: 3 })
  expect(JSON.stringify({ draft, review })).toBe(before)
})
it('rejects stale, unnoted, open-ended, or materially different findings', () => {
  for (const value of [{ ...request(), manuscriptHash: 'old' }, { ...request(), reviewOutputHash: 'old' },
    { ...request(), noteQuote: '未写入备注的条件' }, { ...request(), sourceRefs: ['unknown'] },
    { ...request(), recheckAfterSteps: 4 }]) expect(() => validateChapterNoteDeferral(value, draft, review)).toThrow()
  const material = structuredClone(review); material.receipt.output.findings[0].code = 'unsupported_label'
  expect(() => validateChapterNoteDeferral(request(), draft, material)).toThrow()
  const additional = structuredClone(review); additional.receipt.output.findings.push({ pageId: 'site-02', code: 'missing_content' })
  expect(() => validateChapterNoteDeferral(request(), draft, additional)).toThrow()
})
