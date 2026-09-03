import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const json = path => JSON.parse(read(path))
const matrix = json('docs/version-matrix.json')
const pkg = json('package.json')
const lockfile = read('pnpm-lock.yaml')
const failures = []

const requireCondition = (condition, message) => {
  if (!condition) failures.push(message)
}

const PRE_VERSION = '2.0.0'
const PRE_PACKAGE = '@architectureworld/dsh-preplanning-agent'
const ARCHITECTURE_BRANCH = 'architecture/pre-v2.0.0'
const DEVELOPMENT_BRANCH = 'feat/pre-v2.0.0'
const PRESENTATION_STANDARD = 'Presentation Standard Project Directory'
const PRESENTATION_VERSION = '0.1.0'
const PRESENTATION_PACKAGE = '@architectureworld/presentation-contracts'
const PRESENTATION_COMMIT = '974668d308728386ea005c9e77d58ebff9372f0a'
const PRESENTATION_SCHEMASET = '5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc'
const PRESENTATION_LOCK = 'docs/contracts/presentation-standard-project-v0.1.0-lock.json'
const PRESENTATION_TARBALL = 'vendor/presentation-contracts/architectureworld-presentation-contracts-0.1.0.tgz'
const PRESENTATION_ARTIFACT = 'vendor/presentation-contracts/contract-artifact.json'
const VERIFIED_CODE_HEAD = 'c44699b5b0adccac5168d0205e579d898ca02013'
const VERIFIED_RUN_ID = 33725698031

requireCondition(matrix.schemaVersion === 3,
  'version matrix schemaVersion must be 3')
requireCondition(matrix.repository === 'ArchitectureWorld/pre-design',
  'version matrix must identify the pre-design repository')
requireCondition(matrix.product?.name === 'pre-design',
  'product name must be pre-design')
requireCondition(matrix.product?.version === PRE_VERSION,
  'pre-design product version must be 2.0.0')
requireCondition(matrix.product?.packageName === PRE_PACKAGE,
  'pre-design package name mismatch')
requireCondition(matrix.product?.packageVersion === PRE_VERSION,
  'pre-design package version must be 2.0.0')
requireCondition(matrix.product?.status === 'verified-development-candidate',
  'pre-design 2.0.0 must be recorded as a verified development candidate')
requireCondition(matrix.product?.publishedTag === null,
  'pre-design 2.0.0 must not claim a published tag')

requireCondition(matrix.activeBranches?.architecture === ARCHITECTURE_BRANCH,
  `active architecture branch must be ${ARCHITECTURE_BRANCH}`)
requireCondition(matrix.activeBranches?.development === DEVELOPMENT_BRANCH,
  `active development branch must be ${DEVELOPMENT_BRANCH}`)
requireCondition(!matrix.activeBranches?.architecture?.includes('presentation'),
  'active Pre architecture branch must not be named after Presentation')
requireCondition(!matrix.activeBranches?.development?.includes('presentation'),
  'active Pre development branch must not be named after Presentation')

requireCondition(pkg.name === PRE_PACKAGE,
  'package.json name must match the Pre product package')
requireCondition(pkg.version === PRE_VERSION,
  'package.json version must be 2.0.0')
requireCondition(pkg.engines?.node === '>=22.0.0',
  'Pre 2.0.0 must declare Node.js >=22.0.0')

const external = matrix.externalContracts?.presentationProjectFormat
requireCondition(external?.relationship === 'decoupled-external-contract',
  'Presentation project format must be recorded as a decoupled external Contract')
requireCondition(external?.standardName === PRESENTATION_STANDARD,
  'Presentation standard name mismatch')
requireCondition(external?.standardVersion === PRESENTATION_VERSION,
  'Presentation standard version must be 0.1.0')
requireCondition(external?.authorityRepository === 'ArchitectureWorld/presentation-tools',
  'Presentation Contract authority repository mismatch')
requireCondition(external?.sourceCommitSHA === PRESENTATION_COMMIT,
  'Presentation Contract source commit mismatch')
requireCondition(external?.contractRoot === 'contracts/presentation-standard-project',
  'Presentation Contract root mismatch')
