export interface PreplanningWorkspaceDraft {
  readonly statement: string
  readonly projectName: string
  readonly nameEdited: boolean
}

const STORAGE_PREFIX = 'pre-design:v2:workspace-draft:'
const DEFAULT_DRAFT: PreplanningWorkspaceDraft = Object.freeze({
  statement: '',
  projectName: '',
  nameEdited: false,
})

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

function workspaceKey(workspacePath: string): string {
  const normalized = workspacePath
    .normalize('NFC')
    .trim()
    .replace(/\\/gu, '/')
    .replace(/\/+$/gu, '')
  return `${STORAGE_PREFIX}${encodeURIComponent(normalized)}`
}

function validDraft(value: unknown): value is PreplanningWorkspaceDraft {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return typeof row.statement === 'string'
    && typeof row.projectName === 'string'
    && typeof row.nameEdited === 'boolean'
}

function currentDraft(value: PreplanningWorkspaceDraft): PreplanningWorkspaceDraft {
  return {
    statement: value.statement,
    projectName: value.projectName,
    nameEdited: value.nameEdited,
  }
}

export function emptyWorkspaceDraft(): PreplanningWorkspaceDraft {
  return { ...DEFAULT_DRAFT }
}

export function loadWorkspaceDraft(
  workspacePath: string | undefined,
): PreplanningWorkspaceDraft {
  const target = storage()
  if (target === undefined || workspacePath === undefined || workspacePath.trim() === '') {
    return emptyWorkspaceDraft()
  }
  try {
    const raw = target.getItem(workspaceKey(workspacePath))
    if (raw === null) return emptyWorkspaceDraft()
    const parsed = JSON.parse(raw) as unknown
    if (!validDraft(parsed)) {
      target.removeItem(workspaceKey(workspacePath))
      return emptyWorkspaceDraft()
    }
    // Older V2 drafts may still contain mode/report/visual fields. They are intentionally
    // ignored so project creation remains independent from execution-policy settings.
    return currentDraft(parsed)
  } catch {
    return emptyWorkspaceDraft()
  }
}

export function saveWorkspaceDraft(
  workspacePath: string | undefined,
  draft: PreplanningWorkspaceDraft,
): void {
  const target = storage()
  if (target === undefined || workspacePath === undefined || workspacePath.trim() === '') return
  if (!validDraft(draft)) return
  try {
    target.setItem(workspaceKey(workspacePath), JSON.stringify(currentDraft(draft)))
  } catch {
    // Browser storage can be disabled or full; the form remains usable in memory.
  }
}

export function clearWorkspaceDraft(workspacePath: string | undefined): void {
  const target = storage()
  if (target === undefined || workspacePath === undefined || workspacePath.trim() === '') return
  try {
    target.removeItem(workspaceKey(workspacePath))
  } catch {
    // No-op when browser storage is unavailable.
  }
}
