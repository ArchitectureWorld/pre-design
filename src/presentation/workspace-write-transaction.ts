import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { writeUtf8FileAtomically } from './filesystem.ts'
import { PresentationStandardProjectError } from './standard-project-error.ts'
import type { PresentationStandardProjectWriterHooks } from './standard-project-types.ts'
import {
  PRESENTATION_LAYOUTS_ROOT,
  assertTransactionManagedDirectory,
  assertTransactionManagedPath,
} from './workspace-managed-paths.ts'

const TRANSIENT_RENAME_ERROR_CODES = new Set(['EACCES', 'EBUSY', 'EPERM'])
const RENAME_RETRY_DELAYS_MS = Object.freeze([25, 50, 100, 200, 400] as const)

export type WorkspaceWriteActionKind = 'create' | 'replace' | 'delete'

export interface WorkspaceWriteAction {
  readonly relativePath: string
  readonly kind: WorkspaceWriteActionKind
}

interface WorkspaceTransactionOwner {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly workspaceRoot: string
  readonly pid: number
  readonly createdAt: string
}

type WorkspaceTransactionPhase =
  | 'prepared'
  | 'committing'
  | 'validating'
  | 'validated'
  | 'rolling_back'

interface WorkspaceTransactionJournal {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly workspaceRoot: string
  readonly projectId: string
  readonly phase: WorkspaceTransactionPhase
  readonly actions: readonly WorkspaceWriteAction[]
  readonly currentAction: number | null
  readonly completedActions: number
  readonly candidateDirectory?: string
  readonly createdLayoutsRoot: boolean
  readonly createdDirectories: readonly string[]
}

export type WorkspaceRecoveryResult =
  | { readonly status: 'none' }
  | { readonly status: 'active'; readonly operationId?: string }
  | { readonly status: 'recovered'; readonly operationId?: string }

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

function projectPath(root: string, relativePath: string): string {
  return join(root, ...relativePath.split('/'))
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined
}

async function readJsonIfExists(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function ownerFrom(value: unknown, expectedWorkspaceRoot: string): WorkspaceTransactionOwner | undefined {
  const row = asRecord(value)
  if (row === undefined) return undefined
  const pid = row.pid
  if (row.schemaVersion !== 1
    || typeof row.operationId !== 'string'
    || row.workspaceRoot !== expectedWorkspaceRoot
    || typeof pid !== 'number'
    || !Number.isSafeInteger(pid)
    || typeof row.createdAt !== 'string') return undefined
  return Object.freeze({
    schemaVersion: 1,
    operationId: row.operationId,
    workspaceRoot: expectedWorkspaceRoot,
    pid,
    createdAt: row.createdAt,
  })
}

function journalFrom(value: unknown, expectedWorkspaceRoot: string): WorkspaceTransactionJournal | undefined {
  const row = asRecord(value)
  if (row === undefined) return undefined
  const phases: readonly WorkspaceTransactionPhase[] = [
    'prepared', 'committing', 'validating', 'validated', 'rolling_back',
  ]
  const currentAction = row.currentAction
  const completedActions = row.completedActions
  if (row.schemaVersion !== 1
    || typeof row.operationId !== 'string'
    || row.workspaceRoot !== expectedWorkspaceRoot
    || typeof row.projectId !== 'string'
    || typeof row.phase !== 'string'
    || !phases.includes(row.phase as WorkspaceTransactionPhase)
    || !Array.isArray(row.actions)
    || !(currentAction === null
      || (typeof currentAction === 'number' && Number.isSafeInteger(currentAction)))
    || typeof completedActions !== 'number'
    || !Number.isSafeInteger(completedActions)
    || completedActions < 0
    || typeof row.createdLayoutsRoot !== 'boolean') return undefined

  const actions = row.actions.map((candidate) => {
    const action = asRecord(candidate)
    if (action === undefined
      || typeof action.relativePath !== 'string'
      || (action.kind !== 'create' && action.kind !== 'replace' && action.kind !== 'delete')) {
      throw new Error('transaction journal contains an invalid action')
    }
    return Object.freeze({
      relativePath: assertTransactionManagedPath(action.relativePath),
      kind: action.kind,
    })
  })
  const createdDirectories = Array.isArray(row.createdDirectories)
    ? row.createdDirectories.map((entry) => {
        if (typeof entry !== 'string') {
          throw new Error('transaction journal contains a non-string directory')
        }
        return assertTransactionManagedDirectory(entry)
      })
    : []
  const candidateDirectory = typeof row.candidateDirectory === 'string'
    ? row.candidateDirectory
    : undefined
  if (candidateDirectory !== undefined
    && (candidateDirectory.startsWith('../')
      || candidateDirectory === '..'
      || isAbsolute(candidateDirectory))) {
    throw new Error('transaction journal candidateDirectory escapes the transaction root')
  }
  if (completedActions > actions.length
    || (typeof currentAction === 'number'
      && (currentAction < 0 || currentAction >= actions.length))) {
    throw new Error('transaction journal action cursor is out of range')
  }
  return Object.freeze({
    schemaVersion: 1,
    operationId: row.operationId,
    workspaceRoot: expectedWorkspaceRoot,
    projectId: row.projectId,
    phase: row.phase as WorkspaceTransactionPhase,
    actions: Object.freeze(actions),
    currentAction: currentAction as number | null,
    completedActions,
    ...(candidateDirectory === undefined ? {} : { candidateDirectory }),
    createdLayoutsRoot: row.createdLayoutsRoot,
    createdDirectories: Object.freeze(createdDirectories),
  })
}

function processIsAlive(pid: number): boolean {
  if (pid <= 0) return false
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH' || code === 'EINVAL') return false
    return true
  }
}

