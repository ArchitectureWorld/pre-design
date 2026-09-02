import { DEFAULT_PRESENTATION_TOPICS } from './topics.ts'
import type {
  ContractNeutralPresentationProjection,
  ContentNature,
  ProfessionalFinding,
  ProjectedContentBlock,
  ProjectedListBlock,
  ProjectedMetricGroupBlock,
  ProjectedPresentationPage,
  ProjectedPresentationSection,
  ProjectedTableBlock,
  ProjectionIdFactory,
  ProjectionIdKind,
  ProjectionScalar,
  ProjectionSourceRef,
  ProjectionSourceRevision,
  ProjectionTopicDefinition,
  SupportingBlock,
  PresentationProjectionInput,
} from './types.ts'

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`)
}

function requiredString(value: string, code: string, field: string): string {
  const normalized = value.normalize('NFC').trim()
  if (normalized === '') fail(code, `${field} is required`)
  return normalized
}

function assertOrder(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    fail('PRESENTATION_PROJECTION_ORDER_INVALID', `${field} must be a non-negative integer`)
  }
  return value
}

function assertRevision(value: ProjectionSourceRevision): ProjectionSourceRevision {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      fail(
        'PRESENTATION_PROJECTION_REVISION_INVALID',
        'preDesignRevision must be a non-negative integer or non-empty string',
      )
    }
    return value
  }
  return requiredString(
    value,
    'PRESENTATION_PROJECTION_REVISION_INVALID',
    'preDesignRevision',
  )
}

function uniqueStrings(
  values: readonly string[],
  code: string,
  field: string,
  allowEmpty: boolean,
): readonly string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = value.normalize('NFC').trim()
    if (normalized === '') {
      if (allowEmpty) continue
      fail(code, `${field} contains an empty value`)
    }
    if (seen.has(normalized)) fail(code, `${field} contains duplicate '${normalized}'`)
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function createId(factory: ProjectionIdFactory, kind: ProjectionIdKind): string {
  return requiredString(
    factory.create(kind),
    'PRESENTATION_PROJECTION_ID_INVALID',
    `${kind} ID`,
  )
}

function validateScalar<T extends ProjectionScalar>(value: T, field: string): T {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    fail('PRESENTATION_PROJECTION_SCALAR_INVALID', `${field} must be finite`)
  }
  return (typeof value === 'string' ? value.normalize('NFC') : value) as T
}

function buildSourceRef(
  input: PresentationProjectionInput,
  finding: Pick<ProfessionalFinding, 'objectIds' | 'evidenceIds'>,
): ProjectionSourceRef {
  return {
    provider: 'pre-design',
    sourceProjectId: input.preDesignProjectId,
    sourceRevision: input.preDesignRevision,
    objectIds: uniqueStrings(
      finding.objectIds,
      'PRESENTATION_PROJECTION_SOURCE_ID_INVALID',
      'objectIds',
      false,
    ),
    evidenceIds: uniqueStrings(
      finding.evidenceIds,
      'PRESENTATION_PROJECTION_SOURCE_ID_INVALID',
      'evidenceIds',
      false,
    ),
  }
}

function buildSupportingBlock(
  block: SupportingBlock,
  order: number,
  sourceRefs: readonly ProjectionSourceRef[],
  ids: ProjectionIdFactory,
): ProjectedContentBlock {
  const contentBlockId = createId(ids, 'content-block')

  switch (block.type) {
    case 'heading':
      return {
        contentBlockId,
        type: 'heading',
        role: block.role ?? 'section_title',
        order,
        content: requiredString(
          block.content,
          'PRESENTATION_PROJECTION_BLOCK_CONTENT_REQUIRED',
          'heading content',
        ),
        sourceRefs,
      }

    case 'text': {
      const contentNature: { readonly contentNature?: ContentNature } =
        block.contentNature === undefined
          ? {}
          : { contentNature: block.contentNature }
      return {
        contentBlockId,
        type: 'text',
        role: block.role ?? 'body',
        order,
        content: requiredString(
          block.content,
          'PRESENTATION_PROJECTION_BLOCK_CONTENT_REQUIRED',
          'text content',
        ),
        ...contentNature,
        sourceRefs,
      }
    }

    case 'list': {
      if (block.items.length === 0) {
        fail('PRESENTATION_PROJECTION_LIST_EMPTY', 'list blocks require at least one item')
      }
      const items = block.items.map((item, itemIndex) => ({
        listItemId: createId(ids, 'list-item'),
        order: itemIndex,
        content: requiredString(
          item,
          'PRESENTATION_PROJECTION_LIST_ITEM_REQUIRED',
          `list item ${itemIndex}`,
        ),
        sourceRefs,
      }))
      const projected: ProjectedListBlock = {
        contentBlockId,
        type: 'list',
        role: block.role ?? 'body',
        order,
        listStyle: block.listStyle,
        items,
        sourceRefs,
      }
      return projected
    }

    case 'metric_group': {
      if (block.metrics.length === 0) {
        fail(
          'PRESENTATION_PROJECTION_METRIC_GROUP_EMPTY',
          'metric groups require at least one metric',
        )
      }
      const metrics = block.metrics.map((metric, metricIndex) => {
        const unit = metric.unit === undefined
          ? {}
          : {
              unit: requiredString(
                metric.unit,
                'PRESENTATION_PROJECTION_METRIC_UNIT_INVALID',
                `metric ${metricIndex} unit`,
              ),
            }
        const note = metric.note === undefined
          ? {}
          : {
              note: requiredString(
                metric.note,
                'PRESENTATION_PROJECTION_METRIC_NOTE_INVALID',
                `metric ${metricIndex} note`,
              ),
            }
        const value = typeof metric.value === 'number'
          ? validateScalar(metric.value, `metric ${metricIndex} value`)
          : requiredString(
              metric.value,
              'PRESENTATION_PROJECTION_METRIC_VALUE_REQUIRED',
              `metric ${metricIndex} value`,
            )
        return {
          metricId: createId(ids, 'metric'),
          order: metricIndex,
          label: requiredString(
            metric.label,
            'PRESENTATION_PROJECTION_METRIC_LABEL_REQUIRED',
            `metric ${metricIndex} label`,
          ),
          value,
          ...unit,
          ...note,
          sourceRefs,
        }
      })
      const projected: ProjectedMetricGroupBlock = {
        contentBlockId,
        type: 'metric_group',
        role: block.role ?? 'body',
        order,
        metrics,
        sourceRefs,
      }
      return projected
    }

    case 'table': {
      if (block.columns.length === 0) {
        fail('PRESENTATION_PROJECTION_TABLE_COLUMNS_EMPTY', 'tables require columns')
      }
      const columns = block.columns.map((column, columnIndex) => ({
        tableColumnId: createId(ids, 'table-column'),
        order: columnIndex,
        label: requiredString(
          column,
          'PRESENTATION_PROJECTION_TABLE_COLUMN_REQUIRED',
          `table column ${columnIndex}`,
        ),
      }))
      const rows = block.rows.map((row, rowIndex) => {
        if (row.length !== columns.length) {
          fail(
            'PRESENTATION_PROJECTION_TABLE_WIDTH_MISMATCH',
            `table row ${rowIndex} has ${row.length} cells for ${columns.length} columns`,
          )
        }
        return {
          tableRowId: createId(ids, 'table-row'),
          order: rowIndex,
          cells: row.map((cell, cellIndex) => ({
            tableCellId: createId(ids, 'table-cell'),
            tableColumnId: columns[cellIndex]!.tableColumnId,
            content: validateScalar(cell, `table cell ${rowIndex}:${cellIndex}`),
            sourceRefs,
          })),
          sourceRefs,
        }
      })
      const projected: ProjectedTableBlock = {
        contentBlockId,
        type: 'table',
        role: block.role ?? 'body',
        order,
        columns,
        rows,
        sourceRefs,
      }
      return projected
    }
  }
}

function buildPage(
  input: PresentationProjectionInput,
  finding: ProfessionalFinding,
  outlineNodeId: string,
  pageOrder: number,
  ids: ProjectionIdFactory,
): ProjectedPresentationPage {
  const sourceRefs = [buildSourceRef(input, finding)]
  const title = requiredString(
    finding.title,
    'PRESENTATION_PROJECTION_TITLE_REQUIRED',
    'finding title',
  )
  const keyMessage = requiredString(
    finding.keyMessage,
    'PRESENTATION_PROJECTION_KEY_MESSAGE_REQUIRED',
    'keyMessage',
  )
  const contentBlocks: ProjectedContentBlock[] = [
    {
      contentBlockId: createId(ids, 'content-block'),
      type: 'heading',
      role: 'page_title',
      order: 0,
      content: title,
      sourceRefs,
    },
    {
      contentBlockId: createId(ids, 'content-block'),
      type: 'text',
      role: 'key_message',
      order: 1,
      content: keyMessage,
      contentNature: finding.contentNature,
      sourceRefs,
    },
  ]

  finding.supportingBlocks.forEach((block, index) => {
    contentBlocks.push(buildSupportingBlock(block, index + 2, sourceRefs, ids))
  })

  const scriptBlocks = (finding.speakerNotes ?? []).map((note, index) => ({
    scriptBlockId: createId(ids, 'script-block'),
    order: index,
    content: requiredString(
      note,
      'PRESENTATION_PROJECTION_SCRIPT_REQUIRED',
      `speaker note ${index}`,
    ),
    sourceRefs,
  }))
  const assetIds = uniqueStrings(
    finding.assetIds ?? [],
    'PRESENTATION_PROJECTION_ASSET_ID_INVALID',
    'assetIds',
    false,
  )
  const pageAssets = assetIds.map((assetId, index) => ({
    pageAssetId: createId(ids, 'page-asset'),
    order: index,
    assetId,
    role: index === 0 ? 'primary' as const : 'supporting' as const,
    sourceRefs,
  }))

  return {
    findingId: finding.findingId,
    projectId: input.presentationProjectId,
    pageId: createId(ids, 'page'),
    outlineNodeId,
    order: pageOrder,
    sourceRefs,
    contentBlocks,
    scriptBlocks,
    pageAssets,
  }
}

function mergeTopics(
  additionalTopics: readonly ProjectionTopicDefinition[],
): readonly ProjectionTopicDefinition[] {
  const topics = new Map<string, ProjectionTopicDefinition>()
  for (const topic of [...DEFAULT_PRESENTATION_TOPICS, ...additionalTopics]) {
    const key = requiredString(
      topic.key,
      'PRESENTATION_PROJECTION_TOPIC_KEY_REQUIRED',
      'topic key',
    )
    if (topics.has(key)) {
      fail('PRESENTATION_PROJECTION_TOPIC_DUPLICATE', `duplicate topic '${key}'`)
    }
    topics.set(key, {
      key,
      title: requiredString(
        topic.title,
        'PRESENTATION_PROJECTION_TOPIC_TITLE_REQUIRED',
        `topic '${key}' title`,
      ),
      order: assertOrder(topic.order, `topic '${key}' order`),
    })
  }
  return [...topics.values()]
    .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))
}

function validateInput(
  input: PresentationProjectionInput,
  topics: readonly ProjectionTopicDefinition[],
): void {
  requiredString(
    input.preDesignProjectId,
    'PRESENTATION_PROJECTION_PROJECT_ID_REQUIRED',
    'preDesignProjectId',
  )
  requiredString(
    input.presentationProjectId,
    'PRESENTATION_PROJECTION_PROJECT_ID_REQUIRED',
    'presentationProjectId',
  )
  assertRevision(input.preDesignRevision)

  const topicKeys = new Set(topics.map(topic => topic.key))
  const findingIds = new Set<string>()
  for (const finding of input.findings) {
    const findingId = requiredString(
      finding.findingId,
      'PRESENTATION_PROJECTION_FINDING_ID_REQUIRED',
      'findingId',
    )
    if (findingIds.has(findingId)) {
      fail(
        'PRESENTATION_PROJECTION_FINDING_DUPLICATE',
        `duplicate finding '${findingId}'`,
      )
    }
    findingIds.add(findingId)

    if (!topicKeys.has(finding.topicKey)) {
      fail(
        'PRESENTATION_PROJECTION_TOPIC_UNKNOWN',
        `finding '${findingId}' references unknown topic '${finding.topicKey}'`,
      )
    }
    assertOrder(finding.order, `finding '${findingId}' order`)
    if (finding.include === false) continue
    requiredString(
      finding.title,
      'PRESENTATION_PROJECTION_TITLE_REQUIRED',
      `finding '${findingId}' title`,
    )
    requiredString(
      finding.keyMessage,
      'PRESENTATION_PROJECTION_KEY_MESSAGE_REQUIRED',
      `finding '${findingId}' keyMessage`,
    )
  }
}

function aggregateSectionSourceRef(
  input: PresentationProjectionInput,
  findings: readonly ProfessionalFinding[],
): ProjectionSourceRef {
  return {
    provider: 'pre-design',
    sourceProjectId: input.preDesignProjectId,
    sourceRevision: input.preDesignRevision,
    objectIds: [...new Set(findings.flatMap(finding => finding.objectIds))],
    evidenceIds: [...new Set(findings.flatMap(finding => finding.evidenceIds))],
  }
}

export function buildPresentationProjection(
  rawInput: PresentationProjectionInput,
  ids: ProjectionIdFactory,
): ContractNeutralPresentationProjection {
  const input: PresentationProjectionInput = {
    ...rawInput,
    preDesignProjectId: requiredString(
      rawInput.preDesignProjectId,
      'PRESENTATION_PROJECTION_PROJECT_ID_REQUIRED',
      'preDesignProjectId',
    ),
    presentationProjectId: requiredString(
      rawInput.presentationProjectId,
      'PRESENTATION_PROJECTION_PROJECT_ID_REQUIRED',
      'presentationProjectId',
    ),
    preDesignRevision: assertRevision(rawInput.preDesignRevision),
  }
  const topics = mergeTopics(input.additionalTopics ?? [])
  validateInput(input, topics)
  const includedFindings = input.findings.filter(finding => finding.include !== false)
  const sections: ProjectedPresentationSection[] = []
  const pages: ProjectedPresentationPage[] = []

  for (const topic of topics) {
    const topicFindings = includedFindings
      .filter(finding => finding.topicKey === topic.key)
      .sort((left, right) => left.order - right.order
        || left.findingId.localeCompare(right.findingId))
    if (topicFindings.length === 0) continue

    const outlineNodeId = createId(ids, 'outline-node')
    const sectionPages = topicFindings.map(finding =>
      buildPage(input, finding, outlineNodeId, pages.length, ids))
    pages.push(...sectionPages)
    sections.push({
      topicKey: topic.key,
      title: topic.title,
      order: topic.order,
      outlineNodeId,
      pageIds: sectionPages.map(page => page.pageId),
      sourceRefs: [aggregateSectionSourceRef(input, topicFindings)],
    })
  }

  return {
    preDesignProjectId: input.preDesignProjectId,
    presentationProjectId: input.presentationProjectId,
    preDesignRevision: input.preDesignRevision,
    sections,
    pages,
  }
}
