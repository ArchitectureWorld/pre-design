export type ContentNature =
  | 'fact'
  | 'user_statement'
  | 'professional_judgement'
  | 'assumption'
  | 'recommendation'
  | 'decision'
  | 'missing'

export type ProjectionSourceRevision = number | string
export type ProjectionScalar = null | boolean | number | string

export interface ProjectionTopicDefinition {
  readonly key: string
  readonly title: string
  readonly order: number
}

export type ProjectionIdKind =
  | 'outline-node'
  | 'page'
  | 'content-block'
  | 'list-item'
  | 'metric'
  | 'table-row'
  | 'table-column'
  | 'table-cell'
  | 'script-block'
  | 'page-asset'

export interface ProjectionIdFactory {
  create(kind: ProjectionIdKind): string
}

export interface HeadingSupportingBlock {
  readonly type: 'heading'
  readonly role?: 'subtitle' | 'section_title'
  readonly content: string
}

export interface TextSupportingBlock {
  readonly type: 'text'
  readonly role?: 'body' | 'caption' | 'source_note'
  readonly content: string
  readonly contentNature?: ContentNature
}

export interface ListSupportingBlock {
  readonly type: 'list'
  readonly role?: 'body' | 'steps' | 'key_points'
  readonly listStyle: 'ordered' | 'unordered'
  readonly items: readonly string[]
}

export interface MetricSupportingInput {
  readonly label: string
  readonly value: string | number
  readonly unit?: string
  readonly note?: string
}

export interface MetricGroupSupportingBlock {
  readonly type: 'metric_group'
  readonly role?: 'body' | 'key_metrics'
  readonly metrics: readonly MetricSupportingInput[]
}

export interface TableSupportingBlock {
  readonly type: 'table'
  readonly role?: 'body' | 'comparison' | 'data'
  readonly columns: readonly string[]
  readonly rows: readonly (readonly ProjectionScalar[])[]
}

export type SupportingBlock =
  | HeadingSupportingBlock
  | TextSupportingBlock
  | ListSupportingBlock
  | MetricGroupSupportingBlock
  | TableSupportingBlock

export interface ProfessionalFinding {
  readonly findingId: string
  readonly topicKey: string
  readonly order: number
  readonly title: string
  readonly keyMessage: string
  readonly contentNature: ContentNature
  readonly objectIds: readonly string[]
  readonly evidenceIds: readonly string[]
  readonly supportingBlocks: readonly SupportingBlock[]
  readonly speakerNotes?: readonly string[]
  readonly assetIds?: readonly string[]
  readonly include?: boolean
}

export interface PresentationProjectionInput {
  readonly preDesignProjectId: string
  readonly presentationProjectId: string
  readonly preDesignRevision: ProjectionSourceRevision
  readonly additionalTopics?: readonly ProjectionTopicDefinition[]
  readonly findings: readonly ProfessionalFinding[]
}

export interface ProjectionSourceRef {
  readonly provider: 'pre-design'
  readonly sourceProjectId: string
  readonly sourceRevision: ProjectionSourceRevision
  readonly objectIds: readonly string[]
  readonly evidenceIds: readonly string[]
}

interface ProjectedBlockBase {
  readonly contentBlockId: string
  readonly order: number
  readonly sourceRefs: readonly ProjectionSourceRef[]
}

export interface ProjectedHeadingBlock extends ProjectedBlockBase {
  readonly type: 'heading'
  readonly role: 'page_title' | 'subtitle' | 'section_title'
  readonly content: string
}

export interface ProjectedTextBlock extends ProjectedBlockBase {
  readonly type: 'text'
  readonly role: 'key_message' | 'body' | 'caption' | 'source_note'
  readonly content: string
  readonly contentNature?: ContentNature
}

export interface ProjectedListItem {
  readonly listItemId: string
  readonly order: number
  readonly content: string
  readonly sourceRefs: readonly ProjectionSourceRef[]
}

export interface ProjectedListBlock extends ProjectedBlockBase {
  readonly type: 'list'
  readonly role: 'body' | 'steps' | 'key_points'
  readonly listStyle: 'ordered' | 'unordered'
  readonly items: readonly ProjectedListItem[]
}

export interface ProjectedMetric {
  readonly metricId: string
  readonly order: number
  readonly label: string
  readonly value: string | number
  readonly unit?: string
  readonly note?: string
  readonly sourceRefs: readonly ProjectionSourceRef[]
}

export interface ProjectedMetricGroupBlock extends ProjectedBlockBase {
  readonly type: 'metric_group'
  readonly role: 'body' | 'key_metrics'
  readonly metrics: readonly ProjectedMetric[]
}

export interface ProjectedTableColumn {
  readonly tableColumnId: string
  readonly order: number
  readonly label: string
}

export interface ProjectedTableCell {
  readonly tableCellId: string
  readonly tableColumnId: string
  readonly content: ProjectionScalar
  readonly sourceRefs: readonly ProjectionSourceRef[]
}

export interface ProjectedTableRow {
  readonly tableRowId: string
  readonly order: number
  readonly cells: readonly ProjectedTableCell[]
  readonly sourceRefs: readonly ProjectionSourceRef[]
}

export interface ProjectedTableBlock extends ProjectedBlockBase {
  readonly type: 'table'
  readonly role: 'body' | 'comparison' | 'data'
  readonly columns: readonly ProjectedTableColumn[]
  readonly rows: readonly ProjectedTableRow[]
}

export type ProjectedContentBlock =
  | ProjectedHeadingBlock
  | ProjectedTextBlock
  | ProjectedListBlock
  | ProjectedMetricGroupBlock
  | ProjectedTableBlock

export interface ProjectedScriptBlock {
  readonly scriptBlockId: string
  readonly order: number
  readonly content: string
  readonly sourceRefs: readonly ProjectionSourceRef[]
}

export interface ProjectedPageAsset {
  readonly pageAssetId: string
  readonly order: number
  readonly assetId: string
  readonly role: 'primary' | 'supporting'
  readonly sourceRefs: readonly ProjectionSourceRef[]
}

export interface ProjectedPresentationPage {
  readonly findingId: string
  readonly projectId: string
  readonly pageId: string
  readonly outlineNodeId: string
  readonly order: number
  readonly sourceRefs: readonly ProjectionSourceRef[]
  readonly contentBlocks: readonly ProjectedContentBlock[]
  readonly scriptBlocks: readonly ProjectedScriptBlock[]
  readonly pageAssets: readonly ProjectedPageAsset[]
}

export interface ProjectedPresentationSection {
  readonly topicKey: string
  readonly title: string
  readonly order: number
  readonly outlineNodeId: string
  readonly pageIds: readonly string[]
  readonly sourceRefs: readonly ProjectionSourceRef[]
}

export interface ContractNeutralPresentationProjection {
  readonly preDesignProjectId: string
  readonly presentationProjectId: string
  readonly preDesignRevision: ProjectionSourceRevision
  readonly sections: readonly ProjectedPresentationSection[]
  readonly pages: readonly ProjectedPresentationPage[]
}
