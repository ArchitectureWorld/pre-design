import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))

interface CandidatePackage {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

interface PackageManifest {
  readonly name: string
  readonly version: string
}

interface PackageScan {
  readonly version: string
  readonly entrySha256: string
  readonly rootSourceLeakage: readonly string[]
  readonly canonicalV06TestEntries: number
  readonly syntheticMarker: boolean
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function run(args: readonly string[], cwd = repositoryRoot): Promise<string> {
  const options = { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
  const result = process.platform === 'win32'
    ? await execute(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', ['pnpm', ...args].map(windowsCommandArgument).join(' ')], options)
    : await execute('pnpm', [...args], options)
  return result.stdout.trim()
}

function windowsCommandArgument(value: string): string {
  if (/[\s\0"&|<>^%!]/u.test(value)) throw new Error(`unsafe or spaced Windows command argument: ${value}`)
  return value
}

function outputArgument(argv: readonly string[]): string {
  const index = argv.indexOf('--output')
  const value = index < 0 ? undefined : argv[index + 1]
  if (value === undefined || value.trim() === '') throw new Error('usage: --output <new-absolute-directory>')
  if (!isAbsolute(value)) throw new Error('output directory must be absolute')
  return resolve(value)
}

async function onlyTgz(root: string): Promise<string> {
  const files = (await readdir(root)).filter(file => file.endsWith('.tgz'))
  if (files.length !== 1) throw new Error(`expected exactly one tgz in ${root}, found ${files.length}`)
  return join(root, files[0]!)
}

async function describe(path: string): Promise<CandidatePackage> {
  return { path, bytes: (await stat(path)).size, sha256: await sha256(path) }
}

async function tarText(args: readonly string[]): Promise<string> {
  const result = await execute('tar', [...args], { windowsHide: true, maxBuffer: 20 * 1024 * 1024 })
  return result.stdout
}

async function scanPackage(path: string): Promise<PackageScan> {
  const entries = (await tarText(['-tf', path])).split(/\r?\n/u).filter(Boolean)
  const packageJson = JSON.parse(await tarText(['-xOf', path, 'package/package.json'])) as PackageManifest
  const entry = await tarText(['-xOf', path, 'package/lib/index.js'])
  return {
    version: packageJson.version,
    entrySha256: createHash('sha256').update(entry, 'utf8').digest('hex'),
    rootSourceLeakage: entries.filter(candidate => /^package\/(?:tests|scripts)\//u.test(candidate)
      || /synthetic-boundary-host/u.test(candidate)),
    canonicalV06TestEntries: entries.filter(candidate => /^package\/contracts\/v0\.6\/(?:tests\/|run_contract_tests\.bat$)/u.test(candidate)).length,
    syntheticMarker: entry.includes('synthetic-boundary-fixture-v1'),
  }
}

async function copyPackageInputs(destination: string): Promise<void> {
  await mkdir(destination, { recursive: true })
  for (const entry of ['package.json', 'cordis.patch.yml', 'compatibility', 'contracts', 'lib'] as const) {
    await cp(join(repositoryRoot, entry), join(destination, entry), { recursive: true })
  }
}

async function main(): Promise<void> {
  const outputRoot = outputArgument(process.argv.slice(2))
  await mkdir(outputRoot)
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'preplan-package-build-'))
  try {
    const manifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as PackageManifest
    if (manifest.version !== '0.7.0') throw new Error(`package version drifted: ${manifest.version}`)

    await run(['build'])
    const formalEntryPath = join(repositoryRoot, 'lib', 'index.js')
    const formalEntrySha256 = await sha256(formalEntryPath)

    const formalPackRoot = join(temporaryRoot, 'formal-pack')
    await mkdir(formalPackRoot)
    await run(['pack', '--pack-destination', formalPackRoot])
    const formalPath = join(outputRoot, 'dsh-preplanning-agent-0.7.0-formal-candidate.tgz')
    await rename(await onlyTgz(formalPackRoot), formalPath)

    const syntheticRoot = join(temporaryRoot, 'synthetic-package')
    await copyPackageInputs(syntheticRoot)
    const syntheticBuildRoot = join(temporaryRoot, 'synthetic-build')
    await run([
      'exec', 'tsdown', 'tests/fixtures/synthetic-boundary-host.ts', '--no-config', '--format', 'esm', '--platform', 'node',
      '--target', 'es2024', '--out-dir', syntheticBuildRoot,
      '--deps.never-bundle', '@deepseek-ai/cordis', '--deps.never-bundle', '@deepseek-ai/schemastery', '--logLevel', 'error',
    ])
    const fixtureEntries = (await readdir(syntheticBuildRoot)).filter(file => /\.[mc]?js$/u.test(file))
    if (fixtureEntries.length !== 1) throw new Error(`expected one synthetic fixture entry, found ${fixtureEntries.length}`)
    await cp(join(syntheticBuildRoot, fixtureEntries[0]!), join(syntheticRoot, 'lib', 'index.js'))
    const syntheticEntrySha256 = await sha256(join(syntheticRoot, 'lib', 'index.js'))
    if (syntheticEntrySha256 === formalEntrySha256) throw new Error('synthetic fixture entry unexpectedly matches formal entry')

    const syntheticPackRoot = join(temporaryRoot, 'synthetic-pack')
    await mkdir(syntheticPackRoot)
    await run(['pack', '--pack-destination', syntheticPackRoot], syntheticRoot)
    const syntheticPath = join(outputRoot, 'dsh-preplanning-agent-0.7.0-synthetic-fixture-candidate.tgz')
    await rename(await onlyTgz(syntheticPackRoot), syntheticPath)

    const finalFormalEntrySha256 = await sha256(formalEntryPath)
    if (finalFormalEntrySha256 !== formalEntrySha256) throw new Error('formal lib/index.js changed during synthetic package build')
    const formalScan = await scanPackage(formalPath)
    const syntheticScan = await scanPackage(syntheticPath)
    if (formalScan.version !== manifest.version || syntheticScan.version !== manifest.version) throw new Error('packed package version drifted')
    if (formalScan.entrySha256 !== formalEntrySha256 || syntheticScan.entrySha256 !== syntheticEntrySha256) throw new Error('packed entry SHA-256 drifted')
    if (formalScan.rootSourceLeakage.length > 0 || syntheticScan.rootSourceLeakage.length > 0) throw new Error('plugin source root leaked into a candidate package')
    if (formalScan.syntheticMarker || !syntheticScan.syntheticMarker) throw new Error('synthetic fixture marker isolation failed')
    const result = {
      package: manifest.name,
      version: manifest.version,
      outputRoot,
      formal: await describe(formalPath),
      synthetic: await describe(syntheticPath),
      formalEntrySha256,
      syntheticEntrySha256,
      finalFormalEntrySha256,
      formalScan,
      syntheticScan,
      syntheticMarker: 'synthetic-boundary-fixture-v1',
      isolation: 'synthetic entry built and packed from an isolated temporary package root',
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    await rm(outputRoot, { recursive: true, force: true })
    throw error
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

await main()
