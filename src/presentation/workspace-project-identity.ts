import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectId } from '@architectureworld/presentation-contracts'
import { getPresentationStandardContract } from './standard-contract.ts'
import { PresentationStandardProjectError } from './standard-project-error.ts'
import { workspaceContainsPreDesignFilesWithoutProject } from './workspace-managed-paths.ts'

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function identityError(
  code: 'PROJECT_ID_CONFLICT' | 'PROJECT_ID_MISSING' | 'PROJECT_ID_INVALID',
  message: string,
  details?: unknown,
): PresentationStandardProjectError {
  return new PresentationStandardProjectError(code, 'preflight', message, details)
}

export async function readWorkspaceProjectId(
  workspaceRoot: string,
): Promise<ProjectId | undefined> {
  const projectPath = join(workspaceRoot, 'project.json')
  if (!await exists(projectPath)) {
    if (await workspaceContainsPreDesignFilesWithoutProject(workspaceRoot)) {
      throw identityError(
        'PROJECT_ID_MISSING',
        'Workspace contains reserved Pre standard-project files but project.json is missing',
        { workspaceRoot },
      )
    }
    return undefined
  }

  const info = await lstat(projectPath)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw identityError(
      'PROJECT_ID_INVALID',
      'project.json must be a regular file and cannot be a symbolic link',
      { projectPath },
    )
  }

  let document: unknown
  try {
    document = JSON.parse(await readFile(projectPath, 'utf8'))
  } catch (error) {
    throw identityError(
      'PROJECT_ID_INVALID',
      'project.json is not valid JSON',
      { cause: error instanceof Error ? error.message : String(error) },
    )
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw identityError('PROJECT_ID_INVALID', 'project.json must contain a JSON object')
  }

  const projectId = Reflect.get(document, 'projectId')
  if (projectId === undefined || projectId === null || projectId === '') {
    throw identityError('PROJECT_ID_MISSING', 'project.json.projectId is required')
  }
  const contract = await getPresentationStandardContract()
  if (!contract.isId('project', projectId)) {
    throw identityError(
      'PROJECT_ID_INVALID',
      'project.json.projectId is not a Contract 0.1.0 project ID',
      { projectId },
    )
  }
  return projectId as ProjectId
}

export async function assertWorkspaceProjectId(
  workspaceRoot: string,
  expectedProjectId: string,
): Promise<ProjectId | undefined> {
  const contract = await getPresentationStandardContract()
  if (!contract.isId('project', expectedProjectId)) {
    throw identityError(
      'PROJECT_ID_INVALID',
      'candidate projectId is not a Contract 0.1.0 project ID',
      { expectedProjectId },
    )
  }
  const existingProjectId = await readWorkspaceProjectId(workspaceRoot)
  if (existingProjectId !== undefined && existingProjectId !== expectedProjectId) {
    throw identityError(
      'PROJECT_ID_CONFLICT',
      `Workspace projectId '${existingProjectId}' conflicts with candidate '${expectedProjectId}'`,
      { existingProjectId, expectedProjectId },
    )
  }
  return existingProjectId
}
