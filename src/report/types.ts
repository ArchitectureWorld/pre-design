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
  readonly kind: 'concept' | 'evidence' | 'deterministic'
  readonly caption: string
  readonly sourcePath: string
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml'
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

export interface FrozenStateObject {
  readonly objectId: string
  readonly chapterId: string
  readonly workItemId?: string
  readonly title: string
  readonly summary: string
  readonly facts: readonly FrozenStateFact[]
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
  ClientPage,
  ClientPageKind,
  ClientPagePlan,
  ClientPolicyViolation,
  ClientProjectProfile,
  ClientRenderContext,
  ClientReport,
  ClientReportBundle,
} from './client-types.ts'
