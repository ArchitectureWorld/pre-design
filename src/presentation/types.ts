import { isAbsolute, win32 } from 'node:path'
import { isStableId } from '@architectureworld/presentation-contracts'
import { PresentationStableIdLedger } from './identity-ledger.ts'

export type PresentationDirectoryState =
  | 'awaiting_contract'
  | 'creating'
  | 'ready'
  | 'recovery_required'

export interface PresentationBindingFailure {
  readonly code: string
  readonly stage: string
  readonly message: string
  readonly failedAt: string
}

export interface PresentationProjectBindingRecord {
  readonly preDesignProjectId: string
  readonly presentationProjectId?: string
  readonly projectSlug?: string
  readonly directoryRoot?: string
  readonly standardVersion?: string
  readonly state: PresentationDirectoryState
  readonly stableIds: Readonly<Record<string, string>>
  readonly lastExportedPreDesignRevision?: number
  readonly lastExportedAt?: string
  readonly lastExportedObjectHashes: Readonly<Record<string, string>>
  readonly lastExportedFileHashes: Readonly<Record<string, string>>
  readonly lastFailure?: PresentationBindingFailure
  readonly createdAt: string
  readonly updatedAt: string
}

export interface CreateAwaitingPresentationBindingInput {
  readonly preDesignProjectId: string
  readonly createdAt: string
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const PROJECT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== ''
}

function isPortableAbsolutePath(value: string): boolean {
  return isAbsolute(value) || win32.isAbsolute(value)
}

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`)
}

function assertHashMap(name: string, values: Readonly<Record<string, string>>): void {
  for (const [key, hash] of Object.entries(values)) {
    if (key.trim() === '' || !SHA256_PATTERN.test(hash)) {
      fail('PRESENTATION_BINDING_HASH_INVALID', `invalid ${name} hash for '${key}'`)
    }
  }
}

export function createAwaitingPresentationBinding(
  input: CreateAwaitingPresentationBindingInput,
): PresentationProjectBindingRecord {
  if (!nonEmpty(input.preDesignProjectId)) {
    fail('PRESENTATION_BINDING_PROJECT_ID_REQUIRED', 'preDesignProjectId is required')
  }
  if (!nonEmpty(input.createdAt)) {
    fail('PRESENTATION_BINDING_TIMESTAMP_REQUIRED', 'createdAt is required')
  }

  return Object.freeze({
    preDesignProjectId: input.preDesignProjectId,
    state: 'awaiting_contract' as const,
    stableIds: Object.freeze({}),
    lastExportedObjectHashes: Object.freeze({}),
    lastExportedFileHashes: Object.freeze({}),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  })
}

export function assertPresentationBinding(
  record: PresentationProjectBindingRecord,
): PresentationProjectBindingRecord {
  if (!nonEmpty(record.preDesignProjectId)) {
    fail('PRESENTATION_BINDING_PROJECT_ID_REQUIRED', 'preDesignProjectId is required')
  }
  if (!nonEmpty(record.createdAt) || !nonEmpty(record.updatedAt)) {
    fail('PRESENTATION_BINDING_TIMESTAMP_REQUIRED', 'createdAt and updatedAt are required')
  }

  if (record.lastExportedPreDesignRevision !== undefined
    && (!Number.isInteger(record.lastExportedPreDesignRevision)
      || record.lastExportedPreDesignRevision < 0)) {
    fail(
      'PRESENTATION_BINDING_REVISION_INVALID',
      'lastExportedPreDesignRevision must be a non-negative integer',
    )
  }

  assertHashMap('object', record.lastExportedObjectHashes)
  assertHashMap('file', record.lastExportedFileHashes)
  try {
    new PresentationStableIdLedger(record.stableIds)
  } catch (error) {
    fail(
      'PRESENTATION_BINDING_STABLE_IDS_INVALID',
      error instanceof Error ? error.message : String(error),
    )
  }

  if (record.lastFailure !== undefined) {
    if (!nonEmpty(record.lastFailure.code)
      || !nonEmpty(record.lastFailure.stage)
      || !nonEmpty(record.lastFailure.message)
      || !nonEmpty(record.lastFailure.failedAt)) {
      fail('PRESENTATION_BINDING_FAILURE_INVALID', 'lastFailure must be structurally complete')
    }
  }

  if (record.state === 'awaiting_contract') {
    if (record.presentationProjectId !== undefined
      || record.projectSlug !== undefined
      || record.directoryRoot !== undefined
      || record.standardVersion !== undefined
      || Object.keys(record.stableIds).length > 0) {
      fail(
        'PRESENTATION_BINDING_AWAITING_CONTRACT_DIRTY',
        'awaiting-contract bindings cannot contain Contract-backed identity or directory fields',
      )
    }
    return record
  }

  if (!nonEmpty(record.presentationProjectId)
    || !nonEmpty(record.projectSlug)
    || !nonEmpty(record.directoryRoot)
    || !nonEmpty(record.standardVersion)) {
    const code = record.state === 'ready'
      ? 'PRESENTATION_BINDING_READY_INCOMPLETE'
      : 'PRESENTATION_BINDING_CONTRACT_FIELDS_REQUIRED'
    fail(code, `${record.state} binding requires Presentation identity, slug, directory and version`)
  }

  if (!isStableId('project', record.presentationProjectId)) {
    fail('PRESENTATION_BINDING_PROJECT_ID_INVALID', 'presentationProjectId must use the official project UUIDv7 format')
  }
  if (!PROJECT_SLUG_PATTERN.test(record.projectSlug)) {
    fail('PRESENTATION_BINDING_PROJECT_SLUG_INVALID', `invalid projectSlug '${record.projectSlug}'`)
  }
  if (record.standardVersion !== '0.1.0') {
    fail('PRESENTATION_BINDING_STANDARD_VERSION_INVALID', 'standardVersion must be 0.1.0')
  }
  if (!isPortableAbsolutePath(record.directoryRoot)) {
    fail(
      'PRESENTATION_BINDING_DIRECTORY_NOT_ABSOLUTE',
      'directoryRoot must be an absolute host path kept outside Canonical project files',
    )
  }

  return record
}
