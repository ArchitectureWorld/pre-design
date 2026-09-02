import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  commitStagedDirectory,
  copyFileVerified,
  createStagingDirectory,
  removeStagingDirectory,
  writeCanonicalJsonAtomically,
  writeUtf8FileAtomically,
} from '../src/presentation/filesystem.ts'

const roots: string[] = []

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'pre-design-presentation-fs-'))
  roots.push(root)
  return root
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

describe('Presentation filesystem foundation', () => {
  it('creates a sibling staging directory and exposes the project only after commit', async () => {
    const root = await temporaryRoot()
    const finalDirectory = join(root, 'projects', 'presentation-project-1-demo')
    const stagingDirectory = await createStagingDirectory({
      finalDirectory,
      operationId: 'operation-1',
    })

    expect(dirname(stagingDirectory)).toBe(dirname(finalDirectory))
    expect(basename(stagingDirectory)).toBe(
      '.creating-presentation-project-1-demo-operation-1',
    )
    expect(await exists(finalDirectory)).toBe(false)

    await writeUtf8FileAtomically(
      join(stagingDirectory, 'project.json'),
      '{"projectId":"presentation-project-1"}\n',
    )
    await commitStagedDirectory(stagingDirectory, finalDirectory)

    expect(await exists(stagingDirectory)).toBe(false)
    expect(await readFile(join(finalDirectory, 'project.json'), 'utf8'))
      .toContain('presentation-project-1')
  })

  it('refuses existing final directories and cross-parent staging commits', async () => {
    const root = await temporaryRoot()
    const occupied = join(root, 'projects', 'occupied')
    await mkdir(occupied, { recursive: true })

    await expect(createStagingDirectory({
      finalDirectory: occupied,
      operationId: 'operation-occupied',
    })).rejects.toThrow('PRESENTATION_FINAL_DIRECTORY_EXISTS')

    const staging = join(root, 'left', '.creating-project-operation')
    const finalDirectory = join(root, 'right', 'project')
    await mkdir(staging, { recursive: true })
    await mkdir(dirname(finalDirectory), { recursive: true })

    await expect(commitStagedDirectory(staging, finalDirectory))
      .rejects.toThrow('PRESENTATION_STAGING_NOT_SIBLING')
    expect(await exists(staging)).toBe(true)
  })

  it('writes canonical JSON atomically and leaves no temporary sibling', async () => {
    const root = await temporaryRoot()
    const target = join(root, 'project', 'outline.json')

    await writeCanonicalJsonAtomically(target, { z: 1, a: { d: 4, c: 3 } })
    expect(await readFile(target, 'utf8'))
      .toBe('{"a":{"c":3,"d":4},"z":1}\n')

    await writeCanonicalJsonAtomically(target, { changed: true })
    expect(await readFile(target, 'utf8')).toBe('{"changed":true}\n')
    expect((await readdir(dirname(target))).filter(name => name.includes('.tmp-')))
      .toEqual([])
  })

  it('copies a source file without moving it and verifies byte count and SHA-256', async () => {
    const root = await temporaryRoot()
    const source = join(root, 'incoming', '项目资料.txt')
    const destination = join(root, 'project', 'source-materials', 'documents', '项目资料.txt')
    await mkdir(dirname(source), { recursive: true })
    await writeFile(source, '原始项目资料\n', 'utf8')

    const result = await copyFileVerified(source, destination)

    expect(result.bytes).toBe(Buffer.byteLength('原始项目资料\n'))
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(await readFile(source, 'utf8')).toBe('原始项目资料\n')
    expect(await readFile(destination, 'utf8')).toBe('原始项目资料\n')
    expect((await readdir(dirname(destination))).filter(name => name.includes('.tmp-')))
      .toEqual([])
  })

  it('cleans an abandoned staging directory idempotently', async () => {
    const root = await temporaryRoot()
    const finalDirectory = join(root, 'projects', 'presentation-project-2-demo')
    const staging = await createStagingDirectory({
      finalDirectory,
      operationId: 'operation-cleanup',
    })
    await writeFile(join(staging, 'partial.json'), '{}', 'utf8')

    await removeStagingDirectory(staging)
    await removeStagingDirectory(staging)
    expect(await exists(staging)).toBe(false)
  })
})
