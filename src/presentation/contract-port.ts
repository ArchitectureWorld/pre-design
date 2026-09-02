export interface PresentationValidationIssue {
  readonly code: string
  readonly path: string
  readonly message?: string
}

export interface PresentationProjectValidation {
  readonly valid: boolean
  readonly errors: readonly PresentationValidationIssue[]
  readonly warnings?: readonly PresentationValidationIssue[]
}

export interface PresentationMinimalDocumentsInput {
  readonly presentationProjectId: string
  readonly preDesignProjectId: string
  readonly projectSlug: string
  readonly projectName: string
  readonly createdAt: string
}

export interface PresentationFormatContract {
  readonly standardName: string
  readonly standardVersion: string
  readonly schemaSetSha256: string
  createId(kind: string): string
  createMinimalDocuments(
    input: PresentationMinimalDocumentsInput,
  ): Readonly<Record<string, unknown>>
  validateDocument(
    kind: string,
    value: unknown,
  ): readonly PresentationValidationIssue[]
  validateProject(root: string): Promise<PresentationProjectValidation>
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`)
}

export function assertPresentationContractReady(
  contract: PresentationFormatContract | null | undefined,
): PresentationFormatContract {
  if (contract === undefined || contract === null) {
    fail(
      'PRESENTATION_CONTRACT_NOT_LOCKED',
      'an explicit, version-locked Presentation Contract is required',
    )
  }

  if (contract.standardName.trim() === ''
    || contract.standardVersion.trim() === ''
    || !SHA256_PATTERN.test(contract.schemaSetSha256)
    || typeof contract.createId !== 'function'
    || typeof contract.createMinimalDocuments !== 'function'
    || typeof contract.validateDocument !== 'function'
    || typeof contract.validateProject !== 'function') {
    fail(
      'PRESENTATION_CONTRACT_INVALID',
      'the supplied Presentation Contract is incomplete or not integrity-locked',
    )
  }

  return contract
}
