import { describe, expect, it } from 'vitest'
import { allocateModuleMaterialChars, assertNativeModuleContext, nativeProviderReviewContext } from '../src/research-v2/native-module-context-budget.ts'

describe('native request context allocation', () => {
  it('records an uncertain byte upper bound without claiming actual token admission or reducing the configured reserve',()=>{
    const limits={contextWindow:872000,outputTokenLimit:128000},prompt='中'.repeat(300000)
    expect(()=>assertNativeModuleContext(limits,prompt,'{}',[])).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
    expect(nativeProviderReviewContext(limits,prompt,'{}',[])).toMatchObject({admission:'native-provider',actualTokenCountKnown:false,
      estimatedInputTokens:908194,contextWindow:872000,outputReservedTokens:128000})
  })
  it.each([{}, {contextWindow:872000}, {contextWindow:128000,outputTokenLimit:128000}, {contextWindow:10000,outputTokenLimit:9000}])
    ('retains hard capacity rejection when the original output/system allowance is impossible or unknown: %j',limits=>{
      expect(()=>nativeProviderReviewContext(limits,'task','{}',[])).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
    })
  it('uses the smallest authorized input capacity after each route reserves its own output and fixed context', () => {
    const primary = { contextWindow: 872000, outputTokenLimit: 128000 }
    const secondary = { contextWindow: 1048576, outputTokenLimit: 65536 }
    expect(allocateModuleMaterialChars([primary, secondary], 'x'.repeat(10000))).toBeGreaterThan(100000)
    expect(allocateModuleMaterialChars([primary, secondary], '原文'.repeat(10000))).toBeLessThan(allocateModuleMaterialChars([primary, secondary], '')!)
    expect(allocateModuleMaterialChars([primary, { contextWindow: 128000, outputTokenLimit: 65536 }], '')).toBeLessThan(48000)
  })
  it('keeps unknown capacity bounded without inventing provider limits', () => {
    expect(allocateModuleMaterialChars([{}], '')).toBeUndefined()
    expect(allocateModuleMaterialChars([{ contextWindow: 872000, outputTokenLimit: 128000 }, {}], '')).toBeUndefined()
  })
  it('accounts for multibyte text, tool schemas and images before dispatch', () => {
    const limits = { contextWindow: 200000, outputTokenLimit: 128000 }
    expect(() => assertNativeModuleContext(limits, 'x'.repeat(30000), '{}', [])).not.toThrow()
    expect(() => assertNativeModuleContext(limits, '中'.repeat(30000), '{}', [])).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
    expect(() => assertNativeModuleContext(limits, 'x'.repeat(30000), 'schema'.repeat(8000), [])).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
    expect(() => assertNativeModuleContext(limits, 'x'.repeat(30000), '{}', Array.from({ length: 16 }, () => ({ type: 'image' })))).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
  })
  it('preserves configured output reservation even when that leaves no usable input', () => {
    expect(() => assertNativeModuleContext({ contextWindow: 128000, outputTokenLimit: 128000 }, 'task', '{}', [])).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
  })
  it('leaves room for the sixteen source images and correction when selecting material', () => {
    const limits = { contextWindow: 872000, outputTokenLimit: 128000 }
    const blocks = [...Array.from({ length: 16 }, () => ({ type: 'image' })), { type: 'text', text: '图像来源说明'.repeat(256) }]
    const fixed = '规'.repeat(10000), schema = 'schema '.repeat(32000), correction = '校'.repeat(12000)
    const withoutImages = allocateModuleMaterialChars([limits], fixed)!
    expect(() => assertNativeModuleContext(limits, fixed + '材'.repeat(withoutImages) + correction, schema, blocks)).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
    const withImages = allocateModuleMaterialChars([limits], fixed, blocks)!
    const checked = assertNativeModuleContext(limits, fixed + '材'.repeat(withImages) + correction, schema, blocks)
    expect(checked!.outputReservedTokens).toBe(128000)
    expect(checked!.estimatedInputTokens + checked!.outputReservedTokens).toBeLessThanOrEqual(limits.contextWindow)
  })
  it('rejects source images that exhaust the available route before selecting text', () => {
    expect(() => allocateModuleMaterialChars([{ contextWindow: 200000, outputTokenLimit: 128000 }], '',
      Array.from({ length: 16 }, () => ({ type: 'image' })))).toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
  })
  it('reserves the complete native schema before material, preceding groups and correction consume the remaining capacity', () => {
    const limits = { contextWindow: 872000, outputTokenLimit: 128000 }
    const blocks = [...Array.from({ length: 16 }, () => ({ type: 'image' })), { type: 'text', text: '图像来源说明'.repeat(256) }]
    const fixed = '规'.repeat(10000), schema = 's'.repeat(246227)
    const precedingAndCorrection = '已'.repeat(8000) + '纠'.repeat(15000)
    const oldCapacity = allocateModuleMaterialChars([limits], fixed, blocks)!
    expect(() => assertNativeModuleContext(limits, fixed + '材'.repeat(oldCapacity) + precedingAndCorrection, schema, blocks))
      .toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
    const capacity = allocateModuleMaterialChars([limits], fixed, blocks, schema)!
    const budget = assertNativeModuleContext(limits, fixed + '材'.repeat(capacity) + precedingAndCorrection, schema, blocks)!
    expect(budget.outputReservedTokens).toBe(128000)
    expect(budget.estimatedInputTokens + budget.outputReservedTokens).toBeLessThanOrEqual(872000)
  })
  it('rejects an authorized route whose complete native schema already exhausts its source allowance', () => {
    expect(() => allocateModuleMaterialChars([{ contextWindow: 200000, outputTokenLimit: 128000 }], '', [], 's'.repeat(80000)))
      .toThrow('MODULE_MODEL_CONTEXT_BUDGET_EXCEEDED')
  })
})
