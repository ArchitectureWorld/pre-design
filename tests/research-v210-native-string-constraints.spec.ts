import { describe, expect, it } from 'vitest'
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { getModuleAuthorExecutionFieldGroups, getModuleAuthorGroupSchema, getModuleAuthorGroupOutputSchemaPrompt, validateModuleAuthorGroup } from '../src/research-v2/module-author-groups.ts'
import { getModuleOutputSchema } from '../src/research-v2/module-contracts.ts'
import { materialCorpusFingerprint } from '../src/materials/research-evidence.ts'
import { sha256CanonicalJson as hash } from '../src/presentation/canonical-json.ts'

const empty = { documents: [], limitations: [] }
const corpus = { ...empty, fingerprint: materialCorpusFingerprint(empty) }
function draft(group: any): any {
  return { projectionVersion: 'module-author-field-group.v16', groupId: group.groupId,
    outputs: { peer_products: { type: 'planning.peer_products.v1.2', quality: 'limited', scope: 'Synthetic identifier regression', asOf: '2026-10-04', limitations: ['Synthetic only'],
      records: ['original-03', 'original-04'].map(recordId => ({ recordId, resultClass: 'observation_summary',
        ...Object.fromEntries(group.fields.map((field: string) => [field, { value: null, claimClass: 'missing', limitations: ['No verified input'] }])) })) } },
    evidence: [], limitations: ['Synthetic only'], stepResults: Object.fromEntries([1, 2, 3, 4].map(step => ['step' + step,
      { status: 'limited', summary: 'No verified input', fieldRefs: [], limitations: ['No verified input'] }])) }
}

describe('native author string constraints retain the central contract', () => {
  it('delivers the formal identifier pattern and meaning in supported native descriptions', () => {
    const first = draft(getModuleAuthorExecutionFieldGroups('3.05')[0]), groups = getModuleAuthorExecutionFieldGroups('3.05', [first]), group = groups[1]
    const source: any = getModuleOutputSchema('3.05'), schema: any = getModuleAuthorGroupSchema('3.05', group.groupId, [first])
    const original = source.properties.peer_products.properties.records.items.properties.formatId.anyOf.find((branch: any) => branch.properties.claimClass.enum).properties.value
    const field = schema.properties.outputs.properties.peer_products.properties.records.items.properties.formatId
    const native = field.properties.value.oneOf.find((branch: any) => branch.type === 'string')
    expect(native.description).toContain(original.pattern)
    expect(native).not.toHaveProperty('pattern') // The DSH subset cannot validate this keyword.
    expect(field.description).toContain('机器关联标识')
    expect(field.description).toContain('decision+proposal')
    expect(field.description).toContain('missing/null')
    expect(getModuleAuthorGroupOutputSchemaPrompt('3.05', group.groupId, [first])).toContain(original.pattern)
    expect(() => assertObjectJsonSchema(schema)).not.toThrow()
  })

  it('still rejects prose in formatId without changing the native draft or the frozen identity group', () => {
    const first = draft(getModuleAuthorExecutionFieldGroups('3.05')[0]), group = getModuleAuthorExecutionFieldGroups('3.05', [first])[1], rejected = draft(group)
    rejected.outputs.peer_products.records[0].formatId = { value: '多功能旅游胜地', claimClass: 'source_conclusion', limitations: ['Literal source label is not an identifier'] }
    const original = hash(rejected), anchor = hash(first)
    expect(() => validateModuleAuthorGroup('3.05', rejected, [first], corpus)).toThrow(/MODULE_PROJECTION_OUTPUT_INVALID:.*formatId.value.*pattern/)
    expect(hash(rejected)).toBe(original)
    expect(hash(first)).toBe(anchor)
    rejected.outputs.peer_products.records[0].formatId = { value: null, claimClass: 'missing', limitations: ['Identifier is unsupported'] }
    expect(validateModuleAuthorGroup('3.05', rejected, [first], corpus)).toEqual(rejected)
  })
})
