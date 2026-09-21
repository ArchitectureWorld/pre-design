import type { PresentationAdoptedAssetInput } from '../../presentation/standard-project-types.ts'
import type { ClientCartography, ClientSiteAnalysisKind } from '../client-types.ts'

export type PlanningAnalysisKind = 'regional-context' | 'accessibility' | 'audience-catchment' | 'competitor-distribution' | 'site-analysis'

/** Coordinates are never inferred from a project name or treated as a legal boundary. */
export interface AnalysisCoordinate {
  readonly longitude: number
  readonly latitude: number
  readonly crs: 'EPSG:4326' | 'WGS84' | 'EPSG:3857' | 'GCJ-02' | 'BD-09'
}

export interface AnalysisSource {
  readonly label: string
  readonly locator: string
  readonly sha256?: string
  readonly observedAt?: string
  readonly methodology?: string
}

export interface AnalysisLocation {
  readonly id: string
  readonly label: string
  readonly coordinate: AnalysisCoordinate
  readonly source: AnalysisSource
}

export interface AnalysisNode extends AnalysisLocation {
  readonly role: 'city' | 'settlement' | 'transport' | 'resource' | 'competitor'
  /** The caller must supply a sourced reason to classify a real place as a competitor. */
  readonly comparisonBasis?: AnalysisSource
}

export interface AnalysisBoundary {
  readonly status: 'confirmed' | 'research'
  readonly coordinates: readonly AnalysisCoordinate[]
  readonly source: AnalysisSource
  /** A confirmed boundary requires an independently approved source digest. */
  readonly confirmedSourceSha256?: string
}

export interface PlanningAnalysisInput {
  readonly projectId: string
  readonly pageId: string
  readonly chapterId?: string
  readonly title: string
  readonly question?: string
  readonly kind: PlanningAnalysisKind
  readonly outputDirectory: string
  readonly location?: AnalysisLocation
  readonly nodes?: readonly AnalysisNode[]
  readonly routeRequests?: readonly { readonly fromId: string; readonly toId: string }[]
  /** Geodesic distance only. Never a driving isochrone or demonstrated customer catchment. */
  readonly radiusKm?: readonly number[]
  readonly requiredEvidence?: readonly string[]
  readonly boundary?: AnalysisBoundary
  readonly minimumExtentKm?: number
  readonly maximumRouteSnapMeters?: number
  readonly signal?: AbortSignal
}

export interface AnalysisGap {
  readonly code: string
  readonly message: string
  readonly blocking: boolean
  readonly subjectId?: string
}

export interface AnalysisEvidence {
  readonly evidenceId: string
  readonly kind: 'location' | 'node' | 'basemap' | 'route' | 'distance' | 'boundary'
  readonly statement: string
  readonly source: AnalysisSource
  readonly rawPath?: string
  readonly sha256?: string
}

export interface Wgs84Point {
  readonly longitude: number
  readonly latitude: number
}

export interface MapViewport {
  readonly width: number
  readonly height: number
  readonly zoom: number
  readonly west: number
  readonly south: number
  readonly east: number
  readonly north: number
  readonly worldLeft: number
  readonly worldTop: number
  readonly centerLatitude: number
}

export interface AnalysisReceipt {
  readonly url: string
  readonly retrievedAt: string
  readonly mediaType: string
  readonly bytes: Uint8Array
}

export interface AnalysisBasemap {
  readonly png: Uint8Array
  readonly width: number
  readonly height: number
  readonly crs: 'EPSG:3857'
  readonly attribution: string
  readonly source: AnalysisSource
  readonly receipts: readonly AnalysisReceipt[]
}

export interface AnalysisRoute {
  readonly fromId: string
  readonly toId: string
  readonly mode: 'driving'
  readonly distanceMeters: number
  readonly durationSeconds: number
  readonly geometry: readonly Wgs84Point[]
  readonly waypoints: readonly { readonly coordinate: Wgs84Point; readonly snapDistanceMeters: number; readonly name: string }[]
  readonly source: AnalysisSource
  readonly traffic: 'not-included'
  readonly receipts: readonly AnalysisReceipt[]
}

export interface AnalysisRouteQuery {
  readonly from: AnalysisLocation & { readonly wgs84: Wgs84Point }
  readonly to: AnalysisLocation & { readonly wgs84: Wgs84Point }
}

export interface PlanningAnalysisDependencies {
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>
  readonly now?: () => Date
  readonly basemap?: (viewport: MapViewport, signal?: AbortSignal) => Promise<AnalysisBasemap>
  readonly route?: (query: AnalysisRouteQuery, signal?: AbortSignal) => Promise<AnalysisRoute>
}

export interface PlanningAnalysisAsset {
  readonly adoptedAsset: PresentationAdoptedAssetInput
  readonly sha256: string
  readonly width: number
  readonly height: number
  readonly analysisKind: ClientSiteAnalysisKind
  readonly cartography: ClientCartography
  readonly metadataPath: string
}

export interface PlanningAnalysisResult {
  readonly status: 'ready' | 'partial' | 'blocked'
  readonly assets: readonly PlanningAnalysisAsset[]
  readonly evidence: readonly AnalysisEvidence[]
  readonly gaps: readonly AnalysisGap[]
  readonly manifestPath?: string
}

export interface PlanningLocationEvidence {
  /** A source-backed location statement, never a generated map brief. */
  readonly text: string
  readonly source: AnalysisSource
  readonly placeName?: string
  /** Administrative context or other disambiguators actually present in the source. */
  readonly contextTerms?: readonly string[]
  readonly coordinate?: AnalysisCoordinate
}

export interface PlanningLocationSourceFact {
  readonly text: string
  readonly source: AnalysisSource
  /** The upstream source mapping explicitly identifies the fact, not a keyword classifier. */
  readonly role: 'project-location' | 'project-name' | 'other'
  readonly placeName?: string
  readonly contextTerms?: readonly string[]
  readonly coordinate?: AnalysisCoordinate
}

export interface PlanningGeocodeCandidate {
  readonly id: string
  readonly name: string
  readonly displayName: string
  readonly coordinate: AnalysisCoordinate
  readonly source: AnalysisSource
}

export interface ResolvePlanningLocationInput {
  readonly projectName: string
  readonly evidence: readonly PlanningLocationEvidence[]
  readonly outputDirectory?: string
  readonly signal?: AbortSignal
}

export interface PlanningLocationResolverDependencies extends Pick<PlanningAnalysisDependencies, 'fetch' | 'now'> {
  readonly geocode?: (query: string, signal?: AbortSignal) => Promise<{ readonly candidates: readonly PlanningGeocodeCandidate[]; readonly receipts: readonly AnalysisReceipt[] }>
}

export interface PlanningLocationResolution {
  readonly status: 'resolved' | 'ambiguous' | 'missing'
  readonly location?: AnalysisLocation
  readonly candidates: readonly PlanningGeocodeCandidate[]
  readonly evidence: readonly PlanningLocationEvidence[]
  readonly gaps: readonly AnalysisGap[]
  readonly receiptPaths: readonly string[]
  readonly manifestPath?: string
}
