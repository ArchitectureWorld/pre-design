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
import { normalizeProjectRelativePath } from '@architectureworld/presentation-contracts'
import {
  copyFileVerified,
  sha256File,
  writeCanonicalJsonAtomically,
} from './filesystem.ts'
import { getPresentationStandardContract } from './standard-contract.ts'
import {
  PresentationStandardProjectError,
  asPresentationStandardProjectError,
  type PresentationStandardProjectStage,
} from './standard-project-error.ts'
import type {
  PresentationStandardProjectPublishResult,
  PublishPresentationStandardProjectInput,
} from './standard-project-types.ts'

export { PresentationStandardProjectError } from './standard-project-error.ts'

const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const REQUIRED_DIRECTORIES = Object.freeze([
  'pages',
  'pages/drafts',
  'source-materials',
  'source-materials/documents',
  'source-materials/drawings',
  'source-materials/images',
  'source-materials/videos',
  'source-materials/data',
  'source-materials/models',
  'source-materials/other',
  'assets',
  'assets/images',
  'assets/videos',
  'assets/charts',
  'assets/diagrams',
  'assets/audio',
  'assets/other',
  'layouts',
])

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function absoluteHostPath(value: string, name: string): string {
  if (!isAbsolute(value) && !win32.isAbsolute(value)) {
    throw new PresentationStandardProjectError(
      'PRESENTATION_HOST_PATH_NOT_ABSOLUTE',
      'preflight',
      `${name} must be an absolute host path`,
      { value },
    )
  }
  return resolve(value)
}

function assertOperationId(value: string): string {
  if (!OPERATION_ID_PATTERN.test(value)) {
    throw new PresentationStandardProjectError(
      'PRESENTATION_OPERATION_ID_INVALID',
      'preflight',
      `unsafe operationId '${value}'`,
    )
  }
  return value
}

