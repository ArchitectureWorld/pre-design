import { describe, expect, it } from 'vitest'
import { workflowUpstreamPromptView, expandWorkflowUpstreamPromptView } from '../src/runtime/workflow-upstream-context.ts'

describe('lossless workflow upstream prompt view', () => {
  it('shares economically repeated source identity strings shorter than 64 characters without replacing unique text', () => {
    const sourceId = 'source-12345678901234567890123456789012'
    const source = [{ value: { rows: Array.from({ length: 100 }, (_, i) => ({ sourceId, notes: `独有原文${i}` })) } }]
    const view = workflowUpstreamPromptView(source)
    expect(view).toMatchObject({ strings: expect.arrayContaining([sourceId]) })
    expect(expandWorkflowUpstreamPromptView(view)).toEqual(source)
  })
  it('stores repeated evidence field names once while retaining exact values and record shapes', () => {
    const source = [{ objectId: 'OP06', revision: 144, value: { data: {
      scenarios: Array.from({ length: 60 }, (_, index) => ({ name: `方案${index}`, evidence_refs: [{
        evidence_id: 'OP02', asset_id: 'OP02', version_id: 'OP02@141', claim_class: 'assumption',
        locator: { section: `/data/items/${index}` }, quote_hash: index.toString().padStart(64, '0'),
        captured_at: '2026-09-29T13:00:00Z', reliability: 'unknown', notes: `第${index}项仍是条件假设`,
        ...(index % 2 ? { confidence: 0, nullable: null, verified: false } : {}),
      }] })),
    } } }]
    const original = structuredClone(source), view = workflowUpstreamPromptView(source)
    expect(view).toMatchObject({ encoding: 'workflow-upstream-evidence-v2' })
    expect(expandWorkflowUpstreamPromptView(view)).toEqual(original)
    expect(source).toEqual(original)
    expect(JSON.stringify(view).length).toBeLessThan(JSON.stringify(source).length * 0.75)
    expect(workflowUpstreamPromptView(source)).toEqual(view)
  })

  it('keeps original marker-shaped evidence objects distinct from encoded rows', () => {
    const source = [{ value: { '@E': 0, '@E_': 1, data: { rows: Array.from({ length: 50 }, () => ({
      evidence_refs: [{ '@E': [0, ['literal']], '@S': 0, notes: 'not a dictionary reference', claim_class: 'assumption',
        evidence_id: 'OP02', asset_id: 'OP02', version_id: 'OP02@141', reliability: 'unknown' }],
    })) } } }]
    const view = workflowUpstreamPromptView(source)
    expect(view).toMatchObject({ encoding: 'workflow-upstream-evidence-v2', evidenceKey: '@E__' })
    expect(expandWorkflowUpstreamPromptView(view)).toEqual(source)
  })

  it.each([
    { columns: [['notes']], record: [0, []] },
    { columns: [['notes', 'notes']], record: [0, ['a', 'b']] },
    { columns: [['notes']], record: [1, ['a']] },
    { columns: [['notes']], record: [0, ['a'], 'extra'] },
  ])('rejects malformed evidence rows instead of filling or dropping fields: %j', ({ columns, record }) => {
    expect(() => expandWorkflowUpstreamPromptView({ encoding: 'workflow-upstream-evidence-v2', referenceKey: '@S', strings: [],
      evidenceKey: '@E', evidenceColumns: columns, upstream: [{ '@E': record }] })).toThrow('WORKFLOW_UPSTREAM_VIEW_INVALID')
  })

  it('deduplicates repeated source identity text without dropping values, notes, classification or provenance', () => {
    const upstream = [{ objectId: 'PS03', revision: 8, value: { data: {
      actors: Array.from({ length: 14 }, (_, index) => ({ name: `角色${index}`, confidence: 0.3,
        evidence_refs: [{ evidence_id: 'source-' + 'a'.repeat(70), version_id: 'version-' + 'b'.repeat(70),
          locator: { section: '原始资料/归档文件/精确段落'.repeat(20) }, quote_hash: 'c'.repeat(64),
          claim_class: 'user_statement', notes: `各角色限制${index}` }] })),
    } } }]
    const original = structuredClone(upstream), view = workflowUpstreamPromptView(upstream)
    expect(view).toMatchObject({ encoding: 'workflow-upstream-evidence-v2' })
    expect(expandWorkflowUpstreamPromptView(view)).toEqual(original)
    expect(upstream).toEqual(original)
    expect(JSON.stringify(view).length).toBeLessThan(JSON.stringify(original).length * 0.6)
    expect(JSON.stringify(view)).toContain('各角色限制13')
    expect(JSON.stringify(view)).toContain('user_statement')
  })

  it('keeps ordinary short inputs in their existing format', () => {
    const source = [{ objectId: 'PS02', revision: 2, value: { data: { value: '未知', restrictions: ['待查', '待查'], confidence: null } } }]
    expect(workflowUpstreamPromptView(source)).toEqual(source)
    expect(expandWorkflowUpstreamPromptView(source)).toEqual(source)
  })

  it('does not confuse actual marker-shaped objects, escaped keys or original strings with dictionary references', () => {
    const source = [{ objectId: 'PS01', revision: 3, value: { '@S': 0, '@S_': 1,
      'a/b~c': Array.from({ length: 20 }, () => ({ '@S': 0, text: '原始长字符串'.repeat(100), missing: null })),
      literal: '{"@S":0}', empty: '', truth: false, number: 0 } }]
    const view = workflowUpstreamPromptView(source)
    expect(view).toMatchObject({ encoding: 'workflow-upstream-strings-v1', referenceKey: '@S__' })
    expect(expandWorkflowUpstreamPromptView(view)).toEqual(source)
    expect(workflowUpstreamPromptView(source)).toEqual(view)
  })

  it('does not compact unique text or replace field names', () => {
    const field = '长业务字段名'.repeat(20)
    const source = [{ value: { [field]: '独有业务内容'.repeat(80), values: Array.from({ length: 8 }, (_, i) => `${i}`.repeat(100)) } }]
    expect(workflowUpstreamPromptView(source)).toEqual(source)
  })

  it('rejects malformed encoded dictionary references rather than changing source values', () => {
    expect(() => expandWorkflowUpstreamPromptView({ encoding: 'workflow-upstream-strings-v1', referenceKey: '@S', strings: ['原文'], upstream: [{ '@S': 7 }] })).toThrow('WORKFLOW_UPSTREAM_VIEW_INVALID')
  })
})
