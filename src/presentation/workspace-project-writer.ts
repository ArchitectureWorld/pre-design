import { createHash } from 'node:crypto'
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  rm,
} from 'node:fs/promises'
import {
  dirname,
  isAbsolute,
  join,
  resolve,
  win32,
} from 'node:path'
import type { CanonicalDocument, ProjectValidationResult } from '@architectureworld/presentation-contracts'
import { canonicalizeJson } from './canonical-json.ts'
import { sha256File, writeCanonicalJsonAtomically } from './filesystem.ts'
import { getPresentationStandardContract } from './standard-contract.ts'
import {
  PresentationStandardProjectError,
  type PresentationStandardProjectStage,
} from './standard-project-error.ts'
import type {
  PresentationStandardProjectBuild,
  PresentationStandardProjectPublishResult,
  PresentationStandardProjectWriterHooks,
} from './standard-project-types.ts'
import { publishPresentationStandardProject } from './standard-project-writer.ts'
import { assertWorkspaceProjectId } from './workspace-project-identity.ts'
import {
  PRE_DESIGN_FIXED_MANAGED_PATHS,
  PRE_DESIGN_REQUIRED_DIRECTORIES,
  PRESENTATION_LAYOUTS_ROOT,
  managedPathSetFromBuild,
  normalizePreDesignManagedPath,
  readExistingPreDesignManagedPathSet,
  type PreDesignManagedPathSet,
} from './workspace-managed-paths.ts'
import {
  acquirePresentationWorkspaceTransaction,
  type WorkspaceWriteAction,
} from './workspace-write-transaction.ts'

