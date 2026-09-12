export type ResearchSourcePriority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5'
export type ResearchAuthorityLevel =
  | 'project_official'
  | 'government_official'
  | 'official_standard'
  | 'authoritative_industry'
  | 'auxiliary'
  | 'inference'

export type ResearchAccessMode =
  | 'workspace_file'
  | 'web_page'
  | 'web_search'
  | 'api'
  | 'manual_import'
  | 'professional_tool'

export type ResearchReliabilityGrade = 'A' | 'B' | 'C' | 'D' | 'inference'

export interface ResearchFreshnessPolicy {
  readonly maxAgeDays: number | null
  readonly refreshOnProjectStart: boolean
  readonly notes: string
}

export interface DataSourceDefinition {
  readonly sourceId: string
  readonly name: string
  readonly publisher: string
  readonly priority: ResearchSourcePriority
  readonly authorityLevel: ResearchAuthorityLevel
  readonly homepage: string | null
  readonly allowedDomains: readonly string[]
  readonly accessModes: readonly ResearchAccessMode[]
  readonly supportedDataKinds: readonly string[]
  readonly freshnessPolicy: ResearchFreshnessPolicy
  readonly reliabilityGrade: ResearchReliabilityGrade
  readonly notes: string
}

export interface ResearchDataPoint {
  readonly dataPointId: string
  readonly label: string
  readonly dataKind: string
  readonly description: string
  readonly unit?: string | null
}

export interface ResearchSourcePreference {
  readonly sourceId: string
  readonly purpose: string
  readonly required: boolean
}

export interface ResearchQueryTemplate {
  readonly sourceId: string
  readonly template: string
}

export interface ResearchMethodDefinition {
  readonly methodId: string
  readonly version: string
  readonly description: string
  readonly deterministic: boolean
}

export interface ResearchMinimumEvidence {
  readonly minHighAuthority: number
  readonly minIndependentSources: number
  readonly highRiskRequiresGradeA: boolean
}

export interface WorkflowResearchSpec {
  readonly workflowId: string
  readonly requiredDataPoints: readonly ResearchDataPoint[]
  readonly optionalDataPoints: readonly ResearchDataPoint[]
  readonly preferredSources: readonly ResearchSourcePreference[]
  readonly queryTemplates: readonly ResearchQueryTemplate[]
  readonly extractionRules: readonly string[]
  readonly normalizationRules: readonly string[]
  readonly aggregationMethod: ResearchMethodDefinition
  readonly analysisMethod: ResearchMethodDefinition
  readonly crossCheckRules: readonly string[]
  readonly freshnessRules: readonly string[]
  readonly minimumEvidence: ResearchMinimumEvidence
  readonly fallbackPolicy: string
  readonly outputClaims: readonly string[]
}

export interface ResearchValidationResult {
  readonly valid: boolean
  readonly errors: readonly string[]
}

export interface EvidenceRecord {
  readonly evidenceId: string
  readonly workflowId: string
  readonly dataPointId: string
  readonly sourceId: string
  readonly sourceType: ResearchAccessMode
  readonly sourceUri: string
  readonly sourceTitle: string
  readonly publisher: string
  readonly publishedAt: string | null
  readonly capturedAt: string
  readonly asOf: string | null
  readonly locator: Readonly<Record<string, unknown>>
  readonly rawValue: unknown
  readonly normalizedValue: unknown
  readonly unit: string | null
  readonly contentHash: string
  readonly reliability: ResearchReliabilityGrade
  readonly claimClass: 'fact' | 'source_conclusion' | 'user_statement' | 'agent_inference' | 'assumption' | 'decision' | 'missing'
  readonly notes?: string
}

export interface AnalysisTraceStep {
  readonly step: number
  readonly description: string
  readonly inputEvidenceIds: readonly string[]
  readonly output: unknown
}

export interface AnalysisTrace {
  readonly traceId: string
  readonly workflowId: string
  readonly claimId: string
  readonly inputEvidenceIds: readonly string[]
  readonly inputObjectIds: readonly string[]
  readonly methodId: string
  readonly methodVersion: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly calculationSteps: readonly AnalysisTraceStep[]
  readonly outputValue: unknown
  readonly confidence: number
  readonly limitations: readonly string[]
}
