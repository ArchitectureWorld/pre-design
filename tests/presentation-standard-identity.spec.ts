import { describe, expect, it } from 'vitest'
import { isStableId, type StableIdKind } from '@architectureworld/presentation-contracts'
import { PresentationStableIdLedger } from '../src/presentation/identity-ledger.ts'

const KINDS: readonly StableIdKind[] = [
  'project',
  'projectRules',
  'outlineDocument',
  'outlineNode',
  'page',
  'draftDocument',
  'contentBlock',
  'listItem',
  'metric',
  'tableRow',
  'tableColumn',
  'tableCell',
  'scriptBlock',
  'pageAsset',
  'sourceMaterial',
  'asset',
]

describe('Presentation stable identity ledger', () => {
  it('creates every identity through the official typed UUIDv7 factory', () => {
    const ledger = new PresentationStableIdLedger()
    for (const kind of KINDS) {
      const id = ledger.resolve(kind, `fixture:${kind}:stable-business-key`)
      expect(isStableId(kind, id)).toBe(true)
      expect(ledger.resolve(kind, `fixture:${kind}:stable-business-key`)).toBe(id)
    }
  })

  it('rehydrates persisted mappings without changing IDs', () => {
    const first = new PresentationStableIdLedger()
    const projectId = first.resolve('project', 'project:preplan-project-campus-renewal')
    const pageId = first.resolve('page', 'finding:diagnosis')
    const titleBlockId = first.resolve('contentBlock', 'finding:diagnosis:block:title')

    const restored = new PresentationStableIdLedger(first.snapshot())
    expect(restored.resolve('project', 'project:preplan-project-campus-renewal')).toBe(projectId)
    expect(restored.resolve('page', 'finding:diagnosis')).toBe(pageId)
    expect(restored.resolve('contentBlock', 'finding:diagnosis:block:title')).toBe(titleBlockId)
    expect(restored.snapshot()).toEqual(first.snapshot())
  })

  it('can bind duplicate source keys to one content-identity record', () => {
    const ledger = new PresentationStableIdLedger()
    const primary = ledger.resolve('sourceMaterial', 'source:upload:primary')
    expect(ledger.alias('sourceMaterial', 'source:upload:duplicate', 'source:upload:primary')).toBe(primary)
    expect(ledger.resolve('sourceMaterial', 'source:upload:duplicate')).toBe(primary)
  })

  it('rejects empty keys, kind mismatches and conflicting persisted entries', () => {
    const ledger = new PresentationStableIdLedger()
    expect(() => ledger.resolve('page', '   ')).toThrow('PRESENTATION_STABLE_ID_KEY_INVALID')
    const pageId = ledger.resolve('page', 'finding:diagnosis')
    expect(() => new PresentationStableIdLedger({
      'asset:visual:diagnosis': pageId,
    })).toThrow('PRESENTATION_STABLE_ID_KIND_MISMATCH')
    expect(() => new PresentationStableIdLedger({
      'page:finding:diagnosis': pageId,
      'page:finding:baseline': pageId,
    })).toThrow('PRESENTATION_STABLE_ID_DUPLICATE')
  })
})
