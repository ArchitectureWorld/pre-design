export const CONDITION_FIELDS = ['industryPlanning', 'existingBuildings', 'externalPartners', 'marketing'] as const
export type ConditionField = typeof CONDITION_FIELDS[number]
export type ConditionValue = boolean | 'unknown'
export type ResearchFlags = Partial<Record<ConditionField, ConditionValue | null>>
export type Condition = { readonly op: 'always' } | { readonly op: 'eq'; readonly field: ConditionField; readonly value: boolean }
export interface ResearchPort { readonly name: string; readonly type: string; readonly selector: string }
export interface CandidateArtifact {
  readonly artifactId: string
  readonly kind: 'figure' | 'table'
  readonly title: string
  readonly state: 'planned'
  readonly dataset: string
  readonly display: Readonly<{ type: string; template?: string; sizePreset: string; columns?: readonly string[] }>
  readonly reportRequirement: 'candidate'
  readonly auditRequired: boolean
  readonly renditions: readonly never[]
}
export interface PlanningModule {
  readonly id: string; readonly moduleId: string; readonly title: string; readonly when: Condition
  readonly ports: readonly ResearchPort[]; readonly figures: readonly CandidateArtifact[]; readonly table: CandidateArtifact
}
export interface PlanningEdge {
  readonly edgeId: string; readonly groupId: string; readonly source: string; readonly target: string
  readonly moduleId: string; readonly selector: string; readonly type: string; readonly requiredWhen: Condition
  readonly minimumState: { readonly draft: readonly string[]; readonly formal: readonly string[] }
  readonly alternativeOf: string | null
}
export interface LegacyMapping { readonly workItemId: string; readonly objectId: string; readonly targets: readonly string[] }
export interface PlanningCatalog {
  readonly schemaVersion: 'planning-index.v1'; readonly specVersion: 'planning-research.v1.2'; readonly sourceSha256: string
  readonly hash: string; readonly chapters: readonly (readonly [string,string])[]
  readonly modules: readonly PlanningModule[]; readonly edges: readonly PlanningEdge[]; readonly legacy: readonly LegacyMapping[]
}
export interface UnresolvedDependency { readonly groupId: string; readonly target: string; readonly reason: string }
export interface ResearchPlan {
  readonly execution: 'planning_only'; readonly catalogHash: string; readonly hash: string
  readonly flags: Readonly<Record<ConditionField,ConditionValue>>
  readonly activeModuleIds: readonly string[]; readonly inactiveModuleIds: readonly string[]; readonly pendingModuleIds: readonly string[]
  readonly edges: readonly PlanningEdge[]; readonly unresolved: readonly UnresolvedDependency[]
  readonly blockedModuleIds: readonly string[]; readonly waves: readonly (readonly string[])[]
}
