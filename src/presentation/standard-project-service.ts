import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
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
    readonly createdAt?: string
    readonly actorId?: string | null
    readonly rules?: ExportPresentationStandardProjectInput['rules']
    readonly sourceMaterials?: ExportPresentationStandardProjectInput['sourceMaterials']
    readonly assets?: ExportPresentationStandardProjectInput['assets']
    readonly confirmExternalChanges?: boolean
    readonly writerHooks?: ExportPresentationStandardProjectInput['writerHooks']
  }): Promise<PresentationStandardProjectServiceResult> {
    const preDesignProjectId = input.frozenProject.projectId
    const existing = this.options.bindings.read(preDesignProjectId)
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
    const directoryRoot = join(this.options.workspaceRoot, build.directoryName)
    if (existing?.directoryRoot !== undefined && existing.directoryRoot !== directoryRoot) {
      throw new PresentationStandardProjectError(
        'PRESENTATION_BINDING_DIRECTORY_IMMUTABLE',
        'preflight',
        `binding directory '${existing.directoryRoot}' does not match '${directoryRoot}'`,
      )
    }

    const timestamp = this.now()
    const creating: PresentationProjectBindingRecord = {
      preDesignProjectId,
      presentationProjectId: build.projectId,
      projectSlug,
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
      const expectedExistingFileHashes = existing === undefined
        || Object.keys(existing.lastExportedFileHashes).length === 0
        ? undefined
        : existing.lastExportedFileHashes
      const published = await publishPresentationStandardProject({
        workspaceRoot: this.options.workspaceRoot,
        build,
        operationId: `export-r${input.frozenProject.revision}-${randomUUID()}`,
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
