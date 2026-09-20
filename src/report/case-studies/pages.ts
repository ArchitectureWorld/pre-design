import type { PlanningManuscriptPage, PlanningManuscriptSource } from '../manuscript/types.ts'
import { validateCaseStudies } from './service.ts'
import type { CaseStudyEvidence, CaseStudyGalleryImage, CaseStudyPageFocus, ReportCaseStudies, SelectedCaseStudy } from './types.ts'

const factsId = (id: string) => `source:case-study:${id}:facts`
const matchId = (id: string) => `source:case-study:${id}:project-match`
const analysisId = (id: string, focus: CaseStudyPageFocus) => `source:case-study:${id}:${focus}`
// Existing material keys remain stable while the report reads area → line → point → application.
const focuses: readonly CaseStudyPageFocus[] = ['site', 'organization', 'experience', 'application']
const pageId = (id: string, focus: CaseStudyPageFocus) => `case-study-${id}${focus === 'site' ? '' : `-${focus}`}`

/** The original key remains the site photograph, including for integrations that omit imageId. */
export const caseStudyPhotoKey = (caseId: string, imageId: CaseStudyPageFocus = 'site'): string =>
  `case-study-photo:${caseId}${imageId === 'site' ? '' : `:${imageId}`}`

export interface CaseStudyPhoto {
  readonly caseId: string
  readonly imageId: CaseStudyPageFocus
  readonly sourceKey: string
  readonly image: CaseStudyGalleryImage
  readonly pageIds: readonly string[]
  readonly analysisScale: NonNullable<CaseStudyGalleryImage['analysisScale']>
  readonly mediaPurpose: NonNullable<CaseStudyGalleryImage['mediaPurpose']>
  readonly locationEvidence: readonly CaseStudyEvidence[]
}

/** Material registration and page binding share one mapping for every verified catalogue entry. */
export function caseStudyPhotos(bundle: ReportCaseStudies): CaseStudyPhoto[] {
  validateCaseStudies(bundle)
  return bundle.cases.flatMap(row => focuses.flatMap(focus => {
    const image = row.gallery!.find(image => image.imageId === focus)
    return image ? [{ caseId: row.caseId, imageId: focus, sourceKey: caseStudyPhotoKey(row.caseId, focus), image,
      pageIds: [pageId(row.caseId, focus)], analysisScale: image.analysisScale!, mediaPurpose: image.mediaPurpose!,
      locationEvidence: (image.locationEvidenceIds ?? []).map(id => row.evidence.find(evidence => evidence.evidenceId === id)!) }] : []
  }))
}

function photoVisual(row: SelectedCaseStudy, focus: CaseStudyPageFocus, purpose: string): PlanningManuscriptPage['visual'] {
  const image = row.gallery!.find(image => image.imageId === focus)!
  // A missing local file remains a materialization error, never a silent text-only fallback or AI replacement.
  return { kind: 'source', subject: row.name, purpose, caption: image.description,
    sourceMaterialKey: caseStudyPhotoKey(row.caseId, focus) }
}

/** Independent case analysis followed by applications grounded in this project's matched source excerpts. */
export function caseStudyPages(bundle: ReportCaseStudies): PlanningManuscriptPage[] {
  validateCaseStudies(bundle)
  return bundle.cases.flatMap(row => {
    const analysisPages = focuses.flatMap(focus => {
      const section = row.analysis!.find(section => section.focus === focus)
      if (!section) return []
      const page: PlanningManuscriptPage = {
        id: pageId(row.caseId, section.focus), kind: 'comparison', title: `${row.name}｜${section.title}`,
        claim: section.claim, body: [...section.body], sourceRefs: [factsId(row.caseId), analysisId(row.caseId, section.focus)],
        visual: photoVisual(row, section.focus, section.claim),
        notes: section.evidenceIds.map(id => { const evidence = row.evidence.find(item => item.evidenceId === id)!; return `${id}: ${evidence.sourceUrl}` }),
      }
      return [page]
    })
    const matched = row.similarities.slice(0, 2).map(item => row.features.find(feature => feature.id === item.featureId)!)
    const applicationClaim = `以${matched.map(feature => feature.label).join('与')}作为本项目的借鉴重点。`
    const application: PlanningManuscriptPage = {
      id: pageId(row.caseId, 'application'), kind: 'comparison', title: `${row.name}｜转化策略`, claim: applicationClaim,
      body: [...matched.map(feature => `${feature.label}：${feature.application}`), row.boundary.applicationLimit], sourceRefs: [factsId(row.caseId), matchId(row.caseId)],
      visual: photoVisual(row, 'application', applicationClaim),
      notes: [row.boundary.fact, row.boundary.applicationLimit, ...row.similarities.flatMap(item => item.projectSourceRefs)],
    }
    return [...analysisPages, application]
  })
}

export function caseStudySources(bundle: ReportCaseStudies): PlanningManuscriptSource[] {
  validateCaseStudies(bundle)
  return bundle.cases.flatMap(row => [
    { id: factsId(row.caseId), objectId: `case-study:${row.caseId}`, fieldPath: `caseStudies.${row.caseId}.verifiedFacts`,
      text: `${row.name}，${row.location}。${row.summary}${row.features.map(feature => feature.fact).join('')}${row.boundary.fact}`,
      basis: row.evidence.map(item => `${item.publisher}；${item.sourceUrl}；${item.capturedAt}；原文：${item.excerpt}`).join('\n'),
      evidenceIds: row.evidence.map(item => item.evidenceId) },
    ...row.analysis!.map(section => ({ id: analysisId(row.caseId, section.focus), objectId: `case-study:${row.caseId}`,
      fieldPath: `caseStudies.${row.caseId}.analysis.${section.focus}`,
      text: `${section.title}。${section.claim}${section.body.join('')}`,
      basis: section.evidenceIds.map(id => { const evidence = row.evidence.find(item => item.evidenceId === id)!;
        return `${evidence.publisher}；${evidence.sourceUrl}；原文：${evidence.excerpt}` }).join('\n'), evidenceIds: [...section.evidenceIds] })),
    { id: matchId(row.caseId), objectId: `case-study:${row.caseId}`, fieldPath: `caseStudies.${row.caseId}.projectMatch`,
      text: `共同点：${row.similarities.map(item => item.statement).join('、')}。应用建议：${row.applications.join('')}应用条件：${row.boundary.applicationLimit}`,
      basis: `应用建议属于策划判断；项目对应依据：${row.similarities.flatMap(item => item.projectSourceRefs).join('、')}`,
      evidenceIds: [...new Set(row.similarities.flatMap(item => item.caseEvidenceIds))] },
  ])
}
