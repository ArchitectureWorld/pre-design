import type { FrozenProjectInput } from '../../report/types.ts'
import { makeSourceIndex } from '../../report/manuscript/source.ts'
import type { ClientFinding } from './client-outline.ts'
import type { SupportingBlock } from './types.ts'
import { clientPlanningPage } from '../../report/manuscript/client-copy.ts'
import { caseStudyPages, caseStudySources, validateCaseStudies } from '../../report/case-studies/index.ts'
import type { PlanningManuscriptPage } from '../../report/manuscript/types.ts'
import { summarizeReportPage } from '../../report/manuscript/report-story.ts'

/** Authored report pages are the authority. Projection must not crop or rewrite them. */
export function authoredFindings(input: FrozenProjectInput): readonly ClientFinding[] {
  if (input.caseStudies) validateCaseStudies(input.caseStudies, input)
  const sources = new Map([...makeSourceIndex(input), ...input.caseStudies ? caseStudySources(input.caseStudies) : []].map(source => [source.id, source]))
  const chapters: { id: string; title: string; pages: readonly PlanningManuscriptPage[] }[] = [...input.manuscript!.chapters]
  if (input.caseStudies) chapters.splice(Math.min(3, chapters.length), 0, { id: 'case-studies', title: '真实项目案例与借鉴', pages: caseStudyPages(input.caseStudies) })
  return chapters.flatMap((chapter, chapterIndex) => chapter.pages.map((originalPage, order) => {
    const page = summarizeReportPage(clientPlanningPage(originalPage))
    const refs = page.sourceRefs.map(id => {
      const source = sources.get(id)
      if (!source) throw new Error(`MANUSCRIPT_SOURCE_UNKNOWN: ${id}`)
      return source
    })
    const supportingBlocks: SupportingBlock[] = page.body.map(content => ({ type: 'text', role: 'body', content }))
    if (page.product) {
      const p = page.product
      supportingBlocks.push({ type: 'table', role: 'data', columns: ['产品要素', '策划内容'], rows: [
        ['目标客群', p.audience], ['核心体验', p.experience], ['空间载体', p.location], ['规模依据', p.scale], ['运营组织', p.operations],
      ] })
    }
    if (page.table) supportingBlocks.push({ type: 'table', role: 'comparison', ...page.table })
    return {
      findingId: `manuscript:${page.id}`, topicKey: `manuscript:${chapter.id}`, sectionKey: `manuscript:${chapter.id}`,
      sectionTitle: chapter.title, sectionOrder: chapterIndex, order, title: page.title, keyMessage: page.claim,
      contentNature: 'recommendation' as const, objectIds: [...new Set(refs.flatMap(ref => {
        const row = input.caseStudies?.cases.find(row => ref.objectId === `case-study:${row.caseId}`)
        return row ? row.similarities.flatMap(match => match.projectSourceRefs.map(id => sources.get(id)!.objectId)) : [ref.objectId]
      }))],
      evidenceIds: [...new Set(refs.flatMap(ref => ref.evidenceIds))], supportingBlocks,
      speakerNotes: [...page.notes, ...refs.map(ref => `来源：${ref.objectId}/${ref.fieldPath}；${ref.basis}`)],
      assetIds: [], manuscriptPage: page, visualRequirement: page.visual.kind,
      visualBrief: `项目：${input.projectName}。本页：${page.title}。主体：${page.visual.subject}。场景表达：${page.visual.purpose}。本页主张：${page.claim}。${page.product ? `具体体验：${page.product.experience}；空间载体：${page.product.location}；尺度依据：${page.product.scale}。` : ''}以上内容仅用于理解场景，不是需要绘制的文字。图名由汇报版面呈现，图像来源与性质保留在独立资料依据，不得写入像素画面。依据仅限本页资料和明确提出的策划方案，不把假设画成建成事实。完整单幅场景铺满画幅，无白边、文字、标注、引线、水印或拼贴；概念图不得伪装成现场照片、测绘图或法定边界。`,
    }
  }))
}
