import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const readJson = async relativePath => JSON.parse(await readFile(path.join(root, relativePath), 'utf8'))
const lock = await readJson('docs/contracts/presentation-standard-project-v0.1.0-lock.json')
const artifact = await readJson(lock.installation.artifactMetadataPath)
const packageJson = await readJson('package.json')
const lockfile = await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8')
const tarball = path.join(root, ...lock.installation.tarballPath.split('/'))

function requireCondition(condition, message) {
  if (!condition) throw new Error(`PRESENTATION_CONTRACT_LOCK_INVALID: ${message}`)
}

async function digestFile(filePath, algorithm, encoding = 'hex') {
  return createHash(algorithm).update(await readFile(filePath)).digest(encoding)
}

requireCondition(lock.standardName === 'Presentation Standard Project Directory', 'standard name mismatch')
requireCondition(lock.standardVersion === '0.1.0', 'standard version mismatch')
requireCondition(lock.authorityRepository === 'ArchitectureWorld/presentation-tools', 'authority repository mismatch')
requireCondition(lock.sourceCommitSHA === '974668d308728386ea005c9e77d58ebff9372f0a', 'source commit mismatch')
requireCondition(lock.contractRoot === 'contracts/presentation-standard-project', 'contract root mismatch')
requireCondition(lock.packageName === '@architectureworld/presentation-contracts', 'package name mismatch')
requireCondition(lock.packageVersion === '0.1.0', 'package version mismatch')
requireCondition(lock.schemaSetSha256 === '5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc', 'Schema Set mismatch')
requireCondition(lock.successMarker === 'PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS', 'success marker mismatch')
requireCondition(lock.schemaAuthorityExclusions.includes('feat/report-studio-v0.1.1-hardening'), 'hardening branch exclusion missing')

requireCondition(packageJson.name === '@architectureworld/dsh-preplanning-agent', 'pre-design package identity mismatch')
requireCondition(packageJson.version === '2.0.0', 'pre-design product version must be 2.0.0')
requireCondition(packageJson.engines?.node === '>=22.0.0', 'Node.js engine must satisfy the Contract package')
requireCondition(
  packageJson.devDependencies?.[lock.packageName] === `file:${lock.installation.tarballPath}`,
  'Contract dependency must be the exact packed tarball',
)

const tarballStat = await stat(tarball)
const actualSha256 = await digestFile(tarball, 'sha256')
const actualIntegrity = `sha512-${await digestFile(tarball, 'sha512', 'base64')}`
requireCondition(artifact.standardName === lock.standardName, 'artifact standard name mismatch')
requireCondition(artifact.standardVersion === lock.standardVersion, 'artifact standard version mismatch')
requireCondition(artifact.packageName === lock.packageName, 'artifact package name mismatch')
requireCondition(artifact.packageVersion === lock.packageVersion, 'artifact package version mismatch')
requireCondition(artifact.authorityRepository === lock.authorityRepository, 'artifact authority repository mismatch')
requireCondition(artifact.sourceCommitSHA === lock.sourceCommitSHA, 'artifact source commit mismatch')
requireCondition(artifact.schemaSetSha256 === lock.schemaSetSha256, 'artifact Schema Set mismatch')
requireCondition(artifact.tarballPath === lock.installation.tarballPath, 'artifact tarball path mismatch')
requireCondition(artifact.sizeBytes === tarballStat.size, 'artifact byte count mismatch')
requireCondition(artifact.sha256 === actualSha256, 'artifact SHA-256 mismatch')
requireCondition(artifact.integrity === actualIntegrity, 'artifact SHA-512 integrity mismatch')
requireCondition(lockfile.includes(`specifier: file:${lock.installation.tarballPath}`), 'pnpm importer lacks exact file dependency')
requireCondition(lockfile.includes(actualIntegrity), 'pnpm lockfile lacks tarball integrity')

const contract = await import(lock.packageName)
requireCondition(contract.STANDARD_NAME === lock.standardName, 'installed Contract standard name mismatch')
requireCondition(contract.STANDARD_VERSION === lock.standardVersion, 'installed Contract standard version mismatch')
requireCondition(contract.PACKAGE_NAME === lock.packageName, 'installed Contract package name mismatch')
for (const exportName of [
  'createStableId',
  'isStableId',
  'createMinimalProjectDocuments',
  'createProjectDirectoryPlan',
  'validateDocumentWithAjv',
  'validateProjectDirectoryWithAjv',
  'verifySchemaSetHash',
]) {
  requireCondition(typeof contract[exportName] === 'function', `installed Contract export ${exportName} is unavailable`)
}
const schemaCheck = await contract.verifySchemaSetHash()
requireCondition(schemaCheck.valid, `installed Contract Schema Set is invalid: ${JSON.stringify(schemaCheck)}`)
requireCondition(schemaCheck.expectedSha256 === lock.schemaSetSha256, 'installed expected Schema Set mismatch')
requireCondition(schemaCheck.actualSha256 === lock.schemaSetSha256, 'installed actual Schema Set mismatch')

const plan = contract.createProjectDirectoryPlan({ name: 'Contract Lock Probe', projectSlug: 'contract-lock-probe' })
requireCondition(plan.standardVersion === lock.standardVersion, 'Factory standard version mismatch')
requireCondition(Object.keys(plan.documents).length === 6, 'Factory must return six minimum documents')
requireCondition(plan.directoryName === `${plan.projectId}-contract-lock-probe`, 'Factory directory naming mismatch')
requireCondition(contract.isStableId('project', plan.projectId), 'Factory project ID is not Contract-valid')

console.log('PRESENTATION_CONTRACT_LOCK_PASS')
console.log(JSON.stringify({
  preDesignVersion: packageJson.version,
  standardVersion: lock.standardVersion,
  sourceCommitSHA: lock.sourceCommitSHA,
  schemaSetSha256: lock.schemaSetSha256,
  tarballSha256: actualSha256,
  tarballIntegrity: actualIntegrity,
}, null, 2))
