import { createHash } from 'node:crypto'
import {
  lstat,
  mkdir,
  readFile,
  rm,
} from 'node:fs/promises'
import {
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
  PRE_DESIGN_REQUIRED_DIRECTORIES,
  PRESENTATION_LAYOUTS_ROOT,
  managedPathSetFromBuild,
  normalizePreDesignManagedPath,
  readExistingPreDesignManagedPathSet,
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
      if (existing !== undefined
        && candidate !== undefined
        && sha256CanonicalDocument(stripAdditiveObjectKeys(existing, candidate)) === expected) {
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
}): Promise<void> {
  const contract = await getPresentationStandardContract()
  for (const relativePath of input.canonicalPaths) {
    const existingPath = workspacePath(input.root, relativePath)
    if (!await exists(existingPath)) continue
    const existing = await readJson(existingPath)
    const candidatePath = workspacePath(input.candidateRoot, relativePath)
    const candidate = await readJson(candidatePath)
    if (existing === undefined || candidate === undefined) continue
    const merged = mergeCompatibleObjectKeys(existing, candidate)
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
  managedPathSetFromBuild(input.build)

  const transaction = await acquirePresentationWorkspaceTransaction(
    directoryRoot,
    input.operationId,
  )
  let committed = false

  try {
    const existingProjectId = await assertWorkspaceProjectId(directoryRoot, input.build.projectId)
    const existingPaths = await readExistingPreDesignManagedPathSet(directoryRoot)
    if (existingPaths.manifestErrors.length > 0
      && input.confirmExternalChanges !== true) {
      throw new PresentationStandardProjectError(
        'CONTRACT_VALIDATION_FAILED',
        'preflight',
        'existing shared Workspace contains unreadable Pre manifests',
        { errors: existingPaths.manifestErrors },
      )
    }
    const hadManagedEntries = existingPaths.all.length > 0
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
    const candidatePaths = managedPathSetFromBuild(input.build)
    const allowedPaths = new Set([...existingPaths.all, ...candidatePaths.all])
    const canonicalPaths = new Set(candidatePaths.canonicalJson)
    const actualHashes = await collectExactHashes(directoryRoot, existingPaths.all)

    await classifyExternalChanges({
      root: directoryRoot,
      candidateRoot,
      allowedPaths,
      canonicalPaths,
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
        fileHashes: actualHashes,
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
    const finalPaths = await readExistingPreDesignManagedPathSet(directoryRoot)
    const fileHashes = await collectExactHashes(directoryRoot, finalPaths.all)
    await transaction.markValidated()
    await transaction.complete()

    return Object.freeze({
      directoryRoot,
      projectId: input.build.projectId,
      projectSlug: input.build.projectSlug,
      standardVersion: '0.1.0' as const,
      replacedExisting: hadManagedEntries,
      fileHashes,
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
