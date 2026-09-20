import { expect, it } from 'vitest'
import { makeSourceIndex } from '../src/report/manuscript/source.ts'
import type { FrozenProjectInput } from '../src/report/types.ts'
import type { PlanningManuscriptPage } from '../src/report/manuscript/types.ts'
import type { PresentationAdoptedAssetInput, PresentationSourceMaterialInput } from '../src/presentation/standard-project-types.ts'
import { createProjectImageProvenance, projectImageSourceContext } from '../src/presentation/project-image-provenance.ts'

const digest = 'a'.repeat(64)
function fixture() {
  const base: FrozenProjectInput = { projectId: 'different-project', projectName: '山地文化公园', revision: 5, generatedAt: '2026-09-20',
    recommendation: '山地休闲', decisionItems: [], gates: [], visualAssets: [], stateObjects: [{ objectId: 'PS01', chapterId: '01', title: '项目任务', summary: '', facts: [],
      reportSections: [{ key: 'site', title: '项目地点', entries: [{ key: 'location', fieldPath: 'data.location', text: '空间位置：四川省成都市', basis: '用户提供任务书', evidenceRefs: [{ evidenceId: 'source-task-book' }] }] }] }] }
  const source: PresentationSourceMaterialInput = { sourceKey: 'workspace-inbox:图/原始航拍.jpg', sourcePath: 'fixture/site.jpg', originalFileName: '原始航拍.jpg', mimeType: 'image/jpeg', importedAt: '2026-09-20' }
  const page: PlanningManuscriptPage = { id: 'site', kind: 'evidence', title: '场地整体', claim: '山水相依', body: [], sourceRefs: makeSourceIndex(base).map(row => row.id), notes: [],
    visual: { kind: 'source', subject: '项目原图', purpose: '场地整体', caption: '场地整体', sourceMaterialKey: source.sourceKey } }
  const project: FrozenProjectInput = { ...base, manuscript: { schemaVersion: 'pre-design.planning-manuscript.v1', policyVersion: 'fixture', projectId: base.projectId,
    sourceRevision: 5, sourceFingerprint: 'fixture', generatedAt: base.generatedAt, title: '项目策划', chapters: [{ id: 'site', title: '场地', thesis: '场地整体', pages: [page] }] } }
  const origin = createProjectImageProvenance(project, page, source, digest)
  const asset: PresentationAdoptedAssetInput & { sha256: string } = { sourceKey: 'client-source:site', sourcePath: source.sourcePath, originalFileName: source.originalFileName,
    mimeType: source.mimeType, semanticRole: 'source_evidence', displayName: '场地整体', createdAt: source.importedAt, adoptedAt: source.importedAt, objectIds: [], evidenceIds: [],
    origin: { type: 'source_material', sourceMaterialKeys: [source.sourceKey], parentAssetKeys: [], sourceTool: null, method: origin.method },
    sha256: digest, imageQuality: { sourceLocation: origin.sourceLocation } }
  return { project, page, source, asset }
}

it('binds a registered project image to the cited location field and exact source bytes', () => {
  const { project, asset } = fixture()
  expect(projectImageSourceContext(asset, project)).toEqual({ sourceLocation: '四川省成都市', sourceLocationVerified: true })
  expect(projectImageSourceContext({ ...asset, sha256: 'b'.repeat(64) }, project)?.sourceLocationVerified).not.toBe(true)
  expect(projectImageSourceContext(asset, { ...project, projectId: 'another-project' })?.sourceLocationVerified).not.toBe(true)
})

it('does not treat a filename, uncited location or a missing evidence reference as location proof', () => {
  const { project, page, source } = fixture()
  expect(createProjectImageProvenance(project, { ...page, sourceRefs: [] }, source, digest).sourceLocation).toBeUndefined()
  expect(createProjectImageProvenance(project, { ...page, visual: { ...page.visual, sourceMaterialKey: 'another-photo' } }, source, digest).sourceLocation).toBeUndefined()
  const noEvidence = { ...project, stateObjects: project.stateObjects.map(row => ({ ...row, reportSections: row.reportSections!.map(section => ({ ...section,
    entries: section.entries.map(entry => ({ ...entry, evidenceRefs: [] })) })) })) }
  expect(createProjectImageProvenance(noEvidence, page, source, digest).sourceLocation).toBeUndefined()
})

it('invalidates changed project location evidence and accepts only the recorded full-frame source derivative', () => {
  const { project, asset } = fixture()
  const changed = { ...project, stateObjects: project.stateObjects.map(row => ({ ...row, reportSections: row.reportSections!.map(section => ({ ...section,
    entries: section.entries.map(entry => ({ ...entry, text: '空间位置：云南省昆明市' })) })) })) }
  expect(projectImageSourceContext(asset, changed)?.sourceLocationVerified).not.toBe(true)
  const prepared = { ...asset, sourcePath: 'fixture/prepared.jpg', sha256: 'b'.repeat(64), imagePreparation: { version: 'report-raster-v1' as const, sourcePath: asset.sourcePath, sourceSha256: asset.sha256 } }
  expect(projectImageSourceContext(prepared, project)?.sourceLocationVerified).toBe(true)
  expect(projectImageSourceContext({ ...prepared, imagePreparation: { ...prepared.imagePreparation, sourceSha256: 'c'.repeat(64) } }, project)?.sourceLocationVerified).not.toBe(true)
})
