/** One policy for page planning, copy, layout, native review and the public checklist.
 * Its version is deliberately independent of the immutable manuscript rulesVersion. */
import { DIAGRAM_AESTHETICS } from './diagram-design.ts'
import { CLIENT_VISUAL_PROMPT, CHAPTER_CAPACITY_GUIDANCE } from './chapter-client-visuals.ts'
export const CHAPTER_QUALITY_POLICY = {
  version: 'chapter-quality-20261021.2',
  reviewBatchSize: 3,
  recheckAfterSteps: 3,
  maxAutomaticRevisions: 2,
  rules: [
    {id:'scene-required',title:'逐页场景或产品图',text:CLIENT_VISUAL_PROMPT},
    {id:'diagram-aesthetics',title:'图件审美与表达层级',text:DIAGRAM_AESTHETICS},
    { id: 'purpose', title: '页面任务与图件匹配', text: '每页一个可讲清的判断。位置问题用真实地图，关系与次序用关系图，比较用可比图表；普通风景照片不能代替本页必需的空间或游览序列表达。图件和正文共同支持结论。' },
    { id: 'hierarchy', title: '主辅层级与完整构图', text: '先定主视觉、文字组和阅读顺序，再安排辅助内容。避免把信息拆成同等权重的小图、小卡片和散落短句。大图可以通高、贴边；不为了页眉或图注机械缩小主图。留白服务阅读，不用无关小图填空。' },
    { id: 'proportion', title: '真实图像比例与可读性', text: '按图片自然比例选择图框；竖图不能孤立在大横框中央。地图与专业图件完整保留边界、图例、标注；最终裁切不能损失论证对象。检查实际图像和文字尺寸，不以容器足够大代替可读。' },
    { id: 'grouping', title: '同组内容对齐', text: '同组文字采用共同起点、宽度、基线和间距，形成明确的行或列；不同层级可灵活组织，不要求所有页面套同一网格。禁止用缩字或重叠硬塞内容。' },
    { id: 'typography', title: '标题编号与字体层级', text: '标题编号与标题同字体、字号、字重和基线。1600×900画布，标题至少36px、正文24px、图注16px；留足真实换行高度，避免孤立短尾行。' },
    { id: 'caption', title: '图注准确且有归属', text: '图注描述最终裁切后实际可见内容，不能依据目录名猜测。首字对齐实际图像左边缘、尾字对齐右边缘或整体居中；允许图下或叠图，兼顾对比度和合理间距，不机械贴页边。不写屋面状物、资料圈画等核查语言。' },
    { id: 'overlay', title: '叠图避让核心信息', text: '标题、图注可以覆盖图片；选择低信息区，保护地图标注、水岸、地标等核心主体，保持可读对比度。不能用虚假的小保护框放行遮挡；满版图不强制另留占空间的底带。' },
    { id: 'imagery', title: '原图计数与视觉差异', text: '同一原图全稿最多 2 次，同页不得重复；裁切、缩放、改名仍累计。近似角度也要检查是否提供新信息，不能只换文件维持重复画面。参考图和概念图保留必要身份，不冒充现场。' },
    { id: 'audience', title: '甲方正文与内部备注分离', text: '正文用可直接对外汇报的语言表达拟议方案和价值。会议纪要、讨论、来源时点、权属许可和人工确认事项放备注；拟议目标不得伪装成已落地事实。已审策划正文按拟议目标状态阅读，未逐句加“拟”字不代表已建成。已在备注说明的入口、道路、权属和许可条件不得再次成为视觉阻断；只有明确声称已经建成、已获批、已营业等与事实相反时才要求内容复核。' },
    { id: 'rhythm', title: '全章节奏与完整论证', text: '查看当前全章缩略图及相邻页。同一种实际图文组织不得连续三页，换标题、颜色、素材或模板名不算改变；理由不能豁免。字段可比性用相同信息口径保持。每页相关场景或产品图必须存在，关系图、地图、表格不抵扣。章末独立判断所有页面的组织和连续阅读，局部页面不变不代表整章判断可以复用。' },
  ],
} as const

export type ChapterQualityRuleId = typeof CHAPTER_QUALITY_POLICY.rules[number]['id']
export interface VisualReviewPageIdentity { pageId: string; screenshotSha256: string }
export interface ChapterVisualFinding {
  ruleId: ChapterQualityRuleId; severity: 'blocking'|'improve'; evidence: string; action: string; repairTarget: 'layout'|'content'
}
export interface ChapterVisualReview {
  pages: (VisualReviewPageIdentity & { imageReadable: boolean; checks: { ruleId: ChapterQualityRuleId; observation: string }[]; findings: ChapterVisualFinding[] })[]
  chapterObservation: string
}
export interface VisualReviewCycle { policyVersion: string; initialLayoutHash: string; currentLayoutHash: string; revisionCount: number }

