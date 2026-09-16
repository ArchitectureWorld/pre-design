import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'

const SAFE_DELETE_MARKER = 'SAFE_DELETE_BULK_CONFIRM_REQUIRED'

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  const guardedRm: typeof actual.rm = async (path, options) => {
    if (options?.recursive === true && String(path).includes('.pre-design-transaction-')) {
      throw new Error(
        `[safe-delete] [${SAFE_DELETE_MARKER}] {"count":58,"threshold":50,"scope":"turn","targetCount":1}`,
      )
    }
    return actual.rm(path, options)
  }
  return { ...actual, rm: guardedRm }
})

import {
  PresentationWorkspaceWriteTransaction,
  recoverPresentationWorkspaceTransaction,
  workspaceTransactionDirectory,
} from '../src/presentation/workspace-write-transaction.ts'

const cleanupRoots: string[] = []

async function actualFs(): Promise<typeof import('node:fs/promises')> {
  return vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
}

async function exists(path: string): Promise<boolean> {
  const fs = await actualFs()
  try {
    await fs.lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function createWorkspace(): Promise<string> {
  const fs = await actualFs()
  const parent = await fs.mkdtemp(join(tmpdir(), 'pre-safe-delete-'))
  cleanupRoots.push(parent)
  const workspaceRoot = join(parent, 'workspace')
  await fs.mkdir(workspaceRoot)
  return workspaceRoot
}

async function addBulkScratch(transactionRoot: string, count = 55): Promise<void> {
  const fs = await actualFs()
  const scratch = join(transactionRoot, 'bulk-scratch')
  await fs.mkdir(scratch, { recursive: true })
  await Promise.all(Array.from({ length: count }, (_, index) =>
    fs.writeFile(join(scratch, `item-${String(index).padStart(3, '0')}.json`), '{}\n', 'utf8')))
}

async function writeTransactionMetadata(input: {
  readonly workspaceRoot: string
  readonly phase: 'validated' | 'committing'
  readonly action?: { readonly relativePath: string; readonly kind: 'replace' }
}): Promise<string> {
  const fs = await actualFs()
  const transactionRoot = workspaceTransactionDirectory(input.workspaceRoot)
  await fs.mkdir(transactionRoot, { recursive: true })
  const actions = input.action === undefined ? [] : [input.action]
  await fs.writeFile(join(transactionRoot, 'owner.json'), JSON.stringify({
    schemaVersion: 1,
    operationId: `safe-delete-${input.phase}`,
    workspaceRoot: input.workspaceRoot,
    pid: 2147483647,
    createdAt: '2026-09-16T00:00:00.000Z',
  }), 'utf8')
  await fs.writeFile(join(transactionRoot, 'journal.json'), JSON.stringify({
    schemaVersion: 1,
    operationId: `safe-delete-${input.phase}`,
    workspaceRoot: input.workspaceRoot,
    projectId: 'safe-delete-project',
    phase: input.phase,
    actions,
    currentAction: input.phase === 'committing' && actions.length > 0 ? 0 : null,
    completedActions: 0,
    createdLayoutsRoot: false,
    createdDirectories: [],
  }), 'utf8')
  await addBulkScratch(transactionRoot)
  return transactionRoot
}

async function expectRetainedSibling(transactionRoot: string): Promise<void> {
  const fs = await actualFs()
  const siblings = await fs.readdir(dirname(transactionRoot))
  const prefix = `${basename(transactionRoot)}.safe-delete-retained-`
  expect(siblings.some(name => name.startsWith(prefix))).toBe(true)
}

afterEach(async () => {
  const fs = await actualFs()
  await Promise.all(cleanupRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
})

describe('Workspace transaction cleanup under host safe-delete protection', () => {
  it('retires a validated transaction instead of blocking startup when bulk recursive delete requires confirmation', async () => {
    const workspaceRoot = await createWorkspace()
    const transactionRoot = await writeTransactionMetadata({ workspaceRoot, phase: 'validated' })

    await expect(recoverPresentationWorkspaceTransaction(workspaceRoot))
      .resolves.toMatchObject({ status: 'recovered', operationId: 'safe-delete-validated' })

    expect(await exists(transactionRoot)).toBe(false)
    await expectRetainedSibling(transactionRoot)
  })

  it('releases the active transaction path after a validated write when bulk cleanup is guarded', async () => {
    const workspaceRoot = await createWorkspace()
    const transactionRoot = workspaceTransactionDirectory(workspaceRoot)
    const candidateDirectory = join(transactionRoot, 'candidate')
    const fs = await actualFs()
    await fs.mkdir(candidateDirectory, { recursive: true })

    const transaction = new PresentationWorkspaceWriteTransaction(
      workspaceRoot,
      'safe-delete-complete',
      transactionRoot,
    )
    await transaction.initialize({
      projectId: 'safe-delete-project',
      actions: [],
      candidateDirectory,
      createdDirectories: [],
      createdLayoutsRoot: false,
    })
    await addBulkScratch(transactionRoot)
    await transaction.markValidated()

    await transaction.complete()

    expect(await exists(transactionRoot)).toBe(false)
    await expectRetainedSibling(transactionRoot)
  })

  it('finishes rollback recovery before retaining guarded scratch data', async () => {
    const workspaceRoot = await createWorkspace()
    const transactionRoot = await writeTransactionMetadata({
      workspaceRoot,
      phase: 'committing',
      action: { relativePath: 'outline.json', kind: 'replace' },
    })
    const fs = await actualFs()
    const target = join(workspaceRoot, 'outline.json')
    const backup = join(transactionRoot, 'backup', 'outline.json')
    await fs.mkdir(dirname(backup), { recursive: true })
    await fs.writeFile(target, '{"state":"partial"}\n', 'utf8')
    await fs.writeFile(backup, '{"state":"original"}\n', 'utf8')

    await expect(recoverPresentationWorkspaceTransaction(workspaceRoot))
      .resolves.toMatchObject({ status: 'recovered', operationId: 'safe-delete-committing' })

    expect(await fs.readFile(target, 'utf8')).toBe('{"state":"original"}\n')
    expect(await exists(transactionRoot)).toBe(false)
    const siblings = await fs.readdir(dirname(transactionRoot))
    expect(siblings.some(name => name.includes('.recovery-') && name.includes('.safe-delete-retained-'))).toBe(true)
  })
})