export interface PublishPresentationStandardProjectIntoWorkspaceInput {
  readonly directoryRoot: string
  readonly build: PresentationStandardProjectBuild
  readonly operationId: string
  readonly expectedExistingFileHashes?: Readonly<Record<string, string>>
  readonly confirmExternalChanges?: boolean
  readonly hooks?: PresentationStandardProjectWriterHooks
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function absoluteDirectory(value: string): string {
  if (!isAbsolute(value) && !win32.isAbsolute(value)) {
    throw new PresentationStandardProjectError(
      'PRE_DESIGN_WORKSPACE_PATH_NOT_ABSOLUTE',
      'preflight',
      'Workspace project root must be an absolute path',
      { value },
    )
  }
  return resolve(value)
}

async function assertWorkspaceRoot(root: string): Promise<void> {
  const info = await lstat(root)
  if (info.isSymbolicLink()) {
    throw new PresentationStandardProjectError(
      'PRE_DESIGN_WORKSPACE_SYMLINK_FORBIDDEN',
      'preflight',
      'DSH Workspace root cannot be a symbolic link',
    )
  }
  if (!info.isDirectory()) {
    throw new PresentationStandardProjectError(
      'PRE_DESIGN_WORKSPACE_NOT_DIRECTORY',
      'preflight',
      'DSH Workspace root must be an existing directory',
    )
  }
}

function workspacePath(root: string, relativePath: string): string {
  return join(root, ...normalizePreDesignManagedPath(relativePath).split('/'))
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const MANIFEST_COLLECTIONS = Object.freeze({
  'source-materials/manifest.json': {
    collectionKey: 'materials',
    idKey: 'sourceMaterialId',
  },
  'assets/manifest.json': {
    collectionKey: 'assets',
    idKey: 'assetId',
  },
} as const)

type ManagedManifestPath = keyof typeof MANIFEST_COLLECTIONS

function manifestCollection(relativePath: string) {
  return Object.hasOwn(MANIFEST_COLLECTIONS, relativePath)
    ? MANIFEST_COLLECTIONS[relativePath as ManagedManifestPath]
    : undefined
}

function managedRecordPath(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.relativePath !== 'string') return undefined
  return normalizePreDesignManagedPath(value.relativePath)
}

function restrictExistingManagedPaths(
  discovered: PreDesignManagedPathSet,
  expectedHashes: Readonly<Record<string, string>> | undefined,
): PreDesignManagedPathSet {
  if (expectedHashes === undefined) return discovered
  const owned = new Set<string>(PRE_DESIGN_FIXED_MANAGED_PATHS)
  for (const relativePath of Object.keys(expectedHashes)) {
    owned.add(normalizePreDesignManagedPath(relativePath))
  }
  const retain = (relativePath: string) => owned.has(relativePath)
  return Object.freeze({
    all: Object.freeze(discovered.all.filter(retain)),
    canonicalJson: Object.freeze(discovered.canonicalJson.filter(retain)),
    payloadFiles: Object.freeze(discovered.payloadFiles.filter(retain)),
    manifestErrors: discovered.manifestErrors,
  })
}

function ownedManifestProjection(
  value: unknown,
  relativePath: string,
  ownedPaths: ReadonlySet<string>,
): unknown {
  const descriptor = manifestCollection(relativePath)
  if (descriptor === undefined || !isRecord(value)) return value
  const rows = value[descriptor.collectionKey]
  if (!Array.isArray(rows)) return value
  return {
    ...value,
    [descriptor.collectionKey]: rows.filter((row) => {
      const path = managedRecordPath(row)
      return path === undefined || ownedPaths.has(path)
    }),
  }
}

function mergeExternalManifestRecords(input: {
  readonly existing: unknown
  readonly candidate: unknown
  readonly merged: unknown
  readonly relativePath: string
  readonly ownedExistingPaths: ReadonlySet<string>
  readonly candidateManagedPaths: ReadonlySet<string>
}): { readonly document: unknown; readonly externalPayloadPaths: readonly string[] } {
  const descriptor = manifestCollection(input.relativePath)
  if (descriptor === undefined
    || !isRecord(input.existing)
    || !isRecord(input.candidate)
    || !isRecord(input.merged)) {
    return { document: input.merged, externalPayloadPaths: [] }
  }
  const existingRows = input.existing[descriptor.collectionKey]
  const candidateRows = input.candidate[descriptor.collectionKey]
  if (!Array.isArray(existingRows) || !Array.isArray(candidateRows)) {
    return { document: input.merged, externalPayloadPaths: [] }
  }

  const candidateIds = new Set(candidateRows.flatMap((row) => {
    if (!isRecord(row)) return []
    const id = row[descriptor.idKey]
    return typeof id === 'string' ? [id] : []
  }))
  const externalRows: unknown[] = []
  const externalPayloadPaths: string[] = []
  for (const row of existingRows) {
    const path = managedRecordPath(row)
    if (path === undefined || input.ownedExistingPaths.has(path)) continue
    const id = isRecord(row) ? row[descriptor.idKey] : undefined
    if (input.candidateManagedPaths.has(path)
      || (typeof id === 'string' && candidateIds.has(id))) {
      throw new PresentationStandardProjectError(
        'EXTERNAL_PATH_MODIFICATION_FORBIDDEN',
        'preflight',
        `candidate attempts to claim externally owned manifest record '${path}'`,
        { relativePath: input.relativePath, path, id },
      )
    }
    externalRows.push(row)
    externalPayloadPaths.push(path)
  }
  return {
    document: {
      ...input.merged,
      [descriptor.collectionKey]: [...candidateRows, ...externalRows],
    },
    externalPayloadPaths: Object.freeze(externalPayloadPaths),
  }
}

function stripAdditiveObjectKeys(existing: unknown, candidate: unknown): unknown {
  if (!isRecord(existing) || !isRecord(candidate)) return existing
  return Object.fromEntries(Object.keys(existing)
    .filter(key => Object.hasOwn(candidate, key))
    .sort((left, right) => left.localeCompare(right))
    .map(key => [key, stripAdditiveObjectKeys(existing[key], candidate[key])]))
}

function mergeCompatibleObjectKeys(existing: unknown, candidate: unknown): unknown {
  if (!isRecord(existing) || !isRecord(candidate)) return candidate
  const merged: Record<string, unknown> = {}
  for (const key of [...new Set([...Object.keys(existing), ...Object.keys(candidate)])]
    .sort((left, right) => left.localeCompare(right))) {
    merged[key] = Object.hasOwn(candidate, key)
      ? Object.hasOwn(existing, key)
        ? mergeCompatibleObjectKeys(existing[key], candidate[key])
        : candidate[key]
      : existing[key]
  }
  return merged
}

function sha256CanonicalDocument(value: unknown): string {
  return createHash('sha256')
    .update(`${canonicalizeJson(value)}\n`, 'utf8')
    .digest('hex')
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    return undefined
  }
}

