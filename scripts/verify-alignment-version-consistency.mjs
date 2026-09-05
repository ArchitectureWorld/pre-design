import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const json = path => JSON.parse(read(path))
const exists = path => existsSync(resolve(root, path))
const failures = []
const requireCondition = (condition, message) => {
  if (!condition) failures.push(message)
}

const PRE_VERSION = '2.0.0'
const PRE_PACKAGE = '@architectureworld/dsh-preplanning-agent'
const ARCHITECTURE_BRANCH = 'architecture/pre-v2.0.0'
const DEVELOPMENT_BRANCH = 'feat/pre-v2.0.0'
const NODE_BASELINE = '>=24.11.0'
const PRESENTATION_STANDARD = 'Presentation Standard Project Directory'
const PRESENTATION_VERSION = '0.1.0'
const PRESENTATION_PACKAGE = '@architectureworld/presentation-contracts'
const PRESENTATION_COMMIT = '974668d308728386ea005c9e77d58ebff9372f0a'
const PRESENTATION_SCHEMASET = '5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc'
const PRESENTATION_LOCK = 'docs/contracts/presentation-standard-project-v0.1.0-lock.json'
const PRESENTATION_TARBALL = 'vendor/presentation-contracts/architectureworld-presentation-contracts-0.1.0.tgz'
const PRESENTATION_ARTIFACT = 'vendor/presentation-contracts/contract-artifact.json'

const matrix = json('docs/version-matrix.json')
const pkg = json('package.json')
const lockfile = read('pnpm-lock.yaml')

requireCondition(Number.isInteger(matrix.schemaVersion) && matrix.schemaVersion >= 5,
  'version matrix schemaVersion must be at least 5')
requireCondition(matrix.repository === 'ArchitectureWorld/pre-design',
  'version matrix must identify ArchitectureWorld/pre-design')
requireCondition(matrix.product?.name === 'pre-design',
  'product name must be pre-design')
requireCondition(matrix.product?.version === PRE_VERSION,
  'Pre product version must remain 2.0.0')
requireCondition(matrix.product?.packageName === PRE_PACKAGE,
  'Pre package name mismatch')
requireCondition(matrix.product?.packageVersion === PRE_VERSION,
  'Pre package version must remain 2.0.0')
requireCondition(matrix.product?.publishedTag === null,
  'Pre 2.0.0 must remain unpublished')
requireCondition(matrix.activeBranches?.architecture === ARCHITECTURE_BRANCH,
  `architecture branch must remain ${ARCHITECTURE_BRANCH}`)
requireCondition(matrix.activeBranches?.development === DEVELOPMENT_BRANCH,
  `development branch must remain ${DEVELOPMENT_BRANCH}`)

requireCondition(pkg.name === PRE_PACKAGE, 'package.json name mismatch')
requireCondition(pkg.version === PRE_VERSION, 'package.json version mismatch')
requireCondition(pkg.engines?.node === NODE_BASELINE,
  `package.json must declare Node.js ${NODE_BASELINE}`)
requireCondition(pkg.devDependencies?.[PRESENTATION_PACKAGE] === `file:${PRESENTATION_TARBALL}`,
  'package.json must pin the immutable Contract tarball')
requireCondition(lockfile.includes('architectureworld-presentation-contracts-0.1.0.tgz'),
  'pnpm lockfile must pin Contract 0.1.0')

const external = matrix.externalContracts?.presentationProjectFormat
requireCondition(external?.relationship === 'decoupled-external-contract',
  'Presentation format must remain a decoupled external Contract')
requireCondition(external?.standardName === PRESENTATION_STANDARD,
  'Presentation Contract name mismatch')
requireCondition(external?.standardVersion === PRESENTATION_VERSION,
  'Presentation Contract version must remain 0.1.0')
requireCondition(external?.authorityRepository === 'ArchitectureWorld/presentation-tools',
  'Presentation Contract authority repository mismatch')
requireCondition(external?.sourceCommitSHA === PRESENTATION_COMMIT,
  'Presentation Contract source commit changed')
requireCondition(external?.packageName === PRESENTATION_PACKAGE,
  'Presentation Contract package name mismatch')
requireCondition(external?.packageVersion === PRESENTATION_VERSION,
  'Presentation Contract package version mismatch')
requireCondition(external?.schemaSetSha256 === PRESENTATION_SCHEMASET,
  'Presentation Contract Schema Set changed')
