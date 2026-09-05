import { basename, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  CommandDefinition,
  CommandInvocation,
  CommandResult,
} from '@deepseek-ai/dsh-commands'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import type { ProjectRepository } from '../state/repository.ts'
import type { FrozenProjectInput, ReportAsset } from '../report/types.ts'
import {
  PRE_DESIGN_VERSION,
  PRESENTATION_PROJECT_FORMAT_NAME,
  PRESENTATION_PROJECT_FORMAT_VERSION,
  PRESENTATION_PROJECT_SUCCESS_MARKER,
} from '../version.ts'
import type { PresentationAutoSyncService } from './auto-sync.ts'
import { openDirectoryInFileManager } from './open-directory.ts'
import type { PresentationStandardProjectService } from './standard-project-service.ts'
import type { PresentationAdoptedAssetInput } from './standard-project-types.ts'
import { preparePresentationMaterials } from './material-registry.ts'
import {
  resolveInvocationWorkspaceRoot,
  type WorkspaceInvocationLike,
} from './workspace-context.ts'

export const PRE_DESIGN_WORKSPACE_EMPTY_MARKER = 'PRE_DESIGN_WORKSPACE_EMPTY'
export const PRE_DESIGN_WORKSPACE_ATTACHED_MARKER = 'PRE_DESIGN_WORKSPACE_PROJECT_ATTACHED'

export interface PresentationRuntimeDependencies {
  readonly repository: Pick<ProjectRepository, 'readContext' | 'bindSession'>
  readonly standardProjects: Pick<
    PresentationStandardProjectService,
    'exportProject' | 'findByWorkspaceRoot' | 'findByPreDesignProjectId'
  >
  readonly source: (
    projectId: string,
    revision: number,
  ) => FrozenProjectInput | Promise<FrozenProjectInput>
  readonly autoSync?: Pick<PresentationAutoSyncService, 'noteExplicitSuccess'>
  readonly resolveWorkspaceRoot?: (
    value: WorkspaceInvocationLike,
  ) => Promise<string | undefined>
  readonly openDirectory?: (directoryRoot: string) => Promise<void>
  readonly now?: () => string
}

export interface PresentationRuntimeSyncResult {
  readonly preDesignProjectId: string
  readonly preDesignRevision: number
  readonly presentationProjectId: string
  readonly directoryRoot: string
  readonly standardName: typeof PRESENTATION_PROJECT_FORMAT_NAME
  readonly standardVersion: typeof PRESENTATION_PROJECT_FORMAT_VERSION
  readonly validationMarker: typeof PRESENTATION_PROJECT_SUCCESS_MARKER
  readonly replacedExisting: boolean
  readonly materialWarnings?: readonly string[]
}

function fileNameOf(path: string): string {
  return win32.isAbsolute(path) || path.includes('\\')
    ? win32.basename(path)
    : basename(path)
}

function semanticRoleOf(asset: ReportAsset): string {
  if (asset.kind === 'concept') return 'concept_visual'
  if (asset.kind === 'deterministic') return 'analytical_diagram'
  return 'evidence_visual'
}

function objectIdsOf(asset: ReportAsset, project: FrozenProjectInput): string[] {
  return project.stateObjects
    .filter(object => asset.workItemId !== undefined && object.workItemId === asset.workItemId)
    .map(object => object.objectId)
    .sort((left, right) => left.localeCompare(right))
}

export function adoptedPresentationAssets(
  project: FrozenProjectInput,
): readonly PresentationAdoptedAssetInput[] {
  const adopted = new Set(project.adoptedAssetIds ?? project.visualAssets.map(asset => asset.assetId))
  return project.visualAssets
    .filter(asset => adopted.has(asset.assetId))
    .map(asset => {
      const generated = asset.kind !== 'evidence'
      return {
        sourceKey: asset.assetId,
        sourcePath: asset.sourcePath,
        displayName: asset.caption.trim() === '' ? asset.assetId : asset.caption,
        originalFileName: fileNameOf(asset.sourcePath),
        mimeType: asset.mimeType,
        semanticRole: semanticRoleOf(asset),
        ...(asset.width === undefined ? {} : { widthPx: asset.width }),
        ...(asset.height === undefined ? {} : { heightPx: asset.height }),
        createdAt: project.generatedAt,
        adoptedAt: project.generatedAt,
        origin: {
          type: generated ? 'generated_by_plugin' : 'human_added',
          sourceMaterialKeys: [],
          parentAssetKeys: [],
          method: generated
            ? 'generated and adopted by pre-design'
            : 'adopted as project evidence by pre-design',
          sourceTool: generated
            ? { name: 'pre-design', version: PRE_DESIGN_VERSION }
            : null,
        },
        objectIds: objectIdsOf(asset, project),
        evidenceIds: [],
      } satisfies PresentationAdoptedAssetInput
    })
}

