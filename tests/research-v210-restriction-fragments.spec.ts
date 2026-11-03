import { describe, expect, it } from 'vitest'
import { moduleReferencePromptView, expandModuleReferencePromptView } from '../src/research-v2/module-reference-context.ts'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'

const clauses = [
  '公开资料记载历史规划目标；不能证明当期人口、建设完成、场地适用性或已经取得许可。'.repeat(4),
  '入口、边界及通行状态仍须回到同一对象的有效原件；照片相机机位不得替代地物几何。'.repeat(4),
  '规模字段中的约、余、规划与统计口径必须保留；不得通过取整或省略限定词制造精确事实。'.repeat(4),
]
function reference() {
  return { upstream: Array.from({ length: 30 }, (_, index) => ({
    claimId: `claim-${index.toString(16).padStart(32, '0')}`,
    limitations: [`claim-${index.toString(16).padStart(32, '0')} [source_conclusion]: ${clauses[index % 3]}；${clauses[(index + 1) % 3]}\n记录${index}仍未核验。`],
  })), quote: '独立原文；标点和换行\n须逐字保留。' }
}

describe('lossless composite restriction transport', () => {
  it('shares repeated clauses within distinct restrictions without losing addresses, qualifiers, punctuation or order', () => {
    const original = reference(), before = structuredClone(original), view = moduleReferencePromptView(original)
    expect(JSON.stringify(view).length).toBeLessThan(JSON.stringify(original).length * 0.8)
    expect(expandModuleReferencePromptView(view)).toEqual(before)
    expect(sha256CanonicalJson(expandModuleReferencePromptView(view))).toBe(sha256CanonicalJson(before))
    expect(original).toEqual(before)
  })

  it('rejects altered composite fragments and retains the original two-part text wire', () => {
    const original = reference(), view: any = structuredClone(moduleReferencePromptView(original))
    const legacy = { encoding: 'research-reference.v1', stringKey: '@S', rowKey: '@R', textKey: '@T',
      strings: ['原文条件。'], columns: [], data: { limitations: [{ '@T': ['原地址: ', { '@S': 0 }] }] },
      originalHash: sha256CanonicalJson({ limitations: ['原地址: 原文条件。'] }), originalChars: JSON.stringify({ limitations: ['原地址: 原文条件。'] }).length }
    expect(expandModuleReferencePromptView(legacy)).toEqual({ limitations: ['原地址: 原文条件。'] })
    view.strings[0] += '已核验'
    expect(() => expandModuleReferencePromptView(view)).toThrow('MODULE_REFERENCE_CONTEXT_INVALID')
  })
})
