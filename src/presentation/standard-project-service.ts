import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import type { FrozenProjectInput } from '../report/types.ts'
import { PresentationBindingRepository } from './binding-repository.ts'
import { normalizeProjectSlug } from './path-policy.ts'
import { buildPresentationStandardProject } from './standard-project-adapter.ts'
import {
  PresentationStandardProjectError,
  asPresentationStandardProjectError,
} from './standard-project-error.ts'
import type {
  CreatePresentationStandardProjectInput,
  ExportPresentationStandardProjectInput,
  PresentationStandardProjectPublishResult,
} from './standard-project-types.ts'
import { publishPresentationStandardProject } from './standard-project-writer.ts'
import { publishPresentationStandardProjectIntoWorkspace } from './workspace-project-writer.ts'
import type { PresentationProjectBindingRecord } from './types.ts'

export interface PresentationStandardProjectServiceOptions {
  readonly bindings: PresentationBindingRepository
  readonly workspaceRoot: string
  readonly now?: () => string
}

export type PresentationStandardProjectServiceResult = PresentationStandardProjectPublishResult & {
  readonly stableIds: Readonly<Record<string, string>>
}

export class PresentationStandardProjectService {
  private chain: Promise<void> = Promise.resolve()
  private readonly now: () => string

  constructor(private readonly options: PresentationStandardProjectServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString())
  }

  findByWorkspaceRoot(workspaceRoot: string): PresentationProjectBindingRecord | undefined {
    return this.options.bindings.findByWorkspaceRoot(resolve(workspaceRoot))
  }

  findByPreDesignProjectId(preDesignProjectId: string): PresentationProjectBindingRecord | undefined {
    return this.options.bindings.read(preDesignProjectId)
  }

  createProject(
    input: CreatePresentationStandardProjectInput,
  ): Promise<PresentationStandardProjectServiceResult> {
    return this.serialize(async () => {
      const existing = this.options.bindings.read(input.preDesignProjectId)
      if (existing?.state === 'ready') {
        throw new PresentationStandardProjectError(
          'PRESENTATION_STANDARD_PROJECT_ALREADY_BOUND',
          'preflight',
          `pre-design project '${input.preDesignProjectId}' already has a ready standard project`,
          { directoryRoot: existing.directoryRoot },
        )
      }
      const frozenProject: FrozenProjectInput = {
        projectId: input.preDesignProjectId,
        projectName: input.projectName,
        revision: 0,
        generatedAt: input.createdAt,
        recommendation: '',
        decisionItems: [],
        stateObjects: [],
        gates: [],
        visualAssets: [],
        adoptedAssetIds: [],
        siteBoundary: { status: 'not_provided' },
      }
      return this.publish({
        frozenProject,
        projectSlug: input.projectSlug,
        workspaceRoot: input.workspaceRoot,
        createdAt: input.createdAt,
        rules: input.rules,
        actorId: input.actorId,
        confirmExternalChanges: false,
      })
    })
  }

  exportProject(
    input: ExportPresentationStandardProjectInput,
  ): Promise<PresentationStandardProjectServiceResult> {
    return this.serialize(() => this.publish({
      frozenProject: input.frozenProject,
      workspaceRoot: input.workspaceRoot,
      rules: input.rules,
      sourceMaterials: input.sourceMaterials,
      assets: input.assets,
      confirmExternalChanges: input.confirmExternalChanges,
      writerHooks: input.writerHooks,
    }))
  }

  private async publish(input: {
    readonly frozenProject: FrozenProjectInput
    readonly projectSlug?: string
    readonly workspaceRoot?: string
    readonly createdAt?: string
    readonly actorId?: string | null
    readonly rules?: ExportPresentationStandardProjectInput['rules']
    readonly sourceMaterials?: ExportPresentationStandardProjectInput['sourceMaterials']
    readonly assets?: ExportPresentationStandardProjectInput['assets']
    readonly confirmExternalChanges?: boolean
    readonly writerHooks?: ExportPresentationStandardProjectInput['writerHooks']
  }): Promise<PresentationStandardProjectServiceResult> {
    const preDesignProjectId = input.frozenProject.projectId
    const requestedWorkspaceRoot = input.workspaceRoot === undefined
      ? undefined
      : resolve(input.workspaceRoot)
    const workspaceOwner = requestedWorkspaceRoot === undefined
      ? undefined
      : this.options.bindings.findByWorkspaceRoot(requestedWorkspaceRoot)
    if (workspaceOwner !== undefined && workspaceOwner.preDesignProjectId !== preDesignProjectId) {
      throw new PresentationStandardProjectError(
        'PRE_DESIGN_WORKSPACE_ALREADY_BOUND',
        'preflight',
        `Workspace '${requestedWorkspaceRoot}' already belongs to pre-design project '${workspaceOwner.preDesignProjectId}'`,
      )
    }

    const existing = this.options.bindings.read(preDesignProjectId)
    if (existing?.workspaceRoot !== undefined
      && requestedWorkspaceRoot !== undefined
      && existing.workspaceRoot !== requestedWorkspaceRoot) {
      throw new PresentationStandardProjectError(
        'PRE_DESIGN_WORKSPACE_BINDING_IMMUTABLE',
        'preflight',
        `pre-design project '${preDesignProjectId}' already belongs to Workspace '${existing.workspaceRoot}'`,
      )
    }

    const createdAt = existing?.createdAt ?? input.createdAt ?? input.frozenProject.generatedAt
    const projectSlug = existing?.projectSlug
      ?? input.projectSlug
      ?? normalizeProjectSlug(input.frozenProject.projectName)
    const build = await buildPresentationStandardProject({
      frozenProject: input.frozenProject,
      projectSlug,
      presentationProjectId: existing?.presentationProjectId as Parameters<typeof buildPresentationStandardProject>[0]['presentationProjectId'],
      stableIds: existing?.stableIds,
      rules: input.rules,
      sourceMaterials: input.sourceMaterials,
      assets: input.assets,
      createdAt,
      actorId: input.actorId,
    })

    const directoryRoot = requestedWorkspaceRoot
      ?? join(this.options.workspaceRoot, build.directoryName)
    const directoryChanged = existing?.directoryRoot !== undefined
      && existing.directoryRoot !== directoryRoot
    if (directoryChanged
      && Object.keys(existing.lastExportedFileHashes).length > 0
      && input.confirmExternalChanges !== true) {
      throw new PresentationStandardProjectError(
        'PRE_DESIGN_WORKSPACE_MIGRATION_CONFIRMATION_REQUIRED',
        'preflight',
        `existing standard project is '${existing.directoryRoot}', explicit --force is required before rebinding to '${directoryRoot}'`,
        { previousDirectoryRoot: existing.directoryRoot, requestedDirectoryRoot: directoryRoot },
      )
    }

    const timestamp = this.now()
    const creating: PresentationProjectBindingRecord = {
      preDesignProjectId,
      presentationProjectId: build.projectId,
      projectSlug,
      ...(requestedWorkspaceRoot === undefined ? {} : { workspaceRoot: requestedWorkspaceRoot }),
      directoryRoot,
      standardVersion: '0.1.0',
      state: 'creating',
      stableIds: build.stableIds,
      ...(existing?.lastExportedPreDesignRevision === undefined
        ? {}
        : { lastExportedPreDesignRevision: existing.lastExportedPreDesignRevision }),
      ...(existing?.lastExportedAt === undefined ? {} : { lastExportedAt: existing.lastExportedAt }),
      lastExportedObjectHashes: existing?.lastExportedObjectHashes ?? {},
      lastExportedFileHashes: existing?.lastExportedFileHashes ?? {},
      createdAt,
      updatedAt: timestamp,
    }
    await this.options.bindings.put(creating)

    try {
      const sameDirectory = existing?.directoryRoot === directoryRoot
      const expectedExistingFileHashes = sameDirectory
        && existing !== undefined
        && Object.keys(existing.lastExportedFileHashes).length > 0
        ? existing.lastExportedFileHashes
        : undefined
      const operationId = `export-r${input.frozenProject.revision}-${randomUUID()}`
      const published = requestedWorkspaceRoot === undefined
        ? await publishPresentationStandardProject({
            workspaceRoot: this.options.workspaceRoot,
            build,
            operationId,
            expectedExistingFileHashes,
            confirmExternalChanges: input.confirmExternalChanges,
            hooks: input.writerHooks,
          })
        : await publishPresentationStandardProjectIntoWorkspace({
            directoryRoot: requestedWorkspaceRoot,
            build,
            operationId,
            expectedExistingFileHashes,
            confirmExternalChanges: input.confirmExternalChanges,
            hooks: input.writerHooks,
          })
      const ready: PresentationProjectBindingRecord = {
        ...creating,
        state: 'ready',
        stableIds: build.stableIds,
        lastExportedPreDesignRevision: input.frozenProject.revision,
        lastExportedAt: timestamp,
        lastExportedObjectHashes: build.semanticObjectHashes,
        lastExportedFileHashes: published.fileHashes,
        updatedAt: timestamp,
      }
      await this.options.bindings.put(ready)
      return Object.freeze({ ...published, stableIds: build.stableIds })
    } catch (error) {
      const structured = asPresentationStandardProjectError(error, 'commit')
      const failureTime = this.now()
      const recovery: PresentationProjectBindingRecord = {
        ...creating,
        state: 'recovery_required',
        lastFailure: {
          code: structured.code,
          stage: structured.stage,
          message: structured.message,
          failedAt: failureTime,
        },
        updatedAt: failureTime,
      }
      await this.options.bindings.put(recovery)
      throw structured
    }
  }

  private serialize<T>(job: () => Promise<T>): Promise<T> {
    const result = this.chain.then(job)
    this.chain = result.then(() => undefined, () => undefined)
    return result
  }
}
