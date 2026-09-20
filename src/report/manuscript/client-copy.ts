import type { PlanningManuscript, PlanningManuscriptPage } from './types.ts'

export const CLIENT_COPY_VERSION = 'client-copy-2026-09-18.1'
/** These describe the production material, not the planning proposal. */
export const MATERIAL_EXPLANATION = /意向|拟议关系示意|非地理(?:关系)?示意|非现场实景|概念示意|概念图|不(?:表示|代表)实际(?:地理|位置|距离|方位|测绘)|不代表.*(?:已建成|已获批|已到位)|不替代.*(?:测绘|法定|事实资料)/u

export const CLIENT_COPY_INSTRUCTION = '对外汇报严格禁止材料解释性说明。标题、正文、表格、产品字段、图注与图内文字不出现“意向、概念示意、非现场实景、拟议关系示意、非地理示意、不表示实际位置”等文字。图名只写表达对象（如“茶园漫游”“服务组织”“启动顺序”）；不把制图说明、资料性质或来源声明写成正文。来源和图像性质存入notes及资料依据。策划方案用动作和目标表达，真实场地条件用具体条件句说明，不把拟实施内容改写为已经建成。'

/** Presentation migration only: the archived manuscript and evidence are unchanged. */
export function clientCopyText(value: string): string {
  return value
    .replace(/[（(][^）)]*(?:非现场实景|概念意向|非地理示意|概念示意)[^）)]*[）)]/gu, '')
    .replace(/(?:拟议关系示意|非地理关系示意)[；;：:][^。]*[。]?/gu, '')
    .replace(/(?:不表示|不代表)实际(?:地理|位置|距离|方位|测绘)[^。]*[。]?/gu, '')
    .replace(/(?:概念示意图|概念示意|概念图|场景意向|意向图|意向)/gu, '')
    .replace(/非地理(?:关系)?示意|非现场实景/gu, '')
    .replace(/[；;，,：:]\s*$/u, '').trim()
}

export function clientPlanningPage(page: PlanningManuscriptPage): PlanningManuscriptPage {
  const clean = clientCopyText
  const caption = MATERIAL_EXPLANATION.test(page.visual.caption)
    ? clean(page.visual.subject).replace(/(?:关系)?示意图?$/u, '') || clean(page.title)
    : clean(page.visual.caption)
  return { ...page, title: clean(page.title), claim: clean(page.claim), body: page.body.map(clean).filter(Boolean),
    ...(page.product ? { product: Object.fromEntries(Object.entries(page.product).map(([key, value]) => [key, clean(value)])) as unknown as NonNullable<PlanningManuscriptPage['product']> } : {}),
    ...(page.table ? { table: { columns: page.table.columns.map(clean), rows: page.table.rows.map(row => row.map(clean)) } } : {}),
    visual: { ...page.visual, subject: clean(page.visual.subject), purpose: clean(page.visual.purpose), caption,
      ...(page.visual.diagram ? { diagram: { nodes: page.visual.diagram.nodes.map(n => ({ ...n, label: clean(n.label) })), edges: page.visual.diagram.edges.map(e => ({ ...e, ...(e.label ? { label: clean(e.label) } : {}) })) } } : {}) },
    notes: page.notes.includes(`原图注：${page.visual.caption}`) || caption === page.visual.caption ? page.notes : [...page.notes, `原图注：${page.visual.caption}`],
  }
}

export function clientPlanningManuscript(manuscript: PlanningManuscript): PlanningManuscript {
  return { ...manuscript, title: clientCopyText(manuscript.title), chapters: manuscript.chapters.map(chapter => ({ ...chapter,
    title: clientCopyText(chapter.title), thesis: clientCopyText(chapter.thesis), pages: chapter.pages.map(clientPlanningPage) })) }
}
