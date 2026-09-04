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
const PROBE_COMMAND = '/preplan-presentation-sync --probe'
const SYNC_COMMAND = '/preplan-presentation-sync'
const FORCE_SYNC_COMMAND = '/preplan-presentation-sync --force'
const OPEN_FOLDER_COMMAND = '/preplan-open-project-folder'
const PRESENTATION_TOOL = 'preplanning_sync_presentation_project'
const LEGACY_ROOT_ENV = 'PRE_DESIGN_PRESENTATION_PROJECT_ROOT'
const LEGACY_ROOT = '~/.dsh/presentation-projects'
const UI_VERSION_LABEL = 'Pre 2.0.0 · Project Format 0.1.0'
const VERIFIED_RUNTIME_HEAD = '700a1675ac5801b4ed824b31de48184be2cc1c6c'
const VERIFIED_RUNTIME_RUN_ID = 33835245301
const MANAGED_ROOT_ENTRIES = [
  'project.json', 'rules.json', 'outline.json', 'pages', 'source-materials', 'assets',
]
const PRESERVED_WORKSPACE_ENTRIES = ['layouts', 'all-unrelated-user-files-and-directories']

const sameArray = (left, right) => Array.isArray(left)
  && left.length === right.length
  && left.every((value, index) => value === right[index])

requireCondition(matrix.schemaVersion === 5,
  'version matrix schemaVersion must be 5')
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
  'pre-design 2.0.0 must remain a verified development candidate before release')
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
  pkg.devDependencies?.[PRESENTATION_PACKAGE] === `file:${PRESENTATION_TARBALL}`,
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
const runtime = output?.runtime
requireCondition(output?.status === 'workspace-root-usage-ready-and-verified-on-development-branch',
  'Presentation standard output must be recorded as Workspace-root usage-ready')
requireCondition(output?.contractVersion === PRESENTATION_VERSION,
  'runtime output Contract version mismatch')
requireCondition(output?.verificationStatus === 'workspace-root-runtime-and-full-regression-passed',
  'Workspace-root verification status mismatch')
requireCondition(output?.verifiedHead === VERIFIED_RUNTIME_HEAD,
  'verified Workspace-root runtime code commit mismatch')
requireCondition(output?.verifiedWorkflow?.name === 'Pre 2.0.0 Integration',
  'verified runtime workflow name mismatch')
requireCondition(output?.verifiedWorkflow?.runId === VERIFIED_RUNTIME_RUN_ID,
  'verified runtime workflow run mismatch')
requireCondition(output?.verifiedWorkflow?.conclusion === 'success',
  'verified runtime workflow must be successful')

requireCondition(runtime?.automaticInitialization === 'workspace-probe-then-create-or-continue',
  'UI must probe the Workspace before creating or continuing')
requireCondition(runtime?.workspaceBinding === 'one-dsh-workspace-one-pre-project-multiple-sessions',
  'Workspace binding model mismatch')
requireCondition(runtime?.primaryProjectRoot === 'SessionHeader.cwd',
  'SessionHeader.cwd must be the primary project root')
requireCondition(runtime?.projectRootMode === 'dsh-workspace-root-is-standard-project-root',
  'DSH Workspace must be the standard project root')
requireCondition(sameArray(runtime?.managedRootEntries, MANAGED_ROOT_ENTRIES),
  'Pre-managed Workspace root entries mismatch')
requireCondition(sameArray(runtime?.preservedWorkspaceEntries, PRESERVED_WORKSPACE_ENTRIES),
  'preserved Workspace entries mismatch')
requireCondition(runtime?.legacyFallbackProjectRoot === LEGACY_ROOT,
  'legacy fallback root mismatch')
requireCondition(runtime?.legacyFallbackEnvironmentVariable === LEGACY_ROOT_ENV,
  'legacy fallback environment variable mismatch')
requireCondition(runtime?.defaultProjectRoot === undefined,
  'user-level Presentation directory must not remain the default project root')
requireCondition(runtime?.probeCommand === PROBE_COMMAND,
  'Workspace probe command mismatch')
requireCondition(runtime?.syncCommand === SYNC_COMMAND,
  'Presentation sync command mismatch')
requireCondition(runtime?.forceSyncCommand === FORCE_SYNC_COMMAND,
  'Presentation force-sync command mismatch')
requireCondition(runtime?.openFolderCommand === OPEN_FOLDER_COMMAND,
  'Workspace open-folder command mismatch')
requireCondition(runtime?.agentTool === PRESENTATION_TOOL,
  'Presentation Agent tool mismatch')
requireCondition(runtime?.workspaceDraftPersistence === 'localStorage-per-workspace',
  'Workspace UI draft persistence mismatch')
requireCondition(runtime?.uiVersionLabel === UI_VERSION_LABEL,
  'UI version label mismatch')
requireCondition(runtime?.presentationConsumption === 'open-current-dsh-workspace-root',
  'Presentation consumption boundary must use the current DSH Workspace root')
requireCondition(matrix.implementation?.releaseStatus === 'not-merged-not-published',
  'Pre 2.0.0 release status must remain not merged and not published')