requireCondition(external?.packageName === PRESENTATION_PACKAGE,
  'Presentation Contract package name mismatch')
requireCondition(external?.packageVersion === PRESENTATION_VERSION,
  'Presentation Contract package version mismatch')
requireCondition(external?.schemaSetSha256 === PRESENTATION_SCHEMASET,
  'Presentation Schema Set SHA-256 mismatch')
requireCondition(external?.lockFile === PRESENTATION_LOCK,
  'Presentation Contract lock path mismatch')
requireCondition(external?.lockStatus === 'locked',
  'Presentation Contract must be locked')

requireCondition(existsSync(resolve(root, PRESENTATION_LOCK)),
  'Presentation Contract lock file is missing')
requireCondition(existsSync(resolve(root, PRESENTATION_TARBALL)),
  'fixed Presentation Contract tarball is missing')
requireCondition(existsSync(resolve(root, PRESENTATION_ARTIFACT)),
  'Presentation Contract artifact metadata is missing')

if (existsSync(resolve(root, PRESENTATION_LOCK))) {
  const lock = json(PRESENTATION_LOCK)
  requireCondition(lock.standardName === PRESENTATION_STANDARD,
    'Contract lock standard name mismatch')
  requireCondition(lock.standardVersion === PRESENTATION_VERSION,
    'Contract lock standard version mismatch')
  requireCondition(lock.sourceCommitSHA === PRESENTATION_COMMIT,
    'Contract lock source commit mismatch')
  requireCondition(lock.packageName === PRESENTATION_PACKAGE,
    'Contract lock package name mismatch')
  requireCondition(lock.packageVersion === PRESENTATION_VERSION,
    'Contract lock package version mismatch')
  requireCondition(lock.schemaSetSha256 === PRESENTATION_SCHEMASET,
    'Contract lock Schema Set SHA-256 mismatch')
  requireCondition(lock.schemaAuthorityExclusions?.includes('feat/report-studio-v0.1.1-hardening'),
    'Contract lock must reject the Report Studio hardening branch as Schema authority')
}

if (existsSync(resolve(root, PRESENTATION_ARTIFACT))) {
  const artifact = json(PRESENTATION_ARTIFACT)
  requireCondition(artifact.standardVersion === PRESENTATION_VERSION,
    'packed Contract artifact standard version mismatch')
  requireCondition(artifact.sourceCommitSHA === PRESENTATION_COMMIT,
    'packed Contract artifact source commit mismatch')
  requireCondition(artifact.schemaSetSha256 === PRESENTATION_SCHEMASET,
    'packed Contract artifact Schema Set mismatch')
  requireCondition(artifact.tarballPath === PRESENTATION_TARBALL,
    'packed Contract artifact path mismatch')
  requireCondition(/^[a-f0-9]{64}$/u.test(artifact.sha256 ?? ''),
    'packed Contract artifact SHA-256 is missing or invalid')
  requireCondition(/^sha512-/u.test(artifact.integrity ?? ''),
    'packed Contract artifact npm integrity is missing')
}

requireCondition(
  pkg.devDependencies?.[PRESENTATION_PACKAGE]
    === `file:${PRESENTATION_TARBALL}`,
  'package.json must pin the exact Contract tarball as a development dependency',
)
requireCondition(lockfile.includes(PRESENTATION_PACKAGE),
  'pnpm lockfile must contain the Presentation Contract package')
requireCondition(lockfile.includes('architectureworld-presentation-contracts-0.1.0.tgz'),
  'pnpm lockfile must pin the immutable Contract tarball')

requireCondition(matrix.legacyContracts?.business === 'v0.6',
  'business Contract line must remain v0.6')
requireCondition(matrix.legacyContracts?.governance === 'v0.7',
  'governance Contract line must remain v0.7')
requireCondition(matrix.historical?.lastPublishedPreDesign?.packageVersion === '0.7.0',
  'historical Pre package baseline must remain 0.7.0')
requireCondition(matrix.historical?.lastPublishedPreDesign?.tag === 'v0.7.0',
  'historical Pre tag must remain v0.7.0')

