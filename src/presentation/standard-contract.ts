import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import * as PresentationContract from '@architectureworld/presentation-contracts'
import type {
  CanonicalDocument,
  DocumentType,
  ProjectDirectoryPlan,
  ProjectId,
  StableIdKind,
} from '@architectureworld/presentation-contracts'
import type { PresentationStandardContractAdapter } from './standard-project-types.ts'

export interface PresentationStandardContractLock {
  readonly schemaVersion: 1
  readonly standardName: 'Presentation Standard Project Directory'
  readonly standardVersion: '0.1.0'
  readonly authorityRepository: 'ArchitectureWorld/presentation-tools'
  readonly sourceCommitSHA: '974668d308728386ea005c9e77d58ebff9372f0a'
  readonly contractRoot: 'contracts/presentation-standard-project'
  readonly packageName: '@architectureworld/presentation-contracts'
  readonly packageVersion: '0.1.0'
  readonly schemaSetSha256: '5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc'
  readonly minimumNodeVersion: '22.0.0'
  readonly successMarker: 'PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS'
  readonly schemaAuthorityExclusions: readonly ['feat/report-studio-v0.1.1-hardening']
}

export const PRESENTATION_STANDARD_CONTRACT_LOCK: PresentationStandardContractLock = Object.freeze({
  schemaVersion: 1,
  standardName: 'Presentation Standard Project Directory',
  standardVersion: '0.1.0',
  authorityRepository: 'ArchitectureWorld/presentation-tools',
  sourceCommitSHA: '974668d308728386ea005c9e77d58ebff9372f0a',
  contractRoot: 'contracts/presentation-standard-project',
  packageName: '@architectureworld/presentation-contracts',
  packageVersion: '0.1.0',
  schemaSetSha256: '5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc',
  minimumNodeVersion: '22.0.0',
  successMarker: 'PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS',
  schemaAuthorityExclusions: ['feat/report-studio-v0.1.1-hardening'],
})

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`)
}

export function assertPresentationContractCoordinates(
  candidate: Readonly<Record<string, unknown>>,
): asserts candidate is PresentationStandardContractLock {
  const expected = PRESENTATION_STANDARD_CONTRACT_LOCK
  for (const key of [
    'schemaVersion',
    'standardName',
    'standardVersion',
    'authorityRepository',
    'sourceCommitSHA',
    'contractRoot',
    'packageName',
    'packageVersion',
    'schemaSetSha256',
    'minimumNodeVersion',
    'successMarker',
  ] as const) {
    if (candidate[key] !== expected[key]) {
      fail(
        'PRESENTATION_CONTRACT_COORDINATE_MISMATCH',
        `${key} must be '${String(expected[key])}', received '${String(candidate[key])}'`,
      )
    }
  }
  const exclusions = candidate.schemaAuthorityExclusions
  if (!Array.isArray(exclusions)
    || exclusions.length !== 1
    || exclusions[0] !== expected.schemaAuthorityExclusions[0]) {
    fail(
      'PRESENTATION_CONTRACT_COORDINATE_MISMATCH',
      'schema authority exclusion must reject the Report Studio hardening branch',
    )
  }
}

const require = createRequire(import.meta.url)

export function presentationContractPackageRoot(): string {
  return dirname(require.resolve('@architectureworld/presentation-contracts/package.json'))
}

let cached: Promise<PresentationStandardContractAdapter> | undefined

export function getPresentationStandardContract(): Promise<PresentationStandardContractAdapter> {
  cached ??= createAdapter()
  return cached
}

async function createAdapter(): Promise<PresentationStandardContractAdapter> {
  const lock = PRESENTATION_STANDARD_CONTRACT_LOCK
  if (PresentationContract.STANDARD_NAME !== lock.standardName
    || PresentationContract.STANDARD_VERSION !== lock.standardVersion
    || PresentationContract.PACKAGE_NAME !== lock.packageName) {
    fail(
      'PRESENTATION_CONTRACT_COORDINATE_MISMATCH',
      'installed Contract identity does not match the fixed lock',
    )
  }

  const schemaSet = await PresentationContract.verifySchemaSetHash()
  if (!schemaSet.valid
    || schemaSet.expectedSha256 !== lock.schemaSetSha256
    || schemaSet.actualSha256 !== lock.schemaSetSha256) {
    fail(
      'PRESENTATION_CONTRACT_SCHEMASET_MISMATCH',
      `expected '${lock.schemaSetSha256}', received '${schemaSet.actualSha256}'`,
    )
  }

  const adapter: PresentationStandardContractAdapter = {
    standardName: lock.standardName,
    standardVersion: lock.standardVersion,
    schemaSetSha256: lock.schemaSetSha256,
    createId(kind: StableIdKind): string {
      return PresentationContract.createStableId(kind)
    },
    isId(kind: StableIdKind, value: unknown): boolean {
      return PresentationContract.isStableId(kind, value)
    },
    createProjectDirectoryPlan(input): ProjectDirectoryPlan {
      return PresentationContract.createProjectDirectoryPlan(input as Parameters<typeof PresentationContract.createProjectDirectoryPlan>[0])
    },
    async validateDocument(document: CanonicalDocument) {
      return PresentationContract.validateDocumentWithAjv(
        document.documentType as DocumentType,
        document,
      )
    },
    validateProject(projectRoot: string) {
      return PresentationContract.validateProjectDirectoryWithAjv(projectRoot)
    },
  }
  return Object.freeze(adapter)
}

export function assertPresentationProjectId(value: unknown): asserts value is ProjectId {
  if (!PresentationContract.isStableId('project', value)) {
    fail('PRESENTATION_PROJECT_ID_INVALID', 'projectId must use the official project_<UUIDv7> format')
  }
}