const requiredFiles = [
  'src/version.ts',
  'src/client/VersionFooter.tsx',
  'src/client/workspace-draft.ts',
  'src/presentation/standard-contract.ts',
  'src/presentation/standard-project-adapter.ts',
  'src/presentation/standard-project-writer.ts',
  'src/presentation/workspace-project-writer.ts',
  'src/presentation/workspace-context.ts',
  'src/presentation/open-directory.ts',
  'src/presentation/standard-project-service.ts',
  'src/presentation/runtime-integration.ts',
  'src/presentation/identity-ledger.ts',
  'src/presentation/binding-domain.ts',
  'src/presentation/binding-repository.ts',
  'scripts/prepare-presentation-contract.mjs',
  'scripts/prepare-presentation-contract-runtime-assets.mjs',
  'scripts/verify-presentation-contract-lock.mjs',
  'scripts/verify-presentation-standard-integration.mjs',
  'tests/presentation-workspace-runtime.spec.ts',
  'tests/workspace-project-root.spec.ts',
  'tests/presentation-standard-workspace-recovery.spec.ts',
  'tests/direct-start-workspace.client.spec.ts',
  'tests/workspace-form-draft.client.spec.tsx',
  'tests/workspace-open-folder-ui.client.spec.tsx',
  'handoff/PRE_DESIGN_PRESENTATION_STANDARD_PROJECT_V0.1.0_IMPLEMENTATION.md',
  'docs/superpowers/specs/2026-09-04-pre-v2.0.0-workspace-root-and-ui-recovery-design.md',
  'docs/superpowers/plans/2026-09-04-pre-v2.0.0-workspace-root-and-ui-recovery.md',
  '.github/workflows/presentation-standard-project-integration.yml',
]
for (const path of requiredFiles) {
  requireCondition(existsSync(resolve(root, path)), `required Pre 2.0.0 file is missing: ${path}`)
}

const readRequired = path => existsSync(resolve(root, path)) ? read(path) : ''
const readme = readRequired('README.md')
const handoff = readRequired('HANDOFF.md')
const detailedHandoff = readRequired('handoff/PRE_DESIGN_PRESENTATION_STANDARD_PROJECT_V0.1.0_IMPLEMENTATION.md')
const versioning = readRequired('docs/VERSIONING.md')
const workflow = readRequired('.github/workflows/presentation-standard-project-integration.yml')
const host = readRequired('src/index.ts')
const runtimeSource = readRequired('src/presentation/runtime-integration.ts')
const workspaceContext = readRequired('src/presentation/workspace-context.ts')
const workspaceWriter = readRequired('src/presentation/workspace-project-writer.ts')
const bindingRepository = readRequired('src/presentation/binding-repository.ts')
const directStart = readRequired('src/client/direct-start.ts')
const client = readRequired('src/client/index.tsx')
const projectForm = readRequired('src/client/PreplanningProjectForm.tsx')
const statusCard = readRequired('src/client/PreplanningStatusCard.tsx')
const draftStore = readRequired('src/client/workspace-draft.ts')
const versionSource = readRequired('src/version.ts')
const systemPrompt = readRequired('src/prompts/preplanning-system.ts')
const runtimeTest = readRequired('tests/host-apply.spec.ts')

for (const [path, text] of [
  ['README.md', readme],
  ['HANDOFF.md', handoff],
  ['docs/VERSIONING.md', versioning],
  ['detailed handoff', detailedHandoff],
]) {
  requireCondition(text.includes('feat/pre-v2.0.0'),
    `${path} must point to the current Pre development branch`)
  requireCondition(text.includes('2.0.0'),
    `${path} must state the Pre 2.0.0 product version`)
  requireCondition(text.includes(PRESENTATION_STANDARD),
    `${path} must identify the external Presentation Contract`)
  requireCondition(text.includes(PRESENTATION_VERSION),
    `${path} must state the external Contract version independently`)
  requireCondition(text.includes('SessionHeader.cwd'),
    `${path} must identify the DSH Workspace root source`)
  requireCondition(text.includes(OPEN_FOLDER_COMMAND),
    `${path} must document the Workspace open-folder command`)
  requireCondition(text.includes(PROBE_COMMAND),
    `${path} must document Workspace probing`)
  requireCondition(text.includes(UI_VERSION_LABEL),
    `${path} must document the visible version label`)
}

requireCondition(readme.includes('layouts/') && readme.includes('不会被 Pre'),
  'README must document layouts and unrelated Workspace file preservation')
requireCondition(handoff.includes(VERIFIED_RUNTIME_HEAD) && handoff.includes(String(VERIFIED_RUNTIME_RUN_ID)),
  'HANDOFF must carry verified Workspace-root coordinates')
requireCondition(detailedHandoff.includes(VERIFIED_RUNTIME_HEAD)
  && detailedHandoff.includes(String(VERIFIED_RUNTIME_RUN_ID)),
  'detailed Handoff must carry verified Workspace-root coordinates')

