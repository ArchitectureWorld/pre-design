import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
const lockPath = join(root, 'docs', 'contracts', 'presentation-standard-project-v0.1.0-lock.json')
const lock = JSON.parse(await readFile(lockPath, 'utf8'))
const require = createRequire(import.meta.url)

function requireCondition(condition, message) {
  if (!condition) {
    throw new Error(`PRESENTATION_CONTRACT_RUNTIME_ASSETS_FAILED: ${message}`)
  }
}

async function computeSchemaSetHash(schemaRoot) {
  const names = (await readdir(schemaRoot))
    .filter(name => name.endsWith('.schema.json'))
    .sort()
  requireCondition(names.length > 0, `no JSON Schemas found in ${schemaRoot}`)

  const hash = createHash('sha256')
  for (const name of names) {
    hash.update(name)
    hash.update('\0')
    hash.update(await readFile(join(schemaRoot, name)))
    hash.update('\0')
  }
  return { hash: hash.digest('hex'), names }
}

const contractPackageJson = require.resolve(`${lock.packageName}/package.json`)
const contractRoot = dirname(contractPackageJson)
const contractPackage = JSON.parse(await readFile(contractPackageJson, 'utf8'))
const sourceHashPath = join(contractRoot, 'SCHEMASET.sha256')
const sourceSchemaRoot = join(contractRoot, 'schemas', lock.standardVersion)
const targetHashPath = join(root, 'SCHEMASET.sha256')
const targetSchemasRoot = join(root, 'schemas')
const targetSchemaRoot = join(targetSchemasRoot, lock.standardVersion)

requireCondition(contractPackage.name === lock.packageName,
  `installed Contract package is ${contractPackage.name}, expected ${lock.packageName}`)
requireCondition(contractPackage.version === lock.packageVersion,
  `installed Contract version is ${contractPackage.version}, expected ${lock.packageVersion}`)

const expectedHash = (await readFile(sourceHashPath, 'utf8')).trim().split(/\s+/u)[0]
const source = await computeSchemaSetHash(sourceSchemaRoot)
requireCondition(expectedHash === lock.schemaSetSha256,
  `SCHEMASET file is ${expectedHash}, expected ${lock.schemaSetSha256}`)
requireCondition(source.hash === lock.schemaSetSha256,
  `computed source Schema Set is ${source.hash}, expected ${lock.schemaSetSha256}`)

await rm(targetSchemasRoot, { recursive: true, force: true })
await mkdir(targetSchemaRoot, { recursive: true })
for (const name of source.names) {
  await copyFile(join(sourceSchemaRoot, name), join(targetSchemaRoot, name))
}
await copyFile(sourceHashPath, targetHashPath)

const copiedHash = (await readFile(targetHashPath, 'utf8')).trim().split(/\s+/u)[0]
const copied = await computeSchemaSetHash(targetSchemaRoot)
requireCondition(copiedHash === lock.schemaSetSha256,
  `copied SCHEMASET file is ${copiedHash}, expected ${lock.schemaSetSha256}`)
requireCondition(copied.hash === lock.schemaSetSha256,
  `copied Schema Set is ${copied.hash}, expected ${lock.schemaSetSha256}`)
requireCondition(copied.names.join('\n') === source.names.join('\n'),
  'copied Schema file list differs from the pinned Contract')

console.log('PRESENTATION_CONTRACT_RUNTIME_ASSETS_PASS')
console.log(JSON.stringify({
  packageName: lock.packageName,
  packageVersion: lock.packageVersion,
  standardVersion: lock.standardVersion,
  schemaSetSha256: copied.hash,
  schemaCount: copied.names.length,
  outputRoot: root,
}, null, 2))
