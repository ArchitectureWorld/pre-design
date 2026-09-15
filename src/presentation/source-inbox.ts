import { lstat, mkdir, readdir, realpath } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { PresentationSourceMaterialInput } from './standard-project-types.ts'

export const SOURCE_INBOX_DIRECTORY = '原始资料'
const SOURCE_KEY_PREFIX = 'workspace-inbox:'

export interface WorkspaceSourceInboxScan {
  readonly inboxRoot: string
  readonly sourceMaterials: readonly PresentationSourceMaterialInput[]
  readonly warnings: readonly string[]
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  '.3dm': 'application/octet-stream',
  '.avi': 'video/x-msvideo',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.dwg': 'image/vnd.dwg',
  '.dxf': 'image/vnd.dxf',
  '.fbx': 'application/octet-stream',
  '.geojson': 'application/geo+json',
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ifc': 'application/x-step',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.obj': 'model/obj',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.rtf': 'application/rtf',
  '.rvt': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
})

function portableRelative(root: string, path: string): string {
  const value = relative(root, path).split('\\').join('/')
  if (value === '' || value === '.' || value === '..' || value.startsWith('../') || isAbsolute(value)) {
    throw new Error(`PRESENTATION_SOURCE_INBOX_PATH_INVALID: '${path}' is outside 原始资料`)
  }
  return value.normalize('NFC')
}

function order(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function mimeTypeOf(fileName: string): string {
  return MIME_BY_EXTENSION[extname(fileName).toLowerCase()] ?? 'application/octet-stream'
}

async function assertSafeRoot(workspaceRoot: string): Promise<string> {
  const requested = resolve(workspaceRoot)
  const info = await lstat(requested)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('PRESENTATION_SOURCE_INBOX_WORKSPACE_INVALID: Workspace 必须是普通目录。')
  }
  return realpath(requested)
}

/**
 * Reads the user-owned `${Workspace}/原始资料` inbox without taking ownership of it.
 * The directory is created when absent; entries are never moved, deleted, renamed or rewritten.
 * Symbolic links are deliberately ignored so recursive scanning cannot escape the Workspace.
 */
export async function scanWorkspaceSourceInbox(workspaceRoot: string): Promise<WorkspaceSourceInboxScan> {
  const root = await assertSafeRoot(workspaceRoot)
  const inboxRoot = join(root, SOURCE_INBOX_DIRECTORY)
  await mkdir(inboxRoot, { recursive: true })
  const inboxInfo = await lstat(inboxRoot)
  if (!inboxInfo.isDirectory() || inboxInfo.isSymbolicLink()) {
    throw new Error('PRESENTATION_SOURCE_INBOX_INVALID: 原始资料必须是 Workspace 内的普通目录。')
  }
  const canonicalInbox = await realpath(inboxRoot)
  const suffix = relative(root, canonicalInbox)
  if (suffix === '..' || suffix.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(suffix)) {
    throw new Error('PRESENTATION_SOURCE_INBOX_ESCAPE: 原始资料目录越出 Workspace。')
  }

  const sourceMaterials: PresentationSourceMaterialInput[] = []
  const warnings: string[] = []

  const visit = async (directory: string): Promise<void> => {
    const names = (await readdir(directory)).sort(order)
    for (const name of names) {
      const path = join(directory, name)
      const info = await lstat(path)
      const relativePath = portableRelative(canonicalInbox, path)
      if (info.isSymbolicLink()) {
        warnings.push(`原始资料已跳过符号链接：${relativePath}`)
        continue
      }
      if (info.isDirectory()) {
        await visit(path)
        continue
      }
      if (!info.isFile()) {
        warnings.push(`原始资料已跳过非普通文件：${relativePath}`)
        continue
      }
      sourceMaterials.push({
        sourceKey: `${SOURCE_KEY_PREFIX}${relativePath}`,
        sourcePath: path,
        originalFileName: basename(path).normalize('NFC'),
        mimeType: mimeTypeOf(path),
        importedAt: info.mtime.toISOString(),
        status: 'available',
      })
    }
  }

  await visit(canonicalInbox)
  sourceMaterials.sort((left, right) => order(left.sourceKey, right.sourceKey))
  warnings.sort(order)
  return Object.freeze({
    inboxRoot: canonicalInbox,
    sourceMaterials: Object.freeze(sourceMaterials),
    warnings: Object.freeze(warnings),
  })
}
