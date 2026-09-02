import { isAbsolute, win32 } from 'node:path'

export type PresentationDirectoryState =
  | 'awaiting_contract'
  | 'creating'
  | 'ready'
  | 'recovery_required'

export interface PresentationProjectBindingRecord {
  readonly preDesignProjectId: string
  readonly presentationProjectId?: string
  readonly directoryRoot?: string
  readonly standardVersion?: string
  readonly state: PresentationDirectoryState
  readonly lastExportedPreDesignRevision?: number
  readonly lastExportedAt?: string
  readonly lastExportedObjectHashes: Readonly<Record<string, string>>
  readonly createdAt: string
  readonly updatedAt: string
}

export interface CreateAwaitingPresentationBindingInput {
  readonly preDesignProjectId: string
  readonly createdAt: string
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== ''
}

function isPortableAbsolutePath(value: string): boolean {
  return isAbsolute(value) || win32.isAbsolute(value)
}

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`)
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
    lastExportedObjectHashes: Object.freeze({}),
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

  for (const [objectId, hash] of Object.entries(record.lastExportedObjectHashes)) {
    if (objectId.trim() === '' || !SHA256_PATTERN.test(hash)) {
      fail(
        'PRESENTATION_BINDING_HASH_INVALID',
        `invalid exported object hash for '${objectId}'`,
      )
    }
  }

  if (record.state === 'awaiting_contract') {
    if (record.presentationProjectId !== undefined
      || record.directoryRoot !== undefined
      || record.standardVersion !== undefined) {
      fail(
        'PRESENTATION_BINDING_AWAITING_CONTRACT_DIRTY',
        'awaiting-contract bindings cannot guess Presentation identity, directory or version',
      )
    }
    return record
  }

  if (!nonEmpty(record.presentationProjectId)
    || !nonEmpty(record.directoryRoot)
    || !nonEmpty(record.standardVersion)) {
    const code = record.state === 'ready'
      ? 'PRESENTATION_BINDING_READY_INCOMPLETE'
      : 'PRESENTATION_BINDING_CONTRACT_FIELDS_REQUIRED'
    fail(code, `${record.state} binding requires Presentation identity, directory and version`)
  }

  if (!isPortableAbsolutePath(record.directoryRoot)) {
    fail(
      'PRESENTATION_BINDING_DIRECTORY_NOT_ABSOLUTE',
      'directoryRoot must be an absolute host path kept outside Canonical project files',
    )
  }

  return record
}
