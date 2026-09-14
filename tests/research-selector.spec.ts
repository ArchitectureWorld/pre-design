import { describe, expect, it } from 'vitest'
import { applyResearchSelector } from '../src/research/selector.ts'

describe('Pre 2.0.1 field-level research selectors', () => {
  it('extracts a JSON Pointer value with an exact locator fragment', () => {
    const result = applyResearchSelector(
      '{"project":{"name":"武汉站改造","meta":{"stage":"方案"}}}',
      { project: { name: '武汉站改造', meta: { stage: '方案' } } },
      { type: 'json_pointer', pointer: '/project/name' },
    )

    expect(result).toEqual({
      rawValue: '武汉站改造',
      normalizedValue: '武汉站改造',
      locator: { selectorType: 'json_pointer', jsonPointer: '/project/name' },
    })
  })

  it('supports RFC6901 escape tokens and rejects a missing JSON Pointer', () => {
    const value = { 'a/b': { '~key': 42 } }
    expect(applyResearchSelector(JSON.stringify(value), value, {
      type: 'json_pointer', pointer: '/a~1b/~0key',
    }).normalizedValue).toBe(42)

    expect(() => applyResearchSelector(JSON.stringify(value), value, {
      type: 'json_pointer', pointer: '/missing',
    })).toThrow(/JSON Pointer.*not found/u)
  })

  it('extracts an inclusive 1-based text line range and records exact line numbers', () => {
    const result = applyResearchSelector('第一行\n第二行\n第三行\n第四行', '第一行\n第二行\n第三行\n第四行', {
      type: 'text_lines', startLine: 2, endLine: 3,
    })

    expect(result).toEqual({
      rawValue: '第二行\n第三行',
      normalizedValue: '第二行\n第三行',
      locator: { selectorType: 'text_lines', startLine: 2, endLine: 3 },
    })
  })

  it('fails closed for invalid or out-of-range text line selections', () => {
    expect(() => applyResearchSelector('one\ntwo', 'one\ntwo', {
      type: 'text_lines', startLine: 0, endLine: 1,
    })).toThrow(/positive integers/u)
    expect(() => applyResearchSelector('one\ntwo', 'one\ntwo', {
      type: 'text_lines', startLine: 2, endLine: 3,
    })).toThrow(/outside available text lines/u)
  })
})
