import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { materialCorpusFingerprint } from '../src/materials/research-evidence.ts'
import { getModuleAuthorProjectionSchema, bindNativeModuleEvidenceSchema } from '../src/research-v2/module-author-projection.ts'
import { moduleRecoveryFeedback } from '../src/research-v2/module-recovery-feedback.ts'
import { verifyModuleSourceValues } from '../src/research-v2/module-claims.ts'
import { sha256CanonicalJson as hash } from '../src/presentation/canonical-json.ts'

function fixture() {
  const text = '历史规划目标：可容纳50万人规模；不能证明当前已建人口。', contentHash = createHash('sha256').update(text).digest('hex')
  const directory = 'research/runs/RUN-11111111-1111-4111-8111-111111111111/sources/'
  const path = directory + contentHash + '.json', wrongPath = directory + contentHash.slice(0, 48) + contentHash.slice(-10) + '.json'
  const document = { path, contentHash, text, byteLength: Buffer.byteLength(text) }, base = { documents: [document], limitations: [] }
  const corpus = { ...base, fingerprint: materialCorpusFingerprint(base) }
  const targets = ['scale', 'denominator'].map(field => ({ port: 'peer_products', recordId: 'peer-03', field, at: '/value' }))
  const raw = { groupId: 'peer_products:3.1.2', outputs: { peer_products: { records: [{ recordId: 'peer-03',
    ...Object.fromEntries(targets.map(t => [t.field, { value: { value: 50 }, claimClass: 'source_conclusion', limitations: ['历史规划目标'] }])) }] } },
    evidence: targets.map(target => ({ kind: 'source', target, source: { path: wrongPath, quote: text, valueQuote: '50' } })) }
  const audit: any = { reviewReceipts: [], attempts: [
    { classId: 'text', groupId: raw.groupId, status: 'failed', error: 'MODULE_PROJECTION_SOURCE_LOCATION: ' + wrongPath, structuredOutput: raw },
    { classId: 'text', groupId: raw.groupId, status: 'failed', error: 'MODULE_NATIVE_error' },
  ] }
  return { corpus, contentHash, path, wrongPath, text, targets, raw, audit }
}

describe('native source path identity repair', () => {
  it('shows the verbatim path rule in the supported native source and calculation schemas', () => {
    const schema: any = bindNativeModuleEvidenceSchema(getModuleAuthorProjectionSchema('3.05'))
    const descriptions: string[] = []
    function walk(node: any) {
      if (!node || typeof node !== 'object') return
      if (node.properties?.path && node.properties?.quote) descriptions.push(node.properties.path.description ?? '')
      Object.values(node).forEach(walk)
    }
    walk(schema)
    expect(descriptions.length).toBeGreaterThan(1)
    expect(descriptions.every(text => text.includes('逐字复制') && text.includes('哈希') && text.includes('不得缩写'))).toBe(true)
    expect(() => assertObjectJsonSchema(schema)).not.toThrow()
  })

  it('distinguishes the shortened filename on both rejected targets after a later empty native response, without accepting or changing the draft', () => {
    const f = fixture(), before = hash(f), feedback = moduleRecoveryFeedback({ resumeExecutionAudit: f.audit, corpus: f.corpus }, f.raw.groupId)
    const excerpt = JSON.parse(feedback.split('\n').at(-1)!).previousRejection.diagnosticExcerpt
    expect(excerpt.originalSubmissionHash).toBe(hash(f.raw))
    expect(excerpt.fieldTextConflicts.map((c: any) => c.target)).toEqual(f.targets)
    for (const conflict of excerpt.fieldTextConflicts) {
      expect(conflict.sourcePathCopyDiagnostic).toMatchObject({ diagnosticOnly: true,
        submittedFileName: f.wrongPath.split('/').at(-1), submittedFileNameChars: 63,
        matchedFileNames: [{ fileName: f.contentHash + '.json', fileNameChars: 69 }],
        sourcePathsMustBeCopiedVerbatim: true })
      expect(conflict.quoteLocationMatches).toEqual([{ path: f.path, contentHash: f.contentHash, literalExactMatch: true }])
      expect(conflict.sourcePathCopyDiagnostic.boundary).toContain('not accepted')
    }
    expect(feedback).toContain('完整文件名')
    expect(hash(f)).toBe(before)
    expect(() => verifyModuleSourceValues(f.corpus, [{ sourceId: 'regression-only', path: f.wrongPath, contentHash: f.contentHash, quote: f.text, rawValue: 50, valueQuote: '50' }])).toThrow('MODULE_SOURCE_VALUE_LOCATION')
  })
})
