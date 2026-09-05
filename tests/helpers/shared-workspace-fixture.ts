import { createHash } from 'node:crypto'
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { validateProjectDirectoryWithAjv } from '@architectureworld/presentation-contracts'
import { buildPresentationStandardProject } from '../../src/presentation/standard-project-adapter.ts'
import type {
  PresentationRulesInput,
  PresentationStandardProjectBuild,
} from '../../src/presentation/standard-project-types.ts'
import type { FrozenProjectInput } from '../../src/report/types.ts'

export const FIXED_CREATED_AT = '2026-09-05T00:00:00.000Z'
export const INTERNAL_PRE_PROJECT_ID = 'preplan-shared-workspace-safety'

const roots: string[] = []

export async function createSharedWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pre-design-shared-workspace-'))
  roots.push(root)
  return root
}

export async function cleanupSharedWorkspaces(): Promise<void> {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
}

export function frozenProject(
  revision: number,
  summary: string,
  projectName = '武汉站综合枢纽共享项目',
): FrozenProjectInput {
  return {
    projectId: INTERNAL_PRE_PROJECT_ID,
    projectName,
    revision,
    generatedAt: `2026-09-05T00:00:${String(revision).padStart(2, '0')}.000Z`,
    recommendation: '形成站城一体的综合枢纽。',
    decisionItems: [],
    stateObjects: [{
      objectId: 'DG05',
      chapterId: '03',
      workItemId: '03-05',
      title: '核心机会',
      summary,
      facts: [],
    }],
    gates: [],
    visualAssets: [],
    adoptedAssetIds: [],
    siteBoundary: { status: 'not_provided' },
  }
}

export async function buildSharedProject(input: {
  readonly revision: number
  readonly summary: string
  readonly stableIds?: Readonly<Record<string, string>>
  readonly projectName?: string
  readonly rules?: PresentationRulesInput
}): Promise<PresentationStandardProjectBuild> {
  return buildPresentationStandardProject({
    frozenProject: frozenProject(
      input.revision,
      input.summary,
      input.projectName,
    ),
    projectSlug: 'wuhan-station-shared',
    stableIds: input.stableIds,
    rules: input.rules,
    createdAt: FIXED_CREATED_AT,
  })
}

export async function writePresentationOwnedFixture(root: string): Promise<void> {
  await mkdir(join(root, 'layouts', 'pages'), { recursive: true })
  await mkdir(join(root, 'layouts', 'openpencil'), { recursive: true })
  await mkdir(join(root, 'layouts', 'future-component'), { recursive: true })
  await mkdir(join(root, 'third-party-extension'), { recursive: true })
  await mkdir(join(root, 'assets', 'future-component'), { recursive: true })
  await writeFile(
    join(root, 'layouts', 'manifest.json'),
    '{"owner":"presentation","version":"0.2.0-beta.1"}\n',
    'utf8',
  )
  await writeFile(
    join(root, 'layouts', 'pages', 'page-a.json'),
    '{"projectId":"presentation-owned","layout":"manual"}\n',
    'utf8',
  )
  await writeFile(
    join(root, 'layouts', 'openpencil', 'page-a.op'),
    'OPENPENCIL\u0000PAGE-A\n',
    'utf8',
  )
  await writeFile(
    join(root, 'layouts', 'future-component', 'unknown.bin'),
    Buffer.from([0, 255, 17, 34, 51, 68, 85, 102]),
  )
  await writeFile(
    join(root, 'third-party-extension', 'custom.json'),
    '{"extension":"keep-byte-for-byte","revision":7}\n',
    'utf8',
  )
  await writeFile(
    join(root, 'assets', 'future-component', 'unknown.bin'),
    Buffer.from([102, 85, 68, 51, 34, 17, 255, 0]),
  )
}

export interface FileSnapshot {
  readonly sha256: string
  readonly bytes: number
}

export async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

export async function snapshotFiles(root: string): Promise<Readonly<Record<string, FileSnapshot>>> {
  const files: Record<string, FileSnapshot> = {}

  async function visit(directory: string): Promise<void> {
    for (const name of (await readdir(directory)).sort((left, right) => left.localeCompare(right))) {
      const absolute = join(directory, name)
      const info = await lstat(absolute)
      if (info.isSymbolicLink()) throw new Error(`fixture contains unexpected symlink: ${absolute}`)
      if (info.isDirectory()) {
        await visit(absolute)
        continue
      }
      if (!info.isFile()) throw new Error(`fixture contains unsupported entry: ${absolute}`)
      const portable = relative(root, absolute).split(sep).join('/')
      files[portable] = { sha256: await sha256(absolute), bytes: info.size }
    }
  }

  await visit(root)
  return Object.freeze(files)
}

export async function snapshotSelectedFiles(
  root: string,
  relativePaths: readonly string[],
): Promise<Readonly<Record<string, FileSnapshot>>> {
  const result: Record<string, FileSnapshot> = {}
  for (const relativePath of [...relativePaths].sort((left, right) => left.localeCompare(right))) {
    const absolute = join(root, ...relativePath.split('/'))
    const info = await lstat(absolute)
    result[relativePath] = { sha256: await sha256(absolute), bytes: info.size }
  }
  return Object.freeze(result)
}

export async function mtimeNanoseconds(path: string): Promise<bigint> {
  return (await stat(path, { bigint: true })).mtimeNs
}

export async function readJson<T = Record<string, unknown>>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export async function expectContractValid(root: string): Promise<void> {
  const validation = await validateProjectDirectoryWithAjv(root)
  if (!validation.valid) {
    throw new Error(`Contract validation failed: ${JSON.stringify(validation.errors, null, 2)}`)
  }
}
