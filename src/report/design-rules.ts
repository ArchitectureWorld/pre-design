import { buildChapterQualityPrompt } from './chapter-quality-policy.ts'
/** Shared authoring and rendering rules for the approved chapter workflow. */
export const REPORT_DESIGN_RULES = {
  version: 'chapter-remediation-20261015.1',
  canvas: { width: 1600, height: 900 },
  fontMinPx: { title: 36, body: 24, caption: 16 },
  bodyPointsMax: 3,
  textOnlyMaxRatio: 0.15,
  captionAlignments: ['left', 'right', 'center'],
} as const

export function buildReportDesignRulesPrompt(): string {
  return `排版规则版本 ${REPORT_DESIGN_RULES.version}：1600×900横版，标题至少36px、正文24px、图注脚注16px。每页一个结论，正文最多3个不重复的要点；完整论证、来源、人工确认事项和假设影响进入notes。图注绑定对应图像，首字对齐图像左边缘、尾字对齐右边缘，或整体中心对齐图像中心，不能对齐无关容器。图件须回答本页问题；不得用无关照片或抽象方框填充。\n`+buildChapterQualityPrompt()
}
