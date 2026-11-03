import { describe, expect, it } from 'vitest'
import { moduleReferencePromptView, expandModuleReferencePromptView } from '../src/research-v2/module-reference-context.ts'

function source() {
  const body = 'Inherited conditional constraint: not measured, approved or a current factual conclusion. '.repeat(8)
  return { sourceValues: [{ sourceId: 'source-original', path: '原始资料/原件.pdf', page: 3, contentHash: 'a'.repeat(64),
    quote: '连续原文\n0.03 m³/s；2022年6月，轴序xy。', rawValue: 0.03, valueQuote: '0.03' }],
    upstream: Array.from({ length: 30 }, (_, i) => ({ moduleId: 'preplan.research.01.02', claimId: `claim-${i}`, selector: `/outputs/a~1b/records/${i}/value`,
      claimClass: i % 2 ? 'assumption' : 'source_conclusion', value: [0, -0.03, false, null, '', ['xy', 114.976, 30.839]],
      limitations: [`claim-${String(i).padStart(32, '0')} [proposal]: ${body}`] })) }
}
describe('exact native research reference transport', () => {
  it('retains complete source spans, addresses, classifications, values and restrictions while sharing repeated input structure', () => {
    const value = source(), before = structuredClone(value), view: any = moduleReferencePromptView(value)
    expect(view.encoding).toBe('research-reference.v1')
    expect(JSON.stringify(view).length).toBeLessThan(JSON.stringify(value).length * 0.5)
    expect(expandModuleReferencePromptView(view)).toEqual(before)
    expect(value).toEqual(before)
    expect(moduleReferencePromptView(value)).toEqual(view)
  })
  it('keeps literal dictionary-shaped original objects and unusual keys distinct from transport markers', () => {
    const value = { ...source(), literals: { '@S': 0, '@S_': 1, '@R': [0, []], '@T': ['x', 'y'], 'a/b~c': '{"@S":0}' } }
    const view: any = moduleReferencePromptView(value)
    expect(view.stringKey).toBe('@S__'); expect(view.rowKey).toBe('@R_'); expect(view.textKey).toBe('@T_')
    expect(expandModuleReferencePromptView(view)).toEqual(value)
  })
  it('does not change a small input or encode unique material prose unnecessarily', () => {
    const value = { quote: '唯一连续原文', quantity: 0.03, missing: null, limitations: ['实际未检测'] }
    expect(moduleReferencePromptView(value)).toEqual(value)
    expect(expandModuleReferencePromptView(value)).toEqual(value)
  })
  it('shares repeated short Chinese restrictions by their UTF-8 transport cost', () => {
    const value = { limitations: Array.from({ length: 200 }, () => '仅供方案比较') }
    const before = structuredClone(value), view = moduleReferencePromptView(value)
    expect(Buffer.byteLength(JSON.stringify(view), 'utf8')).toBeLessThan(Buffer.byteLength(JSON.stringify(value), 'utf8') * 0.65)
    expect(expandModuleReferencePromptView(view)).toEqual(before)
    expect(value).toEqual(before)
  })
  it.each(['reference', 'columns', 'cells', 'hash', 'size', 'markers'])('rejects a damaged %s without supplying content or accepting a partial reconstruction', kind => {
    const view: any = structuredClone(moduleReferencePromptView(source()))
    if (kind === 'reference') view.data = { [view.stringKey]: view.strings.length }
    if (kind === 'columns') view.columns[0].push(view.columns[0][0])
    if (kind === 'cells') view.data = { [view.rowKey]: [0, []] }
    if (kind === 'hash') view.originalHash = '0'.repeat(64)
    if (kind === 'size') view.originalChars++
    if (kind === 'markers') view.textKey = view.stringKey
    expect(() => expandModuleReferencePromptView(view)).toThrow('MODULE_REFERENCE_CONTEXT_INVALID')
  })
})
