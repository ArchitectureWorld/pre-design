import { expect, it } from 'vitest'
import { CHAPTER_QUALITY_POLICY, buildChapterQualityPrompt, chapterQualityMarkdown, validateVisualReview, summarizeVisualReviews, nextVisualReviewCycle } from '../src/report/chapter-quality-policy.ts'
import { buildReportDesignRulesPrompt, REPORT_DESIGN_RULES } from '../src/report/design-rules.ts'

const pages = [{ pageId: 'site-01', screenshotSha256: 'a'.repeat(64) }, { pageId: 'site-02', screenshotSha256: 'b'.repeat(64) }]
const review = () => ({ pages: pages.map(p => ({ ...p, imageReadable: true, checks: CHAPTER_QUALITY_POLICY.rules.map(r => ({ ruleId: r.id, observation: '图像与文字分为两组，实际页面可见。' })), findings: [] as any[] })), chapterObservation: '全章有图表、主辅图与大图变化。' })

it('shares the policy across authoring and public rules without invalidating existing manuscripts', () => {
  expect(REPORT_DESIGN_RULES.version).toBe('chapter-remediation-20261015.1')
  for (const rule of CHAPTER_QUALITY_POLICY.rules) {
    expect(buildReportDesignRulesPrompt()).toContain(rule.id)
    expect(chapterQualityMarkdown()).toContain(rule.title)
  }
  expect(buildChapterQualityPrompt()).toContain('最终裁切')
  expect(buildChapterQualityPrompt()).toContain('最多 2 次')
})
it('requires every page, the actual screenshot identity, and all ten checks before claiming review', () => {
  expect(() => validateVisualReview(review(), pages)).not.toThrow()
  const missing = review(); missing.pages.pop()
  expect(() => validateVisualReview(missing, pages)).toThrow('CHAPTER_QUALITY_REVIEW_PAGES')
  expect(() => validateVisualReview(missing, pages)).toThrow('site-02')
  expect(() => validateVisualReview(missing, pages)).toThrow('received')
  const stale = review(); stale.pages[0]!.screenshotSha256 = 'old'
  expect(() => validateVisualReview(stale, pages)).toThrow('CHAPTER_QUALITY_REVIEW_SCREENSHOT')
  const skipped = review(); skipped.pages[0]!.checks.pop()
  expect(() => validateVisualReview(skipped, pages)).toThrow('CHAPTER_QUALITY_REVIEW_COVERAGE')
  const unreadable = review(); unreadable.pages[0]!.imageReadable = false
  expect(() => validateVisualReview(unreadable, pages)).toThrow('CHAPTER_QUALITY_REVIEW_UNREADABLE')
})
it('does not turn cosmetic refinements or note conditions into a chapter blocker', () => {
  const v = review()
  v.pages[0]!.findings.push({ ruleId: 'caption', severity: 'improve', evidence: '图注可读且居中，但与图片底缘距离略大。', action: '后续微调间距。', repairTarget: 'layout' })
  validateVisualReview(v, pages)
  expect(summarizeVisualReviews([v])).toMatchObject({ status: 'ready_with_notes', blockingPageIds: [], improvementCount: 1 })
})
it('routes a misleading caption to its own page instead of rewriting the entire chapter', () => {
  const v = review()
  v.pages[1]!.findings.push({ ruleId: 'caption', severity: 'blocking', evidence: '图注写开阔库湾，实际裁切只有岩壁和树丛，看不到水面。', action: '换为可见库湾的原图或改为准确描述。', repairTarget: 'layout' })
  validateVisualReview(v, pages)
  expect(summarizeVisualReviews([v])).toMatchObject({ status: 'needs_revision', blockingPageIds: ['site-02'], layoutPageIds: ['site-02'] })
  v.pages[1]!.findings[0].evidence = ''
  expect(() => validateVisualReview(v, pages)).toThrow('CHAPTER_QUALITY_REVIEW_FINDING')
})
it('preserves an exhausted automatic cycle on resume and starts a new cycle only for changed inputs', () => {
  const exhausted = { policyVersion: CHAPTER_QUALITY_POLICY.version, initialLayoutHash: 'a', currentLayoutHash: 'b', revisionCount: 2 }
  expect(nextVisualReviewCycle(exhausted, 'b')).toEqual(exhausted)
  expect(nextVisualReviewCycle(exhausted, 'c')).toMatchObject({ initialLayoutHash: 'c', revisionCount: 0 })
})
it('escalates recurring illegible diagram structure without blocking ordinary spacing refinements',()=>{
  const v=review()
  for(const p of v.pages)p.findings.push({ruleId:'diagram-aesthetics',severity:'improve',evidence:'同等权重的大卡片与绕行连线导致主辅难辨。',action:'按关系分组并整理走线。',repairTarget:'layout'})
  expect(summarizeVisualReviews([v])).toMatchObject({status:'needs_revision',blockingPageIds:['site-01','site-02'],improvementCount:0})
  v.pages.forEach(p=>{p.findings[0].evidence='组名与节点之间的间距可微调。'})
  expect(summarizeVisualReviews([v])).toMatchObject({status:'ready_with_notes',blockingPageIds:[],improvementCount:2})
})