async function collectExactHashes(
  root: string,
  relativePaths: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  const result: Record<string, string> = {}
  for (const relativePath of relativePaths) {
    const target = workspacePath(root, relativePath)
    if (!await exists(target)) continue
    const info = await lstat(target)
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new PresentationStandardProjectError(
        'MANAGED_PATH_VIOLATION',
        'preflight',
        `Pre-managed path '${relativePath}' must be a regular file`,
        { relativePath },
      )
    }
    result[relativePath] = await sha256File(target)
  }
  return Object.freeze(result)
}

async function validateExistingProject(
  root: string,
  hadProject: boolean,
  confirmExternalChanges: boolean,
): Promise<ProjectValidationResult | undefined> {
  if (!hadProject || confirmExternalChanges) return undefined
  const contract = await getPresentationStandardContract()
  const validation = await contract.validateProject(root)
  if (!validation.valid) {
    throw new PresentationStandardProjectError(
      'CONTRACT_VALIDATION_FAILED',
      'preflight',
      'Contract 0.1.0 rejected the existing shared Workspace before writing',
      validation,
    )
  }
  return validation
}

async function classifyExternalChanges(input: {
  readonly root: string
  readonly candidateRoot: string
  readonly allowedPaths: ReadonlySet<string>
  readonly canonicalPaths: ReadonlySet<string>
  readonly ownedExistingPaths: ReadonlySet<string>
  readonly actualHashes: Readonly<Record<string, string>>
  readonly expectedHashes?: Readonly<Record<string, string>>
  readonly confirmExternalChanges: boolean
}): Promise<void> {
  if (input.expectedHashes === undefined) return
  const changed = [...new Set([
    ...Object.keys(input.expectedHashes),
    ...Object.keys(input.actualHashes),
  ])]
    .filter(path => input.allowedPaths.has(path))
    .sort((left, right) => left.localeCompare(right))
    .filter(path => input.expectedHashes?.[path] !== input.actualHashes[path])

  const incompatible: string[] = []
  for (const relativePath of changed) {
    const expected = input.expectedHashes[relativePath]
    const actual = input.actualHashes[relativePath]
    if (expected !== undefined
      && actual !== undefined
      && input.canonicalPaths.has(relativePath)) {
      const existing = await readJson(workspacePath(input.root, relativePath))
      const candidate = await readJson(workspacePath(input.candidateRoot, relativePath))
      const ownedExisting = ownedManifestProjection(
        existing,
        relativePath,
        input.ownedExistingPaths,
      )
      if (existing !== undefined
        && candidate !== undefined
        && sha256CanonicalDocument(stripAdditiveObjectKeys(ownedExisting, candidate)) === expected) {
        continue
      }
    }
    incompatible.push(relativePath)
  }

  if (incompatible.length > 0 && !input.confirmExternalChanges) {
    throw new PresentationStandardProjectError(
      'PRESENTATION_EXTERNAL_CHANGE_REVIEW_REQUIRED',
      'preflight',
      'existing Workspace contains changes to Pre-managed files that are not compatible additive fields',
      {
        changedPaths: incompatible,
        expected: input.expectedHashes,
        actual: input.actualHashes,
      },
    )
  }
}

