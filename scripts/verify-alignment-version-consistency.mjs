import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const matrix = JSON.parse(read('docs/version-matrix.json'))
const pkg = JSON.parse(read('package.json'))
const lockfile = read('pnpm-lock.yaml')
const failures = []
const requireCondition = (condition, message) => {
  if (!condition) failures.push(message)
}

const normativeFiles = [
  'README.md',
  'HANDOFF.md',
  'docs/VERSIONING.md',
  'docs/implementation/presentation-phase0-foundation.md',
  'docs/superpowers/specs/2026-09-02-pre-design-presentation-project-alignment-v2.0.0-design.md',
  'docs/superpowers/specs/2026-09-02-pre-design-presentation-content-baseline-v2.0.0.md',
  'docs/superpowers/plans/2026-09-02-pre-design-presentation-project-alignment-v2.0.0.md',
]
const phase0Files = [
  'src/presentation/contract-port.ts',
  'src/presentation/types.ts',
  'src/presentation/binding-domain.ts',
  'src/presentation/binding-repository.ts',
  'src/presentation/canonical-json.ts',
  'src/presentation/path-policy.ts',
  'src/presentation/filesystem.ts',
  'src/presentation/projector/index.ts',
  'src/presentation/projector/frozen-project-adapter.ts',
  'src/presentation/update-plan.ts',
  'src/presentation/material-plan.ts',
  'src/report/browser-executable.ts',
  'tests/presentation-phase0-foundation.spec.ts',
  'tests/presentation-binding-repository.spec.ts',
  'tests/presentation-host-binding.spec.ts',
  'tests/presentation-filesystem.spec.ts',
  'tests/presentation-projection.spec.ts',
  'tests/presentation-frozen-project-adapter.spec.ts',
  'tests/presentation-update-plan.spec.ts',
  'tests/presentation-material-plan.spec.ts',
  'tests/presentation-build-toolchain.spec.ts',
  'tests/browser-executable.spec.ts',
]
const docs = Object.fromEntries(normativeFiles.map(path => [path, read(path)]))

requireCondition(matrix.schemaVersion === 2,
  'version matrix schemaVersion must be 2')
requireCondition(matrix.branch === 'architecture/presentation-project-alignment-v2.0.0',
  'alignment branch must match the frozen baseline branch')
requireCondition(matrix.implementationBranch === 'feature/presentation-phase0-foundation-v2.0.0',
  'implementation branch must match the Phase 0 branch')
requireCondition(matrix.alignmentBaseline?.version === '2.0.0',
  'alignment baseline version must be 2.0.0')
requireCondition(matrix.alignmentBaseline?.label === 'v2.0.0',
  'alignment baseline label must be v2.0.0')
requireCondition(pkg.name === matrix.executablePackage?.name,
  'package name must match the version matrix')
requireCondition(pkg.version === '0.7.0'
  && pkg.version === matrix.executablePackage?.version,
  'executable package version must remain 0.7.0')
requireCondition(matrix.executablePackage?.versionBumpAuthorized === false,
  'this branch must not authorize a package-version bump')
requireCondition(matrix.publishedRelease?.tag === 'v0.7.0',
  'published historical release must remain v0.7.0')
requireCondition(matrix.legacyContracts?.business === 'v0.6',
  'business contract line must remain v0.6')
requireCondition(matrix.legacyContracts?.governance === 'v0.7',
  'governance contract line must remain v0.7')

const presentation = matrix.presentationStandard
requireCondition(presentation?.name === 'Presentation Standard Project Directory',
  'Presentation standard name must remain provider-neutral')
requireCondition(presentation?.authorityRepository === 'ArchitectureWorld/presentation-tools',
  'Presentation authority repository must remain presentation-tools')
requireCondition(['pending', 'locked'].includes(presentation?.contractLockStatus),
  'Presentation contractLockStatus must be pending or locked')
requireCondition(
  presentation?.lockFile === 'docs/contracts/presentation-standard-project-v1-lock.json',
  'Presentation Contract Lock placeholder path must remain stable until accepted',
)

