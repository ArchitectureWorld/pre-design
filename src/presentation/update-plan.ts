import { sha256CanonicalJson } from './canonical-json.ts'

export interface ProjectionUpdatePlanInput {
  readonly previousExportHashes: Readonly<Record<string, string>>
  readonly currentObjectHashes: Readonly<Record<string, string>>
  readonly incomingObjects: Readonly<Record<string, unknown>>
}

export interface ProjectionUpdatePlan {
  readonly createdIds: readonly string[]
  readonly updatedIds: readonly string[]
  readonly unchangedIds: readonly string[]
  readonly reviewRequiredIds: readonly string[]
  readonly retainedIds: readonly string[]
  readonly incomingHashes: Readonly<Record<string, string>>
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`)
}

function validateObjectIds(
  values: Readonly<Record<string, unknown>>,
  field: string,
): readonly string[] {
  const normalized = new Map<string, string>()
  for (const objectId of Object.keys(values)) {
    const candidate = objectId.normalize('NFC').trim()
    if (candidate === '') {
      fail('PRESENTATION_UPDATE_OBJECT_ID_REQUIRED', `${field} contains an empty object ID`)
    }
    if (candidate !== objectId) {
      fail(
        'PRESENTATION_UPDATE_OBJECT_ID_INVALID',
        `${field} object ID '${objectId}' is not trimmed NFC`,
      )
    }
    const existing = normalized.get(candidate)
    if (existing !== undefined && existing !== objectId) {
      fail(
        'PRESENTATION_UPDATE_OBJECT_ID_COLLISION',
        `${field} object IDs '${existing}' and '${objectId}' normalize identically`,
      )
    }
    normalized.set(candidate, objectId)
  }
  return [...normalized.keys()].sort((left, right) => left.localeCompare(right))
}

function validateHashMap(
  values: Readonly<Record<string, string>>,
  field: string,
): readonly string[] {
  const objectIds = validateObjectIds(values, field)
  for (const objectId of objectIds) {
    const value = values[objectId]
    if (value === undefined || !SHA256_PATTERN.test(value)) {
      fail(
        'PRESENTATION_UPDATE_HASH_INVALID',
        `${field} contains an invalid SHA-256 for '${objectId}'`,
      )
    }
  }
  return objectIds
}

export function planProjectionUpdate(
  input: ProjectionUpdatePlanInput,
): ProjectionUpdatePlan {
  const previousIds = validateHashMap(
    input.previousExportHashes,
    'previousExportHashes',
  )
  validateHashMap(input.currentObjectHashes, 'currentObjectHashes')
  const incomingIds = validateObjectIds(input.incomingObjects, 'incomingObjects')

  const createdIds: string[] = []
  const updatedIds: string[] = []
  const unchangedIds: string[] = []
  const reviewRequiredIds: string[] = []
  const incomingHashes: Record<string, string> = {}

  for (const objectId of incomingIds) {
    const incomingHash = sha256CanonicalJson(input.incomingObjects[objectId])
    incomingHashes[objectId] = incomingHash
    const previousHash = input.previousExportHashes[objectId]
    const currentHash = input.currentObjectHashes[objectId]

    if (previousHash === undefined) {
      if (currentHash === undefined) createdIds.push(objectId)
      else reviewRequiredIds.push(objectId)
      continue
    }

    if (currentHash === undefined || currentHash !== previousHash) {
      reviewRequiredIds.push(objectId)
      continue
    }

    if (incomingHash === previousHash) unchangedIds.push(objectId)
    else updatedIds.push(objectId)
  }

  const incomingIdSet = new Set(incomingIds)
  const retainedIds = previousIds.filter(objectId => !incomingIdSet.has(objectId))

  return {
    createdIds,
    updatedIds,
    unchangedIds,
    reviewRequiredIds,
    retainedIds,
    incomingHashes,
  }
}

export function applySuccessfulExportLedger(
  previousExportHashes: Readonly<Record<string, string>>,
  plan: ProjectionUpdatePlan,
): Readonly<Record<string, string>> {
  validateHashMap(previousExportHashes, 'previousExportHashes')
  validateHashMap(plan.incomingHashes, 'incomingHashes')

  const next: Record<string, string> = { ...previousExportHashes }
  for (const objectId of [
    ...plan.createdIds,
    ...plan.updatedIds,
    ...plan.unchangedIds,
  ]) {
    const hash = plan.incomingHashes[objectId]
    if (hash === undefined) {
      fail(
        'PRESENTATION_UPDATE_PLAN_INVALID',
        `successful object '${objectId}' has no incoming hash`,
      )
    }
    next[objectId] = hash
  }

  return Object.fromEntries(
    Object.entries(next)
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}
