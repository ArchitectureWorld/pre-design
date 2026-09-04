import {
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
} from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  win32,
} from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { sha256File } from './filesystem.ts'
import { getPresentationStandardContract } from './standard-contract.ts'
import {
  PresentationStandardProjectError,
  asPresentationStandardProjectError,
  type PresentationStandardProjectStage,
} from './standard-project-error.ts'
import type {
  PresentationStandardProjectBuild,
  PresentationStandardProjectPublishResult,
  PresentationStandardProjectWriterHooks,
} from './standard-project-types.ts'
import { publishPresentationStandardProject } from './standard-project-writer.ts'

const MANAGED_ROOTS = Object.freeze([
  'project.json',
  'rules.json',
  'outline.json',
  'pages',
  'source-materials',
  'assets',
] as const)

const TRANSIENT_RENAME_ERROR_CODES = new Set(['EACCES', 'EBUSY', 'EPERM'])
const RENAME_RETRY_DELAYS_MS = Object.freeze([25, 50, 100, 200, 400] as const)

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

async function renameWithTransientRetry(oldPath: string, newPath: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(oldPath, newPath)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const retryDelay = RENAME_RETRY_DELAYS_MS[attempt]
      if (retryDelay === undefined || code === undefined || !TRANSIENT_RENAME_ERROR_CODES.has(code)) {
        throw error
      }
      await delay(retryDelay)
    }
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

function portable(root: string, target: string): string {
  return relative(root, target).split(sep).join('/')
}

async function managedEntryExists(root: string): Promise<boolean> {
  for (const name of MANAGED_ROOTS) {
    if (await exists(join(root, name))) return true
  }
  return false
}

async function collectManagedFileHashes(
  root: string,
): Promise<Readonly<Record<string, string>>> {
  const hashes: Record<string, string> = {}

  async function visit(target: string): Promise<void> {
    const info = await lstat(target)
    if (info.isSymbolicLink()) {
      throw new PresentationStandardProjectError(
        'PRESENTATION_SYMLINK_NOT_ALLOWED',
        'preflight',
        `symbolic link '${portable(root, target)}' is not allowed in Pre-managed output`,
      )
    }
    if (info.isFile()) {
      hashes[portable(root, target)] = await sha256File(target)
      return
    }
    if (!info.isDirectory()) {
      throw new PresentationStandardProjectError(
        'PRESENTATION_NON_REGULAR_FILE_NOT_ALLOWED',
        'preflight',
        `unsupported filesystem entry '${portable(root, target)}'`,
      )
    }
    for (const name of (await readdir(target)).sort((left, right) => left.localeCompare(right))) {
      await visit(join(target, name))
    }
  }

  for (const name of MANAGED_ROOTS) {
    const target = join(root, name)
    if (await exists(target)) await visit(target)
  }

  return Object.freeze(Object.fromEntries(
    Object.entries(hashes).sort(([left], [right]) => left.localeCompare(right)),
  ))
}

