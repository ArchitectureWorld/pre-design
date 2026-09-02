import { describe, expect, it } from 'vitest'
import {
  applySuccessfulExportLedger,
  planProjectionUpdate,
} from '../src/presentation/update-plan.ts'
import { sha256CanonicalJson } from '../src/presentation/canonical-json.ts'

const hash = (value: unknown) => sha256CanonicalJson(value)

describe('contract-neutral projection update planning', () => {
  it('classifies create, update and unchanged objects deterministically', () => {
    const previous = {
      page_update: hash({ title: 'old' }),
      page_unchanged: hash({ title: 'same' }),
    }
    const current = { ...previous }
    const result = planProjectionUpdate({
      previousExportHashes: previous,
      currentObjectHashes: current,
      incomingObjects: {
        page_unchanged: { title: 'same' },
        page_create: { title: 'new' },
        page_update: { title: 'changed' },
      },
    })

    expect(result).toEqual({
      createdIds: ['page_create'],
      updatedIds: ['page_update'],
      unchangedIds: ['page_unchanged'],
      reviewRequiredIds: [],
      retainedIds: [],
      incomingHashes: {
        page_create: hash({ title: 'new' }),
        page_unchanged: hash({ title: 'same' }),
        page_update: hash({ title: 'changed' }),
      },
    })
  })

  it('requires review when an exported object was externally changed or deleted', () => {
    const previous = {
      page_changed: hash({ title: 'pre-design output' }),
      page_deleted: hash({ title: 'pre-design output 2' }),
    }
    const result = planProjectionUpdate({
      previousExportHashes: previous,
      currentObjectHashes: {
        page_changed: hash({ title: 'edited by another actor' }),
      },
      incomingObjects: {
        page_changed: { title: 'new pre-design output' },
        page_deleted: { title: 'new pre-design output 2' },
      },
    })

    expect(result.createdIds).toEqual([])
    expect(result.updatedIds).toEqual([])
    expect(result.reviewRequiredIds).toEqual(['page_changed', 'page_deleted'])
  })

  it('does not claim or overwrite an existing object absent from the previous export ledger', () => {
    const result = planProjectionUpdate({
      previousExportHashes: {},
      currentObjectHashes: {
        page_existing: hash({ title: 'owned elsewhere' }),
      },
      incomingObjects: {
        page_existing: { title: 'pre-design candidate' },
      },
    })

    expect(result.reviewRequiredIds).toEqual(['page_existing'])
    expect(result.createdIds).toEqual([])
  })

  it('retains previously exported objects that are absent from the new projection', () => {
    const previous = {
      page_retained: hash({ title: 'old projection' }),
      page_still_here: hash({ title: 'same' }),
    }
    const result = planProjectionUpdate({
      previousExportHashes: previous,
      currentObjectHashes: { ...previous },
      incomingObjects: {
        page_still_here: { title: 'same' },
      },
    })

    expect(result.retainedIds).toEqual(['page_retained'])
    expect(result.reviewRequiredIds).toEqual([])
  })

  it('treats reordered object keys as unchanged but array order as semantic', () => {
    const previousValue = { z: 1, a: { b: 2 }, list: ['a', 'b'] }
    const previousHash = hash(previousValue)

    expect(planProjectionUpdate({
      previousExportHashes: { object_1: previousHash },
      currentObjectHashes: { object_1: previousHash },
      incomingObjects: {
        object_1: { list: ['a', 'b'], a: { b: 2 }, z: 1 },
      },
    }).unchangedIds).toEqual(['object_1'])

    expect(planProjectionUpdate({
      previousExportHashes: { object_1: previousHash },
      currentObjectHashes: { object_1: previousHash },
      incomingObjects: {
        object_1: { list: ['b', 'a'], a: { b: 2 }, z: 1 },
      },
    }).updatedIds).toEqual(['object_1'])
  })

  it('advances the export ledger only for successful non-conflicting objects', () => {
    const previous = {
      page_conflict: hash({ title: 'previous' }),
      page_retained: hash({ title: 'retained' }),
    }
    const plan = planProjectionUpdate({
      previousExportHashes: previous,
      currentObjectHashes: {
        page_conflict: hash({ title: 'external' }),
        page_retained: previous.page_retained,
      },
      incomingObjects: {
        page_create: { title: 'created' },
        page_conflict: { title: 'candidate' },
      },
    })

    expect(applySuccessfulExportLedger(previous, plan)).toEqual({
      page_conflict: previous.page_conflict,
      page_create: hash({ title: 'created' }),
      page_retained: previous.page_retained,
    })
  })

  it('rejects malformed hashes and empty object identities', () => {
    expect(() => planProjectionUpdate({
      previousExportHashes: { object_1: 'not-a-hash' },
      currentObjectHashes: {},
      incomingObjects: {},
    })).toThrow('PRESENTATION_UPDATE_HASH_INVALID')

    expect(() => planProjectionUpdate({
      previousExportHashes: {},
      currentObjectHashes: {},
      incomingObjects: { '': { title: 'invalid' } },
    })).toThrow('PRESENTATION_UPDATE_OBJECT_ID_REQUIRED')
  })
})
