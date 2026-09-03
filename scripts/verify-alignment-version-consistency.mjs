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
const PRESENTATION_COMMAND = '/preplan-presentation-sync'
const PRESENTATION_TOOL = 'preplanning_sync_presentation_project'
const PRESENTATION_ROOT_ENV = 'PRE_DESIGN_PRESENTATION_PROJECT_ROOT'
const PRESENTATION_DEFAULT_ROOT = '~/.dsh/presentation-projects'
const UI_VERSION_LABEL = 'Pre 2.0.0 · Project Format 0.1.0'
const VERIFIED_RUNTIME_HEAD = '521265c541a1d6dacac075849962a4c703530a6d'
const VERIFIED_RUNTIME_RUN_ID = 33741077517
const RUNTIME_ASSET_SCRIPT = 'scripts/prepare-presentation-contract-runtime-assets.mjs'
const RUNTIME_SCHEMASET_PATH = 'SCHEMASET.sha256'
const RUNTIME_SCHEMA_ROOT = 'schemas/0.1.0'
const LIBRARY_FILES_PATTERN = 'lib/**'
const BUILT_RUNTIME_TEST = 'tests/built-presentation-runtime.spec.ts'
const PACK_CONTENTS_TEST = 'tests/built-package.spec.ts'

requireCondition(matrix.schemaVersion === 4,
  'version matrix schemaVersion must be 4')
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
  'pre-design 2.0.0 must be a verified development candidate before release')
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
requireCondition(pkg.files?.includes(LIBRARY_FILES_PATTERN),
  'npm package must include every generated lib file and dynamic chunk')
requireCondition(pkg.files?.includes(RUNTIME_SCHEMASET_PATH),
  'npm package must include the Presentation Contract Schema Set hash')
requireCondition(pkg.files?.includes(`${RUNTIME_SCHEMA_ROOT}/*.schema.json`),
  'npm package must include the Presentation Contract runtime schemas')
requireCondition(pkg.scripts?.['prepare:presentation-runtime-assets']
    === `node ${RUNTIME_ASSET_SCRIPT}`,
  'runtime Contract asset preparation script mismatch')
requireCondition(pkg.scripts?.prebuild === 'pnpm prepare:presentation-runtime-assets',
  'prebuild must prepare the immutable Presentation Contract runtime assets')
requireCondition(pkg.scripts?.prepack === 'pnpm build',
  'prepack must rebuild the package and runtime assets')
requireCondition(pkg.scripts?.['test:built']?.includes(BUILT_RUNTIME_TEST),
  'built-package verification must execute the installed Host runtime regression')

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

const output = matrix.implementation?.presentationStandardOutput
requireCondition(output?.status === 'usage-ready-and-verified-on-development-branch',
  'Presentation standard output must be recorded as usage-ready on the Pre development branch')
requireCondition(output?.contractVersion === PRESENTATION_VERSION,
  'runtime output Contract version mismatch')
requireCondition(output?.verificationStatus === 'runtime-handoff-and-full-regression-passed',
  'runtime handoff verification status mismatch')
requireCondition(output?.verifiedHead === VERIFIED_RUNTIME_HEAD,
  'verified runtime code commit mismatch')
requireCondition(output?.verifiedWorkflow?.name === 'Pre 2.0.0 Integration',
  'verified runtime workflow name mismatch')
requireCondition(output?.verifiedWorkflow?.runId === VERIFIED_RUNTIME_RUN_ID,
  'verified runtime workflow run mismatch')
requireCondition(output?.verifiedWorkflow?.conclusion === 'success',
  'verified runtime workflow must be successful')
requireCondition(output?.runtime?.automaticInitialization === 'ui-create-flow',
  'UI create flow must initialize the Presentation standard project')
requireCondition(output?.runtime?.syncCommand === PRESENTATION_COMMAND,
  'Presentation sync command mismatch')
requireCondition(output?.runtime?.forceSyncCommand === `${PRESENTATION_COMMAND} --force`,
  'Presentation force-sync command mismatch')
requireCondition(output?.runtime?.agentTool === PRESENTATION_TOOL,
  'Presentation Agent tool mismatch')
