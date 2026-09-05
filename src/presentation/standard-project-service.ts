import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import type { ProjectId } from '@architectureworld/presentation-contracts'
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
import { readWorkspaceProjectId } from './workspace-project-identity.ts'
import { publishPresentationStandardProjectIntoWorkspace } from './workspace-project-writer.ts'
import { recoverPresentationWorkspaceTransaction } from './workspace-write-transaction.ts'
import {
  createAwaitingPresentationBinding,
  type PresentationDirectoryState,
  type PresentationProjectBindingRecord,
} from './types.ts'

export interface PresentationStandardProjectServiceOptions {
  readonly bindings: PresentationBindingRepository
  readonly workspaceRoot: string
  readonly now?: () => string
}

export type PresentationStandardProjectServiceResult = PresentationStandardProjectPublishResult & {
  readonly stableIds: Readonly<Record<string, string>>
}

const RECOVERABLE_BINDING_STATES: readonly PresentationDirectoryState[] = [
  'awaiting_contract', 'creating', 'ready', 'recovery_required',
]

function projectIdConflict(
  workspaceRoot: string,
  workspaceProjectId: string,
  boundProjectId: string,
): PresentationStandardProjectError {
  return new PresentationStandardProjectError(
    'PROJECT_ID_CONFLICT',
    'preflight',
    `Workspace projectId '${workspaceProjectId}' conflicts with bound projectId '${boundProjectId}'`,
    { workspaceRoot, workspaceProjectId, boundProjectId },
  )
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

  async recoverBoundWorkspaces(): Promise<number> {
    const roots = new Set<string>()
    for (const state of RECOVERABLE_BINDING_STATES) {
      for (const binding of this.options.bindings.listByState(state)) {
        if (binding.workspaceRoot !== undefined) roots.add(resolve(binding.workspaceRoot))
      }
    }
    let recovered = 0
    for (const workspaceRoot of [...roots].sort((left, right) => left.localeCompare(right))) {
      const result = await recoverPresentationWorkspaceTransaction(workspaceRoot)
      if (result.status === 'recovered') recovered += 1
    }
    return recovered
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

    let existing = this.options.bindings.read(preDesignProjectId)
    if (existing?.workspaceRoot !== undefined
      && requestedWorkspaceRoot !== undefined
      && existing.workspaceRoot !== requestedWorkspaceRoot) {
      throw new PresentationStandardProjectError(
        'PRE_DESIGN_WORKSPACE_BINDING_IMMUTABLE',
        'preflight',
        `pre-design project '${preDesignProjectId}' already belongs to Workspace '${existing.workspaceRoot}'`,
      )
    }

    const workspaceProjectId = requestedWorkspaceRoot === undefined
      ? undefined
      : await readWorkspaceProjectId(requestedWorkspaceRoot)
    const boundProjectId = existing?.presentationProjectId
      ?? workspaceOwner?.presentationProjectId
    if (workspaceProjectId !== undefined
      && boundProjectId !== undefined
      && workspaceProjectId !== boundProjectId) {
      throw projectIdConflict(requestedWorkspaceRoot!, workspaceProjectId, boundProjectId)
    }
    const authoritativeProjectId = (workspaceProjectId ?? boundProjectId) as ProjectId | undefined

    const createdAt = existing?.createdAt ?? input.createdAt ?? input.frozenProject.generatedAt
    if (existing === undefined && requestedWorkspaceRoot !== undefined) {
      existing = await this.options.bindings.put(createAwaitingPresentationBinding({
        preDesignProjectId,
        workspaceRoot: requestedWorkspaceRoot,
        createdAt,
      }))
    }

    const projectSlug = existing?.projectSlug
      ?? input.projectSlug
      ?? normalizeProjectSlug(input.frozenProject.projectName)
    const build = await buildPresentationStandardProject({
      frozenProject: input.frozenProject,
      projectSlug,
      presentationProjectId: authoritativeProjectId,
      stableIds: existing?.stableIds,
      rules: input.rules,
      sourceMaterials: input.sourceMaterials,
      assets: input.assets,
      createdAt,
      actorId: input.actorId,
    })

    const directoryRoot = requestedWorkspaceRoot
      ?? join(this.options.workspaceRoot, build.directoryName)
    const previousDirectoryRoot = existing?.directoryRoot
    const directoryChanged = previousDirectoryRoot !== undefined
      && previousDirectoryRoot !== directoryRoot
    if (directoryChanged
      && existing !== undefined
      && Object.keys(existing.lastExportedFileHashes).length > 0
      && input.confirmExternalChanges !== true) {
      throw new PresentationStandardProjectError(
        'PRE_DESIGN_WORKSPACE_MIGRATION_CONFIRMATION_REQUIRED',
        'preflight',
        `existing standard project is '${previousDirectoryRoot}', explicit --force is required before rebinding to '${directoryRoot}'`,
        { previousDirectoryRoot, requestedDirectoryRoot: directoryRoot },
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
