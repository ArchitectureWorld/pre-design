import { expect, it } from 'vitest'
import { renderChapterHtml, collectChapterNotes, formatChapterSources } from '../src/report/chapter-render.ts'
import type { ChapterDraftRecord } from '../src/report/chapter-plan.ts'
import type { ChapterPageLayout } from '../src/report/chapter-render.ts'
import * as profile from '../src/report/chapter-profile.ts'
import { REPORT_DESIGN_RULES } from '../src/report/design-rules.ts'

const draft: ChapterDraftRecord = {
  scope: 'chapter', chapterId: 'opportunity', projectId: 'test', sourceRevision: 1,
  sourceFingerprint: 'test-sources', generatedAt: '2026-10-15T00:00:00Z',
  status: 'draft_ready', userReview: 'pending', nativeAttempts: [], artifactPaths: { chapter: 'test.json', checkpoint: 'test-checkpoint.json' },
  rulesVersion: REPORT_DESIGN_RULES.version, planHash: 'approved-plan',
  chapter: { id: 'opportunity', title: '发展机会', thesis: '茶事体验', pages: [{
    id: 'opportunity-case', kind: 'argument', title: '茶园连接体验', claim: '组织预约体验。',
    body: ['保留这条原生正文。'], sourceRefs: ['H-P05', 'F'], notes: ['权属需确认。'],
    visual: { kind: 'source', caption: '茶园现状', subject: '茶园', purpose: '说明资源' },
    table: { columns: ['案例', '应用', '确认事项'], rows: [['样本甲', '茶事课程', '核对合作条件。']] },
  }] },
}
const rect = { x: 56, y: 220, width: 500, height: 300 }
const layout: ChapterPageLayout = { pageId: 'opportunity-case', name: '案例比较', tableNoteColumns: [2], elements: [
  { type: 'body', index: 0, rect }, { type: 'table', rect }, { type: 'figure', assetId: 'tea', rect },
] }
const assets = [{ id: 'tea', dataUrl: 'data:image/png;base64,AA==', width: 500, height: 300, label: '茶田', sourceNote: '用户现场照片。' }]

