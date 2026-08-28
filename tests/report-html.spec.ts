import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildReportDocument } from '../src/report/build-document.ts'
import { renderHtml } from '../src/report/render-html.ts'
import { REPORT_INPUT } from './report-fixture.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('renderHtml', () => {
  it('publishes a self-contained offline client report with revision and working local assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-html-'))
    roots.push(root)
    const sourceImage = join(root, 'concept-1.png')
    await import('node:fs/promises').then(({ writeFile }) => writeFile(sourceImage, Buffer.from([1, 2, 3])))
    const document = buildReportDocument({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    })

    const artifact = await renderHtml(document, root)
    const htmlPath = join(root, 'html', 'index.html')
    const html = await readFile(htmlPath, 'utf8')

    expect(artifact).toMatchObject({ format: 'html', fileName: 'html/index.html', sha256: expect.any(String) })
    expect(html).toContain('核心结论与需甲方决策事项')
    expect(html).toContain('data-report-revision="57"')
    expect(html).toContain('data-recommendation-id="recommendation-r57-cultural-riverfront"')
    expect(html).toContain('data-adopted-asset-ids="concept-1"')
    expect(html).toContain('concept-1')
    expect(html).not.toMatch(/https?:\/\//iu)
    expect(html).not.toContain('C:/fixtures')
    await expect(access(join(root, 'html', 'assets', 'images', 'concept-1.png'))).resolves.toBeUndefined()
  })
})
