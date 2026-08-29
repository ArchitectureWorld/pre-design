export type ClientChapterRole =
  | 'brief'
  | 'diagnosis'
  | 'opportunity'
  | 'positioning'
  | 'strategy'
  | 'product'
  | 'spatial'
  | 'operation'
  | 'implementation'
  | 'decision'

export interface ArtifactIdentity {
  readonly projectId: string
  readonly sourceRevision: number
  readonly recommendationId: string
  readonly adoptedAssetIds: readonly string[]
}

export interface GovernanceGateSummary {
  readonly gateId: string
  readonly decision: 'approved' | 'approved_with_conditions' | 'returned' | 'blocked'
  readonly revision: number
}

export interface GovernanceAppendix {
  readonly sourceRevision: number
  readonly gateDecisions: readonly GovernanceGateSummary[]
  readonly workflowCounts: Readonly<{ total: number; completed: number; blocked: number }>
}

export interface ClientProjectIdentity {
  readonly projectId: string
  readonly projectName: string
  readonly reportTitle: string
  readonly reportDate: string
  readonly audience: 'executive-and-professional'
  readonly locale: 'zh-CN'
}

export interface ClientProposition {
  readonly projectDefinition: string
  readonly urgency: string
  readonly coreValue: string
  readonly positioning: string
  readonly keywords: readonly string[]
}

export interface ClientPhase {
  readonly phaseId: string
  readonly name: string
  readonly actions: readonly string[]
  readonly prerequisites: readonly string[]
}

export interface ClientInvestmentItem {
  readonly name: string
  readonly amount: string
  readonly unit: string
  readonly assumption: string
}

export type ClientContentBlock =
  | { readonly type: 'narrative'; readonly statement: string; readonly evidenceIds: readonly string[] }
  | { readonly type: 'metric'; readonly label: string; readonly value: string; readonly unit: string; readonly evidenceIds: readonly string[] }
  | { readonly type: 'evidence'; readonly headline: string; readonly evidenceIds: readonly string[]; readonly assetIds: readonly string[] }
  | { readonly type: 'comparison'; readonly headline: string; readonly before: string; readonly after: string; readonly evidenceIds: readonly string[]; readonly assetIds: readonly string[] }
  | { readonly type: 'map'; readonly headline: string; readonly assetId: string; readonly evidenceIds: readonly string[] }
  | { readonly type: 'product'; readonly productId: string; readonly assetIds: readonly string[] }
  | { readonly type: 'scene'; readonly headline: string; readonly productIds: readonly string[]; readonly assetIds: readonly string[] }
  | { readonly type: 'timeline'; readonly headline: string; readonly phases: readonly ClientPhase[]; readonly evidenceIds: readonly string[] }
  | { readonly type: 'investment'; readonly headline: string; readonly items: readonly ClientInvestmentItem[]; readonly evidenceIds: readonly string[] }
  | { readonly type: 'decision'; readonly headline: string; readonly asks: readonly string[]; readonly rationaleEvidenceIds: readonly string[] }

export interface ClientChapter {
  readonly id: string
  readonly role: ClientChapterRole
  readonly headline: string
  readonly claim: string
  readonly blocks: readonly ClientContentBlock[]
}

export interface ClientProduct {
  readonly productId: string
  readonly name: string
  readonly valueProposition: string
  readonly audiences: readonly string[]
  readonly contents: readonly string[]
  readonly usageScenarios: readonly string[]
  readonly spatialCarrier: string
  readonly operatingModel: string
  readonly valueContribution: string
  readonly evidenceIds: readonly string[]
}

export interface ClientEvidence {
  readonly evidenceId: string
  readonly kind: 'fact' | 'observation' | 'policy' | 'case' | 'assumption' | 'calculation'
  readonly statement: string
  readonly sourceLabel: string
  readonly sourceDate: string
  readonly locator: string
  readonly unit?: string
  readonly assumption?: string
}

export type ClientVisualRole =
  | 'hero'
  | 'site-photo'
  | 'map'
  | 'diagram'
  | 'chart'
  | 'product-scene'
  | 'before'
  | 'after'
  | 'material'

export interface ClientVisualAsset {
  readonly assetId: string
  readonly role: ClientVisualRole
  readonly chapterId: string
  readonly productId?: string
  readonly caption: string
  readonly sourceKind: 'project-source' | 'deterministic' | 'ai-concept'
  readonly sourcePath: string
  readonly sha256: string
  readonly width: number
  readonly height: number
  readonly disclosure?: '概念示意'
}

