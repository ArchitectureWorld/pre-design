import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContractRegistry } from '../contracts/registry.ts'
import type { GovernanceRepository } from '../governance/repository.ts'
import type { GateDecisionRecord } from '../governance/types.ts'
import type { ProjectRepository } from '../state/repository.ts'
import type { VisualAssetStore } from '../visual/asset-store.ts'
import type { ClientProjectProfile } from './client-types.ts'
import type { FrozenProjectInput, FrozenStateFact, FrozenStateObject, ReportAsset } from './types.ts'

export interface ReportSourceDependencies {
  readonly repository: Pick<ProjectRepository, 'readProjectRevision'>
  readonly governance: Pick<GovernanceRepository, 'readProject'>
  readonly registry: Pick<ContractRegistry, 'workflows'>
  readonly visualStore: Pick<VisualAssetStore, 'resolveAsset'>
}

export async function loadClientProjectProfile(
  profileRoot: string,
  projectId: string,
): Promise<ClientProjectProfile> {
  if (!/^[A-Za-z0-9._-]+$/u.test(projectId) || projectId === '.' || projectId === '..') {
    throw new Error('unsafe project id for client profile')
  }
  const parsed = JSON.parse(await readFile(join(profileRoot, `${projectId}.json`), 'utf8')) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('client project profile must be an object')
  }
  const record = parsed as Record<string, unknown>
  const identity = record.identity
  if (identity === null || typeof identity !== 'object' || Array.isArray(identity)
    || (identity as Record<string, unknown>).projectId !== projectId) {
    throw new Error('client project profile identity does not match project id')
  }
  for (const key of ['chapters', 'products', 'evidence', 'assetBindings', 'requiredVisualRoles']) {
    if (!Array.isArray(record[key])) throw new Error(`client project profile ${key} must be an array`)
  }
  return parsed as ClientProjectProfile
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {}
}

function firstText(record: Readonly<Record<string, unknown>>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

function printable(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function factsOf(objectId: string, revision: number, record: Readonly<Record<string, unknown>>): FrozenStateFact[] {
  const excluded = new Set(['object_id', 'objectId', 'revision', 'title', 'name', 'summary', 'conclusion', 'recommendation', 'statement'])
  return Object.entries(record)
    .filter(([key]) => !excluded.has(key))
    .flatMap(([key, value]) => {
      const text = printable(value)
      return text === undefined ? [] : [{
        label: key.replaceAll('_', ' '),
        value: text,
        basis: `项目成果版本 R${revision}`,
      }]
    })
    .slice(0, 8)
}

function latestGates(decisions: readonly GateDecisionRecord[], revision: number): FrozenProjectInput['gates'] {
  const latest = new Map<string, GateDecisionRecord>()
  for (const decision of decisions) {
    if (decision.revision > revision) continue
    const existing = latest.get(decision.gateId)
    if (existing === undefined || existing.revision <= decision.revision) latest.set(decision.gateId, decision)
  }
  return [...latest.values()]
    .sort((left, right) => left.gateId.localeCompare(right.gateId))
    .map(decision => ({ gateId: decision.gateId, decision: decision.decision, revision: decision.revision }))
}

export function createFrozenProjectInput(
  projectId: string,
  revision: number,
  dependencies: ReportSourceDependencies,
): FrozenProjectInput {
  const snapshot = dependencies.repository.readProjectRevision(projectId, revision)
  const governed = dependencies.governance.readProject(projectId)
  const descriptors = new Map(dependencies.registry.workflows().map(workflow => [workflow.targetObjectId, workflow]))
  const stateObjects: FrozenStateObject[] = Object.entries(snapshot.stateSnapshot)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([objectId, value]) => {
      const record = recordOf(value)
      const descriptor = descriptors.get(objectId)
      const title = firstText(record, ['title', 'name']) ?? descriptor?.title ?? objectId
      const summary = firstText(record, ['summary', 'conclusion', 'recommendation', 'statement'])
        ?? `${title}已纳入成果版本 R${revision}。`
      return {
        objectId,
        chapterId: descriptor?.chapterId ?? '01',
        workItemId: descriptor?.workItemId,
        title,
        summary,
        facts: factsOf(objectId, revision, record),
      }
    })
  const recommendation = stateObjects
    .map(object => object.summary)
    .find(summary => summary.trim() !== '')
    ?? `本轮成果已冻结至 Revision ${revision}，建议按 Gate 决策进入下一阶段。`
  const gates = latestGates(governed.gateDecisions, revision)
  const decisionItems = gates
    .filter(gate => gate.decision === 'returned' || gate.decision === 'blocked')
    .map(gate => `${gate.gateId} 尚未通过，需甲方确认处理意见。`)
  if (decisionItems.length === 0) decisionItems.push(`确认本轮核心建议，并授权按成果版本 R${revision} 进入下一阶段。`)
  const visualAssets: ReportAsset[] = governed.visualAssets
    .filter(asset => asset.status === 'adopted' && (asset.adoptedRevision ?? Number.POSITIVE_INFINITY) <= revision)
    .map(asset => ({
      assetId: asset.assetId,
      kind: asset.kind,
      caption: `${asset.promptSummary ?? '前期策划概念表现图'}${asset.kind === 'concept' ? '（AI 生成）' : ''}`,
      sourcePath: dependencies.visualStore.resolveAsset(asset.fileName),
      mimeType: asset.mimeType,
    }))
  return {
    projectId,
    projectName: snapshot.project.name,
    revision,
    generatedAt: snapshot.revision.committedAt,
    recommendationId: `recommendation-r${revision}`,
    recommendation,
    decisionItems,
    stateObjects,
    gates,
    visualAssets,
    adoptedAssetIds: visualAssets.map(asset => asset.assetId),
  }
}
