import { execFile as execFileCallback } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

interface PackedPackage { files: { path: string }[] }
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const execFile = promisify(execFileCallback)

async function packedFilePaths(): Promise<string[]> {
  const packArguments = ['pack', '--dry-run', '--json', '--ignore-scripts']
  const command = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'npm'
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm', ...packArguments]
    : packArguments
  const { stdout } = await execFile(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  const rows = JSON.parse(stdout) as PackedPackage[]
  return rows[0]!.files.map(file => file.path.replaceAll('\\', '/')).sort()
}

describe('Pre 2.0.1 packed research contracts', () => {
  it('ships the traceable research schemas, catalog and workflow plans', async () => {
    const paths = await packedFilePaths()
    expect(paths).toEqual(expect.arrayContaining([
      'research/v2.0.1/data-sources.json',
      'research/v2.0.1/workflow-research-specs.json',
      'research/v2.0.1/schemas/data-source-catalog.schema.json',
      'research/v2.0.1/schemas/workflow-research-spec.schema.json',
      'research/v2.0.1/schemas/evidence-record.schema.json',
      'research/v2.0.1/schemas/analysis-trace.schema.json',
    ]))
  })
})
