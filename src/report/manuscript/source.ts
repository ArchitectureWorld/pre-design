import { createHash } from 'node:crypto'
import type { FrozenProjectInput } from '../types.ts'
import type { PlanningManuscriptSource } from './types.ts'

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]))
  return value
}

/** Visual adoption and clock changes cannot change the already written report's source identity. */
export function manuscriptSourceFingerprint(input: FrozenProjectInput): string {
  return createHash('sha256').update(JSON.stringify(canonical({ projectId: input.projectId, projectName: input.projectName,
    revision: input.revision, recommendation: input.recommendation, decisionItems: input.decisionItems,
    stateObjects: [...input.stateObjects].sort((a, b) => a.objectId.localeCompare(b.objectId)),
    siteBoundary: input.siteBoundary, gates: input.gates,
  }))).digest('hex')
}

/** Stable source ids name business fields, never their current position in the report. */
export function makeSourceIndex(input: FrozenProjectInput): readonly PlanningManuscriptSource[] {
  const sources: PlanningManuscriptSource[] = []
  const add = (objectId: string, fieldPath: string, key: string, text: string, basis: string, evidenceIds: readonly string[]) => {
    if (!text.trim()) return
    const id = `source:${objectId}:${createHash('sha256').update(`${fieldPath}\0${key}`).digest('hex').slice(0, 16)}`
    if (sources.some(row => row.id === id)) throw new Error(`MANUSCRIPT_SOURCE_DUPLICATE: ${objectId}/${fieldPath}`)
    sources.push({ id, objectId, fieldPath, text: text.trim(), basis: basis.trim(), evidenceIds: [...new Set(evidenceIds)].sort() })
  }
  for (const object of [...input.stateObjects].sort((a, b) => a.objectId.localeCompare(b.objectId))) {
    const entries = object.reportSections?.flatMap(section => section.entries) ?? []
    if (entries.length) {
      for (const entry of entries) add(object.objectId, entry.fieldPath, entry.key, entry.contentText?.trim() || entry.text,
        entry.basis, entry.evidenceRefs?.map(ref => ref.evidenceId) ?? [])
    } else if (object.facts.length) {
      object.facts.forEach((fact, index) => add(object.objectId, `facts[${index}]`, fact.label, `${fact.label}：${fact.value}`, fact.basis, []))
    } else add(object.objectId, 'summary', 'summary', object.summary, '项目成果概述', [])
  }
  return sources
}
