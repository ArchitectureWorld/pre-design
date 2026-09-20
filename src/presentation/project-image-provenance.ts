import type { FrozenProjectInput } from '../report/types.ts'
import type { PlanningManuscriptPage } from '../report/manuscript/types.ts'
import { makeSourceIndex } from '../report/manuscript/source.ts'
import type { PresentationAdoptedAssetInput, PresentationSourceMaterialInput } from './standard-project-types.ts'

function citedLocation(project: FrozenProjectInput, page: PlanningManuscriptPage) {
  return makeSourceIndex(project).find(row => page.sourceRefs.includes(row.id) && row.objectId === 'PS01'
    && row.fieldPath === 'data.location' && row.evidenceIds.length > 0 && row.text.trim().length > 0)
}
/** A registered original and the page's cited project-location field form the source claim.
 * The visual model must still verify the scene; filenames never establish its location. */
export function createProjectImageProvenance(project: FrozenProjectInput, page: PlanningManuscriptPage, source: PresentationSourceMaterialInput, sha256: string): { method: string; sourceLocation?: string } {
  const evidence = page.visual.kind === 'source' && page.visual.sourceMaterialKey === source.sourceKey
    && !['missing', 'quarantined'].includes(source.status ?? '') ? citedLocation(project, page) : undefined
  const sourceLocation = evidence?.text.replace(/^[^：:]{1,24}[：:]\s*/u, '').trim()
  return { ...(sourceLocation ? { sourceLocation } : {}), method: JSON.stringify({ kind: 'project-reference', projectId: project.projectId,
    pageId: page.id, sourceMaterialKey: source.sourceKey, sourcePath: source.sourcePath, sourceSha256: sha256,
    ...(sourceLocation && evidence ? { sourceLocation, locationEvidence: evidence } : {}) }) }
}

export function projectImageSourceContext(asset: PresentationAdoptedAssetInput & { readonly sha256?: string }, project: FrozenProjectInput): { sourceLocation: string; sourceLocationVerified: true } | undefined {
  let proof: Record<string, unknown>
  try { proof = JSON.parse(asset.origin.method) } catch { return undefined }
  if (!proof || proof.kind !== 'project-reference' || proof.projectId !== project.projectId || typeof proof.sourceLocation !== 'string'
    || !proof.sourceLocation.trim() || proof.sourceLocation !== asset.imageQuality?.sourceLocation
    || typeof proof.sourceMaterialKey !== 'string' || !asset.origin.sourceMaterialKeys.includes(proof.sourceMaterialKey)
    || proof.sourcePath !== (asset.imagePreparation?.sourcePath ?? asset.sourcePath)
    || proof.sourceSha256 !== (asset.imagePreparation?.sourceSha256 ?? asset.sha256)) return undefined
  const page = project.manuscript?.chapters.flatMap(chapter => chapter.pages).find(page => page.id === proof.pageId)
  if (!page || page.visual.kind !== 'source' || page.visual.sourceMaterialKey !== proof.sourceMaterialKey) return undefined
  const evidence = citedLocation(project, page)
  if (!evidence || JSON.stringify(evidence) !== JSON.stringify(proof.locationEvidence)
    || evidence.text.replace(/^[^：:]{1,24}[：:]\s*/u, '').trim() !== proof.sourceLocation) return undefined
  return { sourceLocation: proof.sourceLocation, sourceLocationVerified: true }
}
