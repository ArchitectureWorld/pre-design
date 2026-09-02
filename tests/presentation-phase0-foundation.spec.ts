import { describe, expect, it } from 'vitest'
import {
  assertPresentationBinding,
  createAwaitingPresentationBinding,
  type PresentationProjectBindingRecord,
} from '../src/presentation/types.ts'
import {
  canonicalizeJson,
  sha256CanonicalJson,
} from '../src/presentation/canonical-json.ts'
import {
  assertPortableRelativePath,
  normalizeProjectSlug,
} from '../src/presentation/path-policy.ts'
import {
  assertPresentationContractReady,
  type PresentationFormatContract,
} from '../src/presentation/contract-port.ts'

const createdAt = '2026-09-02T13:00:00.000Z'

describe('Presentation Phase 0 foundation', () => {
  it('creates an awaiting-contract binding without guessing Presentation identity or version', () => {
    const binding = createAwaitingPresentationBinding({
      preDesignProjectId: 'preplan-00000000-0000-4000-8000-000000000001',
      createdAt,
    })

    expect(binding).toEqual({
      preDesignProjectId: 'preplan-00000000-0000-4000-8000-000000000001',
      state: 'awaiting_contract',
      lastExportedObjectHashes: {},
      createdAt,
      updatedAt: createdAt,
    })
    expect(binding).not.toHaveProperty('presentationProjectId')
    expect(binding).not.toHaveProperty('directoryRoot')
    expect(binding).not.toHaveProperty('standardVersion')
  })

  it('rejects a ready binding unless Presentation identity, directory and standard version are complete', () => {
    const incomplete: PresentationProjectBindingRecord = {
      preDesignProjectId: 'preplan-1',
      state: 'ready',
      lastExportedObjectHashes: {},
      createdAt,
      updatedAt: createdAt,
    }

    expect(() => assertPresentationBinding(incomplete))
      .toThrow('PRESENTATION_BINDING_READY_INCOMPLETE')
  })

  it('accepts a complete ready binding without changing its values', () => {
    const ready: PresentationProjectBindingRecord = {
      preDesignProjectId: 'preplan-1',
      presentationProjectId: 'presentation-project-1',
      directoryRoot: '/workspace/projects/presentation-project-1-campus-renewal',
      standardVersion: 'contract-test-version',
      state: 'ready',
      lastExportedObjectHashes: { page_1: 'a'.repeat(64) },
      createdAt,
      updatedAt: createdAt,
    }

    expect(assertPresentationBinding(ready)).toBe(ready)
  })

  it('canonicalizes object keys while preserving array order', () => {
    const first = { z: 1, a: { c: 3, b: 2 }, list: ['b', 'a'] }
    const reordered = { list: ['b', 'a'], a: { b: 2, c: 3 }, z: 1 }

    expect(canonicalizeJson(first)).toBe('{"a":{"b":2,"c":3},"list":["b","a"],"z":1}')
    expect(sha256CanonicalJson(first)).toBe(sha256CanonicalJson(reordered))
    expect(sha256CanonicalJson(first)).not.toBe(
      sha256CanonicalJson({ ...reordered, list: ['a', 'b'] }),
    )
  })

  it('rejects cycles, non-finite numbers and non-JSON values', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    expect(() => canonicalizeJson(cyclic))
      .toThrow('PRESENTATION_CANONICAL_JSON_CYCLE')
    expect(() => canonicalizeJson({ value: Number.NaN }))
      .toThrow('PRESENTATION_CANONICAL_JSON_UNSUPPORTED_NUMBER')
    expect(() => canonicalizeJson({ value: undefined }))
      .toThrow('PRESENTATION_CANONICAL_JSON_UNSUPPORTED_VALUE')
  })

  it('normalizes portable relative paths and rejects path escape forms', () => {
    expect(assertPortableRelativePath('source-materials/images/e\u0301.png'))
      .toBe('source-materials/images/é.png')

    for (const unsafe of [
      '/etc/passwd',
      'C:/temp/file.txt',
      '../outside.txt',
      'assets/../outside.txt',
      'assets\\image.png',
      'assets//image.png',
      'https://example.com/file.png',
      'assets/%2e%2e/file.png',
    ]) {
      expect(() => assertPortableRelativePath(unsafe), unsafe)
        .toThrow('PRESENTATION_PATH_NOT_PORTABLE')
    }
  })

  it('creates deterministic slugs without pretending to transliterate non-ASCII names', () => {
    expect(normalizeProjectSlug(' Campus Renewal / Phase 1 '))
      .toBe('campus-renewal-phase-1')

    const first = normalizeProjectSlug('武汉 城市更新')
    const second = normalizeProjectSlug('武汉 城市更新')
    expect(first).toBe(second)
    expect(first).toMatch(/^project-[a-f0-9]{12}$/)
  })

  it('fails closed until an explicit Presentation Contract is supplied', () => {
    expect(() => assertPresentationContractReady(undefined))
      .toThrow('PRESENTATION_CONTRACT_NOT_LOCKED')

    const contract = {
      standardName: 'test-contract',
      standardVersion: 'test-version',
      schemaSetSha256: 'b'.repeat(64),
      createId: () => 'test-id',
      createMinimalDocuments: () => ({}),
      validateDocument: () => [],
      validateProject: async () => ({ valid: true, errors: [] }),
    } satisfies PresentationFormatContract

    expect(assertPresentationContractReady(contract)).toBe(contract)
  })
})
