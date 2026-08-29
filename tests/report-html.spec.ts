import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import { planClientPages } from '../src/report/page-plan.ts'
import { renderHtml } from '../src/report/render-html.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('renderHtml', () => {
  it('renders an offline client story without visible governance vocabulary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-client-html-'))
    roots.push(root)
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from([1, 2, 3]))
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, CLIENT_PROFILE)
    const context = {
      report: bundle.report,
      plan: planClientPages(bundle.report, 'html'),
      identity: bundle.identity,
    }

    const artifact = await renderHtml(context, root)
    const html = await readFile(join(root, 'html', 'index.html'), 'utf8')
    const body = html.match(/<body[\s\S]*<\/body>/u)?.[0] ?? ''

    expect(artifact).toMatchObject({
      format: 'html',
      fileName: 'html/index.html',
      sha256: expect.any(String),
    })
    expect(html).toContain('<meta name="preplan-source-revision" content="57">')
    expect(html.match(/data-page-kind=/gu)).toHaveLength(36)
    expect(html).toContain('data-page-kind="product"')
    expect(html).toContain('@media (prefers-reduced-motion: reduce)')
    expect(html).toContain(':focus-visible')
    expect(html).toContain('aria-label="成果章节导航"')
    expect(body).not.toMatch(/Gate|Revision|Workflow|工作项|完成度/iu)
    expect(html).not.toMatch(/https?:\/\//iu)
    expect(html).not.toContain(sourceImage)
    await expect(access(join(root, 'html', 'assets', 'images', 'concept-1.png')))
      .resolves.toBeUndefined()
  })
})