async function preserveCompatibleJsonExtensions(input: {
  readonly root: string
  readonly candidateRoot: string
  readonly canonicalPaths: readonly string[]
  readonly ownedExistingPaths: ReadonlySet<string>
  readonly candidateManagedPaths: ReadonlySet<string>
}): Promise<void> {
  const contract = await getPresentationStandardContract()
  const externalPayloadPaths = new Set<string>()
  for (const relativePath of input.canonicalPaths) {
    const existingPath = workspacePath(input.root, relativePath)
    if (!await exists(existingPath)) continue
    const existing = await readJson(existingPath)
    const candidatePath = workspacePath(input.candidateRoot, relativePath)
    const candidate = await readJson(candidatePath)
    if (existing === undefined || candidate === undefined) continue
    const mergedBase = mergeCompatibleObjectKeys(existing, candidate)
    const mergedResult = mergeExternalManifestRecords({
      existing,
      candidate,
      merged: mergedBase,
      relativePath,
      ownedExistingPaths: input.ownedExistingPaths,
      candidateManagedPaths: input.candidateManagedPaths,
    })
    const merged = mergedResult.document
    for (const path of mergedResult.externalPayloadPaths) externalPayloadPaths.add(path)
    const documentValidation = await contract.validateDocument(merged as CanonicalDocument)
    if (!documentValidation.valid) {
      throw new PresentationStandardProjectError(
        'CONTRACT_VALIDATION_FAILED',
        'validation',
        `compatible extension merge for '${relativePath}' violates Contract 0.1.0`,
        { relativePath, errors: documentValidation.errors },
      )
    }
    await writeCanonicalJsonAtomically(candidatePath, merged)
  }
  for (const relativePath of [...externalPayloadPaths].sort((left, right) => left.localeCompare(right))) {
    const source = workspacePath(input.root, relativePath)
    const target = workspacePath(input.candidateRoot, relativePath)
    const info = await lstat(source)
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new PresentationStandardProjectError(
        'CONTRACT_VALIDATION_FAILED',
        'validation',
        `externally owned manifest payload '${relativePath}' is not a regular file`,
        { relativePath },
      )
    }
    if (await exists(target)) {
      throw new PresentationStandardProjectError(
        'EXTERNAL_PATH_MODIFICATION_FORBIDDEN',
        'validation',
        `candidate staging path collides with externally owned payload '${relativePath}'`,
        { relativePath },
      )
    }
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target)
  }
  const validation = await contract.validateProject(input.candidateRoot)
  if (!validation.valid) {
    throw new PresentationStandardProjectError(
      'CONTRACT_VALIDATION_FAILED',
      'validation',
      'Contract 0.1.0 rejected the merged candidate shared Workspace project',
      validation,
    )
  }
}

async function missingStructuralDirectories(
  root: string,
  managedPaths: readonly string[],
): Promise<readonly string[]> {
  const directories = new Set<string>(PRE_DESIGN_REQUIRED_DIRECTORIES)
  for (const relativePath of managedPaths) {
    const parts = relativePath.split('/')
    for (let length = 1; length < parts.length; length += 1) {
      const directory = parts.slice(0, length).join('/')
      if (directory !== PRESENTATION_LAYOUTS_ROOT) directories.add(directory)
    }
  }

  const missing: string[] = []
  for (const relativeDirectory of [...directories]
    .sort((left, right) => left.split('/').length - right.split('/').length
      || left.localeCompare(right))) {
    const target = workspacePath(root, relativeDirectory)
    if (!await exists(target)) {
      missing.push(relativeDirectory)
      continue
    }
    const info = await lstat(target)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new PresentationStandardProjectError(
        'MANAGED_PATH_VIOLATION',
        'preflight',
        `required Pre directory '${relativeDirectory}' is not a regular directory`,
        { relativeDirectory },
      )
    }
  }
  return Object.freeze(missing)
}

async function shouldCreateLayoutsRoot(root: string): Promise<boolean> {
  const target = join(root, PRESENTATION_LAYOUTS_ROOT)
  if (!await exists(target)) return true
  const info = await lstat(target)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new PresentationStandardProjectError(
      'EXTERNAL_PATH_MODIFICATION_FORBIDDEN',
      'preflight',
      'Presentation-owned layouts path must remain an opaque regular directory',
      { path: PRESENTATION_LAYOUTS_ROOT },
    )
  }
  return false
}

