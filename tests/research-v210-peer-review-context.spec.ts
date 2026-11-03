import { describe, expect, it } from 'vitest'
import * as artifacts from '../src/research-v2/peer-product-artifacts.ts'
import { getModuleFieldContracts } from '../src/research-v2/module-contracts.ts'
import { moduleReferencePromptView, expandModuleReferencePromptView } from '../src/research-v2/module-reference-context.ts'
import { assertNativeModuleContext } from '../src/research-v2/native-module-context-budget.ts'
import { sha256CanonicalJson as hash } from '../src/presentation/canonical-json.ts'

const api = artifacts as unknown as Record<string, (value: any) => any>
// The old transport is the exact, duplicated JSON payload. Its budget failure
// must be observable before the lossless reviewer transport is implemented.
const view = (value: any) => api.peerProductReviewPromptView?.(value) ?? value
const expand = (value: any) => api.expandPeerProductReviewPromptView?.(value) ?? value

function payload() {
  const restriction = '来源只描述历史方案；产品是否现存、价格、营业情况及当前适用性均未核实。研究编号不代表经营对象。'.repeat(4)
  const records = Array.from({ length: 15 }, (_, index) => ({ recordId: `product-${index}`,
    ...Object.fromEntries(getModuleFieldContracts('3.05').ports.peer_products.fields.map(field => [field.name,
      { value: null, claimClass: 'missing', claimRefs: [], limitations: [restriction] }])),
    peerId: { value: `peer-${index}`, claimClass: 'decision', claimRefs: [], limitations: [restriction] },
  }))
  const candidate = { outputs: { peer_products: { records, quality: 'limited', limitations: [restriction] } },
    claims: [], sourceValues: [], steps: [{ step: 1, status: 'limited', summary: restriction, claimRefs: [], limitations: [restriction] }], limitations: [restriction] }
  return { candidateHash: hash(candidate), candidate, authorGroupsHash: 'a'.repeat(64),
    authorGroupStates: records.map(record => ({ groupId: record.recordId, limitations: [restriction] })),
    peerProductArtifacts: artifacts.buildPeerProductArtifacts(candidate) }
}

describe('lossless complete native peer-product review context', () => {
  it('shares an exact aggregate step summary and limitation list with all of their included original group states', () => {
    const value = payload()
    const groups = Array.from({ length: 41 }, (_, index) => ({ groupId: `peer_products:${index}`,
      stepResults: { step1: { summary: `第${index}组的原生步骤说明。`, limitations: [`第${index}组独立适用限制。`] } } }))
    const step = { step: 1, status: 'limited', summary: groups.map(g => `[${g.groupId}] ${g.stepResults.step1.summary}`).join('\n'), claimRefs: [],
      limitations: groups.flatMap(g => g.stepResults.step1.limitations) }
    const candidate = { ...value.candidate, steps: [step] }
    const complete = { ...value, candidate, candidateHash: hash(candidate), authorGroupStates: groups, peerProductArtifacts: artifacts.buildPeerProductArtifacts(candidate) }
    const encoded = view(complete), data = expandModuleReferencePromptView(encoded.data) as any
    expect(data.candidate.steps[0].summary).toEqual({ encoding: 'native-group-step-summary.v1', step: 1 })
    expect(data.candidate.steps[0].limitations).toEqual({ encoding: 'native-group-step-limits.v1', step: 1 })
    expect(expand(encoded)).toEqual(complete)
  })
  it('fits a duplicated complete candidate and actual renditions without reducing the configured output reserve', () => {
    const value = payload(), limits = { contextWindow: 872000, outputTokenLimit: 128000 }, fixedContext = 'x'.repeat(328000)
    expect(() => assertNativeModuleContext(limits, fixedContext + JSON.stringify(value), '{}', [])).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
    expect(() => assertNativeModuleContext(limits, fixedContext + JSON.stringify(view(value)), '{}', [])).not.toThrow()
  })
  it('restores every original field, limit, null, selector, state and actual file byte', () => {
    const value = payload(), before = hash(value), encoded = view(value), restored = expand(encoded)
    expect(encoded.encoding).toBe('native-peer-review-context.v1')
    expect(restored).toEqual(value)
    expect(hash(value)).toBe(before)
    expect(hash(restored)).toBe(before)
    for (const [path, content] of Object.entries(value.peerProductArtifacts.files)) expect(restored.peerProductArtifacts.files[path]).toBe(content)
  })
  it('shares full rendered JSON objects with their exact candidate and trace targets rather than duplicating them', () => {
    const value = payload(), encoded = view(value), data = expandModuleReferencePromptView(encoded.data) as any
    expect(data.peerProductArtifacts.files['items/3.05/peer-offers.json']).toEqual({ encoding: 'json-pretty-2-newline-ref.v1', pointer: '/candidate/outputs/peer_products' })
    expect(expand(encoded)).toEqual(value)
    expect(JSON.stringify(encoded).length).toBeLessThan(160000)
  })
  it('keeps arbitrary JSON whitespace and non-JSON files literal when they cannot be restored by the declared formatter', () => {
    const value = payload()
    ;(value.peerProductArtifacts.files as Record<string, string>)['items/3.05/custom.json'] = '{"value":null}\r\n'
    ;(value.peerProductArtifacts.files as Record<string, string>)['items/3.05/custom.html'] = '<p>  原文 &amp; 换行\r\n</p>\n'
    const restored = expand(view(value))
    expect(restored).toEqual(value)
  })
  it('rejects a replaced actual rendition even if its inner reference dictionary hash is recomputed', () => {
    const encoded = view(payload())
    expect(encoded.encoding).toBe('native-peer-review-context.v1')
    const changed = expandModuleReferencePromptView(encoded.data) as any
    changed.peerProductArtifacts.files['items/3.05/TAB-3.05.html'] = '<p>替换稿</p>'
    expect(() => expand({ ...encoded, data: moduleReferencePromptView(changed) })).toThrow('MODULE_PEER_REVIEW_CONTEXT_INVALID')
  })
})
