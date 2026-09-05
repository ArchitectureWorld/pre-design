import { lstat } from 'node:fs/promises'
import { isAbsolute, resolve, win32 } from 'node:path'
import type {
  AssetId,
  AssetManifest,
  AssetRecord,
  CanonicalDocument,
  ContentNature,
  DraftContentBlock,
  DraftPageDocument,
  ListItem,
  MetricRecord,
  OutlineDocument,
  OutlineNode,
  OutlineNodeId,
  PageAssetReference,
  PageId,
  PageManifest,
  PageRecord,
  ProjectId,
  ProjectManifest,
  ProjectRulesDocument,
  ScriptBlock,
  SourceMaterialCategory,
  SourceMaterialId,
  SourceMaterialManifest,
  SourceMaterialRecord,
  SourceRef,
  TableCell,
  TableColumn,
  TableRow,
} from '@architectureworld/presentation-contracts'
import type { FrozenProjectInput, FrozenStateObject } from '../report/types.ts'
import { sha256CanonicalJson } from './canonical-json.ts'
import { sha256File } from './filesystem.ts'
import { PresentationStableIdLedger } from './identity-ledger.ts'
import {
  classifyFormalAsset,
  classifySourceMaterial,
  planMaterialImport,
  type ExistingMaterialEntry,
  type FormalAssetCategory,
  type SourceMaterialCategory as PlannedSourceMaterialCategory,
} from './material-plan.ts'
import { normalizeProjectSlug } from './path-policy.ts'
import { getPresentationStandardContract } from './standard-contract.ts'
import type {
  PresentationAdoptedAssetInput,
  PresentationManagedFile,
  PresentationRulesInput,
  PresentationSourceMaterialInput,
  PresentationStandardProjectBuild,
  PresentationStandardProjectBuildInput,
} from './standard-project-types.ts'
import { compileReportOutline } from './projector/report-outline.ts'
import { DEFAULT_PRESENTATION_TOPICS } from './projector/topics.ts'
import type { ProfessionalFinding, SupportingBlock } from './projector/types.ts'

const RULES_KEY = 'document:rules'
const OUTLINE_KEY = 'document:outline'
const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

