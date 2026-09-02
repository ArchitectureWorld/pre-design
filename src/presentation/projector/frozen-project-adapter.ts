import type { FrozenProjectInput, FrozenStateObject } from '../../report/types.ts'
import type {
  ContentNature,
  ProfessionalFinding,
  SupportingBlock,
} from './types.ts'

interface NarrativeBundleDefinition {
  readonly key: string
  readonly topicKey: string
  readonly order: number
  readonly title: string
  readonly contentNature: ContentNature
  readonly anchorObjectId: string
  readonly accepts: (object: FrozenStateObject) => boolean
}

const BUNDLES: readonly NarrativeBundleDefinition[] = [
  {
    key: 'project-brief',
    topicKey: 'project_brief',
    order: 10,
    title: '项目认知与任务',
    contentNature: 'user_statement',
    anchorObjectId: 'PS01',
    accepts: object => object.chapterId === '01',
  },
  {
    key: 'baseline',
    topicKey: 'diagnosis',
    order: 20,
    title: '项目基础与边界',
    contentNature: 'fact',
    anchorObjectId: 'BL01',
    accepts: object => object.chapterId === '02',
  },
  {
    key: 'diagnosis',
    topicKey: 'diagnosis',
    order: 30,
    title: '现状与核心问题',
    contentNature: 'professional_judgement',
    anchorObjectId: 'DG01',
    accepts: object => /^DG0[1-4]$/u.test(object.objectId),
  },
  {
    key: 'opportunity',
    topicKey: 'opportunity',
    order: 40,
    title: '发展机会',
    contentNature: 'professional_judgement',
    anchorObjectId: 'DG05',
    accepts: object => object.objectId === 'DG05' || object.objectId === 'DG06',
  },
  {
    key: 'positioning',
    topicKey: 'positioning',
    order: 50,
    title: '项目定位与目标',
    contentNature: 'recommendation',
    anchorObjectId: 'OB01',
    accepts: object => object.chapterId === '04',
  },
  {
    key: 'strategy',
    topicKey: 'positioning',
    order: 60,
    title: '总体策略',
    contentNature: 'recommendation',
    anchorObjectId: 'OP07',
    accepts: object => object.chapterId === '05',
  },
  {
    key: 'product',
    topicKey: 'program_product',
    order: 70,
    title: '产品与功能体系',
    contentNature: 'recommendation',
    anchorObjectId: 'PG04',
    accepts: object => object.chapterId === '06',
  },
  {
    key: 'spatial',
    topicKey: 'spatial_strategy',
    order: 80,
    title: '空间策略',
    contentNature: 'recommendation',
    anchorObjectId: 'SP07',
    accepts: object => object.chapterId === '07',
  },
  {
    key: 'delivery',
    topicKey: 'delivery_model',
    order: 90,
    title: '运营、投资与实施',
    contentNature: 'recommendation',
    anchorObjectId: 'IM06',
    accepts: object => object.chapterId === '08' && object.objectId !== 'IM02',
  },
  {
    key: 'decision',
    topicKey: 'decision_next_steps',
    order: 100,
    title: '决策事项与下一步',
    contentNature: 'decision',
    anchorObjectId: 'IM02',
    accepts: object => object.objectId === 'IM02',
  },
]

function compareObjects(left: FrozenStateObject, right: FrozenStateObject): number {
  return (left.workItemId ?? '').localeCompare(right.workItemId ?? '')
    || left.objectId.localeCompare(right.objectId)
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(value => value !== ''))]
}

function supportingStatements(
  members: readonly FrozenStateObject[],
  keyMessage: string,
): string[] {
  const summaries = members.map(member => member.summary)
  const facts = members.flatMap(member => member.facts.map(fact => `${fact.label}：${fact.value}`))
  return distinct([...summaries, ...facts]).filter(statement => statement !== keyMessage).slice(0, 8)
}

function normalSupportingBlocks(
  members: readonly FrozenStateObject[],
  keyMessage: string,
): readonly SupportingBlock[] {
  const statements = supportingStatements(members, keyMessage)
  if (statements.length === 0) return []
  return [{
    type: 'list',
    role: 'key_points',
    listStyle: 'unordered',
    items: statements,
  }]
}

function decisionSupportingBlocks(
  input: FrozenProjectInput,
  members: readonly FrozenStateObject[],
  keyMessage: string,
): readonly SupportingBlock[] {
  const items = distinct(input.decisionItems)
  const fallback = supportingStatements(members, keyMessage)
  const resolvedItems = items.length === 0 ? fallback : items
  if (resolvedItems.length === 0) return []
  return [{
    type: 'list',
    role: 'steps',
    listStyle: 'ordered',
    items: resolvedItems,
  }]
}

function speakerNotes(members: readonly FrozenStateObject[], keyMessage: string): readonly string[] {
  return distinct([
    ...members.map(member => member.summary),
    ...members.flatMap(member => member.facts.map(fact => `${fact.label}：${fact.value}（${fact.basis}）`)),
  ]).filter(statement => statement !== keyMessage)
}

function matchingAssetIds(
  input: FrozenProjectInput,
  members: readonly FrozenStateObject[],
): readonly string[] {
  const adoptedIds = input.adoptedAssetIds === undefined
    ? undefined
    : new Set(input.adoptedAssetIds)
  const chapterIds = new Set(members.map(member => member.chapterId))
  const workItemIds = new Set(members.flatMap(member => member.workItemId === undefined ? [] : [member.workItemId]))

  return [...new Set(input.visualAssets
    .filter(asset => adoptedIds === undefined || adoptedIds.has(asset.assetId))
    .filter(asset => (asset.workItemId !== undefined && workItemIds.has(asset.workItemId))
      || (asset.chapterId !== undefined && chapterIds.has(asset.chapterId)))
    .map(asset => asset.assetId))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 3)
}

function findingForBundle(
  input: FrozenProjectInput,
  definition: NarrativeBundleDefinition,
): ProfessionalFinding | undefined {
  const members = input.stateObjects.filter(definition.accepts).sort(compareObjects)
  if (members.length === 0) return undefined

  const anchor = members.find(member => member.objectId === definition.anchorObjectId) ?? members[0]!
  const keyMessage = anchor.summary.trim() === '' ? anchor.title : anchor.summary
  const supportingBlocks = definition.key === 'decision'
    ? decisionSupportingBlocks(input, members, keyMessage)
    : normalSupportingBlocks(members, keyMessage)

  return {
    findingId: `pre-design:${definition.key}`,
    topicKey: definition.topicKey,
    order: definition.order,
    title: definition.title,
    keyMessage,
    contentNature: definition.contentNature,
    objectIds: members.map(member => member.objectId),
    evidenceIds: [],
    supportingBlocks,
    speakerNotes: speakerNotes(members, keyMessage),
    assetIds: matchingAssetIds(input, members),
  }
}

export function adaptFrozenProjectToPresentationFindings(
  input: FrozenProjectInput,
): readonly ProfessionalFinding[] {
  return BUNDLES.flatMap(definition => {
    const finding = findingForBundle(input, definition)
    return finding === undefined ? [] : [finding]
  })
}