it('keeps native public copy and moves complete table note cells into the shared notes export', () => {
  const original = JSON.stringify(draft)
  const html = renderChapterHtml(draft, [layout], assets)
  const publicPart = html.split('<dialog')[0]!
  expect(publicPart).toContain('保留这条原生正文。')
  expect(publicPart).toContain('茶事课程')
  expect(publicPart).not.toContain('核对合作条件。')
  const notes = collectChapterNotes(draft, [layout], assets)
  expect(notes[0]!.notes).toContain('样本甲 · 确认事项：核对合作条件。')
  expect(notes[0]!.notes).toContain('权属需确认。')
  expect(html).toContain('样本甲 · 确认事项：核对合作条件。')
  expect(JSON.stringify(draft)).toBe(original)
})
it('rejects omitted copy and unavailable figures instead of exporting a partial chapter', () => {
  expect(() => renderChapterHtml(draft, [{ ...layout, elements: layout.elements.filter(e => e.type !== 'body') }], assets)).toThrow('CHAPTER_RENDER_BODY_MISSING')
  expect(() => renderChapterHtml(draft, [layout], [])).toThrow('CHAPTER_RENDER_IMAGE_MISSING')
})
it('rejects invalid table note columns and keeps source labels readable', () => {
  expect(() => renderChapterHtml(draft, [{ ...layout, tableNoteColumns: [4] }], assets)).toThrow('CHAPTER_RENDER_NOTE_COLUMN_INVALID')
  expect(formatChapterSources(['H-P03', 'H-P15', 'F', 'M', 'T'])).toBe('参考稿 P03、15 / 现场照片 / 点位图 / 地形预览')
})
it('uses matching title typography and keeps provenance out of the public slide footer',()=>{
  const html=renderChapterHtml(draft,[layout],assets)
  expect(html).toContain('align-items:baseline')
  expect(html).toMatch(/\.folio\{[^}]*font-size:40px;[^}]*font-weight:700/)
  expect(html.split('<dialog')[0]).not.toContain('依据：参考稿')
})
it.each([
  ['林间小屋周边现场，住宿经营状态待核', '林间小屋周边现场'],
  ['古寨遗址现场线索，保护与准入条件待核', '古寨遗址现场线索'],
  ['采茶体验参考图，非少潭河现场', '采茶体验参考图'],
  ['营地空间案例参考，非少潭河现场', '营地空间案例参考'],
])('moves the internal clause in "%s" into shared notes while preserving the native caption', (caption, visible) => {
  const layouts = [{ ...layout, elements: layout.elements.map(e => e.type === 'figure' ? { ...e, caption } : e) }]
  const original = JSON.stringify(layouts)
  const html = renderChapterHtml(draft, layouts, assets)
  const publicPart = html.split('<dialog')[0]!
  expect(publicPart).toContain(`<span>${visible}</span></figcaption>`)
  expect(publicPart).not.toContain(caption)
  expect(collectChapterNotes(draft, layouts, assets)[0]!.notes).toContain(`原生图注：${caption}`)
  expect(html.split('<dialog')[1]).toContain(`原生图注：${caption}`)
  expect(JSON.stringify(layouts)).toBe(original)
})
it('keeps a non-site qualifier visible when removing it would misrepresent the photograph', () => {
  const layouts = [{ ...layout, elements: layout.elements.map(e => e.type === 'figure' ? { ...e, caption: '湖山环境，非少潭河现场' } : e) }]
  expect(renderChapterHtml(draft, layouts, assets).split('<dialog')[0]).toContain('<span>湖山环境，非少潭河现场</span></figcaption>')
})
it('renders a site chapter with its own ordinal, page numbers and heading', () => {
  const site = structuredClone(draft)
  Object.assign(site, { chapterId:'site' })
  Object.assign(site.chapter, { id:'site', title:'场地条件与发展判断' })
  Object.assign(site.chapter.pages[0]!,{id:'site-case'})
  const html=renderChapterHtml(site,[{...layout,pageId:'site-case'}],assets)
  expect(html).toContain('02 / 场地条件与发展判断')
  expect(html).toContain('<span class="folio">2.01</span>')
  expect(html).toContain('<h2>2.01 茶园连接体验</h2>')
  expect(html).not.toContain('01 / 发展机会与项目价值')
  expect(html).not.toContain('第一章')
})

it('renders the actual project identity and never injects an unrelated reference document', () => {
  const actual={...draft,projectName:'滨海 <园区> & 更新'}
  const html=renderChapterHtml(actual,[layout],assets)
  expect(html).toContain('滨海 &lt;园区&gt; &amp; 更新')
  expect(html).not.toMatch(/少潭河|SHAOTANHE|1006_统一排版/)
  expect(collectChapterNotes(actual,[layout],assets)[0]!.notes).toContain('权属需确认。')
  const legacy=renderChapterHtml(draft,[layout],assets)
  expect(legacy).toContain('项目策划');expect(legacy).not.toMatch(/少潭河|SHAOTANHE/)
})
it('uses one bounded project-specific file stem for HTML, PDF and failed-layout recovery', () => {
  const stem=(profile as any).chapterExportStem
  expect(typeof stem).toBe('function')
  expect(stem('滨海工业遗产公园','site')).toBe('滨海工业遗产公园_第二章_场地条件与发展判断')
  expect(stem(undefined,'site')).toBe('项目策划_第二章_场地条件与发展判断')
  expect(stem('../危险/\\文件:*?<>|','site')).not.toMatch(/[\\/:*?<>|]/)
  expect(stem('../危险/\\文件:*?<>|','site')).not.toMatch(/^\./)
})