function projectPath(root: string, relativePath: string): string {
  const normalized = normalizeProjectRelativePath(relativePath)
  const segments = normalized.split('/')
  const target = resolve(root, ...segments)
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`
  if (target !== root && !target.startsWith(rootWithSeparator)) {
    throw new PresentationStandardProjectError(
      'PRESENTATION_PATH_ESCAPE',
      'writing',
      `project path '${relativePath}' escapes '${root}'`,
    )
  }
  return target
}

function portableRelativePath(root: string, target: string): string {
  const value = relative(root, target).split(sep).join('/')
  return normalizeProjectRelativePath(value)
}

async function collectFileHashes(root: string): Promise<Readonly<Record<string, string>>> {
  const result: Record<string, string> = {}

  async function visit(directory: string): Promise<void> {
    for (const name of (await readdir(directory)).sort((left, right) => left.localeCompare(right))) {
      const target = join(directory, name)
      const entry = await lstat(target)
      if (entry.isSymbolicLink()) {
        throw new PresentationStandardProjectError(
          'PRESENTATION_SYMLINK_NOT_ALLOWED',
          'preflight',
          `symbolic link '${portableRelativePath(root, target)}' is not allowed`,
        )
      }
      if (entry.isDirectory()) {
        await visit(target)
      } else if (entry.isFile()) {
        result[portableRelativePath(root, target)] = await sha256File(target)
      } else {
        throw new PresentationStandardProjectError(
          'PRESENTATION_NON_REGULAR_FILE_NOT_ALLOWED',
          'preflight',
          `unsupported filesystem entry '${portableRelativePath(root, target)}'`,
        )
      }
    }
  }

  await visit(root)
  return Object.freeze(Object.fromEntries(Object.entries(result)
    .sort(([left], [right]) => left.localeCompare(right))))
}

function changedPaths(
  expected: Readonly<Record<string, string>>,
  actual: Readonly<Record<string, string>>,
): readonly string[] {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .sort((left, right) => left.localeCompare(right))
  return keys.filter(key => expected[key] !== actual[key])
}

async function createSiblingDirectory(path: string, code: string): Promise<void> {
  try {
    await mkdir(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new PresentationStandardProjectError(code, 'staging', `directory '${path}' already exists`)
    }
    throw error
  }
}

async function restoreBackup(
  backupDirectory: string,
  finalDirectory: string,
): Promise<void> {
  if (!await exists(backupDirectory)) return
  if (await exists(finalDirectory)) {
    await rm(backupDirectory, { recursive: true, force: true })
    return
  }
  await rename(backupDirectory, finalDirectory)
}

export async function publishPresentationStandardProject(
  input: PublishPresentationStandardProjectInput,
): Promise<PresentationStandardProjectPublishResult> {
  let stage: PresentationStandardProjectStage = 'preflight'
  const operationId = assertOperationId(input.operationId)
  const workspaceRoot = absoluteHostPath(input.workspaceRoot, 'workspaceRoot')
  const finalDirectory = resolve(workspaceRoot, input.build.directoryName)
  const workspaceWithSeparator = workspaceRoot.endsWith(sep) ? workspaceRoot : `${workspaceRoot}${sep}`
  if (!finalDirectory.startsWith(workspaceWithSeparator)
    || basename(finalDirectory) !== input.build.directoryName) {
    throw new PresentationStandardProjectError(
      'PRESENTATION_FINAL_DIRECTORY_INVALID',
      'preflight',
      `directory name '${input.build.directoryName}' is unsafe`,
    )
  }
  await mkdir(workspaceRoot, { recursive: true })

  const finalExists = await exists(finalDirectory)
  if (finalExists && input.expectedExistingFileHashes === undefined) {
    throw new PresentationStandardProjectError(
      'PRESENTATION_STANDARD_PROJECT_EXISTS',
      'preflight',
      `standard project '${finalDirectory}' already exists and no managed-update ledger was supplied`,
      { directoryRoot: finalDirectory },
    )
  }

  if (finalExists && input.expectedExistingFileHashes !== undefined) {
    const actual = await collectFileHashes(finalDirectory)
    const changes = changedPaths(input.expectedExistingFileHashes, actual)
    if (changes.length > 0 && input.confirmExternalChanges !== true) {
      throw new PresentationStandardProjectError(
        'PRESENTATION_EXTERNAL_CHANGE_REVIEW_REQUIRED',
        'preflight',
        'existing standard project contains external or untracked changes',
        { changedPaths: changes, expected: input.expectedExistingFileHashes, actual },
      )
    }
  }

  const parent = dirname(finalDirectory)
  const directoryName = basename(finalDirectory)
  const stagingDirectory = join(parent, `.creating-${directoryName}-${operationId}`)
  const backupDirectory = join(parent, `.backup-${directoryName}-${operationId}`)
  let backupCreated = false
  let stagingCreated = false

  try {
    stage = 'staging'
    if (await exists(stagingDirectory)) {
      throw new PresentationStandardProjectError(
        'PRESENTATION_STAGING_DIRECTORY_EXISTS',
        'staging',
        `staging directory '${stagingDirectory}' already exists`,
      )
    }
    if (await exists(backupDirectory)) {
      throw new PresentationStandardProjectError(
        'PRESENTATION_BACKUP_DIRECTORY_EXISTS',
        'staging',
        `backup directory '${backupDirectory}' already exists`,
      )
    }
    await createSiblingDirectory(stagingDirectory, 'PRESENTATION_STAGING_DIRECTORY_EXISTS')
    stagingCreated = true
    await input.hooks?.afterStagingCreated?.(stagingDirectory)

    stage = 'writing'
    for (const directory of REQUIRED_DIRECTORIES) {
      await mkdir(projectPath(stagingDirectory, directory), { recursive: true })
    }

    const occupied = new Set<string>()
    for (const [relativePath, document] of Object.entries(input.build.documents)
      .sort(([left], [right]) => left.localeCompare(right))) {
      const normalized = normalizeProjectRelativePath(relativePath)
      const folded = normalized.normalize('NFC').toLocaleLowerCase('en-US')
      if (occupied.has(folded)) {
        throw new PresentationStandardProjectError(
          'PRESENTATION_OUTPUT_PATH_DUPLICATE',
          'writing',
          `duplicate canonical output path '${normalized}'`,
        )
      }
      occupied.add(folded)
      await writeCanonicalJsonAtomically(projectPath(stagingDirectory, normalized), document)
    }

    for (const file of input.build.managedFiles) {
      const normalized = normalizeProjectRelativePath(file.relativePath)
      const folded = normalized.normalize('NFC').toLocaleLowerCase('en-US')
      if (occupied.has(folded)) {
        throw new PresentationStandardProjectError(
          'PRESENTATION_OUTPUT_PATH_DUPLICATE',
          'writing',
          `managed file path '${normalized}' collides with another output`,
        )
      }
      occupied.add(folded)
      const copied = await copyFileVerified(
        absoluteHostPath(file.sourcePath, `managedFiles[${file.sourceKey}].sourcePath`),
        projectPath(stagingDirectory, normalized),
      )
      if (copied.bytes !== file.sizeBytes || copied.sha256 !== file.sha256) {
        throw new PresentationStandardProjectError(
          'PRESENTATION_MANAGED_FILE_INTEGRITY_MISMATCH',
          'writing',
          `managed file '${normalized}' changed after its Manifest was prepared`,
          { expected: { sizeBytes: file.sizeBytes, sha256: file.sha256 }, actual: copied },
        )
      }
    }

    stage = 'validation'
    await input.hooks?.beforeValidation?.(stagingDirectory)
    const contract = await getPresentationStandardContract()
    const validation = await contract.validateProject(stagingDirectory)
    if (!validation.valid) {
      throw new PresentationStandardProjectError(
        'PRESENTATION_STANDARD_PROJECT_VALIDATION_FAILED',
        'validation',
        'Contract 0.1.0 rejected the staged standard project directory',
        validation,
      )
    }
    const fileHashes = await collectFileHashes(stagingDirectory)

    stage = 'commit'
    await input.hooks?.beforeCommit?.(stagingDirectory, finalDirectory)
    if (finalExists) {
      await rename(finalDirectory, backupDirectory)
      backupCreated = true
      await input.hooks?.afterBackupCreated?.(backupDirectory)
    }
    try {
      await rename(stagingDirectory, finalDirectory)
      stagingCreated = false
    } catch (error) {
      if (backupCreated) {
        await restoreBackup(backupDirectory, finalDirectory)
        backupCreated = false
      }
      throw error
    }

    if (backupCreated) {
      await rm(backupDirectory, { recursive: true, force: true })
      backupCreated = false
    }

    return Object.freeze({
      directoryRoot: finalDirectory,
      projectId: input.build.projectId,
      projectSlug: input.build.projectSlug,
      standardVersion: '0.1.0' as const,
      replacedExisting: finalExists,
      fileHashes,
      validation,
    })
  } catch (error) {
    const structured = asPresentationStandardProjectError(error, stage)
    stage = 'cleanup'
    if (stagingCreated) await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
    if (backupCreated) {
      await restoreBackup(backupDirectory, finalDirectory).catch(() => undefined)
      backupCreated = false
    }
    throw structured
  }
}

export async function readPresentationStandardProjectFileHashes(
  directoryRoot: string,
): Promise<Readonly<Record<string, string>>> {
  const root = absoluteHostPath(directoryRoot, 'directoryRoot')
  if (!await exists(root)) {
    throw new PresentationStandardProjectError(
      'PRESENTATION_STANDARD_PROJECT_NOT_FOUND',
      'preflight',
      `standard project '${root}' does not exist`,
    )
  }
  return collectFileHashes(root)
}
