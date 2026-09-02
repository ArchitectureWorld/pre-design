import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runGoldenProject, type GoldenProjectFormat } from './build-golden-project.ts'

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function researchPreviewFormats(value: string | undefined): readonly GoldenProjectFormat[] {
  if (value === undefined) {
    if (process.argv.includes('--formats')) throw new Error('--formats requires a comma-separated value')
    return ['html']
  }
  const formats = value.split(',').map(format => format.trim()).filter(Boolean)
  if (formats.length === 0 || formats.some(format => !['html', 'pptx', 'pdf'].includes(format))) {
    throw new Error('--formats must be a comma-separated subset of html,pptx,pdf')
  }
  if (new Set(formats).size !== formats.length) throw new Error('--formats must not contain duplicates')
  if (!formats.includes('html')) throw new Error('--formats must include html')
  return formats as GoldenProjectFormat[]
}

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const fixtureRoot = resolve(
  argumentValue('--fixture')
    ?? fileURLToPath(new URL('../tests/fixtures/golden-project/', import.meta.url)),
)
const outputRoot = resolve(argumentValue('--output') ?? process.env.PREPLAN_GOLDEN_OUTPUT ?? `${repositoryRoot}/outputs/golden-project`)
const browserExecutable = resolve(
  argumentValue('--browser')
    ?? process.env.PREPLAN_BROWSER_EXECUTABLE
    ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
)
const formats = researchPreviewFormats(argumentValue('--formats'))

const result = await runGoldenProject(fixtureRoot, outputRoot, { browserExecutable, formats })
process.stdout.write(`${JSON.stringify({ outputRoot, ...result }, null, 2)}\n`)