requireCondition(workflow.includes(`- ${DEVELOPMENT_BRANCH}`),
  'integration workflow must run on feat/pre-v2.0.0')
requireCondition(workflow.includes("tests/workspace-*.tsx"),
  'integration workflow must watch Workspace UI tests')
requireCondition(workflow.includes('Run standard-project and Workspace output tests'),
  'targeted workflow must run the Workspace output suite')
requireCondition(!workflow.includes('- feat/presentation-standard-project-v0.1.0-integration'),
  'integration workflow must not use a superseded Presentation-named Pre branch')

const targetedScript = pkg.scripts?.['test:presentation-standard'] ?? ''
for (const testPath of [
  'tests/presentation-workspace-runtime.spec.ts',
  'tests/workspace-project-root.spec.ts',
  'tests/direct-start-workspace.client.spec.ts',
  'tests/workspace-form-draft.client.spec.tsx',
  'tests/workspace-open-folder-ui.client.spec.tsx',
]) {
  requireCondition(targetedScript.includes(testPath),
    `targeted Presentation test command must include ${testPath}`)
}

requireCondition(host.includes('registerPresentationRuntime'),
  'Host must register the Presentation runtime integration')
requireCondition(host.includes('PresentationStandardProjectService'),
  'Host must create the Presentation standard project service')
requireCondition(host.includes(LEGACY_ROOT_ENV),
  'Host must retain the explicit legacy project-root environment variable')
requireCondition(runtimeSource.includes("name: 'preplan-presentation-sync'"),
  'runtime integration must register the sync command')
requireCondition(runtimeSource.includes("name: 'preplan-open-project-folder'"),
  'runtime integration must register the open-folder command')
requireCondition(runtimeSource.includes('PRE_DESIGN_WORKSPACE_EMPTY'),
  'runtime integration must publish the empty Workspace marker')
requireCondition(runtimeSource.includes('PRE_DESIGN_WORKSPACE_PROJECT_ATTACHED'),
  'runtime integration must publish the attached Workspace marker')
requireCondition(runtimeSource.includes('session-not-bound'),
  'Workspace probe must preserve legacy Session-bound project recovery')
requireCondition(runtimeSource.includes(`name: '${PRESENTATION_TOOL}'`),
  'runtime integration must register the Agent sync tool')
requireCondition(runtimeSource.includes('confirmExternalChanges'),
  'runtime integration must preserve explicit external-change confirmation')
requireCondition(workspaceContext.includes('session?.header?.cwd')
  && workspaceContext.includes('realpath'),
  'Workspace resolution must use SessionHeader.cwd and realpath')
requireCondition(workspaceWriter.includes("'project.json'")
  && workspaceWriter.includes("'source-materials'")
  && workspaceWriter.includes("'assets'"),
  'Workspace writer must enumerate Pre-managed root entries')
requireCondition(workspaceWriter.includes("join(directoryRoot, 'layouts')"),
  'Workspace writer must preserve or create layouts without replacing it')
requireCondition(bindingRepository.includes('findByWorkspaceRoot'),
  'binding repository must resolve projects by Workspace root')
requireCondition(directStart.includes(`execute('${PROBE_COMMAND}')`),
  'UI direct start must probe the Workspace before project creation')
requireCondition(client.includes('useWorkspacePath') && client.includes('sessions.list'),
  'Browser plugin must read the current Session Workspace path')
requireCondition(projectForm.includes('loadWorkspaceDraft')
  && projectForm.includes('saveWorkspaceDraft')
  && projectForm.includes('clearWorkspaceDraft'),
  'new-project form must persist Workspace-scoped draft input')
requireCondition(projectForm.includes('打开项目文件夹'),
  'new-project form must expose the Workspace folder action')
requireCondition(statusCard.includes('打开项目文件夹'),
  'project status card must expose the Workspace folder action')
requireCondition(draftStore.includes('pre-design:v2:workspace-draft:'),
  'Workspace draft storage namespace mismatch')
requireCondition(versionSource.includes("PRE_DESIGN_VERSION = '2.0.0'"),
  'central Pre UI version constant mismatch')
requireCondition(versionSource.includes("PRESENTATION_PROJECT_FORMAT_VERSION = '0.1.0'"),
  'central project-format UI version constant mismatch')
requireCondition(systemPrompt.includes(PRESENTATION_TOOL),
  'system prompt must teach the Agent to perform the Presentation handoff')
requireCondition(runtimeTest.includes('PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS'),
  'real Host test must assert the Presentation Contract success marker')

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
  workspaceBinding: runtime.workspaceBinding,
  primaryProjectRoot: runtime.primaryProjectRoot,
  probeCommand: runtime.probeCommand,
  syncCommand: runtime.syncCommand,
  openFolderCommand: runtime.openFolderCommand,
  uiVersionLabel: runtime.uiVersionLabel,
  verifiedCodeHead: output.verifiedHead,
  verifiedWorkflowRunId: output.verifiedWorkflow.runId,
  releaseStatus: matrix.implementation.releaseStatus,
}, null, 2))
