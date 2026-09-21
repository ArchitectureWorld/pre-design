import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { verifiedRasterImageDimensions } from '../governance/site-boundary-asset-store.ts'
import type { FrozenProjectInput } from '../report/types.ts'
import { compileClientReportOutline, CLIENT_COMPOSITION_VERSION, summaryStatement } from './projector/client-outline.ts'
import type { PresentationAdoptedAssetInput, PresentationSourceMaterialInput } from './standard-project-types.ts'
import { MANUSCRIPT_DIAGRAM_SOURCE_PREFIX, prepareManuscriptDiagrams } from './manuscript-diagrams.ts'
import { caseStudyPhotos } from '../report/case-studies/index.ts'
import { prepareReportSceneVisuals } from './report-scene-visuals.ts'
import { reportImageDimensions } from '../report/regular/image-dimensions.ts'
import { createProjectImageProvenance } from './project-image-provenance.ts'
import { prepareLocalizedLegendMaterial } from '../visual/image-legend-localization.ts'

const escape = (value: string) => value.replace(/[&<>"']/gu, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' })[c]!)
function svgLines(value: string, x: number, y: number, width = 22, size = 25): string {
  const chars = Array.from(value)
  const lines: string[] = []
  for (let start = 0; start < chars.length; start += width) lines.push(chars.slice(start, start + width).join(''))
  return `<text x="${x}" y="${y}" fill="#203c3e" font-family="Microsoft YaHei, sans-serif" font-size="${size}">${lines.map((line, i) => `<tspan x="${x}" dy="${i ? size * 1.55 : 0}">${escape(line)}</tspan>`).join('')}</text>`
}

/** Source photos are evidence; generated diagrams are explicitly labelled summaries. */
export async function prepareClientVisuals(input: {
  frozenProject: FrozenProjectInput; workspaceRoot: string; sources: readonly PresentationSourceMaterialInput[];
  assets: readonly PresentationAdoptedAssetInput[]; diagrams?: boolean;
}): Promise<{ assets: PresentationAdoptedAssetInput[]; warnings: string[] }> {
  const findings = compileClientReportOutline(input.frozenProject)
  const assets = [...input.assets].filter(a => !a.sourceKey.startsWith('client-diagram:')
    && !a.sourceKey.startsWith(MANUSCRIPT_DIAGRAM_SOURCE_PREFIX)
    && !(input.frozenProject.manuscript && a.sourceKey.startsWith('client-source:')))
  const warnings: string[] = []
  if (input.frozenProject.manuscript) {
    const casePhotos = input.frozenProject.caseStudies ? caseStudyPhotos(input.frozenProject.caseStudies) : []
    for (const finding of findings) {
      const page = finding.manuscriptPage
      if (page?.visual.kind !== 'source' || page.visual.sourceMaterialKey === undefined) continue
      const photograph = casePhotos.find(row => row.sourceKey === page.visual.sourceMaterialKey)
      const caseStudy = input.frozenProject.caseStudies?.cases.find(row => row.caseId === photograph?.caseId)
      if (photograph?.image.sourcePath && caseStudy) {
        const image = photograph.image, bytes = await readFile(image.sourcePath!)
        if (createHash('sha256').update(bytes).digest('hex') !== image.sha256) throw new Error('CASE_STUDY_IMAGE_CHANGED')
        const dimensions = reportImageDimensions(image.mimeType, bytes)
        const original: PresentationAdoptedAssetInput = { sourceKey: `client-source:${photograph.sourceKey}`, sourcePath: image.sourcePath!, originalFileName: `${caseStudy.caseId}-${photograph.imageId}.${image.mimeType === 'image/png' ? 'png' : 'jpg'}`,
          displayName: caseStudy.name, imageIdentity: image.imageIdentity, imageQuality: { ...image.imageQuality, sourceLocation: caseStudy.location }, mimeType: image.mimeType, semanticRole: 'source_evidence', widthPx: dimensions.width, heightPx: dimensions.height,
          createdAt: input.frozenProject.caseStudies!.generatedAt, adoptedAt: input.frozenProject.caseStudies!.generatedAt,
          objectIds: [], evidenceIds: caseStudy.evidence.map(e => e.evidenceId), role: 'primary', pageBindingOnly: true,
          aliases: [photograph.sourceKey],
          pageBindings: [{ findingId: finding.findingId, role: 'primary' }],
          origin: { type: 'human_added', sourceMaterialKeys: [], parentAssetKeys: [], sourceTool: null,
            method: JSON.stringify({ kind: 'case-reference', sourcePageUrl: image.sourcePageUrl, credit: image.credit, sha256: image.sha256, sourceLocation: caseStudy.location, locationEvidence: photograph.locationEvidence, description: caseStudy.summary }) },
        }
        assets.push(original)
        if (image.legendLocalization) {
          try { assets.push(await prepareLocalizedLegendMaterial(original, image.legendLocalization, join(input.workspaceRoot, '.pre-design', 'localized-legends'))) }
          catch (error) { warnings.push(`CASE_LEGEND_UNAVAILABLE: ${page.id}: ${error instanceof Error ? error.message : String(error)}`) }
        }
        continue
      }
      const key = page.visual.sourceMaterialKey, source = input.sources.find(candidate => candidate.sourceKey === key)
      const unavailable = () => warnings.push(`MANUSCRIPT_SOURCE_VISUAL_UNAVAILABLE: ${page.id} 的原始素材 ${key} 不可用，未绑定图片。`)
      if (!source || ['missing', 'quarantined'].includes(source.status ?? '') || !['image/jpeg', 'image/png', 'image/webp'].includes(source.mimeType)) { unavailable(); continue }
      try {
        const bytes = await readFile(source.sourcePath)
        const dimensions = verifiedRasterImageDimensions(source.mimeType as 'image/jpeg' | 'image/png' | 'image/webp', bytes)
        const provenance = createProjectImageProvenance(input.frozenProject, page, source, createHash('sha256').update(bytes).digest('hex'))
        assets.push({ sourceKey: `client-source:${source.sourceKey}:${page.id}`, sourcePath: source.sourcePath, originalFileName: source.originalFileName,
          aliases: [source.sourceKey, `client-source:${source.sourceKey}`],
          displayName: page.visual.caption, mimeType: source.mimeType, semanticRole: 'source_evidence',
          imageQuality: { sourceLocation: provenance.sourceLocation },
          widthPx: dimensions.width, heightPx: dimensions.height, createdAt: source.importedAt, adoptedAt: source.importedAt,
          origin: { type: 'source_material', sourceMaterialKeys: [source.sourceKey], parentAssetKeys: [], sourceTool: null,
            method: provenance.method },
          objectIds: [], evidenceIds: [], role: 'primary', pageBindingOnly: true, pageBindings: [{ findingId: finding.findingId, role: 'primary' }],
        })
      } catch { unavailable() }
    }
    const scenes = await prepareReportSceneVisuals({ frozenProject: input.frozenProject, workspaceRoot: input.workspaceRoot, assets })
    const completeGraphs = new Set(findings.filter(finding => finding.manuscriptPage?.visual.diagram?.nodes.every(node =>
      scenes.assets.some(asset => asset.pageBindings?.some(binding => binding.findingId === finding.findingId && binding.nodeIds?.includes(node.id))))).map(finding => finding.findingId))
    const visibleAssets = scenes.assets.map(asset => ({ ...asset, ...(asset.pageBindings ? { pageBindings: asset.pageBindings.filter(binding => !completeGraphs.has(binding.findingId) || binding.nodeIds?.length) } : {}) }))
      .filter(asset => !asset.pageBindingOnly || asset.pageBindings?.length)
    if (input.diagrams !== false) visibleAssets.push(...(await prepareManuscriptDiagrams(input)).filter(asset => !asset.pageBindings?.some(binding => completeGraphs.has(binding.findingId))))
    return { assets: visibleAssets, warnings: [...warnings, ...scenes.warnings] }
  }
  for (const source of input.sources) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(source.mimeType) || source.status === 'missing') continue
    if (assets.some(a => a.origin.sourceMaterialKeys.includes(source.sourceKey))) continue
    try {
      const dimensions = verifiedRasterImageDimensions(source.mimeType as 'image/jpeg' | 'image/png' | 'image/webp', await readFile(source.sourcePath))
      // Authored source pages need explicit source-to-page selection. A random site
      // photo cannot stand in for every page asking for a boundary or access map.
      const pages = input.frozenProject.manuscript ? [] : findings.filter(f => f.sectionKey === 'site-baseline' || f.findingId === 'pre-design:diagnosis')
      if (!pages.length) continue
      assets.push({ sourceKey: `client-source:${source.sourceKey}`, sourcePath: source.sourcePath, originalFileName: source.originalFileName,
        displayName: `项目原始图像｜${source.originalFileName}`, mimeType: source.mimeType, semanticRole: 'source_evidence',
        widthPx: dimensions.width, heightPx: dimensions.height, createdAt: source.importedAt, adoptedAt: source.importedAt,
        origin: { type: 'source_material', sourceMaterialKeys: [source.sourceKey], parentAssetKeys: [], method: '原始图像用于现状资料展示；不推定拍摄日期或法定边界', sourceTool: null },
        objectIds: [], evidenceIds: [], role: 'primary', pageBindingOnly: true,
        pageBindings: pages.map(f => ({ findingId: f.findingId, role: 'primary' })),
      })
    } catch { warnings.push(`原始图像“${source.originalFileName}”无法校验，未纳入汇报图片。`) }
  }
  if (input.diagrams === false) return { assets, warnings }
  const root = join(input.workspaceRoot, '.pre-design', 'client-diagrams')
  for (const finding of findings) {
    if (finding.visualRequirement === 'concept') continue
    if (assets.some(a => a.pageBindings?.some(b => b.findingId === finding.findingId && b.role !== 'reference'))) continue
    const points = finding.supportingBlocks.flatMap(b => b.type === 'list' ? b.items : []).slice(0, 4)
    if (!points.length) continue
    const cells = points.map((p, i) => {
      const x = 48 + (i % 2) * 584, y = 86 + Math.floor(i / 2) * 342
      const body = summaryStatement(p, 90)
      return `<rect x="${x}" y="${y}" width="552" height="310" rx="18" fill="${i % 2 ? '#e8eeeb' : '#fff'}"/><rect x="${x}" y="${y}" width="7" height="310" fill="#46746a"/><text x="${x + 30}" y="${y + 51}" font-family="sans-serif" font-size="26" fill="#46746a">${String(i + 1).padStart(2, '0')}</text>${svgLines(body, x + 30, y + 104, 19, 24)}`
    }).join('')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1248" height="832" viewBox="0 0 1248 832"><rect width="1248" height="832" fill="#f2f1ec"/>${svgLines(finding.title, 48, 48, 44, 27)}${cells}<text x="48" y="802" font-family="Microsoft YaHei, sans-serif" font-size="18" fill="#647575">策划要点图解 · 依据项目研究成果整理 · 条件与来源见附录</text></svg>`
    const digest = createHash('sha256').update(svg).digest('hex')
    await mkdir(root, { recursive: true })
    const fileName = `${digest}.svg`, path = join(root, fileName)
    await writeFile(path, svg)
    assets.push({ sourceKey: `client-diagram:${finding.findingId}`, sourcePath: path, originalFileName: fileName,
      displayName: `策划要点图解｜${finding.title}`, mimeType: 'image/svg+xml', semanticRole: 'deterministic_visual', widthPx: 1248, heightPx: 832,
      createdAt: input.frozenProject.generatedAt, adoptedAt: input.frozenProject.generatedAt, objectIds: [], evidenceIds: [],
      pageBindingOnly: true, pageBindings: [{ findingId: finding.findingId, role: 'primary' }], role: 'primary',
      origin: { type: 'generated_by_tool', sourceMaterialKeys: [], parentAssetKeys: [], sourceTool: { name: 'pre-design-client-diagram', version: CLIENT_COMPOSITION_VERSION },
        method: JSON.stringify({ pageBindingOnly: true, sourceObjects: finding.objectIds, sourceRevision: input.frozenProject.revision, disclosure: '依据策划条目绘制的要点图解；非现场图、测绘图或审批结论' }) },
    })
  }
  return { assets, warnings }
}
