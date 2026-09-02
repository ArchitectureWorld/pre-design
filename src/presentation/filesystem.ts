import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  rename,
  rm,
} from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
  win32,
} from 'node:path'
import { canonicalizeJson } from './canonical-json.ts'

export interface CreateStagingDirectoryInput {
  readonly finalDirectory: string
  readonly operationId: string
}

export interface CopiedFileIntegrity {
  readonly bytes: number
  readonly sha256: string
}

const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function assertAbsoluteHostPath(path: string): void {
  if (!isAbsolute(path) && !win32.isAbsolute(path)) {
    fail('PRESENTATION_HOST_PATH_NOT_ABSOLUTE', `'${path}' is not absolute`)
  }
}

async function syncRegularFile(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  for await (const chunk of stream) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export async function createStagingDirectory(
  input: CreateStagingDirectoryInput,
): Promise<string> {
  assertAbsoluteHostPath(input.finalDirectory)
  if (!OPERATION_ID_PATTERN.test(input.operationId)) {
    fail(
      'PRESENTATION_OPERATION_ID_INVALID',
      `unsafe operationId '${input.operationId}'`,
    )
  }

  const finalDirectory = resolve(input.finalDirectory)
  const parent = dirname(finalDirectory)
  const directoryName = basename(finalDirectory)
  if (directoryName === '' || directoryName === '.' || directoryName === '..') {
    fail('PRESENTATION_FINAL_DIRECTORY_INVALID', `'${input.finalDirectory}' is invalid`)
  }

  const stagingDirectory = join(
    parent,
    `.creating-${directoryName}-${input.operationId}`,
  )
  await mkdir(parent, { recursive: true })
  if (await pathExists(finalDirectory)) {
    fail(
      'PRESENTATION_FINAL_DIRECTORY_EXISTS',
      `final directory '${finalDirectory}' already exists`,
    )
  }
  if (await pathExists(stagingDirectory)) {
    fail(
      'PRESENTATION_STAGING_DIRECTORY_EXISTS',
      `staging directory '${stagingDirectory}' already exists`,
    )
  }

  await mkdir(stagingDirectory)
  return stagingDirectory
}

export async function commitStagedDirectory(
  stagingDirectory: string,
  finalDirectory: string,
): Promise<void> {
  assertAbsoluteHostPath(stagingDirectory)
  assertAbsoluteHostPath(finalDirectory)
  const staging = resolve(stagingDirectory)
  const final = resolve(finalDirectory)

  if (dirname(staging) !== dirname(final)) {
    fail(
      'PRESENTATION_STAGING_NOT_SIBLING',
      'staging and final directories must share one parent filesystem location',
    )
  }
  const stagingStat = await lstat(staging)
  if (!stagingStat.isDirectory() || stagingStat.isSymbolicLink()) {
    fail(
      'PRESENTATION_STAGING_NOT_DIRECTORY',
      `staging path '${staging}' must be a real directory`,
    )
  }
  if (await pathExists(final)) {
    fail(
      'PRESENTATION_FINAL_DIRECTORY_EXISTS',
      `final directory '${final}' already exists`,
    )
  }

  await rename(staging, final)
}

export async function removeStagingDirectory(
  stagingDirectory: string,
): Promise<void> {
  assertAbsoluteHostPath(stagingDirectory)
  const staging = resolve(stagingDirectory)
  if (!basename(staging).startsWith('.creating-')) {
    fail(
      'PRESENTATION_STAGING_PATH_INVALID',
      `refusing to remove non-staging path '${staging}'`,
    )
  }
  await rm(staging, { recursive: true, force: true })
}

export async function writeUtf8FileAtomically(
  targetPath: string,
  content: string,
): Promise<void> {
  assertAbsoluteHostPath(targetPath)
  const target = resolve(targetPath)
  const parent = dirname(target)
  const temporary = join(parent, `.${basename(target)}.tmp-${randomUUID()}`)
  await mkdir(parent, { recursive: true })

  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporary, 'wx')
    await handle.writeFile(content, { encoding: 'utf8' })
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, target)
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined)
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function writeCanonicalJsonAtomically(
  targetPath: string,
  value: unknown,
): Promise<void> {
  await writeUtf8FileAtomically(targetPath, `${canonicalizeJson(value)}\n`)
}

export async function copyFileVerified(
  sourcePath: string,
  destinationPath: string,
): Promise<CopiedFileIntegrity> {
  assertAbsoluteHostPath(sourcePath)
  assertAbsoluteHostPath(destinationPath)
  const source = resolve(sourcePath)
  const destination = resolve(destinationPath)
  const sourceStat = await lstat(source)
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    fail(
      'PRESENTATION_SOURCE_FILE_NOT_REGULAR',
      `source '${source}' must be a regular non-symlink file`,
    )
  }
  if (await pathExists(destination)) {
    fail(
      'PRESENTATION_DESTINATION_FILE_EXISTS',
      `destination '${destination}' already exists`,
    )
  }

  const parent = dirname(destination)
  const temporary = join(parent, `.${basename(destination)}.tmp-${randomUUID()}`)
  await mkdir(parent, { recursive: true })

  try {
    const sourceSha256 = await sha256File(source)
    await copyFile(source, temporary, constants.COPYFILE_EXCL)
    await syncRegularFile(temporary)
    const copiedStat = await lstat(temporary)
    const copiedSha256 = await sha256File(temporary)
    if (copiedStat.size !== sourceStat.size || copiedSha256 !== sourceSha256) {
      fail(
        'PRESENTATION_FILE_COPY_INTEGRITY_MISMATCH',
        `copied file '${temporary}' does not match source '${source}'`,
      )
    }

    await link(temporary, destination)
    await rm(temporary, { force: true })
    return {
      bytes: copiedStat.size,
      sha256: copiedSha256,
    }
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}