const lockPath = resolve(root, presentation?.lockFile ?? '')
if (presentation?.contractLockStatus === 'pending') {
  requireCondition(!existsSync(lockPath),
    'Contract Lock file must not exist while lock status is pending')
  for (const field of ['standardVersion', 'packageName', 'packageVersion', 'schemaSetSha256']) {
    requireCondition(presentation[field] === null,
      `${field} must be null while Contract Lock is pending`)
  }
} else {
  requireCondition(existsSync(lockPath),
    'Contract Lock file must exist when lock status is locked')
  requireCondition(typeof presentation.standardVersion === 'string'
    && presentation.standardVersion.length > 0,
  'locked Contract must provide standardVersion')
  requireCondition(typeof presentation.packageName === 'string'
    && presentation.packageName.length > 0,
  'locked Contract must provide packageName')
  requireCondition(typeof presentation.packageVersion === 'string'
    && presentation.packageVersion.length > 0,
  'locked Contract must provide packageVersion')
  requireCondition(/^[a-f0-9]{64}$/u.test(presentation.schemaSetSha256 ?? ''),
    'locked Contract must provide a lower-case Schema Set SHA-256')
}

const implementation = matrix.implementation
requireCondition(implementation?.phase0Foundation?.status === 'implemented',
  'Phase 0 foundation must be recorded as implemented')
requireCondition(
  implementation?.phase0Foundation?.verificationStatus
    === 'targeted-tests-and-typecheck-passed',
  'Phase 0 verification status must record targeted tests and typecheck')
requireCondition(
  implementation?.contractDependentIntegration?.status
    === 'blocked-by-contract-lock',
  'Contract-dependent integration must remain blocked while lock is pending')
requireCondition(
  implementation?.contractDependentIntegration?.productionCodeChanged === false,
  'Contract-dependent integration must not claim production code changes')
requireCondition(implementation?.productionCodeChangedForAlignment === true,
  'version matrix must acknowledge Phase 0 source changes')
requireCondition(implementation?.packageReleaseStatus === 'not-authorized',
  'package release must remain unauthorized')
requireCondition(implementation?.planReady === true,
  'implementation plan must remain ready')

requireCondition(matrix.historicalLabels?.clientReportCandidate?.label === 'v0.8',
  'historical client-report candidate label must remain v0.8')
requireCondition(matrix.historicalLabels?.clientReportCandidate?.authority === false,
  'historical client-report candidate must not be a version authority')
requireCondition(matrix.historicalLabels?.handoffBundle?.label === 'FINAL_v2.0',
  'historical handoff bundle label must remain FINAL_v2.0')
requireCondition(matrix.historicalLabels?.handoffBundle?.authority === false,
  'historical handoff bundle must not be a version authority')
requireCondition(matrix.historicalLabels?.legacyHandoff?.path === 'HANDOFF_HISTORY.md',
  'legacy handoff path must remain HANDOFF_HISTORY.md')

for (const path of phase0Files) {
  requireCondition(existsSync(resolve(root, path)),
    `required Phase 0 file is missing: ${path}`)
}

const historyPath = resolve(root, 'HANDOFF_HISTORY.md')
requireCondition(existsSync(historyPath),
  'HANDOFF_HISTORY.md must preserve a non-authoritative history index')
if (existsSync(historyPath)) {
  const history = read('HANDOFF_HISTORY.md')
  requireCondition(history.includes('Status: `superseded-history`'),
    'HANDOFF_HISTORY.md must be explicitly non-authoritative')
  requireCondition(!history.includes('唯一权威'),
    'HANDOFF_HISTORY.md must not contain a current authority claim')
}

const positiveReleaseClaim = /(?:Git Tag|GitHub Release|Release)\s*(?:为|=|:|：)\s*`?v?2\.0\.0/iu
for (const [path, text] of Object.entries(docs)) {
  requireCondition(!text.includes('V2.0.0'),
    `${path} uses the prohibited uppercase alignment label`)
  requireCondition(!/插件(?:包)?版本\s*(?:为|=|:|：)\s*`?2\.0\.0/iu.test(text),
    `${path} mislabels alignment 2.0.0 as a plugin/package version`)
  requireCondition(!positiveReleaseClaim.test(text),
    `${path} mislabels alignment 2.0.0 as a release`)
  requireCondition(!text.includes('awaiting-final-presentation-contract'),
    `${path} contains a deprecated implementation status`)
}