requireCondition(external?.lockFile === PRESENTATION_LOCK,
  'Presentation Contract lock path mismatch')
requireCondition(external?.lockStatus === 'locked',
  'Presentation Contract must remain locked')

for (const path of [PRESENTATION_LOCK, PRESENTATION_TARBALL, PRESENTATION_ARTIFACT, 'SCHEMASET.sha256']) {
  requireCondition(exists(path), `required immutable Contract artifact is missing: ${path}`)
}
if (exists(PRESENTATION_LOCK)) {
  const lock = json(PRESENTATION_LOCK)
  requireCondition(lock.standardName === PRESENTATION_STANDARD, 'Contract lock name mismatch')
  requireCondition(lock.standardVersion === PRESENTATION_VERSION, 'Contract lock version mismatch')
  requireCondition(lock.sourceCommitSHA === PRESENTATION_COMMIT, 'Contract lock source commit mismatch')
  requireCondition(lock.schemaSetSha256 === PRESENTATION_SCHEMASET, 'Contract lock Schema Set mismatch')
}
if (exists(PRESENTATION_ARTIFACT)) {
  const artifact = json(PRESENTATION_ARTIFACT)
  requireCondition(artifact.standardVersion === PRESENTATION_VERSION,
    'packed Contract version mismatch')
  requireCondition(artifact.sourceCommitSHA === PRESENTATION_COMMIT,
    'packed Contract source commit mismatch')
  requireCondition(artifact.schemaSetSha256 === PRESENTATION_SCHEMASET,
    'packed Contract Schema Set mismatch')
}
if (exists('SCHEMASET.sha256')) {
  const runtimeSchemaSet = read('SCHEMASET.sha256').trim().split(/\s+/u)[0]
  requireCondition(runtimeSchemaSet === PRESENTATION_SCHEMASET,
    'runtime Contract Schema Set hash changed')
}

const requiredFiles = [
  'src/presentation/workspace-managed-paths.ts',
  'src/presentation/workspace-project-identity.ts',
  'src/presentation/workspace-write-transaction.ts',
  'src/presentation/workspace-project-writer.ts',
  'src/presentation/standard-project-service.ts',
  'tests/helpers/shared-workspace-fixture.ts',
  'tests/presentation-workspace-ownership.spec.ts',
  'tests/presentation-workspace-identity.spec.ts',
  'tests/presentation-workspace-transaction.spec.ts',
  'docs/superpowers/specs/2026-09-05-pre-design-shared-workspace-safe-write-design.md',
  'docs/superpowers/plans/2026-09-05-pre-design-shared-workspace-safe-write.md',
  '.github/workflows/presentation-standard-project-integration.yml',
]
for (const path of requiredFiles) {
  requireCondition(exists(path), `shared Workspace safety file is missing: ${path}`)
}

const managedPaths = exists('src/presentation/workspace-managed-paths.ts')
  ? read('src/presentation/workspace-managed-paths.ts') : ''
const identity = exists('src/presentation/workspace-project-identity.ts')
  ? read('src/presentation/workspace-project-identity.ts') : ''
const transaction = exists('src/presentation/workspace-write-transaction.ts')
  ? read('src/presentation/workspace-write-transaction.ts') : ''
const writer = exists('src/presentation/workspace-project-writer.ts')
  ? read('src/presentation/workspace-project-writer.ts') : ''
const service = exists('src/presentation/standard-project-service.ts')
  ? read('src/presentation/standard-project-service.ts') : ''
const host = read('src/index.ts')
const workflow = read('.github/workflows/presentation-standard-project-integration.yml')
const ownershipTest = read('tests/presentation-workspace-ownership.spec.ts')
const identityTest = read('tests/presentation-workspace-identity.spec.ts')
const transactionTest = read('tests/presentation-workspace-transaction.spec.ts')

for (const path of [
  'project.json',
  'rules.json',
  'outline.json',
  'pages/manifest.json',
  'source-materials/manifest.json',
  'assets/manifest.json',
]) {
  requireCondition(managedPaths.includes(`'${path}'`),
    `exact Pre-managed path is missing from ownership source: ${path}`)
}
requireCondition(managedPaths.includes("PRESENTATION_LAYOUTS_ROOT = 'layouts'"),
  'layouts ownership boundary is missing')
requireCondition(managedPaths.includes('EXTERNAL_PATH_MODIFICATION_FORBIDDEN'),
  'layouts write protection error is missing')