function changedPaths(
  expected: Readonly<Record<string, string>>,
  actual: Readonly<Record<string, string>>,
): readonly string[] {
  return [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .sort((left, right) => left.localeCompare(right))
    .filter(path => expected[path] !== actual[path])
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

export async function publishPresentationStandardProjectIntoWorkspace(
  input: PublishPresentationStandardProjectIntoWorkspaceInput,
): Promise<PresentationStandardProjectPublishResult> {
  let stage: PresentationStandardProjectStage = 'preflight'
  const directoryRoot = absoluteDirectory(input.directoryRoot)
  const parent = dirname(directoryRoot)
  const label = basename(directoryRoot).replace(/[^A-Za-z0-9._-]/gu, '_') || 'workspace'
  const prepareParent = join(parent, `.pre-design-prepare-${label}-${input.operationId}`)
  const backupRoot = join(parent, `.pre-design-backup-${label}-${input.operationId}`)
  const installed = new Set<string>()
  const backedUp = new Set<string>()
  let prepareCreated = false
  let backupCreated = false

  const rollback = async (): Promise<void> => {
    for (const name of [...installed].reverse()) {
      await rm(join(directoryRoot, name), { recursive: true, force: true }).catch(() => undefined)
    }
    for (const name of [...backedUp].reverse()) {
      const source = join(backupRoot, name)
      const target = join(directoryRoot, name)
      if (await exists(source)) {
        await mkdir(dirname(target), { recursive: true })
        await renameWithTransientRetry(source, target).catch(() => undefined)
      }
    }
  }

  try {
    await assertWorkspaceRoot(directoryRoot)
    const hadManagedEntries = await managedEntryExists(directoryRoot)
    const actualHashes = await collectManagedFileHashes(directoryRoot)

    if (hadManagedEntries && input.expectedExistingFileHashes === undefined
      && input.confirmExternalChanges !== true) {
      throw new PresentationStandardProjectError(
        'PRESENTATION_WORKSPACE_MANAGED_CONTENT_EXISTS',
        'preflight',
        'Workspace already contains Canonical Presentation paths without a Pre export ledger; explicit --force is required',
        { directoryRoot },
      )
    }

    if (input.expectedExistingFileHashes !== undefined) {
      const changes = changedPaths(input.expectedExistingFileHashes, actualHashes)
      if (changes.length > 0 && input.confirmExternalChanges !== true) {
        throw new PresentationStandardProjectError(
          'PRESENTATION_EXTERNAL_CHANGE_REVIEW_REQUIRED',
          'preflight',
          'existing Workspace contains external changes in Pre-managed standard-project files',
          { changedPaths: changes, expected: input.expectedExistingFileHashes, actual: actualHashes },
        )
      }
    }

    stage = 'staging'
    if (await exists(prepareParent) || await exists(backupRoot)) {
      throw new PresentationStandardProjectError(
        'PRESENTATION_WORKSPACE_OPERATION_DIRECTORY_EXISTS',
        'staging',
        'Workspace staging or backup directory already exists',
        { prepareParent, backupRoot },
      )
    }
    await mkdir(prepareParent)
    prepareCreated = true
    const prepared = await publishPresentationStandardProject({
      workspaceRoot: prepareParent,
      build: input.build,
      operationId: `workspace-${input.operationId}`,
      hooks: input.hooks,
    })

    stage = 'commit'
    await mkdir(backupRoot)
    backupCreated = true
    for (const name of MANAGED_ROOTS) {
      const current = join(directoryRoot, name)
      const backup = join(backupRoot, name)
      const candidate = join(prepared.directoryRoot, name)
      if (await exists(current)) {
        await mkdir(dirname(backup), { recursive: true })
        await renameWithTransientRetry(current, backup)
        backedUp.add(name)
      }
      if (await exists(candidate)) {
        await renameWithTransientRetry(candidate, current)
        installed.add(name)
      }
    }
    await mkdir(join(directoryRoot, 'layouts'), { recursive: true })

    stage = 'validation'
    const contract = await getPresentationStandardContract()
    const validation = await contract.validateProject(directoryRoot)
    if (!validation.valid) {
      throw new PresentationStandardProjectError(
        'PRESENTATION_STANDARD_PROJECT_VALIDATION_FAILED',
        'validation',
        'Contract 0.1.0 rejected the final DSH Workspace project root',
        validation,
      )
    }
    const fileHashes = await collectManagedFileHashes(directoryRoot)

    await rm(backupRoot, { recursive: true, force: true })
    backupCreated = false
    await rm(prepareParent, { recursive: true, force: true })
    prepareCreated = false

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
    if (installed.size > 0 || backedUp.size > 0) await rollback()
    if (backupCreated) await rm(backupRoot, { recursive: true, force: true }).catch(() => undefined)
    if (prepareCreated) await rm(prepareParent, { recursive: true, force: true }).catch(() => undefined)
    throw asPresentationStandardProjectError(error, stage)
  }
}
