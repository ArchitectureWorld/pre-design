export const PLANNING_MANUSCRIPT_SCHEMA_VERSION = 'pre-design.planning-manuscript.v1' as const
export const PLANNING_MANUSCRIPT_POLICY_VERSION = 'planning-manuscript-2026-09-18.2'

export const PLANNING_CHAPTER_IDS = ['opportunity', 'site', 'positioning', 'products', 'spatial', 'launch', 'operation'] as const
export type PlanningChapterId = typeof PLANNING_CHAPTER_IDS[number]
export type PlanningManuscriptPageKind = 'argument' | 'evidence' | 'comparison' | 'product' | 'spatial' | 'delivery' | 'financial'

/** The question a presentation page must answer, before choosing its imagery. */
export interface PlanningPageTask {
  readonly kind: 'scene' | 'regional-context' | 'accessibility' | 'audience-catchment' | 'competitor-distribution' | 'site-analysis' | 'process' | 'comparison' | 'financial' | 'divider'
  readonly question: string
  readonly scale: 'regional' | 'city' | 'site' | 'node' | 'scene'
  readonly requiredEvidence: readonly string[]
  readonly imageCount?: number
  readonly preferredTemplate?: 'full-background' | 'split-left' | 'split-right' | 'split-top' | 'split-bottom' | 'array-horizontal' | 'array-vertical' | 'map-analysis' | 'data'
}

export interface PlanningManuscriptSource {
  readonly id: string
  readonly objectId: string
  readonly fieldPath: string
  readonly text: string
  readonly basis: string
  readonly evidenceIds: readonly string[]
}

export interface PlanningManuscriptDiagram {
  readonly nodes: readonly {
    readonly id: string
    readonly label: string
    readonly column: number
    readonly row: number
    readonly tone?: 'accent' | 'neutral' | 'muted'
  }[]
  readonly edges: readonly { readonly from: string; readonly to: string; readonly label?: string }[]
}

export interface PlanningManuscriptPage {
  /** A derived client summary; complete authored content remains in source notes. */
  readonly editorialSummary?: true
  readonly task?: PlanningPageTask
  readonly id: string
  readonly kind: PlanningManuscriptPageKind
  readonly title: string
  readonly claim: string
  readonly body: readonly string[]
  readonly sourceRefs: readonly string[]
  readonly table?: { readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] }
  readonly product?: {
    readonly name: string
    readonly audience: string
    readonly experience: string
    readonly location: string
    readonly scale: string
    readonly operations: string
  }
  readonly visual: { readonly kind: 'source' | 'concept' | 'diagram' | 'none'; readonly subject: string; readonly purpose: string; readonly caption: string; readonly diagram?: PlanningManuscriptDiagram; readonly sourceMaterialKey?: string }
  readonly notes: readonly string[]
}

export interface PlanningManuscriptChapter {
  readonly id: PlanningChapterId
  readonly title: string
  readonly thesis: string
  readonly pages: readonly PlanningManuscriptPage[]
}

export interface PlanningManuscript {
  readonly schemaVersion: typeof PLANNING_MANUSCRIPT_SCHEMA_VERSION
  readonly policyVersion: string
  readonly projectId: string
  readonly sourceRevision: number
  readonly sourceFingerprint: string
  readonly generatedAt: string
  readonly title: string
  readonly chapters: readonly PlanningManuscriptChapter[]
  readonly editorial?: { readonly version: string; readonly draftFingerprint: string; readonly editedAt: string }
}
