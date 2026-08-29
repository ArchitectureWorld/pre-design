import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createClientReportBundle } from '../src/report/client-projection.ts'
import { planClientPages } from '../src/report/page-plan.ts'
import { renderPptx } from '../src/report/render-pptx.ts'
import { CLIENT_PROFILE, REPORT_INPUT } from './client-report-fixture.ts'
import { inspectPptx } from './support/pptx-inspector.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('renderPptx', () => {
  it('creates 36 editable slides with varied layouts and no visible governance terms', async () => {
    const root = await mkdtemp(join(tmpdir(), 'preplan-client-pptx-'))
    roots.push(root)
    const output = join(root, 'report.pptx')
    const sourceImage = join(root, 'concept-1.png')
    await writeFile(sourceImage, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ))
    const bundle = createClientReportBundle({
      ...REPORT_INPUT,
      visualAssets: [{ ...REPORT_INPUT.visualAssets[0]!, sourcePath: sourceImage }],
    }, CLIENT_PROFILE)
    const context = {
      report: bundle.report,
      plan: planClientPages(bundle.report, 'pptx'),
      identity: bundle.identity,
    }

    const artifact = await renderPptx(context, output)
    const deck = await inspectPptx(output)

    expect(artifact).toMatchObject({ format: 'pptx', fileName: 'report.pptx', sha256: expect.any(String) })
    expect(deck.slideCount).toBe(36)
    expect(deck.pageKinds).toEqual(expect.arrayContaining([
      'cover', 'opening-claim', 'chapter-divider', 'product', 'scene', 'decision',
    ]))
    expect(deck.slideTexts.join('\n')).not.toMatch(/Gate|Revision|Workflow|工作项|完成度/iu)
    expect(deck.notesTexts.join('\n')).toContain('sourceRevision=57')
    expect(deck.mediaNames.length).toBeGreaterThanOrEqual(bundle.report.assets.length)
    expect(deck.outOfBoundsObjects).toEqual([])
    expect(deck.textBelowMinimum).toEqual([])
  })
})
