import type { ImageAnalysisScale, ImageQualityMetadata, OriginalImageIdentity } from '../../visual/image-policy.ts'

export const CASE_STUDIES_SCHEMA_VERSION = 'pre-design.report-case-studies.v2' as const
export const CASE_STUDIES_CATALOG_VERSION = 'verified-built-projects-2026-09-19.3'

export type CaseStudyFeatureId = 'tea-landscape' | 'tea-experience' | 'slow-travel' | 'waterfront' | 'viewing' | 'adaptive-reuse' | 'visitor-service'
export type CaseStudyDimension = 'function' | 'scene' | 'environment' | 'operation'

/** Evidence stays in the source record; it is never appended as client-facing image copy. */
export interface CaseStudyEvidence {
  readonly evidenceId: string
  readonly sourceUrl: string
  readonly sourceTitle: string
  readonly publisher: string
  readonly publishedAt: string | null
  readonly capturedAt: string
  /** SHA-256 of the downloaded UTF-8 source HTML, archived during catalog verification. */
  readonly contentHash: string
  readonly excerpt: string
  readonly excerptHash: string
  readonly locator: { readonly kind: 'exact-text'; readonly text: string }
}

export interface CaseStudyFeature {
  readonly id: CaseStudyFeatureId
  readonly dimension: CaseStudyDimension
  readonly label: string
  readonly fact: string
  readonly evidenceIds: readonly string[]
  /** A project-specific application is emitted only when this feature matches project sources. */
  readonly application: string
}

export interface CaseStudyImage {
  readonly sourceUrl: string
  readonly sourcePageUrl: string
  readonly width: number
  readonly height: number
  readonly sha256: string
  readonly mimeType: 'image/jpeg' | 'image/png'
  readonly credit: string
  readonly description: string
  /** Published site-address passages, never a location inferred from faces or visual style. */
  readonly locationEvidenceIds?: readonly string[]
  /** Populated when prepareCaseStudies materializes the verified photograph in a workspace. */
  readonly sourcePath?: string
  readonly imageIdentity?: OriginalImageIdentity
  /** Source classification is not an image-inspection approval. */
  readonly imageQuality?: ImageQualityMetadata
  readonly analysisScale?: ImageAnalysisScale
  readonly mediaPurpose?: 'area-overview' | 'circulation' | 'representative-point' | 'application' | 'area-circulation'
}

export type CaseStudyPageFocus = 'site' | 'experience' | 'organization' | 'application'
export interface CaseStudyGalleryImage extends CaseStudyImage {
  readonly imageId: CaseStudyPageFocus
  readonly evidenceIds: readonly string[]
}
export interface CaseStudyAnalysis {
  readonly focus: Exclude<CaseStudyPageFocus, 'application'>
  readonly title: string
  readonly claim: string
  readonly body: readonly string[]
  readonly evidenceIds: readonly string[]
  /** A three-page case may combine area and line in one properly sourced page. */
  readonly scales?: readonly CaseStudySpatialScale[]
}

export type CaseStudySpatialScale = 'area' | 'line' | 'point'
export type CaseStudyRouteMode = 'arrival' | 'visitor' | 'vehicle' | 'service'
export interface CaseStudySourceGap {
  readonly scale: CaseStudySpatialScale
  readonly mode?: CaseStudyRouteMode
  readonly reason: string
  /** Missing modes outside the documented case scope remain visible to acquisition, without invented claims. */
  readonly blocking: boolean
}
export interface CaseStudySpatialLayer {
  readonly evidenceIds: readonly string[]
  readonly imageIds: readonly CaseStudyPageFocus[]
}
export interface CaseStudySpatialCoverage {
  readonly scope: {
    readonly kind: 'building-site' | 'landscape-route' | 'district'
    readonly statement: string
    readonly evidenceIds: readonly string[]
    readonly measurements: readonly { readonly label: string; readonly value: number; readonly unit: 'm2' | 'ha' | 'm' | 'km'; readonly evidenceIds: readonly string[] }[]
  }
  readonly area: CaseStudySpatialLayer
  readonly line: CaseStudySpatialLayer & {
    readonly routes: readonly { readonly mode: CaseStudyRouteMode; readonly claim: string; readonly evidenceIds: readonly string[]; readonly sourceQuote: string }[]
  }
  readonly point: CaseStudySpatialLayer
  readonly sourceGaps: readonly CaseStudySourceGap[]
}

export interface VerifiedCaseStudy {
  readonly caseId: string
  readonly name: string
  readonly location: string
  readonly delivery: {
    readonly status: 'completed' | 'operating'
    readonly date?: string
    readonly evidenceIds: readonly string[]
    readonly proof: 'completion-record' | 'current-opening-hours'
  }
  readonly summary: string
  readonly lesson: string
  readonly features: readonly CaseStudyFeature[]
  /** A factual difference from which the report derives a transfer boundary. */
  readonly boundary: { readonly fact: string; readonly applicationLimit: string; readonly evidenceIds: readonly string[] }
  readonly evidence: readonly CaseStudyEvidence[]
  readonly image?: CaseStudyImage
  readonly gallery?: readonly CaseStudyGalleryImage[]
  readonly analysis?: readonly CaseStudyAnalysis[]
  /** Historical built cases remain candidates until all three spatial layers have verified sources. */
  readonly spatial?: CaseStudySpatialCoverage
}

export interface CaseStudySimilarity {
  readonly featureId: CaseStudyFeatureId
  readonly dimension: CaseStudyDimension
  readonly statement: string
  readonly projectSourceRefs: readonly string[]
  readonly projectExcerpts: readonly string[]
  readonly caseEvidenceIds: readonly string[]
}

export interface SelectedCaseStudy extends VerifiedCaseStudy {
  readonly similarities: readonly CaseStudySimilarity[]
  readonly applications: readonly string[]
}

export interface ReportCaseStudies {
  readonly schemaVersion: typeof CASE_STUDIES_SCHEMA_VERSION
  readonly catalogVersion: string
  readonly projectId: string
  readonly sourceRevision: number
  /** This is recorded separately and never changes the source manuscript identity. */
  readonly baseSourceFingerprint: string
  readonly caseStudiesFingerprint: string
  readonly generatedAt: string
  readonly cases: readonly SelectedCaseStudy[]
}
