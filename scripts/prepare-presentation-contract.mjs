import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const lockPath = path.join(root, 'docs/contracts/presentation-standard-project-v0.1.0-lock.json')
const lock = JSON.parse(await readFile(lockPath, 'utf8'))
const skipInstall = process.argv.includes('--skip-install')
const keepCheckout = process.argv.includes('--keep-checkout')

function executable(name) {
  return process.platform === 'win32' && ['npm', 'pnpm'].includes(name) ? `${name}.cmd` : name
}

function run(command, args, options = {}) {
  const result = execFileSync(executable(command), args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    env: options.env ?? process.env,
    stdio: options.stdio ?? 'pipe',
  })
  if (options.echo !== false && result.trim() !== '') process.stdout.write(result.endsWith('\n') ? result : `${result}\n`)
  return result
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(`PRESENTATION_CONTRACT_PREPARE_FAILED: ${message}`)
}

async function digestFile(filePath, algorithm, encoding = 'hex') {
  const bytes = await readFile(filePath)
  return createHash(algorithm).update(bytes).digest(encoding)
}

async function computeSchemaSetHash(schemaRoot) {
  const names = (await readdir(schemaRoot)).filter(name => name.endsWith('.schema.json')).sort()
  const hash = createHash('sha256')
  for (const name of names) {
    hash.update(name)
    hash.update('\0')
    hash.update(await readFile(path.join(schemaRoot, name)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

const cacheParent = path.join(root, '.cache')
await mkdir(cacheParent, { recursive: true })
const operationRoot = await mkdtemp(path.join(cacheParent, 'presentation-contract-'))
const checkout = path.join(operationRoot, 'presentation-tools')
const packDestination = path.join(operationRoot, 'pack')
const pythonEnvironment = path.join(operationRoot, 'python')
const repositoryUrl = `https://github.com/${lock.authorityRepository}.git`

try {
  await mkdir(checkout)
  run('git', ['init', '--quiet'], { cwd: checkout })
  run('git', ['remote', 'add', 'origin', repositoryUrl], { cwd: checkout })
  run('git', ['fetch', '--depth=1', 'origin', lock.sourceCommitSHA], { cwd: checkout })
  run('git', ['checkout', '--detach', '--quiet', 'FETCH_HEAD'], { cwd: checkout })
  const checkedOutCommit = run('git', ['rev-parse', 'HEAD'], { cwd: checkout, echo: false }).trim()
  requireCondition(checkedOutCommit === lock.sourceCommitSHA, `checked out ${checkedOutCommit}, expected ${lock.sourceCommitSHA}`)

  const contractRoot = path.join(checkout, ...lock.contractRoot.split('/'))
  const standardVersion = (await readFile(path.join(contractRoot, 'STANDARD_VERSION'), 'utf8')).trim()
  const expectedSchemaLine = (await readFile(path.join(contractRoot, 'SCHEMASET.sha256'), 'utf8')).trim()
  const expectedSchemaHash = expectedSchemaLine.split(/\s+/u)[0]
  const packageJson = JSON.parse(await readFile(path.join(contractRoot, 'package.json'), 'utf8'))
  const actualSchemaHash = await computeSchemaSetHash(path.join(contractRoot, 'schemas', lock.standardVersion))

  requireCondition(standardVersion === lock.standardVersion, `standard version ${standardVersion} does not match lock ${lock.standardVersion}`)
  requireCondition(packageJson.name === lock.packageName, `package name ${packageJson.name} does not match lock ${lock.packageName}`)
  requireCondition(packageJson.version === lock.packageVersion, `package version ${packageJson.version} does not match lock ${lock.packageVersion}`)
  requireCondition(expectedSchemaHash === lock.schemaSetSha256, `SCHEMASET file ${expectedSchemaHash} does not match lock ${lock.schemaSetSha256}`)
  requireCondition(actualSchemaHash === lock.schemaSetSha256, `computed Schema Set ${actualSchemaHash} does not match lock ${lock.schemaSetSha256}`)

  const pythonCommand = process.platform === 'win32' ? 'python' : 'python3'
  run(pythonCommand, ['-m', 'venv', pythonEnvironment])
  const pythonBin = process.platform === 'win32'
    ? path.join(pythonEnvironment, 'Scripts')
    : path.join(pythonEnvironment, 'bin')
  const pythonExecutable = process.platform === 'win32'
    ? path.join(pythonBin, 'python.exe')
    : path.join(pythonBin, 'python3')
  run(pythonExecutable, ['-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', 'jsonschema==4.26.0', 'referencing==0.37.0'])
  const contractEnv = {
    ...process.env,
    PATH: `${pythonBin}${path.delimiter}${process.env.PATH ?? ''}`,
  }

  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: contractRoot, env: contractEnv })
  run('npm', ['test'], { cwd: contractRoot, env: contractEnv })
  const verification = run('npm', ['run', 'verify'], { cwd: contractRoot, env: contractEnv })
  requireCondition(verification.includes(lock.successMarker), `Contract verification did not print ${lock.successMarker}`)

  await mkdir(packDestination, { recursive: true })
  const packed = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packDestination], {
    cwd: contractRoot,
    env: contractEnv,
    echo: false,
  }))
  requireCondition(Array.isArray(packed) && packed.length === 1, 'npm pack returned an unexpected result')
  const generatedTarball = path.join(packDestination, packed[0].filename)
  const expectedTarballName = path.basename(lock.installation.tarballPath)
  requireCondition(path.basename(generatedTarball) === expectedTarballName, `tarball name ${path.basename(generatedTarball)} does not match ${expectedTarballName}`)

  const tarballSha256 = await digestFile(generatedTarball, 'sha256')
  const tarballSha512Base64 = await digestFile(generatedTarball, 'sha512', 'base64')
  const tarballStat = await stat(generatedTarball)
  const artifact = {
    schemaVersion: 1,
    standardName: lock.standardName,
    standardVersion: lock.standardVersion,
    packageName: lock.packageName,
    packageVersion: lock.packageVersion,
    authorityRepository: lock.authorityRepository,
    sourceCommitSHA: lock.sourceCommitSHA,
    schemaSetSha256: lock.schemaSetSha256,
    tarballPath: lock.installation.tarballPath,
    sizeBytes: tarballStat.size,
    sha256: tarballSha256,
    integrity: `sha512-${tarballSha512Base64}`,
  }

  const finalTarball = path.join(root, ...lock.installation.tarballPath.split('/'))
  const finalMetadata = path.join(root, ...lock.installation.artifactMetadataPath.split('/'))
  await mkdir(path.dirname(finalTarball), { recursive: true })

  let committedArtifact
  try {
    committedArtifact = JSON.parse(await readFile(finalMetadata, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (committedArtifact !== undefined) {
    requireCondition(committedArtifact.sourceCommitSHA === artifact.sourceCommitSHA, 'committed artifact source commit drifted')
    requireCondition(committedArtifact.schemaSetSha256 === artifact.schemaSetSha256, 'committed artifact Schema Set drifted')
    requireCondition(committedArtifact.sha256 === artifact.sha256, 'fixed Contract produced a different tarball SHA-256')
    requireCondition(committedArtifact.integrity === artifact.integrity, 'fixed Contract produced a different tarball integrity')
  }

  const temporaryTarball = `${finalTarball}.tmp`
  await copyFile(generatedTarball, temporaryTarball)
  await rename(temporaryTarball, finalTarball)
  await writeFile(finalMetadata, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')

  if (!skipInstall) run('pnpm', ['install', '--frozen-lockfile'], { cwd: root, stdio: 'inherit' })

  console.log('PRESENTATION_CONTRACT_PREPARE_PASS')
  console.log(JSON.stringify({
    sourceCommitSHA: lock.sourceCommitSHA,
    schemaSetSha256: actualSchemaHash,
    tarballPath: lock.installation.tarballPath,
    tarballSha256,
    integrity: artifact.integrity,
    installed: !skipInstall,
  }, null, 2))
} finally {
  if (keepCheckout) console.log(`PRESENTATION_CONTRACT_CHECKOUT=${checkout}`)
  else await rm(operationRoot, { recursive: true, force: true })
}
