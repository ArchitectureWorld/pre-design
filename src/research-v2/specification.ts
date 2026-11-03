import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { brotliDecompressSync } from 'node:zlib'
import { loadPlanningCatalog } from './catalog.ts'
import { freeze } from './graph.ts'
import type { PlanningEdge, ResearchPort } from './types.ts'

/** The complete author-approved dictionary. It is NOT 62 executable result schemas. */
export interface ResearchModuleSpec {
  readonly id: string
  readonly moduleId: string
  readonly title: string
  readonly fields: string
  readonly steps: readonly string[]
  readonly queries: readonly Readonly<{ source: string; text: string; when: string }>[]
  readonly sources: readonly string[]
  readonly method: string
  readonly qa: readonly string[]
  readonly fallback: string
  readonly dataset: string
  readonly outputPorts: readonly ResearchPort[]
  readonly requires: readonly PlanningEdge[]
  readonly figures: readonly Readonly<{ artifactId: string; name: string; spec: string; type: string; [key: string]: unknown }>[]
  readonly table: Readonly<{ artifactId: string; name: string; columns: string; [key: string]: unknown }>
  readonly copySpec: Readonly<Record<string, unknown>>
  readonly releaseSpec: Readonly<Record<string, unknown>>
  readonly [key: string]: unknown
}
export interface ResearchSpecification {
  readonly items: readonly ResearchModuleSpec[]
  readonly sources: readonly Readonly<{ id: string; [key: string]: unknown }>[]
  readonly dependencyEdges: readonly PlanningEdge[]
  readonly [key: string]: unknown
}

export function decodeResearchSpecification(bytes: Uint8Array): ResearchSpecification {
  const catalog = loadPlanningCatalog()
  if (createHash('sha256').update(bytes).digest('hex') !== catalog.sourceSha256) {
    throw new Error('SPEC_SOURCE_HASH_MISMATCH')
  }
  const document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as ResearchSpecification
  if (document.items.length !== 62 || document.sources.length !== 24) throw new Error('SPEC_COVERAGE_MISMATCH')
  // The byte lock authenticates this version. These checks additionally protect the
  // seam between the complete dictionary and the separately compiled routing index.
  for (const mod of catalog.modules) {
    const item = document.items.find(row => row.id === mod.id)
    if (!item || item.moduleId !== mod.moduleId || item.title !== mod.title || item.steps.length !== 4
      || item.fields.trim() === '' || item.method.trim() === '' || item.fallback.trim() === ''
      || JSON.stringify(item.outputPorts) !== JSON.stringify(mod.ports)
      || item.table.artifactId !== mod.table.artifactId
      || item.figures.map(f => f.artifactId).join('|') !== mod.figures.map(f => f.artifactId).join('|')) {
      throw new Error(`SPEC_INDEX_MISMATCH: ${mod.id}`)
    }
    const expected = catalog.edges.filter(e => e.target === mod.id).map(e => e.edgeId).sort()
    if (JSON.stringify(item.requires.map(e => e.edgeId).sort()) !== JSON.stringify(expected)) {
      throw new Error(`SPEC_EDGE_MISMATCH: ${mod.id}`)
    }
  }
  return freeze(document)
}

let cached: ResearchSpecification | undefined
export function loadResearchSpecification(): ResearchSpecification {
  if (cached) return cached
  // Source execution and bundled lib/index.js have different depths. No cwd search
  // or caller-supplied path: only the packaged, byte-locked approved source is read.
  const locations = [
    new URL('../../research/planning-v1.2/unified-data.json.br', import.meta.url),
    new URL('../research/planning-v1.2/unified-data.json.br', import.meta.url),
  ]
  const path = locations.find(location => existsSync(location))
  if (!path) throw new Error('SPEC_PACKAGE_MISSING')
  cached = decodeResearchSpecification(brotliDecompressSync(readFileSync(path), { maxOutputLength: 2 * 1024 * 1024 }))
  return cached
}

export function getResearchModuleSpec(itemId: string): ResearchModuleSpec {
  const item = loadResearchSpecification().items.find(row => row.id === itemId)
  if (!item) throw new Error(`SPEC_ITEM_UNKNOWN: ${itemId}`)
  return item
}
