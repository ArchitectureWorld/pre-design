import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { resolveBrowserExecutable } from './browser-executable.ts'
import type { RenderedArtifact } from './types.ts'
import { readHtmlArtifactIdentity } from './validate-artifacts.ts'

export type BrowserRunner = (executable: string, args: readonly string[]) => Promise<void>

const defaultRunner: BrowserRunner = (executable, args) => new Promise((resolve, reject) => {
  const child = spawn(executable, [...args], { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  let errorText = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { errorText += String(chunk) })
  child.once('error', reject)
  child.once('exit', code => {
    if (code === 0) resolve()
    else reject(new Error(`PDF browser process exited with code ${String(code)}${errorText.trim() === '' ? '' : `: ${errorText.trim()}`}`))
  })
})

export async function renderPdf(
  htmlPath: string,
  outputPath: string,
  browserExecutable: string,
  runner: BrowserRunner = defaultRunner,
): Promise<RenderedArtifact> {
  await mkdir(dirname(outputPath), { recursive: true })
  await runner(resolveBrowserExecutable(browserExecutable), [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${outputPath}`,
    pathToFileURL(htmlPath).href,
  ])
  const html = await readFile(htmlPath, 'utf8')
  const hasClientIdentity = html.includes('name="preplan-project-id"') || html.includes("name='preplan-project-id'")
  if (hasClientIdentity) {
    const metadata = readHtmlArtifactIdentity(html)
    await appendFile(outputPath, `\n%PREPLAN-METADATA:${Buffer.from(JSON.stringify(metadata)).toString('base64url')}\n`)
  } else {
    const revisionText = html.match(/data-report-revision=["'](\d+)["']/u)?.[1]
    const recommendationId = html.match(/data-recommendation-id=["']([^"']*)["']/u)?.[1]
    const adoptedAssetText = html.match(/data-adopted-asset-ids=["']([^"']*)["']/u)?.[1] ?? ''
    if (revisionText !== undefined && recommendationId !== undefined) {
      const metadata = {
        revision: Number(revisionText),
        recommendationId,
        adoptedAssetIds: adoptedAssetText === '' ? [] : adoptedAssetText.split(',').filter(Boolean).sort(),
      }
      await appendFile(outputPath, `\n%PREPLAN-METADATA:${Buffer.from(JSON.stringify(metadata)).toString('base64url')}\n`)
    }
  }
  const content = await readFile(outputPath)
  if (content.subarray(0, 5).toString() !== '%PDF-') throw new Error('browser did not produce a valid PDF artifact')
  return {
    format: 'pdf', fileName: basename(outputPath), path: outputPath, bytes: (await stat(outputPath)).size,
    sha256: createHash('sha256').update(content).digest('hex'),
  }
}