const implementation = matrix.implementation?.presentationStandardOutput
requireCondition(implementation?.status
    === 'implemented-and-verified-on-development-branch',
  'standard-project output must be recorded as implemented and verified')
requireCondition(implementation?.contractVersion === PRESENTATION_VERSION,
  'verified output must identify Contract version 0.1.0')
requireCondition(implementation?.verificationStatus
    === 'targeted-and-full-regression-passed',
  'verified output must record targeted and full regression success')
requireCondition(implementation?.verifiedHead === VERIFIED_CODE_HEAD,
  'verified output must preserve the first fully green code HEAD')
requireCondition(implementation?.verifiedWorkflow?.name === 'Pre 2.0.0 Integration',
  'verified workflow name mismatch')
requireCondition(implementation?.verifiedWorkflow?.runId === VERIFIED_RUN_ID,
  'verified workflow run ID mismatch')
requireCondition(implementation?.verifiedWorkflow?.conclusion === 'success',
  'verified workflow must record success')
requireCondition(matrix.implementation?.releaseStatus === 'not-merged-not-published',
  'Pre 2.0.0 release status must remain not merged and not published')

const requiredFiles = [
  'src/presentation/standard-contract.ts',
  'src/presentation/standard-project-adapter.ts',
  'src/presentation/standard-project-writer.ts',
  'src/presentation/standard-project-service.ts',
  'src/presentation/identity-ledger.ts',
  'src/presentation/binding-domain.ts',
  'src/presentation/binding-repository.ts',
  'scripts/prepare-presentation-contract.mjs',
  'scripts/verify-presentation-contract-lock.mjs',
  'scripts/verify-presentation-standard-integration.mjs',
  'handoff/PRE_DESIGN_PRESENTATION_STANDARD_PROJECT_V0.1.0_IMPLEMENTATION.md',
  '.github/workflows/presentation-standard-project-integration.yml',
]
for (const path of requiredFiles) {
  requireCondition(existsSync(resolve(root, path)), `required Pre 2.0.0 file is missing: ${path}`)
}

const readRequired = path => existsSync(resolve(root, path)) ? read(path) : ''
const readme = readRequired('README.md')
const handoff = readRequired('HANDOFF.md')
const versioning = readRequired('docs/VERSIONING.md')
const workflow = readRequired('.github/workflows/presentation-standard-project-integration.yml')

for (const [path, text] of [
  ['README.md', readme],
  ['HANDOFF.md', handoff],
  ['docs/VERSIONING.md', versioning],
]) {
  requireCondition(text.includes('pre-v2.0.0'),
    `${path} must point to Pre-named v2.0.0 branches`)
  requireCondition(text.includes('2.0.0'),
    `${path} must state the Pre 2.0.0 product version`)
  requireCondition(text.includes('Presentation Standard Project Directory'),
    `${path} must identify the external Presentation Contract`)
  requireCondition(text.includes('0.1.0'),
    `${path} must state the external Contract version independently`)
}

requireCondition(workflow.includes(`- ${DEVELOPMENT_BRANCH}`),
  'integration workflow must run on feat/pre-v2.0.0')
requireCondition(!workflow.includes('- feat/presentation-standard-project-v0.1.0-integration'),
  'integration workflow must not use the superseded Presentation-named Pre branch')

if (failures.length > 0) {
  console.error('PRE_DESIGN_V2_0_0_VERSION_CONSISTENCY_FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('PRE_DESIGN_V2_0_0_VERSION_CONSISTENCY_PASS')
console.log(JSON.stringify({
  product: `${matrix.product.name}@${matrix.product.version}`,
  package: `${pkg.name}@${pkg.version}`,
  architectureBranch: matrix.activeBranches.architecture,
  developmentBranch: matrix.activeBranches.development,
  externalContract: `${external.standardName}@${external.standardVersion}`,
  externalContractCommit: external.sourceCommitSHA,
  verifiedCodeHead: implementation.verifiedHead,
  verifiedWorkflowRunId: implementation.verifiedWorkflow.runId,
  releaseStatus: matrix.implementation.releaseStatus,
}, null, 2))
