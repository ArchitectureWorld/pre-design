import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, win32 } from 'node:path'

export interface WorkspaceInvocationLike {
  readonly agent?: {
    readonly session?: {
      readonly header?: {
        readonly cwd?: unknown
      }
    }
  }
}

function portableAbsolute(value: string): boolean {
  return isAbsolute(value) || win32.isAbsolute(value)
}

export async function resolveInvocationWorkspaceRoot(
  value: WorkspaceInvocationLike,
): Promise<string | undefined> {
  const raw = value.agent?.session?.header?.cwd
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('PRE_DESIGN_WORKSPACE_PATH_INVALID: SessionHeader.cwd 必须是非空字符串。')
  }
  if (!portableAbsolute(raw)) {
    throw new Error('PRE_DESIGN_WORKSPACE_PATH_NOT_ABSOLUTE: DSH 工作区路径必须是绝对路径。')
  }

  const canonical = await realpath(raw)
  const info = await lstat(canonical)
  if (info.isSymbolicLink()) {
    throw new Error('PRE_DESIGN_WORKSPACE_SYMLINK_FORBIDDEN: DSH 工作区根目录不能是符号链接。')
  }
  if (!info.isDirectory()) {
    throw new Error('PRE_DESIGN_WORKSPACE_NOT_DIRECTORY: SessionHeader.cwd 必须指向目录。')
  }
  return canonical
}