function createWriteActions(input: {
  readonly currentHashes: Readonly<Record<string, string>>
  readonly candidateHashes: Readonly<Record<string, string>>
  readonly existingPaths: readonly string[]
  readonly candidatePaths: readonly string[]
}): readonly WorkspaceWriteAction[] {
  const existing = new Set(input.existingPaths)
  const candidate = new Set(input.candidatePaths)
  return Object.freeze([...new Set([...existing, ...candidate])]
    .sort((left, right) => left.localeCompare(right))
    .flatMap((relativePath): WorkspaceWriteAction[] => {
      if (!candidate.has(relativePath)) {
        return existing.has(relativePath) && input.currentHashes[relativePath] !== undefined
          ? [{ relativePath, kind: 'delete' }]
          : []
      }
      if (!existing.has(relativePath) || input.currentHashes[relativePath] === undefined) {
        return [{ relativePath, kind: 'create' }]
      }
      return input.currentHashes[relativePath] === input.candidateHashes[relativePath]
        ? []
        : [{ relativePath, kind: 'replace' }]
    }))
}

function candidateOperationId(operationId: string): string {
  return `workspace-${createHash('sha256').update(operationId).digest('hex').slice(0, 32)}`
}

function workspaceFailure(
  error: unknown,
  stage: PresentationStandardProjectStage,
): PresentationStandardProjectError {
  if (error instanceof PresentationStandardProjectError) return error
  return new PresentationStandardProjectError(
    'WORKSPACE_TRANSACTION_FAILED',
    stage,
    error instanceof Error ? error.message : String(error),
    undefined,
    error instanceof Error ? { cause: error } : undefined,
  )
}

