import type { PresentationAdoptedAssetInput } from './standard-project-types.ts'
import { imageBriefHash, MAX_ORIGINAL_IMAGE_USES, type ImageSlotBrief } from '../visual/image-policy.ts'
export interface ReviewedImageCandidate {
  readonly usageId: string
  readonly source: 'project' | 'web' | 'generated'
  readonly material: PresentationAdoptedAssetInput
}
export function allocateReportImages(briefs: readonly ImageSlotBrief[], candidates: readonly ReviewedImageCandidate[], options: { readonly placementHashes?: Readonly<Record<string, string>> } = {}) {
  const rank = { project: 0, web: 1, generated: 2 }
  const aliases = new Map<string, string>()
  const root = (value: string): string => {
    const parent = aliases.get(value)
    if (!parent) { aliases.set(value, value); return value }
    if (parent === value) return value
    const result = root(parent); aliases.set(value, result); return result
  }
  const union = (a: string, b: string) => { const x = root(a), y = root(b); if (x !== y) aliases.set(y, x) }
  for (const candidate of candidates) {
    const identity = candidate.material.imageIdentity
    if (identity) {
      union(`original:${identity.originalId}`, `sha:${identity.fileSha256}`)
      if (identity.derivedFromSha256 && ['verified-derivative','declared-derivative'].includes(identity.verification)) union(`sha:${identity.fileSha256}`, `sha:${identity.derivedFromSha256}`)
    }
  }
  const familyNames = new Map<string, string>()
  for (const candidate of candidates) {
    const identity = candidate.material.imageIdentity
    if (identity) { const family = root(`sha:${identity.fileSha256}`), name = familyNames.get(family); if (!name || identity.originalId < name) familyNames.set(family, identity.originalId) }
  }
  const familyId = (candidate: ReviewedImageCandidate) => familyNames.get(root(`sha:${candidate.material.imageIdentity!.fileSha256}`))!
  const eligible = (brief: ImageSlotBrief) => candidates.filter(candidate => {
    const identity = candidate.material.imageIdentity, review = candidate.material.imageQuality?.inspection
    return candidate.usageId === brief.id && brief.allowedSources.includes(candidate.source) && identity && review?.actualImageInput === true
      && review.decision === 'approved' && review.usageId === brief.id && review.imageSha256 === identity.fileSha256 && review.requirementHash === imageBriefHash(brief)
      && (!options.placementHashes || review.placementHash === options.placementHashes[brief.id])
  }).sort((a,b) => rank[a.source] - rank[b.source] || a.material.sourceKey.localeCompare(b.material.sourceKey))
  // A capacity graph allows later scarce positions to move earlier choices,
  // avoiding needless retrieval/generation while retaining page-local uniqueness.
  interface Edge { to: number; reverse: number; capacity: number; cost: number; candidate?: ReviewedImageCandidate }
  const graph: Edge[][] = [], ids = new Map<string, number>()
  const node = (id: string) => { if (!ids.has(id)) { ids.set(id, graph.length); graph.push([]) } return ids.get(id)! }
  const source = node('source'), sink = node('sink')
  const add = (from: number, to: number, capacity: number, cost = 0, candidate?: ReviewedImageCandidate) => {
    const edge: Edge = { to, reverse: graph[to]!.length, capacity, cost, ...(candidate ? { candidate } : {}) }
    graph[from]!.push(edge); graph[to]!.push({ to: from, reverse: graph[from]!.length - 1, capacity: 0, cost: -cost })
  }
  const families = new Set<string>(), pageFamilies = new Set<string>()
  for (const brief of [...briefs].sort((a,b) => a.id.localeCompare(b.id))) {
    const position = node(`demand:${brief.id}`); add(source, position, 1)
    for (const candidate of eligible(brief)) {
      const original = familyId(candidate), family = node(`family:${original}`), pageKey = JSON.stringify([brief.pageId, original]), page = node(`page:${pageKey}`)
      if (!families.has(original)) { add(family, sink, MAX_ORIGINAL_IMAGE_USES); families.add(original) }
      if (!pageFamilies.has(pageKey)) { add(page, family, 1); pageFamilies.add(pageKey) }
      add(position, page, 1, rank[candidate.source], candidate)
    }
  }
  for (;;) {
    const distance = graph.map(() => Infinity), previous = graph.map(() => [-1, -1]), pending = [source], queued = new Set([source]); distance[source] = 0
    while (pending.length) {
      const from = pending.shift()!; queued.delete(from)
      for (const [index, edge] of graph[from]!.entries()) if (edge.capacity > 0 && distance[from]! + edge.cost < distance[edge.to]!) {
        distance[edge.to] = distance[from]! + edge.cost; previous[edge.to] = [from, index]
        if (!queued.has(edge.to)) { pending.push(edge.to); queued.add(edge.to) }
      }
    }
    if (!Number.isFinite(distance[sink])) break
    for (let to = sink; to !== source;) { const [from, i] = previous[to]!, edge = graph[from!]![i!]!; edge.capacity--; graph[to]![edge.reverse]!.capacity++; to = from! }
  }
  const assigned: ReviewedImageCandidate[] = [], gaps: ImageSlotBrief[] = [], originalUses: Record<string, number> = {}
  for (const brief of briefs) {
    const selected = graph[node(`demand:${brief.id}`)]!.find(edge => edge.candidate && edge.capacity === 0)?.candidate
    if (!selected) gaps.push(brief)
    else { assigned.push(selected); const id = familyId(selected); originalUses[id] = (originalUses[id] ?? 0) + 1 }
  }
  return { assigned, gaps, originalUses }
}
