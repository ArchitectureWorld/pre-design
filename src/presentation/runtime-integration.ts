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
import type { PresentationStandardProjectService } from './standard-project-service.ts'
import type { PresentationAdoptedAssetInput } from './standard-project-types.ts'

export interface PresentationRuntimeDependencies {
  readonly repository: Pick<ProjectRepository, 'readContext'>
  readonly standardProjects: Pick<PresentationStandardProjectService, 'exportProject'>
  readonly source: (
    projectId: string,
    revision: number,
  ) => FrozenProjectInput | Promise<FrozenProjectInput>
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
    .filter(object => asset.workItemId !== undefined
      ? object.workItemId === asset.workItemId
      : asset.chapterId !== undefined && object.chapterId === asset.chapterId)
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
    throw new Error('Presentation 标准项目同步必须在 DSH Agent Session 中执行。')
  }
  return String(value.agent.id)
}

function jsonSnapshot(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

export async function syncPresentationProject(
  dependencies: PresentationRuntimeDependencies,
  sessionId: string,
  confirmExternalChanges = false,
): Promise<PresentationRuntimeSyncResult> {
  const context = dependencies.repository.readContext(sessionId)
  const frozenProject = await dependencies.source(
    context.project.projectId,
    context.project.currentRevision,
  )
  const published = await dependencies.standardProjects.exportProject({
    frozenProject,
    assets: adoptedPresentationAssets(frozenProject),
    confirmExternalChanges,
  })
  if (!published.validation.valid) {
    throw new Error('PRESENTATION_STANDARD_PROJECT_VALIDATION_FAILED: Contract 校验未通过。')
  }
  return Object.freeze({
    preDesignProjectId: context.project.projectId,
    preDesignRevision: context.project.currentRevision,
    presentationProjectId: published.projectId,
    directoryRoot: published.directoryRoot,
    standardName: PRESENTATION_PROJECT_FORMAT_NAME,
    standardVersion: PRESENTATION_PROJECT_FORMAT_VERSION,
    validationMarker: PRESENTATION_PROJECT_SUCCESS_MARKER,
    replacedExisting: published.replacedExisting,
  })
}

function commandResultText(result: PresentationRuntimeSyncResult): string {
  return [
    '已生成可由 Presentation 直接读取的标准项目。',
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
        text: error instanceof Error ? error.message : 'Presentation 标准项目同步失败。',
      }
    }
  }
}

export function registerPresentationRuntime(
  ctx: Context,
  dependencies: PresentationRuntimeDependencies,
): void {
  ctx.commands.register({
    name: 'preplan-presentation-sync',
    description: '创建或更新可由 Presentation 直接读取的标准项目目录',
    input: { hint: '[--force]' },
    handler: guarded(async invocation => {
      const raw = invocation.rawInput.trim()
      if (raw !== '' && raw !== '--force') {
        return { kind: 'error', text: '仅支持空参数或 --force。' }
      }
      const result = await syncPresentationProject(
        dependencies,
        sessionIdOf(invocation),
        raw === '--force',
      )
      return { kind: 'success', text: commandResultText(result) }
    }),
  })

  ctx.tools.register(defineTool({
    name: 'preplanning_sync_presentation_project',
    description: '将当前前期策划项目写入可由 Presentation Tools 直接读取的标准项目目录；默认拒绝覆盖外部修改。',
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
      return jsonSnapshot(await syncPresentationProject(
        dependencies,
        sessionIdOf(exec),
        args.confirmExternalChanges === true,
      ))
    },
  }))
}
