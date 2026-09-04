import { spawn } from 'node:child_process'
import { lstat } from 'node:fs/promises'
import { isAbsolute, win32 } from 'node:path'

function absolutePath(value: string): boolean {
  return isAbsolute(value) || win32.isAbsolute(value)
}

export async function openDirectoryInFileManager(directoryRoot: string): Promise<void> {
  if (!absolutePath(directoryRoot)) {
    throw new Error('PRE_DESIGN_OPEN_FOLDER_PATH_INVALID: 项目文件夹必须是绝对路径。')
  }
  const info = await lstat(directoryRoot)
  if (info.isSymbolicLink()) {
    throw new Error('PRE_DESIGN_OPEN_FOLDER_SYMLINK_FORBIDDEN: 不允许打开符号链接工作区。')
  }
  if (!info.isDirectory()) {
    throw new Error('PRE_DESIGN_OPEN_FOLDER_NOT_DIRECTORY: 项目文件夹不存在或不是目录。')
  }

  const [command, args] = process.platform === 'win32'
    ? ['explorer.exe', [directoryRoot]] as const
    : process.platform === 'darwin'
      ? ['open', [directoryRoot]] as const
      : ['xdg-open', [directoryRoot]] as const

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