const DEFAULT_RULES: PresentationRulesInput = Object.freeze({
  audiences: Object.freeze(['项目决策团队']),
  purposes: Object.freeze(['前期策划成果交付']),
  language: 'zh-CN',
  writingRules: Object.freeze(['结论优先', '每页只表达一个核心结论']),
  terminology: Object.freeze({}),
  truthConstraints: Object.freeze(['事实、判断、假设、建议和决策必须明确区分']),
  visualIntent: Object.freeze([
    '优先使用可追溯的项目证据与正式采用素材，排版只能使用当前草案页面素材库已关联的素材',
    '相关场景图和大图优先；仅按明确的页面关联使用背景图，不将同一图像铺到无关页面',
    '地图、专业图纸、数据图表与带文字图件完整显示，保留图例和标注，不以裁切背景损失信息',
    '尽量减少纯文字页面；没有真实素材时明确资料缺口，不虚构图片、视频或数据',
  ]),
  prohibitedContent: Object.freeze(['不得虚构缺失事实或证据']),
})

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`)
}

function normalizeString(value: string, name: string): string {
  const normalized = value.normalize('NFC').trim()
  if (normalized === '') fail('PRESENTATION_STANDARD_INPUT_INVALID', `${name} must be non-empty`)
  return normalized
}

function distinctStrings(values: readonly string[]): string[] {
  return [...new Set(values
    .map(value => value.normalize('NFC').trim())
    .filter(value => value !== ''))]
}

function normalizeRules(input: PresentationRulesInput | undefined): ProjectRulesDocument {
  const rules = input ?? DEFAULT_RULES
  const terminology = Object.fromEntries(Object.entries(rules.terminology)
    .map(([key, value]) => [key.normalize('NFC').trim(), value.normalize('NFC').trim()] as const)
    .filter(([key, value]) => key !== '' && value !== ''))
  const language = normalizeString(rules.language, 'rules.language')
  if (!/^(?:[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*|und)$/u.test(language)) {
    fail('PRESENTATION_STANDARD_INPUT_INVALID', `invalid language tag '${language}'`)
  }
  return {
    $schema: '',
    documentType: 'ProjectRulesDocument',
    standardVersion: '0.1.0',
    projectRulesId: '' as ProjectRulesDocument['projectRulesId'],
    projectId: '' as ProjectId,
    audiences: distinctStrings(rules.audiences),
    purposes: distinctStrings(rules.purposes),
    language,
    writingRules: distinctStrings(rules.writingRules),
    terminology,
    truthConstraints: distinctStrings(rules.truthConstraints),
    visualIntent: distinctStrings(rules.visualIntent),
    prohibitedContent: distinctStrings(rules.prohibitedContent ?? []),
  }
}

function portableAbsoluteHostPath(value: string): string {
  if (!isAbsolute(value) && !win32.isAbsolute(value)) {
    fail('PRESENTATION_SOURCE_PATH_NOT_ABSOLUTE', `source path '${value}' must be absolute`)
  }
  return resolve(value)
}

async function regularFileIntegrity(sourcePath: string): Promise<{
  readonly sourcePath: string
  readonly sizeBytes: number
  readonly sha256: string
}> {
  const path = portableAbsoluteHostPath(sourcePath)
  const file = await lstat(path)
  if (!file.isFile() || file.isSymbolicLink()) {
    fail('PRESENTATION_SOURCE_FILE_NOT_REGULAR', `source '${path}' must be a regular non-symlink file`)
  }
  return { sourcePath: path, sizeBytes: file.size, sha256: await sha256File(path) }
}

function normalizeMimeType(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!MIME_PATTERN.test(normalized)) {
    fail('PRESENTATION_MATERIAL_MIME_INVALID', `invalid MIME type '${value}'`)
  }
  return normalized
}

function sourceCategory(category: PlannedSourceMaterialCategory): SourceMaterialCategory {
  const mapping: Record<PlannedSourceMaterialCategory, SourceMaterialCategory> = {
    documents: 'document',
    drawings: 'drawing',
    images: 'image',
    videos: 'video',
    data: 'data',
    models: 'model',
    other: 'other',
  }
  return mapping[category]
}

function assetCategory(category: FormalAssetCategory): AssetRecord['category'] {
  const mapping: Record<FormalAssetCategory, AssetRecord['category']> = {
    images: 'image',
    videos: 'video',
    charts: 'chart',
    diagrams: 'diagram',
    audio: 'audio',
    other: 'other',
  }
  return mapping[category]
}

function assetMediaType(mimeType: string): AssetRecord['mediaType'] {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('model/')) return 'model'
  if (mimeType === 'application/pdf' || mimeType.includes('document') || mimeType.includes('presentation')) return 'document'
  if (mimeType === 'text/csv' || mimeType.includes('json') || mimeType.includes('xml')) return 'data'
  return 'other'
}

function stableSourceKey(sourceKey: string): string {
  return `source:${normalizeString(sourceKey, 'sourceKey')}`
}

function stableAssetKey(sourceKey: string): string {
  return `asset:${normalizeString(sourceKey, 'asset.sourceKey')}`
}

function sourceSnapshot(
  frozenProject: FrozenProjectInput,
  objectIds: readonly string[],
  evidenceIds: readonly string[],
): string {
  const objectSet = new Set(objectIds)
  const objects = frozenProject.stateObjects
    .filter(object => objectSet.has(object.objectId))
    .map(object => ({
      objectId: object.objectId,
      chapterId: object.chapterId,
      workItemId: object.workItemId ?? null,
      title: object.title,
      summary: object.summary,
      facts: object.facts,
      ...(object.reportSections === undefined ? {} : { reportSections: object.reportSections }),
    }))
    .sort((left, right) => left.objectId.localeCompare(right.objectId))
  return sha256CanonicalJson({
    provider: 'pre-design',
    sourceProjectId: frozenProject.projectId,
    sourceRevision: frozenProject.revision,
    objectIds: [...new Set(objectIds)].sort(),
    evidenceIds: [...new Set(evidenceIds)].sort(),
    objects,
  })
}

function sourceRef(
  frozenProject: FrozenProjectInput,
  objectIds: readonly string[],
  evidenceIds: readonly string[] = [],
): SourceRef {
  const normalizedObjects = distinctStrings(objectIds).sort((left, right) => left.localeCompare(right))
  const normalizedEvidence = distinctStrings(evidenceIds).sort((left, right) => left.localeCompare(right))
  return {
    provider: 'pre-design',
    sourceProjectId: normalizeString(frozenProject.projectId, 'frozenProject.projectId'),
    sourceRevision: frozenProject.revision,
    objectIds: normalizedObjects,
    evidenceIds: normalizedEvidence,
    sourceSnapshotSha256: sourceSnapshot(frozenProject, normalizedObjects, normalizedEvidence),
  }
}

function objectById(frozenProject: FrozenProjectInput): ReadonlyMap<string, FrozenStateObject> {
  const result = new Map<string, FrozenStateObject>()
  for (const object of frozenProject.stateObjects) {
    if (result.has(object.objectId)) {
      fail('PRESENTATION_SOURCE_OBJECT_DUPLICATE', `duplicate pre-design object '${object.objectId}'`)
    }
    result.set(object.objectId, object)
  }
  return result
}

async function buildSourceMaterials(
  inputs: readonly PresentationSourceMaterialInput[],
  projectId: ProjectId,
  ledger: PresentationStableIdLedger,
): Promise<{
  readonly manifest: SourceMaterialManifest
  readonly managedFiles: readonly PresentationManagedFile[]
  readonly idsBySourceKey: ReadonlyMap<string, SourceMaterialId>
}> {
  const records: SourceMaterialRecord[] = []
  const managedFiles: PresentationManagedFile[] = []
  const idsBySourceKey = new Map<string, SourceMaterialId>()
  const entries: ExistingMaterialEntry[] = []
  const sourceKeys = new Set<string>()

  for (const input of inputs) {
    const sourceKey = normalizeString(input.sourceKey, 'sourceMaterial.sourceKey')
    if (sourceKeys.has(sourceKey)) fail('PRESENTATION_SOURCE_KEY_DUPLICATE', `duplicate source material key '${sourceKey}'`)
    sourceKeys.add(sourceKey)
    const mimeType = normalizeMimeType(input.mimeType)
    const category = classifySourceMaterial(input.originalFileName, mimeType)
    const integrity = await regularFileIntegrity(input.sourcePath)
    const importPlan = planMaterialImport({
      domain: 'source-materials',
      category,
      originalFileName: input.originalFileName,
      sha256: integrity.sha256,
      existingEntries: entries.filter(entry => entry.relativePath.startsWith(`source-materials/${category}/`)),
    })

    if (importPlan.action === 'deduplicate') {
      const duplicate = records.find(record => record.sourceMaterialId === importPlan.existingObjectId)
      if (duplicate === undefined) fail('PRESENTATION_SOURCE_DEDUPLICATION_INVALID', `missing record '${importPlan.existingObjectId}'`)
      const duplicateId = duplicate.sourceMaterialId
      ledger.bind('sourceMaterial', stableSourceKey(sourceKey), duplicateId)
      idsBySourceKey.set(sourceKey, duplicateId)
      const names = distinctStrings([
        ...(duplicate.alternateOriginalFileNames ?? []),
        input.originalFileName,
      ]).filter(name => name !== duplicate.originalFileName)
      if (names.length > 0) duplicate.alternateOriginalFileNames = names
      continue
    }

    const sourceMaterialId = ledger.resolve('sourceMaterial', stableSourceKey(sourceKey)) as SourceMaterialId
    const record: SourceMaterialRecord = {
      sourceMaterialId,
      originalFileName: importPlan.originalFileName,
      category: sourceCategory(category),
      relativePath: importPlan.relativePath,
      mimeType,
      sizeBytes: integrity.sizeBytes,
      sha256: integrity.sha256,
      importedAt: normalizeString(input.importedAt, 'sourceMaterial.importedAt'),
      status: input.status ?? 'available',
    }
    records.push(record)
    entries.push({
      objectId: sourceMaterialId,
      originalFileName: record.originalFileName,
      relativePath: record.relativePath,
      sha256: record.sha256,
    })
    idsBySourceKey.set(sourceKey, sourceMaterialId)
    managedFiles.push({
      domain: 'source-materials',
      sourceKey,
      stableId: sourceMaterialId,
      sourcePath: integrity.sourcePath,
      relativePath: record.relativePath,
      mimeType,
      sizeBytes: integrity.sizeBytes,
      sha256: integrity.sha256,
    })
  }

  return {
    manifest: {
      $schema: 'https://contracts.architecture.world/presentation-standard-project/0.1.0/source-material-manifest.schema.json',
      documentType: 'SourceMaterialManifest',
      standardVersion: '0.1.0',
      projectId,
      materials: records,
    },
    managedFiles,
    idsBySourceKey,
  }
}

async function buildAssets(
  inputs: readonly PresentationAdoptedAssetInput[],
  frozenProject: FrozenProjectInput,
  projectId: ProjectId,
  ledger: PresentationStableIdLedger,
  sourceMaterialIds: ReadonlyMap<string, SourceMaterialId>,
): Promise<{
  readonly manifest: AssetManifest
  readonly managedFiles: readonly PresentationManagedFile[]
  readonly recordsBySourceKey: ReadonlyMap<string, AssetRecord>
}> {
  const records: AssetRecord[] = []
  const managedFiles: PresentationManagedFile[] = []
  const recordsBySourceKey = new Map<string, AssetRecord>()
  const entries: ExistingMaterialEntry[] = []
  const sourceKeys = new Set<string>()

  for (const input of inputs) {
    const sourceKey = normalizeString(input.sourceKey, 'asset.sourceKey')
    if (sourceKeys.has(sourceKey)) fail('PRESENTATION_ASSET_KEY_DUPLICATE', `duplicate asset key '${sourceKey}'`)
    sourceKeys.add(sourceKey)
    const mimeType = normalizeMimeType(input.mimeType)
    const isDrawing = classifySourceMaterial(input.originalFileName, mimeType) === 'drawings'
    const plannedCategory = isDrawing ? 'other' : classifyFormalAsset(input.originalFileName, mimeType, input.semanticRole)
    const mediaType = isDrawing ? 'other' : assetMediaType(mimeType)
    const integrity = await regularFileIntegrity(input.sourcePath)
    const importPlan = planMaterialImport({
      domain: 'assets',
      category: plannedCategory,
      originalFileName: input.originalFileName,
      sha256: integrity.sha256,
      existingEntries: entries.filter(entry => entry.relativePath.startsWith(`assets/${plannedCategory}/`)),
    })

    if (importPlan.action === 'deduplicate') {
      const duplicate = records.find(record => record.assetId === importPlan.existingObjectId)
      if (duplicate === undefined) fail('PRESENTATION_ASSET_DEDUPLICATION_INVALID', `missing record '${importPlan.existingObjectId}'`)
      ledger.bind('asset', stableAssetKey(sourceKey), duplicate.assetId)
      recordsBySourceKey.set(sourceKey, duplicate)
      continue
    }

    const sourceIds = input.origin.sourceMaterialKeys.map(sourceKeyValue => {
      const id = sourceMaterialIds.get(normalizeString(sourceKeyValue, 'asset.origin.sourceMaterialKey'))
      if (id === undefined) {
        fail('PRESENTATION_ASSET_SOURCE_MATERIAL_MISSING', `asset '${sourceKey}' references unknown source material '${sourceKeyValue}'`)
      }
      return id
    })
    const parentIds = input.origin.parentAssetKeys.map(parentKey => {
      const parent = recordsBySourceKey.get(normalizeString(parentKey, 'asset.origin.parentAssetKey'))
      if (parent === undefined) fail('PRESENTATION_ASSET_PARENT_MISSING', `asset '${sourceKey}' references unknown parent '${parentKey}'`)
      return parent.assetId
    })
    if ((input.origin.type === 'source_material' || input.origin.type === 'derived_source_material')
      && sourceIds.length === 0) {
      fail('PRESENTATION_ASSET_SOURCE_MATERIAL_REQUIRED', `asset '${sourceKey}' requires a source material reference`)
    }

    const metadata: AssetRecord['metadata'] = {}
    if (input.widthPx !== undefined) metadata.widthPx = input.widthPx
    if (input.heightPx !== undefined) metadata.heightPx = input.heightPx
    if (input.durationMs !== undefined) metadata.durationMs = input.durationMs
    if (input.pageCount !== undefined) metadata.pageCount = input.pageCount
    if (input.rowCount !== undefined) metadata.rowCount = input.rowCount
    if (input.columnCount !== undefined) metadata.columnCount = input.columnCount
    if (mediaType === 'image'
      && (!Number.isInteger(metadata.widthPx) || !Number.isInteger(metadata.heightPx))) {
      fail('PRESENTATION_ASSET_IMAGE_DIMENSIONS_REQUIRED', `image asset '${sourceKey}' requires widthPx and heightPx`)
    }
    if ((mediaType === 'video' || mediaType === 'audio') && (metadata.durationMs === undefined || !Number.isFinite(metadata.durationMs) || metadata.durationMs <= 0)) {
      fail('PRESENTATION_ASSET_DURATION_REQUIRED', `${mediaType} asset '${sourceKey}' requires durationMs`)
    }
    if (mediaType !== 'image' && (input.role === 'background' || input.pageBindings?.some(binding => binding.role === 'background'))) {
      fail('PRESENTATION_BACKGROUND_ASSET_INVALID', `only image assets may be backgrounds: '${sourceKey}'`)
    }

    const assetId = ledger.resolve('asset', stableAssetKey(sourceKey)) as AssetId
    const record: AssetRecord = {
      assetId,
      displayName: normalizeString(input.displayName, 'asset.displayName'),
      mediaType,
      category: assetCategory(plannedCategory),
      semanticRole: normalizeString(input.semanticRole, 'asset.semanticRole'),
      relativePath: importPlan.relativePath,
      mimeType,
      sizeBytes: integrity.sizeBytes,
      sha256: integrity.sha256,
      metadata,
      adoptionStatus: 'adopted',
      origin: {
        type: input.origin.type,
        sourceMaterialIds: [...new Set(sourceIds)],
        parentAssetIds: [...new Set(parentIds)],
        method: normalizeString(input.origin.method, 'asset.origin.method'),
        sourceTool: input.origin.sourceTool === null
          ? null
          : {
              name: normalizeString(input.origin.sourceTool.name, 'asset.origin.sourceTool.name'),
              version: normalizeString(input.origin.sourceTool.version, 'asset.origin.sourceTool.version'),
            },
      },
      sourceRefs: [sourceRef(frozenProject, input.objectIds, input.evidenceIds)],
      createdAt: normalizeString(input.createdAt, 'asset.createdAt'),
      adoptedAt: normalizeString(input.adoptedAt, 'asset.adoptedAt'),
      retiredAt: null,
    }
    records.push(record)
    recordsBySourceKey.set(sourceKey, record)
    entries.push({
      objectId: assetId,
      originalFileName: input.originalFileName,
      relativePath: record.relativePath,
      sha256: record.sha256,
    })
    managedFiles.push({
      domain: 'assets',
      sourceKey,
      stableId: assetId,
      sourcePath: integrity.sourcePath,
      relativePath: record.relativePath,
      mimeType,
      sizeBytes: integrity.sizeBytes,
      sha256: integrity.sha256,
    })
  }

  return {
    manifest: {
      $schema: 'https://contracts.architecture.world/presentation-standard-project/0.1.0/asset-manifest.schema.json',
      documentType: 'AssetManifest',
      standardVersion: '0.1.0',
      projectId,
      assets: records,
    },
    managedFiles,
    recordsBySourceKey,
  }
}

function supportingContentBlocks(
  finding: ProfessionalFinding,
  refs: SourceRef[],
  ledger: PresentationStableIdLedger,
): DraftContentBlock[] {
  const prefix = `finding:${normalizeString(finding.findingId, 'finding.findingId')}`
  const occurrences = new Map<string, number>()
  const firstType = new Set<SupportingBlock['type']>()
  return finding.supportingBlocks.flatMap((block, index): DraftContentBlock[] => {
    if ((block.type === 'list' && block.items.length === 0)
      || (block.type === 'metric_group' && block.metrics.length === 0)
      || (block.type === 'table' && block.rows.length === 0)) return []
    const roleKey = `${block.type}:${block.role ?? 'body'}`
    const occurrence = occurrences.get(roleKey) ?? 0
    occurrences.set(roleKey, occurrence + 1)
    const legacyKey = !firstType.has(block.type)
      ? ({ list: 'list', metric_group: 'metrics', table: 'table' } as const)[block.type as 'list' | 'metric_group' | 'table']
      : undefined
    firstType.add(block.type)
    const key = `${prefix}:block:${legacyKey ?? `support:${roleKey}:${occurrence}`}`
    const base = {
      contentBlockId: ledger.resolve('contentBlock', key) as DraftContentBlock['contentBlockId'],
      order: (index + 2) * 10,
      sourceRefs: refs,
    }
    switch (block.type) {
      case 'heading':
        return [{ ...base, type: 'heading', role: block.role ?? 'section_title', content: normalizeString(block.content, 'supporting heading') }]
      case 'text':
        return [{ ...base, type: 'text', role: block.role ?? 'body', content: normalizeString(block.content, 'supporting text'), contentNature: block.contentNature ?? finding.contentNature }]
      case 'list': {
        const items: ListItem[] = block.items.map((content, order) => ({
          listItemId: ledger.resolve('listItem', `${key}:item:${order}`) as ListItem['listItemId'],
          order,
          content: normalizeString(content, 'supporting list item'),
          contentNature: finding.contentNature,
          sourceRefs: refs,
        }))
        return [{ ...base, type: 'list', role: 'body', listStyle: block.listStyle, items }]
      }
      case 'metric_group': {
        const metrics: MetricRecord[] = block.metrics.map((metric, order) => ({
          metricId: ledger.resolve('metric', `${key}:metric:${order}`) as MetricRecord['metricId'],
          order,
          label: normalizeString(metric.label, 'supporting metric label'),
          value: typeof metric.value === 'string' ? metric.value.normalize('NFC') : metric.value,
          unit: metric.unit?.normalize('NFC').trim() || null,
          note: metric.note?.normalize('NFC').trim() || null,
          contentNature: finding.contentNature,
          sourceRefs: refs,
        }))
        return [{ ...base, type: 'metric_group', role: 'body', metrics }]
      }
      case 'table': {
        const columns: TableColumn[] = block.columns.map((label, order) => ({
          tableColumnId: ledger.resolve('tableColumn', `${key}:column:${order}`) as TableColumn['tableColumnId'],
          order,
          label: normalizeString(label, 'supporting table column'),
        }))
        const rows: TableRow[] = block.rows.map((values, order) => {
          if (values.length !== columns.length) fail('PRESENTATION_SUPPORTING_TABLE_INVALID', `finding '${finding.findingId}' has mismatched table cells`)
          const cells: TableCell[] = columns.map((column, columnIndex) => ({
            tableCellId: ledger.resolve('tableCell', `${key}:row:${order}:cell:${columnIndex}`) as TableCell['tableCellId'],
            tableColumnId: column.tableColumnId,
            content: typeof values[columnIndex] === 'string' ? values[columnIndex].normalize('NFC') : values[columnIndex] ?? null,
            contentNature: finding.contentNature,
            sourceRefs: refs,
          }))
          return {
            tableRowId: ledger.resolve('tableRow', `${key}:row:${order}`) as TableRow['tableRowId'],
            order,
            label: String(values[0] ?? '').normalize('NFC'),
            cells,
            sourceRefs: refs,
          }
        })
        return [{ ...base, type: 'table', role: 'body', columns, rows }]
      }
    }
  })
}

function buildDraft(
  frozenProject: FrozenProjectInput,
  finding: ProfessionalFinding,
  projectId: ProjectId,
  pageId: PageId,
  ledger: PresentationStableIdLedger,
  matchingAssets: readonly { readonly input: PresentationAdoptedAssetInput; readonly record: AssetRecord }[],
): DraftPageDocument {
  const findingKey = normalizeString(finding.findingId, 'finding.findingId')
  const refs = [sourceRef(frozenProject, finding.objectIds, finding.evidenceIds)]
  const titleId = ledger.resolve('contentBlock', `finding:${findingKey}:block:title`) as DraftContentBlock['contentBlockId']
  const messageId = ledger.resolve('contentBlock', `finding:${findingKey}:block:key-message`) as DraftContentBlock['contentBlockId']
  // Keep the legacy primary identities available even when a report page has no metric/table.
  for (const role of ['list', 'metrics', 'table']) ledger.resolve('contentBlock', `finding:${findingKey}:block:${role}`)

  const contentBlocks: DraftContentBlock[] = [
    {
      contentBlockId: titleId,
      type: 'heading',
      role: 'page_title',
      order: 0,
      content: normalizeString(finding.title, 'finding.title'),
      sourceRefs: refs,
    },
    {
      contentBlockId: messageId,
      type: 'text',
      role: 'key_message',
      order: 10,
      content: normalizeString(finding.keyMessage, 'finding.keyMessage'),
      contentNature: finding.contentNature as ContentNature,
      sourceRefs: refs,
    },
    ...supportingContentBlocks(finding, refs, ledger),
  ]

  const pageAssets: PageAssetReference[] = matchingAssets.map(({ input, record }, order) => ({
    pageAssetId: ledger.resolve('pageAsset', `finding:${findingKey}:asset:${input.sourceKey}`) as PageAssetReference['pageAssetId'],
    assetId: record.assetId,
    role: input.pageBindings?.find(binding => binding.findingId === finding.findingId)?.role
      ?? input.role ?? (record.mediaType === 'image' ? (order === 0 ? 'primary' : 'supporting') : 'reference'),
    order,
    caption: record.displayName,
    sourceRefs: record.sourceRefs,
  }))
  const authoredSpeakerNotes = distinctStrings(finding.speakerNotes ?? [])
  const speakerParts = authoredSpeakerNotes.length > 0 ? authoredSpeakerNotes : distinctStrings([
    finding.keyMessage,
    ...(finding.contentNature === 'decision' ? frozenProject.decisionItems : []),
    ...(finding.contentNature === 'decision' && frozenProject.recommendation.trim() !== ''
      ? [frozenProject.recommendation]
      : []),
  ])
  const script: ScriptBlock = {
    scriptBlockId: ledger.resolve('scriptBlock', `finding:${findingKey}:script:primary`) as ScriptBlock['scriptBlockId'],
    order: 0,
    content: speakerParts.join('\n'),
    estimatedDurationSeconds: null,
    referencedContentBlockIds: contentBlocks.map(block => block.contentBlockId),
    referencedAssetIds: pageAssets.map(reference => reference.assetId),
    sourceRefs: refs,
  }

  return {
    $schema: 'https://contracts.architecture.world/presentation-standard-project/0.1.0/draft-page-document.schema.json',
    documentType: 'DraftPageDocument',
    standardVersion: '0.1.0',
    draftDocumentId: ledger.resolve('draftDocument', `finding:${findingKey}:draft`) as DraftPageDocument['draftDocumentId'],
    projectId,
    pageId,
    contentBlocks,
    scriptBlocks: [script],
    pageAssets,
  }
}

function matchingAssetsForFinding(
  frozenProject: FrozenProjectInput,
  finding: ProfessionalFinding,
  inputs: readonly PresentationAdoptedAssetInput[],
  records: ReadonlyMap<string, AssetRecord>,
): readonly { readonly input: PresentationAdoptedAssetInput; readonly record: AssetRecord }[] {
  const objectIds = new Set(finding.objectIds)
  const evidenceIds = new Set(finding.evidenceIds)
  const explicitIds = new Set(finding.assetIds ?? [])
  for (const object of frozenProject.stateObjects) {
    if (!objectIds.has(object.objectId)) continue
    for (const section of object.reportSections ?? []) for (const entry of section.entries) for (const ref of entry.evidenceRefs ?? []) {
      if (evidenceIds.has(ref.evidenceId) && ref.assetId !== undefined) explicitIds.add(ref.assetId)
    }
  }
  const matches = new Map<string, { input: PresentationAdoptedAssetInput; record: AssetRecord; priority: number }>()
  for (const input of inputs) {
    const identities = [input.sourceKey, ...(input.aliases ?? [])]
    const pageMatch = input.pageBindings?.some(binding => binding.findingId === finding.findingId) ?? false
    const referenceMatch = identities.some(id => explicitIds.has(id) || evidenceIds.has(id)) || input.evidenceIds.some(id => evidenceIds.has(id))
    const objectMatch = input.objectIds.some(objectId => objectIds.has(objectId))
    if (!pageMatch && !referenceMatch && !objectMatch) continue
    const record = records.get(input.sourceKey.normalize('NFC').trim())
    if (record === undefined) continue
    const priority = pageMatch ? 3 : referenceMatch ? 2 : 1
    const previous = matches.get(record.assetId)
    if (previous === undefined || priority > previous.priority) matches.set(record.assetId, { input, record, priority })
  }
  return [...matches.values()].map(({ input, record }) => ({ input, record }))
}

export async function buildPresentationStandardProject(
  input: PresentationStandardProjectBuildInput,
): Promise<PresentationStandardProjectBuild> {
  const frozenProject = input.frozenProject
  if (!Number.isSafeInteger(frozenProject.revision) || frozenProject.revision < 0) {
    fail('PRESENTATION_SOURCE_REVISION_INVALID', 'pre-design revision must be a non-negative integer')
  }
  const contract = await getPresentationStandardContract()
  const ledger = new PresentationStableIdLedger(input.stableIds)
  const projectKey = `pre-design:${normalizeString(frozenProject.projectId, 'frozenProject.projectId')}`
  if (input.presentationProjectId !== undefined) {
    ledger.bind('project', projectKey, input.presentationProjectId)
  }
  const projectId = ledger.resolve('project', projectKey) as ProjectId
  const projectRulesId = ledger.resolve('projectRules', RULES_KEY) as ProjectRulesDocument['projectRulesId']
  const outlineDocumentId = ledger.resolve('outlineDocument', OUTLINE_KEY) as OutlineDocument['outlineDocumentId']
  const projectSlug = input.projectSlug === undefined
    ? normalizeProjectSlug(frozenProject.projectName)
    : normalizeString(input.projectSlug, 'projectSlug')
  if (!SLUG_PATTERN.test(projectSlug)) {
    fail('PRESENTATION_PROJECT_SLUG_INVALID', `invalid project slug '${projectSlug}'`)
  }

  const normalizedRules = normalizeRules(input.rules)
  const plan = contract.createProjectDirectoryPlan({
    projectId,
    projectSlug,
    name: normalizeString(frozenProject.projectName, 'frozenProject.projectName'),
    language: normalizedRules.language,
    createdAt: input.createdAt ?? frozenProject.generatedAt,
    createdBy: {
      provider: 'pre-design',
      sourceProjectId: frozenProject.projectId,
      actorId: input.actorId ?? null,
    },
    ids: { projectRulesId, outlineDocumentId },
  })

  const sourceMaterials = await buildSourceMaterials(input.sourceMaterials ?? [], projectId, ledger)
  const assets = await buildAssets(
    input.assets ?? [],
    frozenProject,
    projectId,
    ledger,
    sourceMaterials.idsBySourceKey,
  )

  const findings = compileReportOutline(frozenProject)
  const objects = objectById(frozenProject)
  const topicNodes: OutlineNode[] = []
  const subjectNodes: OutlineNode[] = []
  const sectionNodes: OutlineNode[] = []
  const pageRecords: PageRecord[] = []
  const drafts: Record<string, DraftPageDocument> = {}

  for (const topic of DEFAULT_PRESENTATION_TOPICS) {
    const topicFindings = findings.filter(finding => finding.topicKey === topic.key)
    if (topicFindings.length === 0) continue
    const topicObjectIds = topicFindings.flatMap(finding => finding.objectIds)
    const topicNodeId = ledger.resolve('outlineNode', `topic:${topic.key}`) as OutlineNodeId
    topicNodes.push({
      outlineNodeId: topicNodeId,
      parentOutlineNodeId: null,
      kind: 'chapter',
      title: topic.title,
      summary: topicFindings.map(finding => finding.keyMessage).join('；'),
      order: topic.order,
      sourceRefs: [sourceRef(frozenProject, topicObjectIds)],
    })

    const subjects = new Map<string, typeof topicFindings>()
    for (const finding of topicFindings) {
      const sectionKey = normalizeString(finding.sectionKey, 'finding.sectionKey')
      const subjectFindings = subjects.get(sectionKey) ?? []
      subjectFindings.push(finding)
      subjects.set(sectionKey, subjectFindings)
    }
    const orderedSubjects = [...subjects.entries()].sort(([leftKey, left], [rightKey, right]) =>
      left[0]!.sectionOrder - right[0]!.sectionOrder || leftKey.localeCompare(rightKey))
    for (const [subjectOrder, [sectionKey, subjectFindings]] of orderedSubjects.entries()) {
      const subjectNodeId = ledger.resolve('outlineNode', `section:${topic.key}:${sectionKey}`) as OutlineNodeId
      subjectNodes.push({
        outlineNodeId: subjectNodeId,
        parentOutlineNodeId: topicNodeId,
        kind: 'section',
        title: normalizeString(subjectFindings[0]!.sectionTitle, 'finding.sectionTitle'),
        summary: distinctStrings(subjectFindings.map(finding => finding.keyMessage)).join('；'),
        order: subjectOrder,
        sourceRefs: [sourceRef(frozenProject, subjectFindings.flatMap(finding => finding.objectIds))],
      })
      const orderedFindings = [...subjectFindings].sort((left, right) => left.order - right.order || left.findingId.localeCompare(right.findingId))
      for (const [findingOrder, finding] of orderedFindings.entries()) {
        const findingKey = normalizeString(finding.findingId, 'finding.findingId')
        for (const objectId of finding.objectIds) {
          if (!objects.has(objectId)) fail('PRESENTATION_FINDING_SOURCE_MISSING', `finding '${findingKey}' references unknown object '${objectId}'`)
        }
        const sectionNodeId = ledger.resolve('outlineNode', `finding:${findingKey}`) as OutlineNodeId
        const refs = [sourceRef(frozenProject, finding.objectIds, finding.evidenceIds)]
        sectionNodes.push({
          outlineNodeId: sectionNodeId,
          parentOutlineNodeId: subjectNodeId,
          kind: 'section',
          title: normalizeString(finding.title, 'finding.title'),
          summary: normalizeString(finding.keyMessage, 'finding.keyMessage'),
          order: findingOrder,
          sourceRefs: refs,
        })
        const pageId = ledger.resolve('page', `finding:${findingKey}`) as PageId
        const draft = buildDraft(
          frozenProject,
          finding,
          projectId,
          pageId,
          ledger,
          matchingAssetsForFinding(frozenProject, finding, input.assets ?? [], assets.recordsBySourceKey),
        )
        const draftPath = `pages/drafts/${pageId}.json`
        pageRecords.push({
          pageId,
          outlineNodeId: sectionNodeId,
          order: pageRecords.length,
          titleBlockId: draft.contentBlocks.find(block => block.type === 'heading' && block.role === 'page_title')?.contentBlockId ?? null,
          draftPath,
          sourceRefs: refs,
        })
        drafts[draftPath] = draft
      }
    }
  }

  const baseProject = plan.documents['project.json'] as ProjectManifest
  const projectDocument: ProjectManifest = {
    ...baseProject,
    name: normalizeString(frozenProject.projectName, 'frozenProject.projectName'),
    projectSlug,
  }
  const rulesDocument: ProjectRulesDocument = {
    ...normalizedRules,
    $schema: (plan.documents['rules.json'] as ProjectRulesDocument).$schema,
    projectRulesId,
    projectId,
  }
  const outlineDocument: OutlineDocument = {
    ...(plan.documents['outline.json'] as OutlineDocument),
    outlineDocumentId,
    projectId,
    nodes: [...topicNodes, ...subjectNodes, ...sectionNodes]
      .sort((left, right) => left.order - right.order || left.outlineNodeId.localeCompare(right.outlineNodeId)),
  }
  const pageManifest: PageManifest = {
    ...(plan.documents['pages/manifest.json'] as PageManifest),
    projectId,
    pages: pageRecords.sort((left, right) => left.order - right.order || left.pageId.localeCompare(right.pageId)),
  }

  const documents: Record<string, CanonicalDocument> = {
    ...plan.documents,
    'project.json': projectDocument,
    'rules.json': rulesDocument,
    'outline.json': outlineDocument,
    'pages/manifest.json': pageManifest,
    'source-materials/manifest.json': sourceMaterials.manifest,
    'assets/manifest.json': assets.manifest,
    ...drafts,
  }
  const semanticObjectHashes = Object.fromEntries(frozenProject.stateObjects
    .map(object => [object.objectId, sha256CanonicalJson(object)] as const)
    .sort(([left], [right]) => left.localeCompare(right)))

  return Object.freeze({
    standardVersion: '0.1.0' as const,
    projectId,
    projectSlug,
    directoryName: `${projectId}-${projectSlug}`,
    documents: Object.freeze(documents),
    managedFiles: Object.freeze([...sourceMaterials.managedFiles, ...assets.managedFiles]
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath))),
    stableIds: ledger.snapshot(),
    semanticObjectHashes: Object.freeze(semanticObjectHashes),
  })
}