export function buildChapterQualityPrompt(): string {
  return [`通用汇报质量规则 ${CHAPTER_QUALITY_POLICY.version}（所有阶段共用）：`,
    ...CHAPTER_QUALITY_POLICY.rules.map(r => `[${r.id}] ${r.title}：${r.text}`),
    CHAPTER_CAPACITY_GUIDANCE,
    '审查分级：缺少相关场景/产品图、同布局连续三页、关键关系难辨、图文误导、核心表达缺失、遮挡、越界、读不清或明确硬规则违反均为blocking。同类大卡片、长绕线、主辅难辨等跨页反复出现必须整体返修，不能全部归为普通优化。只有不影响表达的局部间距、轻微尾行等为improve。每项问题写具体可见证据和可执行修改动作。',
    `每 ${CHAPTER_QUALITY_POLICY.recheckAfterSteps} 个实质推进步骤及章末回看；不按时间卡关。初版后最多自动返修 ${CHAPTER_QUALITY_POLICY.maxAutomaticRevisions} 次，仅修受影响页。超限保留候选、问题和已完成页面，不能无穷重跑或虚报通过。程序通过、DSH视觉通过、用户验收分别记录。`,
  ].join('\n')
}

export function chapterQualityMarkdown(): string {
  return '# DSH 通用汇报质量规则\n\n版本：' + CHAPTER_QUALITY_POLICY.version + '\n\n' +
    CHAPTER_QUALITY_POLICY.rules.map((r,i) => `${i+1}. **${r.title}**（${r.id}）：${r.text}`).join('\n\n') +
    '\n\n程序检查负责几何、文字完整和原图计数；DSH 独立任务看最终截图，逐项记录观察与问题。可读性、图文一致和信息完整的严重问题返修；普通优化项记录后继续。每三个实质步骤及章末回看，初版后最多自动返修两次。所有状态保留用户待验收，不用技术通过代替用户验收。\n'
}

const nonempty = (v:unknown):v is string => typeof v === 'string' && !!v.trim()
export function validateVisualReview(value: ChapterVisualReview, pages: readonly VisualReviewPageIdentity[]): void {
  if (!value || !Array.isArray(value.pages) || value.pages.length !== pages.length || value.pages.some((p,i) => p.pageId !== pages[i]?.pageId)) throw new Error('CHAPTER_QUALITY_REVIEW_PAGES: '+JSON.stringify({expected:pages.map(p=>p.pageId),received:Array.isArray(value?.pages)?value.pages.map(p=>p?.pageId):[],required:'逐页返回全部expected页面，严格按序；不能只交第一张截图的审查，未发现问题的页面也须提交完整checks和空findings。'}))
  const ids = CHAPTER_QUALITY_POLICY.rules.map(r => r.id)
  for (const [i,p] of value.pages.entries()) {
    if (p.screenshotSha256 !== pages[i]!.screenshotSha256) throw new Error('CHAPTER_QUALITY_REVIEW_SCREENSHOT')
    if (p.imageReadable !== true) throw new Error('CHAPTER_QUALITY_REVIEW_UNREADABLE: '+p.pageId)
    if (!Array.isArray(p.checks) || p.checks.length !== ids.length || ids.some(id => p.checks.filter(c => c.ruleId === id && nonempty(c.observation)).length !== 1)) throw new Error('CHAPTER_QUALITY_REVIEW_COVERAGE: '+p.pageId)
    if (!Array.isArray(p.findings) || p.findings.some(f => !ids.includes(f.ruleId) || !['blocking','improve'].includes(f.severity) || !['layout','content'].includes(f.repairTarget) || !nonempty(f.evidence) || !nonempty(f.action))) throw new Error('CHAPTER_QUALITY_REVIEW_FINDING')
  }
  if (!nonempty(value.chapterObservation)) throw new Error('CHAPTER_QUALITY_REVIEW_OVERVIEW')
}

export function summarizeVisualReviews(reviews: readonly ChapterVisualReview[]) {
  const pages = reviews.flatMap(r => r.pages), findings = pages.flatMap(p => p.findings.map(f => ({ pageId:p.pageId,...f })))
  const recurrent=findings.filter(f=>f.ruleId==='diagram-aesthetics'&&/大.{0,5}(卡片|框)|绕[行线]|交叉|难辨|等重|混读|归属不/.test(f.evidence))
  if(new Set(recurrent.map(f=>f.pageId)).size>=2)for(const f of recurrent)f.severity='blocking'
  const blocking = findings.filter(f => f.severity === 'blocking')
  return { status: blocking.length ? 'needs_revision' as const : findings.length ? 'ready_with_notes' as const : 'ready' as const,
    pageCount: pages.length, blockingPageIds:[...new Set(blocking.map(f => f.pageId))],
    layoutPageIds:[...new Set(blocking.filter(f => f.repairTarget === 'layout').map(f => f.pageId))],
    contentPageIds:[...new Set(blocking.filter(f => f.repairTarget === 'content').map(f => f.pageId))],
    improvementCount: findings.filter(f => f.severity === 'improve').length, findings }
}

export function nextVisualReviewCycle(previous: VisualReviewCycle|undefined, layoutHash: string): VisualReviewCycle {
  if (previous?.policyVersion === CHAPTER_QUALITY_POLICY.version && previous.currentLayoutHash === layoutHash) return previous
  return {policyVersion:CHAPTER_QUALITY_POLICY.version,initialLayoutHash:layoutHash,currentLayoutHash:layoutHash,revisionCount:0}
}
