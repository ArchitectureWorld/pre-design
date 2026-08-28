import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runGoldenProject } from './build-golden-project.ts'

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const fixtureRoot = fileURLToPath(new URL('../tests/fixtures/golden-project/', import.meta.url))
const outputRoot = resolve(argumentValue('--output') ?? process.env.PREPLAN_GOLDEN_OUTPUT ?? `${repositoryRoot}/outputs/golden-project`)
const browserExecutable = resolve(
  argumentValue('--browser')
    ?? process.env.PREPLAN_BROWSER_EXECUTABLE
    ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
)

await mkdir(outputRoot, { recursive: true })
const result = await runGoldenProject(fixtureRoot, outputRoot, { browserExecutable })
process.stdout.write(`${JSON.stringify({ outputRoot, ...result }, null, 2)}\n`)
