// Compatibility probe: compile current Host but resolve DSH imports from the new Worker.
import { build } from 'tsdown'
import { mkdir, symlink, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const root = fileURLToPath(new URL('../../', import.meta.url))
process.chdir(root)
const out = resolve(root, 'web/worker/.host-build')
await mkdir(out, { recursive: true })
for (const name of ['contracts', 'research', 'schemas', 'SCHEMASET.sha256']) {
  await rm(resolve(out, name), { force: true })
  await symlink(resolve(root, name), resolve(out, name), name === 'SCHEMASET.sha256' ? 'file' : 'dir')
}
await build({ config: false, entry: { index: 'src/index.ts' }, outDir: resolve(out, 'lib'),
  format: 'esm', platform: 'node', target: 'es2024', dts: false,
  deps: { neverBundle: specifier => specifier.startsWith('@deepseek-ai/') || specifier.startsWith('pdfjs-dist/') || specifier === 'sharp',
    alwaysBundle: specifier => !specifier.startsWith('@deepseek-ai/') && !specifier.startsWith('pdfjs-dist/') && specifier !== 'sharp' } })