requireCondition(output?.runtime?.defaultProjectRoot === PRESENTATION_DEFAULT_ROOT,
  'default Presentation project root mismatch')
requireCondition(output?.runtime?.projectRootEnvironmentVariable === PRESENTATION_ROOT_ENV,
  'Presentation project root environment variable mismatch')
requireCondition(output?.runtime?.uiVersionLabel === UI_VERSION_LABEL,
  'UI version label mismatch')
requireCondition(output?.runtime?.presentationConsumption === 'open-or-watch-the-same-project-root',
  'Presentation consumption boundary must require the same project root')
requireCondition(output?.packageRuntime?.status === 'verified',
  'installed package runtime must be recorded as verified')
requireCondition(output?.packageRuntime?.assetPreparationScript === RUNTIME_ASSET_SCRIPT,
  'runtime asset preparation script record mismatch')
requireCondition(output?.packageRuntime?.schemaSetPath === RUNTIME_SCHEMASET_PATH,
  'runtime Schema Set path record mismatch')
requireCondition(output?.packageRuntime?.schemaRoot === RUNTIME_SCHEMA_ROOT,
  'runtime Schema root record mismatch')
requireCondition(output?.packageRuntime?.libraryFilesPattern === LIBRARY_FILES_PATTERN,
  'runtime library packaging pattern record mismatch')
requireCondition(output?.packageRuntime?.builtRuntimeTest === BUILT_RUNTIME_TEST,
  'built runtime test record mismatch')
requireCondition(output?.packageRuntime?.packContentsTest === PACK_CONTENTS_TEST,
  'pack contents test record mismatch')
requireCondition(matrix.implementation?.releaseStatus === 'not-merged-not-published',
  'Pre 2.0.0 release status must remain not merged and not published')