function sessionIdOf(value: { readonly agent?: { readonly id: unknown } }): string {
  if (value.agent === undefined) {
    throw new Error('Presentation 标准项目操作必须在 DSH Agent Session 中执行。')
  }
  return String(value.agent.id)
}

function jsonSnapshot(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function nowOf(dependencies: PresentationRuntimeDependencies): string {
  return (dependencies.now ?? (() => new Date().toISOString()))()
}

function errorCodeOf(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined
  const code = (error as { readonly code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function stringDetail(details: unknown, key: string): string | undefined {
  if (details === null || typeof details !== 'object') return undefined
  const value = Reflect.get(details, key)
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

export function formatPresentationOperationError(error: unknown): string {
  if (errorCodeOf(error) !== 'PRE_DESIGN_WORKSPACE_MIGRATION_CONFIRMATION_REQUIRED') {
    return error instanceof Error ? error.message : 'Presentation 标准项目操作失败。'
  }
  const details = (error as { readonly details?: unknown }).details
  const previous = stringDetail(details, 'previousDirectoryRoot')
  const requested = stringDetail(details, 'requestedDirectoryRoot')
  return [
    'PRE_DESIGN_WORKSPACE_MIGRATION_CONFIRMATION_REQUIRED：检测到旧版标准项目，需要一次性确认迁移到当前 DSH Workspace。',
    ...(previous === undefined ? [] : [`旧版标准项目：${previous}。`]),
    ...(requested === undefined ? [] : [`当前目标工作区：${requested}。`]),
    '请在当前 DSH 会话执行 /preplan-presentation-sync --force。',
    '该操作保留 Stable ID、Presentation Project ID 和 Pre Revision；旧目录不会自动删除。',
  ].join('\n')
}

async function workspaceRootOf(
  dependencies: PresentationRuntimeDependencies,
  carrier: WorkspaceInvocationLike,
): Promise<string | undefined> {
  return (dependencies.resolveWorkspaceRoot ?? resolveInvocationWorkspaceRoot)(carrier)
}

async function attachWorkspaceProject(
  dependencies: PresentationRuntimeDependencies,
  sessionId: string,
  workspaceRoot: string,
) {
  const binding = dependencies.standardProjects.findByWorkspaceRoot(workspaceRoot)
  if (binding === undefined) return undefined
  await dependencies.repository.bindSession(
    sessionId,
    binding.preDesignProjectId,
    nowOf(dependencies),
  )
  return binding
}

export async function syncPresentationProject(
  dependencies: PresentationRuntimeDependencies,
  sessionId: string,
  confirmExternalChanges = false,
  workspaceRoot?: string,
): Promise<PresentationRuntimeSyncResult> {
  if (workspaceRoot !== undefined) {
    await attachWorkspaceProject(dependencies, sessionId, workspaceRoot)
  }
  const context = dependencies.repository.readContext(sessionId)
  const frozenProject = await dependencies.source(
    context.project.projectId,
    context.project.currentRevision,
  )
  const binding = dependencies.standardProjects.findByPreDesignProjectId?.(frozenProject.projectId)
  const materials = await preparePresentationMaterials({
    frozenProject,
    workspaceRoot: workspaceRoot ?? binding?.workspaceRoot ?? binding?.directoryRoot,
    assets: adoptedPresentationAssets(frozenProject),
    previous: binding,
  })
  const published = await dependencies.standardProjects.exportProject({
    frozenProject,
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
    assets: materials.assets,
    sourceMaterials: materials.sourceMaterials,
    confirmExternalChanges,
  })
  if (!published.validation.valid) {
    throw new Error('PRESENTATION_STANDARD_PROJECT_VALIDATION_FAILED: Contract 校验未通过。')
  }
  const result = Object.freeze({
    preDesignProjectId: context.project.projectId,
    preDesignRevision: context.project.currentRevision,
    presentationProjectId: published.projectId,
    directoryRoot: published.directoryRoot,
    standardName: PRESENTATION_PROJECT_FORMAT_NAME,
    standardVersion: PRESENTATION_PROJECT_FORMAT_VERSION,
    validationMarker: PRESENTATION_PROJECT_SUCCESS_MARKER,
    replacedExisting: published.replacedExisting,
    materialWarnings: materials.materialWarnings,
  })
  dependencies.autoSync?.noteExplicitSuccess(result.preDesignProjectId, {
    preDesignRevision: result.preDesignRevision,
    directoryRoot: result.directoryRoot,
    reason: confirmExternalChanges ? 'manual-force-sync' : 'manual-sync',
    ...(materials.materialWarnings.length === 0 ? {} : { message: materials.materialWarnings.join('；') }),
  })
  return result
}

function commandResultText(result: PresentationRuntimeSyncResult): string {
  return [
    '已生成可由 Presentation 直接读取的标准项目。',
    ...(result.materialWarnings ?? []).map(warning => `资料提示：${warning}`),
    `目录：${result.directoryRoot}`,
    `Presentation Project ID：${result.presentationProjectId}`,
    `Pre Revision：${result.preDesignRevision}`,
    `格式：${result.standardName} ${result.standardVersion}`,
    `校验：${result.validationMarker}`,
  ].join('\n')
}

function guarded(
  handler: (invocation: CommandInvocation) => Promise<CommandResult>,
): CommandDefinition['handler'] {
  return async invocation => {
    try {
      return await handler(invocation)
    } catch (error) {
      return {
        kind: 'error',
        text: formatPresentationOperationError(error),
      }
    }
  }
}

async function probeWorkspace(
  dependencies: PresentationRuntimeDependencies,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const sessionId = sessionIdOf(invocation)
  const workspaceRoot = await workspaceRootOf(dependencies, invocation)
  if (workspaceRoot === undefined) {
    return {
      kind: 'success',
      text: `${PRE_DESIGN_WORKSPACE_EMPTY_MARKER}\n当前 Session 没有 DSH Workspace；将保留显式兼容输出模式。`,
    }
  }
  const binding = await attachWorkspaceProject(
    dependencies,
    sessionId,
    workspaceRoot,
  )
  if (binding === undefined) {
    try {
      const context = dependencies.repository.readContext(sessionId)
      return {
        kind: 'success',
        text: [
          PRE_DESIGN_WORKSPACE_ATTACHED_MARKER,
          `工作区：${workspaceRoot}`,
          `Pre Project ID：${context.project.projectId}`,
          '状态：当前 Session 已有 Pre 项目；首次同步将建立 Workspace 绑定。',
        ].join('\n'),
      }
    } catch (error) {
      if (errorCodeOf(error) !== 'session-not-bound') throw error
    }
    return {
      kind: 'success',
      text: `${PRE_DESIGN_WORKSPACE_EMPTY_MARKER}\n工作区：${workspaceRoot}`,
    }
  }
  return {
    kind: 'success',
    text: [
      PRE_DESIGN_WORKSPACE_ATTACHED_MARKER,
      `工作区：${workspaceRoot}`,
      `Pre Project ID：${binding.preDesignProjectId}`,
      ...(binding.presentationProjectId === undefined
        ? []
        : [`Presentation Project ID：${binding.presentationProjectId}`]),
    ].join('\n'),
  }
}

export function registerPresentationRuntime(
  ctx: Context,
  dependencies: PresentationRuntimeDependencies,
): void {
  ctx.commands.register({
    name: 'preplan-presentation-sync',
    description: '探测、创建或更新当前 DSH 工作区中的 Presentation 标准项目',
    input: { hint: '[--probe|--force]' },
    handler: guarded(async invocation => {
      const raw = invocation.rawInput.trim()
      if (raw === '--probe') return probeWorkspace(dependencies, invocation)
      if (raw !== '' && raw !== '--force') {
        return { kind: 'error', text: '仅支持空参数、--probe 或 --force。' }
      }
      const workspaceRoot = await workspaceRootOf(dependencies, invocation)
      const result = await syncPresentationProject(
        dependencies,
        sessionIdOf(invocation),
        raw === '--force',
        workspaceRoot,
      )
      return { kind: 'success', text: commandResultText(result) }
    }),
  })

  ctx.commands.register({
    name: 'preplan-open-project-folder',
    description: '在系统文件管理器中打开当前 DSH 工作区项目总文件夹',
    handler: guarded(async invocation => {
      const sessionId = sessionIdOf(invocation)
      const workspaceRoot = await workspaceRootOf(dependencies, invocation)
      let directoryRoot: string
      if (workspaceRoot !== undefined) {
        directoryRoot = workspaceRoot
      } else {
        const context = dependencies.repository.readContext(sessionId)
        const binding = dependencies.standardProjects.findByPreDesignProjectId(
          context.project.projectId,
        )
        if (binding?.directoryRoot === undefined) {
          return {
            kind: 'error',
            text: '当前项目尚未生成标准项目目录，请先执行 /preplan-presentation-sync。',
          }
        }
        directoryRoot = binding.directoryRoot
      }
      await (dependencies.openDirectory ?? openDirectoryInFileManager)(directoryRoot)
      return { kind: 'success', text: `已打开项目文件夹：${directoryRoot}` }
    }),
  })

  ctx.tools.register(defineTool({
    name: 'preplanning_sync_presentation_project',
    description: '将当前前期策划项目写入当前 DSH 工作区根目录；默认拒绝覆盖外部修改。',
    parameters: {
      confirmExternalChanges: {
        type: 'boolean',
        description: '仅在用户明确要求覆盖 Presentation 侧已有修改时设为 true。',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const workspaceRoot = await workspaceRootOf(dependencies, exec)
      return jsonSnapshot(await syncPresentationProject(
        dependencies,
        sessionIdOf(exec),
        args.confirmExternalChanges === true,
        workspaceRoot,
      ))
    },
  }))
}