const frontmatterFiles = normativeFiles.filter(path => path.startsWith('docs/superpowers/'))
for (const path of frontmatterFiles) {
  const text = docs[path]
  requireCondition(text.includes('document_version: 2.0.0'),
    `${path} must declare document_version 2.0.0`)
  requireCondition(text.includes('alignment_baseline: v2.0.0'),
    `${path} must declare alignment_baseline v2.0.0`)
  requireCondition(text.includes('branch: architecture/presentation-project-alignment-v2.0.0'),
    `${path} must point to the frozen alignment branch`)
  requireCondition(text.includes('implementation_status: blocked-by-contract-lock'),
    `${path} must retain the Contract-dependent integration gate`)
  requireCondition(text.includes('version_matrix: docs/version-matrix.json'),
    `${path} must point to the machine version authority`)
  requireCondition(text.includes('version_authority: docs/VERSIONING.md'),
    `${path} must point to the human version authority`)
}

requireCondition(docs['README.md'].includes('Phase 0 基础 | 已实现'),
  'README must state that Phase 0 is implemented')
requireCondition(docs['README.md'].includes('Presentation Contract | 尚未锁定'),
  'README must state that the Presentation Contract is not locked')
requireCondition(docs['README.md'].includes('npm 包版本：`0.7.0`'),
  'README must state the executable package version')
requireCondition(docs['HANDOFF.md'].includes('Phase 0 foundation | `implemented`'),
  'HANDOFF must state the Phase 0 status')
requireCondition(docs['HANDOFF.md'].includes('Presentation Contract version | 尚未锁定'),
  'HANDOFF must not invent a Presentation standardVersion')
requireCondition(docs['HANDOFF.md'].includes('Executable npm package | `0.7.0`'),
  'HANDOFF must state the package version')
requireCondition(docs['docs/VERSIONING.md'].includes('Presentation Contract 版本 | **尚未锁定**'),
  'VERSIONING must leave the Presentation version unlocked')
requireCondition(docs['docs/VERSIONING.md'].includes('Phase 0 foundation | `implemented`'),
  'VERSIONING must state the implemented Phase 0 status')
const phase0Record = docs['docs/implementation/presentation-phase0-foundation.md']
requireCondition(phase0Record.includes('Test Files: 10 passed')
  && phase0Record.includes('Tests: 46 passed')
  && phase0Record.includes('TypeScript: PASS')
  && phase0Record.includes('Full build and repository test suite: PASS')
  && phase0Record.includes('Built-package regression: PASS')
  && phase0Record.includes('Diff hygiene: PASS'),
'Phase 0 record must include the current targeted and full-regression evidence')

const packageText = JSON.stringify(pkg)
requireCondition(!packageText.includes('@architectureworld/presentation-contracts'),
  'package.json must not depend on an unlocked Presentation Contract')
requireCondition(!lockfile.includes('@architectureworld/presentation-contracts'),
  'pnpm lockfile must not contain an unlocked Presentation Contract')

if (failures.length > 0) {
  console.error('PRE_DESIGN_ALIGNMENT_VERSION_CONSISTENCY_FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('PRE_DESIGN_ALIGNMENT_VERSION_CONSISTENCY_PASS')
console.log(JSON.stringify({
  alignmentBranch: matrix.branch,
  implementationBranch: matrix.implementationBranch,
  alignmentBaseline: matrix.alignmentBaseline.label,
  executablePackage: `${pkg.name}@${pkg.version}`,
  publishedRelease: matrix.publishedRelease.tag,
  presentationContractLock: presentation.contractLockStatus,
  presentationStandardVersion: presentation.standardVersion,
  phase0Foundation: implementation.phase0Foundation.status,
  contractDependentIntegration: implementation.contractDependentIntegration.status,
  packageReleaseStatus: implementation.packageReleaseStatus,
}, null, 2))