export interface ClientThemeTokens {
  readonly colors: Readonly<{
    background: string
    surface: string
    ink: string
    muted: string
    primary: string
    accent: string
  }>
  readonly fonts: Readonly<{ display: string; body: string; fallbacks: readonly string[] }>
  readonly grid: Readonly<{ columns: 12; safeMarginRatio: number; spacingBase: 8 }>
  readonly typeScale: Readonly<{
    pptxPt: Readonly<{ cover: number; chapter: number; title: number; body: number; caption: number }>
    htmlPx: Readonly<{ cover: number; chapter: number; title: number; body: number; caption: number }>
  }>
  readonly motion: Readonly<{ durationMs: number; easing: 'ease-out'; respectsReducedMotion: true }>
}

export interface ClientTheme {
  readonly themeId: string
  readonly tokens: ClientThemeTokens
}

export interface ClientThemeOverrides {
  readonly colors?: Readonly<Partial<ClientThemeTokens['colors']>>
  readonly fonts?: Readonly<Partial<ClientThemeTokens['fonts']>>
}

export interface ClientChapterBlueprint {
  readonly id: string
  readonly role: ClientChapterRole
  readonly headline: string
  readonly claim: string
  readonly sourceObjectIds: readonly string[]
  readonly blocks: readonly ClientContentBlock[]
}

export interface ClientAssetBinding {
  readonly assetId: string
  readonly role: ClientVisualRole
  readonly chapterId: string
  readonly productId?: string
  readonly sha256: string
  readonly width: number
  readonly height: number
  readonly disclosure?: '概念示意'
}

export interface ClientProjectProfile {
  readonly identity: ClientProjectIdentity
  readonly proposition: ClientProposition
  readonly themeOverrides: ClientThemeOverrides
  readonly chapters: readonly ClientChapterBlueprint[]
  readonly products: readonly ClientProduct[]
  readonly evidence: readonly ClientEvidence[]
  readonly assetBindings: readonly ClientAssetBinding[]
  readonly requiredVisualRoles: readonly ClientVisualRole[]
}

export interface ClientReport {
  readonly schemaVersion: 'preplan.client-report.v1'
  readonly identity: ClientProjectIdentity
  readonly proposition: ClientProposition
  readonly chapters: readonly ClientChapter[]
  readonly products: readonly ClientProduct[]
  readonly evidence: readonly ClientEvidence[]
  readonly assets: readonly ClientVisualAsset[]
  readonly theme: ClientTheme
}

export type ClientPageKind =
  | 'cover'
  | 'opening-claim'
  | 'chapter-divider'
  | 'evidence'
  | 'opportunity'
  | 'positioning'
  | 'product'
  | 'scene'
  | 'implementation'
  | 'decision'
  | 'appendix'

export type ClientMedium = 'html' | 'pptx' | 'pdf'

export interface ClientPage {
  readonly pageId: string
  readonly kind: ClientPageKind
  readonly layoutVariant: 'full-bleed' | 'split' | 'editorial' | 'data' | 'timeline' | 'summary'
  readonly chapterId: string
  readonly headline: string
  readonly primaryFocus: Readonly<
    | { type: 'claim'; statement: string }
    | { type: 'asset'; assetId: string }
    | { type: 'product'; productId: string }
    | { type: 'decision'; asks: readonly string[] }
  >
  readonly blockIndexes: readonly number[]
  readonly assetIds: readonly string[]
  readonly evidenceIds: readonly string[]
}

export interface ClientPagePlan {
  readonly medium: ClientMedium
  readonly pages: readonly ClientPage[]
  readonly layoutContract: Readonly<{
    safeMarginRatio: number
    minimumTitle: number
    minimumBody: number
    minimumCaption: number
  }>
}

export interface ClientPolicyViolation {
  readonly code: string
  readonly path: string
  readonly message: string
}

export interface ClientReportBundle {
  readonly report: ClientReport
  readonly identity: ArtifactIdentity
  readonly governanceAppendix: GovernanceAppendix
}

export interface ClientRenderContext {
  readonly report: ClientReport
  readonly plan: ClientPagePlan
  readonly identity: ArtifactIdentity
}
