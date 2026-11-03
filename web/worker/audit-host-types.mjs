// Diagnostic overlay only: do not rewrite the legacy package manifest before migration.
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)))
process.chdir(root)
const paths = {}
for (const name of await readdir('web/worker/node_modules/@deepseek-ai')) {
  const dir = resolve('web/worker/node_modules/@deepseek-ai', name)
  const pkg = JSON.parse(await readFile(resolve(dir, 'package.json'), 'utf8'))
  const types = pkg.exports?.['.']?.types ?? pkg.types
  if (types) paths[`@deepseek-ai/${name}`] = [resolve(dir, types)]
  for (const [key, value] of Object.entries(pkg.exports ?? {})) {
    if (key.startsWith('./') && value?.types) paths[`@deepseek-ai/${name}/${key.slice(2)}`] = [resolve(dir, value.types)]
  }
}
await mkdir('.cache', { recursive: true })
const config = '.cache/tsconfig-dsh-target.json'
await writeFile(config, JSON.stringify({ extends: '../tsconfig.json', compilerOptions: { paths },
  include: [`${root}/src/**/*.ts`, `${root}/src/**/*.tsx`] }, null, 2))
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', config], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
