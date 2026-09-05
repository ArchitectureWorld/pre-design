export type ReportNode =
  | { readonly type: 'heading'; readonly level: 1 | 2 | 3; readonly text: string }
  | { readonly type: 'paragraph'; readonly text: string; readonly evidenceIds?: readonly string[] }
  | { readonly type: 'metric'; readonly label: string; readonly value: string; readonly basis: string }
  | { readonly type: 'table'; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] }
  | {
    readonly type: 'chart'
    readonly chartId: string
    readonly chartType: 'bar' | 'line' | 'donut'
    readonly labels: readonly string[]
    readonly values: readonly number[]
    readonly unit: string
  }
  | { readonly type: 'map'; readonly assetId: string; readonly caption: string; readonly evidenceIds: readonly string[] }
  | { readonly type: 'image'; readonly assetId: string; readonly caption: string }
  | {
    readonly type: 'comparison' | 'timeline' | 'warning' | 'decision'
    readonly title: string
    readonly items: readonly string[]
  }

export interface ReportSection {
  readonly id: string
  readonly title: string
  readonly claim: string
  readonly nodes: readonly ReportNode[]
}

export interface ReportAsset {
  readonly assetId: string
  readonly taskId?: string
  readonly chapterId?: string
  readonly workItemId?: string
  readonly kind: 'concept' | 'evidence' | 'deterministic'
  readonly caption: string
  readonly sourcePath: string
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml'
  readonly sha256?: string
  readonly boundaryGeometrySha256?: string
  readonly width?: number
  readonly height?: number
}

export interface ReportDocument {
  readonly meta: {
    readonly projectId: string
    readonly projectName: string
    readonly sourceRevision: number
    readonly generatedAt: string
    readonly title: string
    readonly subtitle: string
    readonly recommendationId: string
    readonly adoptedAssetIds: readonly string[]
  }
  readonly executiveSummary: string
  readonly sections: readonly ReportSection[]
  readonly assets: readonly ReportAsset[]
}

export interface FrozenStateFact {
  readonly label: string
  readonly value: string
  readonly basis: string
}

export interface FrozenReportEntry {
  readonly key: string
  readonly text: string
  readonly contentText?: string
  readonly basis: string
  readonly fieldPath: string
  readonly evidenceRefs?: readonly {
    readonly evidenceId: string
    readonly assetId?: string
    readonly versionId?: string
    readonly locator?: Readonly<Record<string, unknown>>
  }[]
  readonly metric?: {
    readonly label: string
    readonly value: string | number
    readonly unit?: string
  }
}

export interface FrozenReportSection {
  readonly key: string
  readonly title: string
  readonly entries: readonly FrozenReportEntry[]
}

export interface FrozenStateObject {
  readonly objectId: string
  readonly chapterId: string
  readonly workItemId?: string
  readonly title: string
  readonly summary: string
  readonly facts: readonly FrozenStateFact[]
  readonly reportSections?: readonly FrozenReportSection[]
}

export type FrozenSiteBoundary =
  | { readonly status: 'not_provided' }
  | {
    readonly status: 'pending_confirmation'
    readonly boundaryId: string
    readonly source: import('../governance/types.ts').SiteBoundarySource
  }
  | {
    readonly status: 'synthetic_research'
    readonly boundaryId: string
    readonly source: import('../governance/types.ts').SiteBoundarySource
    readonly declarations: readonly ['研究范围（待核）', '非法定红线', '非测绘成果']
    readonly assetId?: string
    readonly assetSha256?: string
  }
  | {
    readonly status: 'confirmed'
    readonly boundaryId: string
    readonly assetId: string
    readonly confirmedRevision: number
    readonly source: import('../governance/types.ts').SiteBoundarySource
    readonly sourceSha256?: string
    readonly geometrySha256?: string
    readonly assetSha256: string
    readonly integrityDigest: string
  }

export interface FrozenProjectInput {
  readonly projectId: string
  readonly projectName: string
  readonly revision: number
  readonly generatedAt: string
  readonly recommendationId?: string
  readonly recommendation: string
  readonly decisionItems: readonly string[]
  readonly stateObjects: readonly FrozenStateObject[]
  readonly gates: readonly {
    readonly gateId: string
    readonly decision: 'approved' | 'approved_with_conditions' | 'returned' | 'blocked'
    readonly revision: number
  }[]
  readonly visualAssets: readonly ReportAsset[]
  readonly adoptedAssetIds?: readonly string[]
  readonly siteBoundary?: FrozenSiteBoundary
}

export interface RenderedArtifact {
  readonly format: 'html' | 'pptx' | 'pdf'
  readonly fileName: string
  readonly path: string
  readonly sha256: string
  readonly bytes: number
}

export type {
  ArtifactIdentity,
  ClientAssetLayout,
  ClientMediaPosition,
  ClientPage,
  ClientPageKind,
  ClientPagePlan,
  ClientPolicyViolation,
  ClientProjectProfile,
  ClientRenderContext,
  ClientReport,
  ClientReportBundle,
} from './client-types.ts'