requireCondition(writer.includes('managedPathSetFromBuild')
  && writer.includes('readExistingPreDesignManagedPathSet'),
  'Workspace writer must use exact manifest-derived ownership sets')
requireCondition(writer.includes('acquirePresentationWorkspaceTransaction')
  && writer.includes('transaction.commit'),
  'Workspace writer must use the persistent file transaction')
requireCondition(!/rm\s*\(\s*directoryRoot\s*,\s*\{\s*recursive/u.test(writer),
  'Workspace writer must not recursively delete the project root')
requireCondition(!/rename\s*\([^\n]*directoryRoot/u.test(writer),
  'Workspace writer must not rename or replace the project root')
requireCondition(identity.includes('PROJECT_ID_CONFLICT')
  && identity.includes('PROJECT_ID_MISSING')
  && identity.includes('PROJECT_ID_INVALID'),
  'single projectId authority errors are incomplete')
requireCondition(transaction.includes('WORKSPACE_WRITE_LOCKED')
  && transaction.includes('WORKSPACE_RECOVERY_FAILED')
  && transaction.includes('journal.json')
  && transaction.includes('owner.json'),
  'Workspace lock, journal, or recovery implementation is incomplete')
requireCondition(service.includes('readWorkspaceProjectId')
  && service.includes('authoritativeProjectId'),
  'standard project service must restore projectId from project.json')
requireCondition(host.includes('recoverBoundWorkspaces'),
  'Host startup must recover abandoned Workspace transactions')

const workspaceSafetyScript = pkg.scripts?.['test:workspace-safety'] ?? ''
for (const testPath of [
  'tests/presentation-workspace-ownership.spec.ts',
  'tests/presentation-workspace-identity.spec.ts',
  'tests/presentation-workspace-transaction.spec.ts',
]) {
  requireCondition(workspaceSafetyScript.includes(testPath),
    `workspace safety command must include ${testPath}`)
}
requireCondition(workflow.includes('ubuntu-latest') && workflow.includes('windows-latest'),
  'Workspace safety CI must run on Ubuntu and Windows')
requireCondition(workflow.includes('node-version: 24.11.0'),
  'Workspace safety CI must pin Node.js 24.11.0')
requireCondition(workflow.includes('pnpm test:workspace-safety'),
  'Workspace safety CI entry point is missing')
requireCondition(workflow.includes(`- ${DEVELOPMENT_BRANCH}`),
  'integration workflow must run on the current Pre branch')
requireCondition(workflow.includes('Run standard-project and Workspace output tests'),
  'targeted workflow must retain the standard Workspace output gate')

requireCondition(ownershipTest.includes('future-component/unknown.bin')
  && ownershipTest.includes('third-party-extension/custom.json')
  && ownershipTest.includes('mtimeNanoseconds'),
  'ownership tests must prove byte preservation and no-op writes')
requireCondition(identityTest.includes('PROJECT_ID_CONFLICT')
  && identityTest.includes('PROJECT_ID_MISSING')
  && identityTest.includes('PROJECT_ID_INVALID'),
  'projectId safety tests are incomplete')
requireCondition(transactionTest.includes('WORKSPACE_TRANSACTION_FAILED')
  && transactionTest.includes('WORKSPACE_WRITE_LOCKED')
  && transactionTest.includes('recoverPresentationWorkspaceTransaction'),
  'transaction rollback, lock, and restart tests are incomplete')

requireCondition(matrix.implementation?.releaseStatus === 'not-merged-not-published',
  'Pre release status must remain not merged and not published')

if (failures.length > 0) {
  console.error('PRE_DESIGN_V2_0_0_VERSION_CONSISTENCY_FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('PRE_DESIGN_V2_0_0_VERSION_CONSISTENCY_PASS')
console.log(JSON.stringify({
  product: `${matrix.product.name}@${matrix.product.version}`,
  package: `${pkg.name}@${pkg.version}`,
  node: pkg.engines.node,
  architectureBranch: matrix.activeBranches.architecture,
  developmentBranch: matrix.activeBranches.development,
  externalContract: `${external.standardName}@${external.standardVersion}`,
  externalContractCommit: external.sourceCommitSHA,
  schemaSetSha256: external.schemaSetSha256,
  workspaceSafetyCommand: 'pnpm test:workspace-safety',
  releaseStatus: matrix.implementation.releaseStatus,
}, null, 2))