const requiredFiles = [
  'src/version.ts',
  'src/client/VersionFooter.tsx',
  'src/presentation/standard-contract.ts',
  'src/presentation/standard-project-adapter.ts',
  'src/presentation/standard-project-writer.ts',
  'src/presentation/standard-project-service.ts',
  'src/presentation/runtime-integration.ts',
  'src/presentation/identity-ledger.ts',
  'src/presentation/binding-domain.ts',
  'src/presentation/binding-repository.ts',
  'scripts/prepare-presentation-contract.mjs',
  RUNTIME_ASSET_SCRIPT,
  'scripts/verify-presentation-contract-lock.mjs',
  'scripts/verify-presentation-standard-integration.mjs',
  'tests/presentation-runtime-integration.spec.ts',
  'tests/host-apply.spec.ts',
  BUILT_RUNTIME_TEST,
  PACK_CONTENTS_TEST,
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
const host = readRequired('src/index.ts')
const runtime = readRequired('src/presentation/runtime-integration.ts')
const directStart = readRequired('src/client/direct-start.ts')
const projectForm = readRequired('src/client/PreplanningProjectForm.tsx')
const statusCard = readRequired('src/client/PreplanningStatusCard.tsx')
const versionSource = readRequired('src/version.ts')
const systemPrompt = readRequired('src/prompts/preplanning-system.ts')
const runtimeTest = readRequired('tests/host-apply.spec.ts')
const runtimeAssetScript = readRequired(RUNTIME_ASSET_SCRIPT)
const builtRuntimeTest = readRequired(BUILT_RUNTIME_TEST)
const packContentsTest = readRequired(PACK_CONTENTS_TEST)

for (const [path, text] of [
  ['README.md', readme],
  ['HANDOFF.md', handoff],
  ['docs/VERSIONING.md', versioning],
]) {
  requireCondition(text.includes('pre-v2.0.0'),
    `${path} must point to Pre-named v2.0.0 branches`)
  requireCondition(text.includes('2.0.0'),
    `${path} must state the Pre 2.0.0 product version`)
  requireCondition(text.includes(PRESENTATION_STANDARD),
    `${path} must identify the external Presentation Contract`)
  requireCondition(text.includes(PRESENTATION_VERSION),
    `${path} must state the external Contract version independently`)
  requireCondition(text.includes(PRESENTATION_COMMAND),
    `${path} must document the live Presentation sync command`)
  requireCondition(text.includes(PRESENTATION_ROOT_ENV),
    `${path} must document the shared Presentation project root variable`)
  requireCondition(text.includes(UI_VERSION_LABEL),
    `${path} must document the visible version label`)
}

requireCondition(workflow.includes(`- ${DEVELOPMENT_BRANCH}`),
  'integration workflow must run on feat/pre-v2.0.0')
requireCondition(!workflow.includes('- feat/presentation-standard-project-v0.1.0-integration'),
  'integration workflow must not use the superseded Presentation-named Pre branch')
requireCondition(workflow.includes(RUNTIME_ASSET_SCRIPT),
  'integration workflow must watch the runtime Contract asset script')
requireCondition(workflow.includes(BUILT_RUNTIME_TEST),
  'integration workflow must watch the installed Host runtime regression')
requireCondition(workflow.includes(PACK_CONTENTS_TEST),
  'integration workflow must watch the npm pack contents regression')

requireCondition(host.includes('registerPresentationRuntime'),
  'Host must register the Presentation runtime integration')
requireCondition(host.includes('PresentationStandardProjectService'),
  'Host must create the Presentation standard project service')
requireCondition(host.includes(PRESENTATION_ROOT_ENV),
  'Host must support the shared Presentation project root environment variable')
requireCondition(host.includes("'.dsh', 'presentation-projects'"),
  'Host must provide the default Presentation project root')
requireCondition(runtime.includes("name: 'preplan-presentation-sync'"),
  'runtime integration must register the user sync command')
requireCondition(runtime.includes(`name: '${PRESENTATION_TOOL}'`),
  'runtime integration must register the Agent sync tool')
requireCondition(runtime.includes('confirmExternalChanges'),
  'runtime integration must preserve explicit external-change confirmation')
requireCondition(directStart.includes(`await execute('${PRESENTATION_COMMAND}')`),
  'UI direct start must initialize a Presentation standard project')
requireCondition(projectForm.includes('<VersionFooter />'),
  'new-project UI must display the version footer')
requireCondition(statusCard.includes('<VersionFooter />'),
  'status UI must display the version footer')
requireCondition(versionSource.includes("PRE_DESIGN_VERSION = '2.0.0'"),
  'central Pre UI version constant mismatch')
requireCondition(versionSource.includes("PRESENTATION_PROJECT_FORMAT_VERSION = '0.1.0'"),
  'central project-format UI version constant mismatch')
requireCondition(systemPrompt.includes(PRESENTATION_TOOL),
  'system prompt must teach the Agent to perform the Presentation handoff')
requireCondition(runtimeTest.includes('PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS'),
  'real Host test must assert the Presentation Contract success marker')
requireCondition(runtimeTest.includes("readFile(join(directoryRoot, 'project.json')"),
  'real Host test must inspect the emitted standard project on disk')
requireCondition(runtimeAssetScript.includes('PRESENTATION_CONTRACT_RUNTIME_ASSETS_PASS'),
  'runtime asset script must report its verification marker')
requireCondition(runtimeAssetScript.includes('SCHEMASET.sha256'),
  'runtime asset script must copy and verify the Schema Set hash')
requireCondition(builtRuntimeTest.includes("resolve(packageRoot, 'lib/index.js')"),
  'installed Host regression must execute the built Host entry')
requireCondition(builtRuntimeTest.includes('PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS'),
  'installed Host regression must assert successful Presentation validation')
requireCondition(packContentsTest.includes("'SCHEMASET.sha256'"),
  'npm pack regression must assert the Schema Set hash is shipped')
requireCondition(packContentsTest.includes("'schemas/0.1.0/asset-manifest.schema.json'"),
  'npm pack regression must assert Presentation schemas are shipped')

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
  runtimeCommand: output.runtime.syncCommand,
  runtimeTool: output.runtime.agentTool,
  defaultProjectRoot: output.runtime.defaultProjectRoot,
  uiVersionLabel: output.runtime.uiVersionLabel,
  packageRuntimeStatus: output.packageRuntime.status,
  verifiedCodeHead: output.verifiedHead,
  verifiedWorkflowRunId: output.verifiedWorkflow.runId,
  releaseStatus: matrix.implementation.releaseStatus,
}, null, 2))
