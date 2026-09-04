import type {
  AssetManifest,
  CanonicalDocument,
  CreatedBy,
  DraftPageDocument,
  ProjectDirectoryPlan,
  ProjectId,
  ProjectManifest,
  ProjectRulesDocument,
  ProjectValidationResult,
  SourceMaterialManifest,
  StableIdKind,
  ValidationIssue,
} from '@architectureworld/presentation-contracts'
import type { FrozenProjectInput } from '../report/types.ts'

export interface PresentationRulesInput {
  readonly audiences: readonly string[]
  readonly purposes: readonly string[]
  readonly language: string
  readonly writingRules: readonly string[]
  readonly terminology: Readonly<Record<string, string>>
  readonly truthConstraints: readonly string[]
  readonly visualIntent: readonly string[]
  readonly prohibitedContent?: readonly string[]
}

export type PresentationSourceMaterialStatus = 'available' | 'archived' | 'missing' | 'quarantined'

export interface PresentationSourceMaterialInput {
  readonly sourceKey: string
  readonly sourcePath: string
  readonly originalFileName: string
  readonly mimeType: string
  readonly importedAt: string
  readonly status?: PresentationSourceMaterialStatus
}

export interface PresentationSourceToolInput {
  readonly name: string
  readonly version: string
}

export type PresentationAssetOriginType =
  | 'source_material'
  | 'derived_source_material'
  | 'generated_by_plugin'
  | 'generated_by_tool'
  | 'human_added'

export interface PresentationAssetOriginInput {
  readonly type: PresentationAssetOriginType
  readonly sourceMaterialKeys: readonly string[]
  readonly parentAssetKeys: readonly string[]
  readonly method: string
  readonly sourceTool: PresentationSourceToolInput | null
}

export interface PresentationAdoptedAssetInput {
  readonly sourceKey: string
  readonly sourcePath: string
  readonly displayName: string
  readonly originalFileName: string
  readonly mimeType: string
  readonly semanticRole: string
  readonly widthPx?: number
  readonly heightPx?: number
  readonly durationMs?: number
  readonly pageCount?: number
  readonly rowCount?: number
  readonly columnCount?: number
  readonly createdAt: string
  readonly adoptedAt: string
  readonly origin: PresentationAssetOriginInput
  readonly objectIds: readonly string[]
  readonly evidenceIds: readonly string[]
}

export interface PresentationManagedFile {
  readonly domain: 'source-materials' | 'assets'
  readonly sourceKey: string
  readonly stableId: string
  readonly sourcePath: string
  readonly relativePath: string
  readonly mimeType: string
  readonly sizeBytes: number
  readonly sha256: string
}

export interface PresentationStandardProjectBuildInput {
  readonly frozenProject: FrozenProjectInput
  readonly projectSlug?: string
  readonly presentationProjectId?: ProjectId
  readonly stableIds?: Readonly<Record<string, string>>
  readonly rules?: PresentationRulesInput
  readonly sourceMaterials?: readonly PresentationSourceMaterialInput[]
  readonly assets?: readonly PresentationAdoptedAssetInput[]
  readonly createdAt?: string
  readonly actorId?: string | null
}

export interface PresentationStandardProjectBuild {
  readonly standardVersion: '0.1.0'
  readonly projectId: ProjectId
  readonly projectSlug: string
  readonly directoryName: string
  readonly documents: Readonly<Record<string, CanonicalDocument>>
  readonly managedFiles: readonly PresentationManagedFile[]
  readonly stableIds: Readonly<Record<string, string>>
  readonly semanticObjectHashes: Readonly<Record<string, string>>
}

export interface PresentationStandardProjectWriterHooks {
  readonly afterStagingCreated?: (stagingDirectory: string) => void | Promise<void>
  readonly beforeValidation?: (stagingDirectory: string) => void | Promise<void>
  readonly beforeCommit?: (stagingDirectory: string, finalDirectory: string) => void | Promise<void>
  readonly afterBackupCreated?: (backupDirectory: string) => void | Promise<void>
}

export interface PublishPresentationStandardProjectInput {
  readonly workspaceRoot: string
  readonly build: PresentationStandardProjectBuild
  readonly operationId: string
  readonly expectedExistingFileHashes?: Readonly<Record<string, string>>
  readonly confirmExternalChanges?: boolean
  readonly hooks?: PresentationStandardProjectWriterHooks
}

export interface PresentationStandardProjectPublishResult {
  readonly directoryRoot: string
  readonly projectId: ProjectId
  readonly projectSlug: string
  readonly standardVersion: '0.1.0'
  readonly replacedExisting: boolean
  readonly fileHashes: Readonly<Record<string, string>>
  readonly validation: ProjectValidationResult
}

export interface CreatePresentationStandardProjectInput {
  readonly preDesignProjectId: string
  readonly projectName: string
  readonly projectSlug?: string
  readonly workspaceRoot?: string
  readonly createdAt: string
  readonly rules?: PresentationRulesInput
  readonly actorId?: string | null
}

export interface ExportPresentationStandardProjectInput {
  readonly frozenProject: FrozenProjectInput
  readonly workspaceRoot?: string
  readonly rules?: PresentationRulesInput
  readonly sourceMaterials?: readonly PresentationSourceMaterialInput[]
  readonly assets?: readonly PresentationAdoptedAssetInput[]
  readonly confirmExternalChanges?: boolean
  readonly writerHooks?: PresentationStandardProjectWriterHooks
}

export interface PresentationStandardContractAdapter {
  readonly standardName: 'Presentation Standard Project Directory'
  readonly standardVersion: '0.1.0'
  readonly schemaSetSha256: string
  createId(kind: StableIdKind): string
  isId(kind: StableIdKind, value: unknown): boolean
  createProjectDirectoryPlan(input: {
    readonly projectId?: ProjectId
    readonly projectSlug: string
    readonly name: string
    readonly language?: string
    readonly createdAt?: string
    readonly createdBy?: CreatedBy
    readonly ids?: {
      readonly projectRulesId?: ProjectRulesDocument['projectRulesId']
      readonly outlineDocumentId?: string
    }
  }): ProjectDirectoryPlan
  validateDocument(document: CanonicalDocument): Promise<{
    readonly valid: boolean
    readonly errors: readonly unknown[]
  }>
  validateProject(projectRoot: string): Promise<ProjectValidationResult>
}

export type {
  AssetManifest,
  CanonicalDocument,
  DraftPageDocument,
  ProjectManifest,
  ProjectRulesDocument,
  SourceMaterialManifest,
  StableIdKind,
  ValidationIssue,
}