export function workspaceTransactionDirectory(workspaceRoot: string): string {
  const root = resolve(workspaceRoot)
  const digest = createHash('sha256').update(root).digest('hex').slice(0, 16)
  return join(dirname(root), `.pre-design-transaction-${digest}`)
}

async function removeEmptyDirectory(path: string): Promise<void> {
  try {
    await rmdir(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTEMPTY' || code === 'EEXIST') return
    throw error
  }
}

async function rollbackJournal(
  transactionRoot: string,
  journal: WorkspaceTransactionJournal,
): Promise<void> {
  const candidateRoot = journal.candidateDirectory === undefined
    ? join(transactionRoot, 'candidate')
    : join(transactionRoot, ...journal.candidateDirectory.split('/'))
  const backupRoot = join(transactionRoot, 'backup')

  for (let index = journal.actions.length - 1; index >= 0; index -= 1) {
    const action = journal.actions[index]!
    const target = projectPath(journal.workspaceRoot, action.relativePath)
    const backup = projectPath(backupRoot, action.relativePath)
    const candidate = projectPath(candidateRoot, action.relativePath)
    if (await exists(backup)) {
      await rm(target, { force: true })
      await mkdir(dirname(target), { recursive: true })
      await renameWithTransientRetry(backup, target)
      continue
    }
    if (action.kind === 'create') {
      const definitelyCommitted = index < journal.completedActions
        || (index === journal.currentAction && !await exists(candidate))
      if (definitelyCommitted) await rm(target, { force: true })
    }
  }

  for (const relativeDirectory of [...journal.createdDirectories].reverse()) {
    await removeEmptyDirectory(projectPath(journal.workspaceRoot, relativeDirectory))
  }
  if (journal.createdLayoutsRoot) {
    await removeEmptyDirectory(join(journal.workspaceRoot, PRESENTATION_LAYOUTS_ROOT))
  }
}

export async function recoverPresentationWorkspaceTransaction(
  workspaceRoot: string,
): Promise<WorkspaceRecoveryResult> {
  const root = resolve(workspaceRoot)
  const transactionRoot = workspaceTransactionDirectory(root)
  if (!await exists(transactionRoot)) return Object.freeze({ status: 'none' })

  let owner: WorkspaceTransactionOwner | undefined
  let journal: WorkspaceTransactionJournal | undefined
  try {
    owner = ownerFrom(await readJsonIfExists(join(transactionRoot, 'owner.json')), root)
    journal = journalFrom(await readJsonIfExists(join(transactionRoot, 'journal.json')), root)
  } catch (error) {
    throw new PresentationStandardProjectError(
      'WORKSPACE_RECOVERY_FAILED',
      'cleanup',
      'cannot parse or validate the Workspace transaction metadata',
      { cause: error instanceof Error ? error.message : String(error), transactionRoot },
    )
  }

  if (journal?.phase === 'validated') {
    await rm(transactionRoot, { recursive: true, force: true })
    return Object.freeze({ status: 'recovered', operationId: journal.operationId })
  }
  if (owner !== undefined && processIsAlive(owner.pid)) {
    return Object.freeze({ status: 'active', operationId: owner.operationId })
  }

  const recoveryDirectory = `${transactionRoot}.recovery-${process.pid}-${randomUUID()}`
  try {
    await rename(transactionRoot, recoveryDirectory)
  } catch (error) {
    if (!await exists(transactionRoot)) {
      return Object.freeze({ status: 'active', operationId: owner?.operationId })
    }
    throw new PresentationStandardProjectError(
      'WORKSPACE_RECOVERY_FAILED',
      'cleanup',
      'cannot acquire recovery ownership for the abandoned Workspace transaction',
      { cause: error instanceof Error ? error.message : String(error), transactionRoot },
    )
  }

  try {
    if (journal !== undefined) await rollbackJournal(recoveryDirectory, journal)
    await rm(recoveryDirectory, { recursive: true, force: true })
    return Object.freeze({
      status: 'recovered',
      ...(journal?.operationId === undefined ? {} : { operationId: journal.operationId }),
    })
  } catch (error) {
    throw new PresentationStandardProjectError(
      'WORKSPACE_RECOVERY_FAILED',
      'cleanup',
      'failed to restore the Workspace from an abandoned transaction',
      { cause: error instanceof Error ? error.message : String(error), transactionRoot: recoveryDirectory },
    )
  }
}

export class PresentationWorkspaceWriteTransaction {
  readonly candidateParent: string
  readonly backupRoot: string
  private journal?: WorkspaceTransactionJournal
  private validated = false

  constructor(
    readonly workspaceRoot: string,
    readonly operationId: string,
    readonly root: string,
  ) {
    this.candidateParent = join(root, 'candidate')
    this.backupRoot = join(root, 'backup')
  }

  get hasJournal(): boolean {
    return this.journal !== undefined
  }

  get isValidated(): boolean {
    return this.validated
  }

  async initialize(input: {
    readonly projectId: string
    readonly actions: readonly WorkspaceWriteAction[]
    readonly candidateDirectory: string
    readonly createdDirectories: readonly string[]
    readonly createdLayoutsRoot: boolean
  }): Promise<void> {
    const candidateRelative = relative(this.root, input.candidateDirectory).split(sep).join('/')
    if (candidateRelative.startsWith('../') || candidateRelative === '..' || isAbsolute(candidateRelative)) {
      throw new PresentationStandardProjectError(
        'WORKSPACE_TRANSACTION_FAILED',
        'staging',
        'candidate directory must stay inside the Workspace transaction directory',
      )
    }
    const actions = input.actions.map(action => Object.freeze({
      relativePath: assertTransactionManagedPath(action.relativePath),
      kind: action.kind,
    }))
    const createdDirectories = input.createdDirectories.map(assertTransactionManagedDirectory)
    await mkdir(this.backupRoot, { recursive: true })
    this.journal = Object.freeze({
      schemaVersion: 1,
      operationId: this.operationId,
      workspaceRoot: this.workspaceRoot,
      projectId: input.projectId,
      phase: 'prepared',
      actions: Object.freeze(actions),
      currentAction: null,
      completedActions: 0,
      candidateDirectory: candidateRelative,
      createdLayoutsRoot: input.createdLayoutsRoot,
      createdDirectories: Object.freeze(createdDirectories),
    })
    await this.writeJournal()
  }

  async commit(
    candidateDirectory: string,
    hooks?: PresentationStandardProjectWriterHooks,
  ): Promise<void> {
    if (this.journal === undefined) throw new Error('transaction journal is not initialized')
    for (let index = 0; index < this.journal.actions.length; index += 1) {
      const action = this.journal.actions[index]!
      await this.updateJournal({ phase: 'committing', currentAction: index })
      const target = projectPath(this.workspaceRoot, action.relativePath)
      const backup = projectPath(this.backupRoot, action.relativePath)
      const candidate = projectPath(candidateDirectory, action.relativePath)

      if (action.kind === 'replace' || action.kind === 'delete') {
        if (!await exists(target)) {
          throw new Error(`managed target '${action.relativePath}' disappeared during commit`)
        }
        await mkdir(dirname(backup), { recursive: true })
        await renameWithTransientRetry(target, backup)
      } else if (await exists(target)) {
        throw new Error(`managed target '${action.relativePath}' appeared during create`)
      }

      if (action.kind === 'replace' || action.kind === 'create') {
        if (!await exists(candidate)) {
          throw new Error(`candidate file '${action.relativePath}' is missing`)
        }
        await mkdir(dirname(target), { recursive: true })
        await renameWithTransientRetry(candidate, target)
      }

      await this.updateJournal({
        phase: 'committing',
        currentAction: null,
        completedActions: index + 1,
      })
      await hooks?.afterManagedPathCommitted?.(action.relativePath, index)
    }
  }

  async beginValidation(): Promise<void> {
    await this.updateJournal({ phase: 'validating', currentAction: null })
  }

  async markValidated(): Promise<void> {
    await this.updateJournal({ phase: 'validated', currentAction: null })
    this.validated = true
  }

  async rollback(): Promise<void> {
    if (this.journal === undefined) {
      await this.abort()
      return
    }
    try {
      await this.updateJournal({ phase: 'rolling_back', currentAction: null })
      await rollbackJournal(this.root, this.journal)
      await rm(this.root, { recursive: true, force: true })
    } catch (error) {
      throw new PresentationStandardProjectError(
        'WORKSPACE_RECOVERY_FAILED',
        'cleanup',
        'Workspace transaction rollback failed',
        { cause: error instanceof Error ? error.message : String(error), transactionRoot: this.root },
      )
    }
  }

  async complete(): Promise<void> {
    try {
      await rm(this.root, { recursive: true, force: true })
    } catch {
      // A validated journal is safe to clean during the next startup or write attempt.
    }
  }

  async abort(): Promise<void> {
    await rm(this.root, { recursive: true, force: true })
  }

  private async updateJournal(
    patch: Partial<Pick<WorkspaceTransactionJournal,
      'phase' | 'currentAction' | 'completedActions'>>,
  ): Promise<void> {
    if (this.journal === undefined) throw new Error('transaction journal is not initialized')
    this.journal = Object.freeze({ ...this.journal, ...patch })
    await this.writeJournal()
  }

  private async writeJournal(): Promise<void> {
    if (this.journal === undefined) throw new Error('transaction journal is not initialized')
    await writeUtf8FileAtomically(
      join(this.root, 'journal.json'),
      `${JSON.stringify(this.journal, null, 2)}\n`,
    )
  }
}

export async function acquirePresentationWorkspaceTransaction(
  workspaceRoot: string,
  operationId: string,
): Promise<PresentationWorkspaceWriteTransaction> {
  const root = resolve(workspaceRoot)
  const transactionRoot = workspaceTransactionDirectory(root)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const acquisitionRoot = `${transactionRoot}.acquire-${process.pid}-${randomUUID()}`
    try {
      await mkdir(acquisitionRoot)
      const owner: WorkspaceTransactionOwner = {
        schemaVersion: 1,
        operationId,
        workspaceRoot: root,
        pid: process.pid,
        createdAt: new Date().toISOString(),
      }
      await writeUtf8FileAtomically(
        join(acquisitionRoot, 'owner.json'),
        `${JSON.stringify(owner, null, 2)}\n`,
      )
      await rename(acquisitionRoot, transactionRoot)
      return new PresentationWorkspaceWriteTransaction(root, operationId, transactionRoot)
    } catch (error) {
      await rm(acquisitionRoot, { recursive: true, force: true }).catch(() => undefined)
      if (!await exists(transactionRoot)) throw error
      const recovery = await recoverPresentationWorkspaceTransaction(root)
      if (recovery.status === 'active') {
        throw new PresentationStandardProjectError(
          'WORKSPACE_WRITE_LOCKED',
          'preflight',
          `Workspace '${root}' already has an active Pre write transaction`,
          { workspaceRoot: root, operationId: recovery.operationId },
        )
      }
    }
  }
  throw new PresentationStandardProjectError(
    'WORKSPACE_WRITE_LOCKED',
    'preflight',
    `Workspace '${root}' could not acquire the Pre write transaction lock`,
    { workspaceRoot: root },
  )
}
