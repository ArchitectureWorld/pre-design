import { describe, expect, it } from 'vitest'
import { sourceScalarGuidance } from '../src/research-v2/source-scalar-guidance.ts'

describe('bounded rejected-source scalar diagnostics', () => {
  it('escapes original field names, preserves zero/false/null and never copies draft values', () => {
    const value = { 'a/b~c': [0, false, null, 'historical-draft-only'] }, original = structuredClone(value)
    const message = sourceScalarGuidance(value), detail = JSON.parse(message.slice(2))
    expect(detail.sourceLeafPaths).toEqual([
      { at: '/a~1b~0c/0', valueType: 'number' }, { at: '/a~1b~0c/1', valueType: 'boolean' },
      { at: '/a~1b~0c/2', valueType: 'null' }, { at: '/a~1b~0c/3', valueType: 'string' },
    ])
    expect(detail.complete).toBe(true)
    expect(message).not.toContain('historical-draft-only'); expect(value).toEqual(original)
  })
  it('bounds large geometries and explicitly marks omitted paths without accepting the candidate', () => {
    const coordinates = Array.from({ length: 10000 }, (_, i) => [i, i]), value = { coordinates }
    const message = sourceScalarGuidance(value), detail = JSON.parse(message.slice(2))
    expect(detail.sourceLeafPaths.length).toBeLessThanOrEqual(16)
    expect(detail.complete).toBe(false)
    expect(message.length).toBeLessThan(2400)
    expect(detail.boundary).toContain('Omitted paths are not accepted')
    expect(coordinates).toHaveLength(10000)
  })
})