export async function publishPresentationStandardProjectIntoWorkspace(
  input: PublishPresentationStandardProjectIntoWorkspaceInput,
): Promise<PresentationStandardProjectPublishResult> {
  let stage: PresentationStandardProjectStage = 'preflight'
  const directoryRoot = absoluteDirectory(input.directoryRoot)
  await assertWorkspaceRoot(directoryRoot)
  const candidatePaths = managedPathSetFromBuild(input.build)

  const transaction = await acquirePresentationWorkspaceTransaction(
    directoryRoot,
    input.operationId,
  )
  let committed = false

  try {
    const existingProjectId = await assertWorkspaceProjectId(directoryRoot, input.build.projectId)
    const discoveredExistingPaths = await readExistingPreDesignManagedPathSet(directoryRoot)
    const existingPaths = restrictExistingManagedPaths(
      discoveredExistingPaths,
      input.expectedExistingFileHashes,
    )
    if (discoveredExistingPaths.manifestErrors.length > 0
      && input.confirmExternalChanges !== true) {
      throw new PresentationStandardProjectError(
        'CONTRACT_VALIDATION_FAILED',
        'preflight',
        'existing shared Workspace contains unreadable Pre manifests',
        { errors: discoveredExistingPaths.manifestErrors },
      )
    }
    const hadManagedEntries = discoveredExistingPaths.all.length > 0
    if (hadManagedEntries
      && input.expectedExistingFileHashes === undefined
      && input.confirmExternalChanges !== true) {
      throw new PresentationStandardProjectError(
        'PRESENTATION_WORKSPACE_MANAGED_CONTENT_EXISTS',
        'preflight',
        'Workspace already contains Pre Canonical paths without a managed export ledger; explicit --force is required',
        { directoryRoot },
      )
    }

    stage = 'staging'
    const prepared = await publishPresentationStandardProject({
      workspaceRoot: transaction.candidateParent,
      build: input.build,
      operationId: candidateOperationId(input.operationId),
      hooks: {
        afterStagingCreated: input.hooks?.afterStagingCreated,
        beforeValidation: input.hooks?.beforeValidation,
      },
    })
    const candidateRoot = prepared.directoryRoot
    const ownedProjectionHashes = await collectExactHashes(candidateRoot, candidatePaths.all)
    const allowedPaths = new Set([...existingPaths.all, ...candidatePaths.all])
    const canonicalPaths = new Set(candidatePaths.canonicalJson)
    const ownedExistingPathSet = new Set(existingPaths.all)
    const candidateManagedPathSet = new Set(candidatePaths.all)
    const actualHashes = await collectExactHashes(directoryRoot, existingPaths.all)

    await classifyExternalChanges({
      root: directoryRoot,
      candidateRoot,
      allowedPaths,
      canonicalPaths,
      ownedExistingPaths: ownedExistingPathSet,
      actualHashes,
      expectedHashes: input.expectedExistingFileHashes,
      confirmExternalChanges: input.confirmExternalChanges === true,
    })
    const existingValidation = await validateExistingProject(
      directoryRoot,
      existingProjectId !== undefined,
      input.confirmExternalChanges === true,
    )

    stage = 'validation'
    await preserveCompatibleJsonExtensions({
      root: directoryRoot,
      candidateRoot,
      canonicalPaths: candidatePaths.canonicalJson,
      ownedExistingPaths: ownedExistingPathSet,
      candidateManagedPaths: candidateManagedPathSet,
    })
    const candidateHashes = await collectExactHashes(candidateRoot, candidatePaths.all)
    const actions = createWriteActions({
      currentHashes: actualHashes,
      candidateHashes,
      existingPaths: existingPaths.all,
      candidatePaths: candidatePaths.all,
    })
    const createdDirectories = await missingStructuralDirectories(
      directoryRoot,
      candidatePaths.all,
    )
    const createLayoutsRoot = await shouldCreateLayoutsRoot(directoryRoot)

    if (actions.length === 0 && createdDirectories.length === 0 && !createLayoutsRoot) {
      await transaction.abort()
      const validation = existingValidation
        ?? await (await getPresentationStandardContract()).validateProject(directoryRoot)
      if (!validation.valid) {
        throw new PresentationStandardProjectError(
          'CONTRACT_VALIDATION_FAILED',
          'validation',
          'Contract 0.1.0 rejected the unchanged shared Workspace',
          validation,
        )
      }
      return Object.freeze({
        directoryRoot,
        projectId: input.build.projectId,
        projectSlug: input.build.projectSlug,
        standardVersion: '0.1.0' as const,
        replacedExisting: hadManagedEntries,
        fileHashes: ownedProjectionHashes,
        validation,
      })
    }

    stage = 'commit'
    await transaction.initialize({
      projectId: input.build.projectId,
      actions,
      candidateDirectory: candidateRoot,
      createdDirectories,
      createdLayoutsRoot: createLayoutsRoot,
    })
    for (const relativeDirectory of createdDirectories) {
      await mkdir(workspacePath(directoryRoot, relativeDirectory))
    }
    if (createLayoutsRoot) await mkdir(join(directoryRoot, PRESENTATION_LAYOUTS_ROOT))
    await input.hooks?.afterBackupCreated?.(transaction.backupRoot)
    await input.hooks?.beforeCommit?.(candidateRoot, directoryRoot)
    await transaction.commit(candidateRoot, input.hooks)
    committed = true

    stage = 'validation'
    await transaction.beginValidation()
    const contract = await getPresentationStandardContract()
    const validation = await contract.validateProject(directoryRoot)
    if (!validation.valid) {
      throw new PresentationStandardProjectError(
        'CONTRACT_VALIDATION_FAILED',
        'validation',
        'Contract 0.1.0 rejected the final shared Workspace project',
        validation,
      )
    }
    await transaction.markValidated()
    await transaction.complete()

    return Object.freeze({
      directoryRoot,
      projectId: input.build.projectId,
      projectSlug: input.build.projectSlug,
      standardVersion: '0.1.0' as const,
      replacedExisting: hadManagedEntries,
      fileHashes: ownedProjectionHashes,
      validation,
    })
  } catch (error) {
    if (!transaction.isValidated) {
      try {
        if (transaction.hasJournal) await transaction.rollback()
        else await transaction.abort()
      } catch (recoveryError) {
        throw recoveryError instanceof PresentationStandardProjectError
          ? recoveryError
          : new PresentationStandardProjectError(
              'WORKSPACE_RECOVERY_FAILED',
              'cleanup',
              recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
            )
      }
    }
    throw workspaceFailure(error, committed ? 'commit' : stage)
  }
}
