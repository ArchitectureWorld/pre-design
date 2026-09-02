import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const matrix = JSON.parse(read('docs/version-matrix.json'))
const pkg = JSON.parse(read('package.json'))

const normativeFiles = [
  'README.md',
  'HANDOFF.md',
  'docs/VERSIONING.md',
  'docs/superpowers/specs/2026-09-02-pre-design-presentation-project-alignment-v2.0.0-design.md',
  'docs/superpowers/specs/2026-09-02-pre-design-presentation-content-baseline-v2.0.0.md',
  'docs/superpowers/plans/2026-09-02-pre-design-presentation-project-alignment-v2.0.0.md',
]

const docs = Object.fromEntries(normativeFiles.map(path => [path, read(path)]))
const failures = []

const requireCondition = (condition, message) => {
  if (!condition) failures.push(message)
}

requireCondition(matrix.branch === 'architecture/presentation-project-alignment-v2.0.0',
  'matrix branch must match the alignment branch')
requireCondition(matrix.alignmentBaseline.version === '2.0.0',
  'alignment baseline version must be 2.0.0')
requireCondition(matrix.alignmentBaseline.label === 'v2.0.0',
  'alignment baseline label must be v2.0.0')
requireCondition(pkg.name === matrix.executablePackage.name,
  'package name must match version matrix')
requireCondition(pkg.version === matrix.executablePackage.version,
  'package version must match version matrix')
requireCondition(matrix.executablePackage.versionBumpAuthorized === false,
  'this branch must not authorize a package version bump')
requireCondition(matrix.publishedRelease.tag === 'v0.7.0',
  'published historical release must remain v0.7.0')
requireCondition(matrix.presentationStandard.majorLine === 'v1',
  'Presentation standard major line must remain v1')
requireCondition(matrix.presentationStandard.standardVersion === '1.0.0',
  'Presentation standardVersion target must remain 1.0.0')
requireCondition(['pending', 'locked'].includes(matrix.presentationStandard.contractLockStatus),
  'contractLockStatus must be pending or locked')
requireCondition(matrix.historicalLabels?.clientReportCandidate?.label === 'v0.8',
  'historical client-report candidate label must remain v0.8')
requireCondition(matrix.historicalLabels?.clientReportCandidate?.authority === false,
  'historical client-report candidate must not be a version authority')
requireCondition(matrix.historicalLabels?.handoffBundle?.label === 'FINAL_v2.0',
  'historical handoff bundle label must remain FINAL_v2.0')
requireCondition(matrix.historicalLabels?.handoffBundle?.authority === false,
  'historical handoff bundle must not be a version authority')
requireCondition(matrix.historicalLabels?.legacyHandoff?.path === 'HANDOFF_HISTORY.md',
  'legacy handoff path must be HANDOFF_HISTORY.md')

const lockPath = resolve(root, 'docs/contracts/presentation-standard-project-v1-lock.json')
const historyHandoffPath = resolve(root, 'HANDOFF_HISTORY.md')
requireCondition(existsSync(historyHandoffPath),
  'HANDOFF_HISTORY.md must preserve the previous historical handoff')
if (matrix.presentationStandard.contractLockStatus === 'pending') {
  requireCondition(!existsSync(lockPath),
    'Contract Lock file must not exist while contractLockStatus is pending')
  requireCondition(matrix.presentationStandard.packageName === null,
    'packageName must be null while Contract Lock is pending')
  requireCondition(matrix.presentationStandard.packageVersion === null,
    'packageVersion must be null while Contract Lock is pending')
  requireCondition(matrix.presentationStandard.schemaSetSha256 === null,
    'schemaSetSha256 must be null while Contract Lock is pending')
  requireCondition(matrix.implementation.status === 'blocked-by-contract-lock',
    'implementation must be blocked while Contract Lock is pending')
} else {
  requireCondition(existsSync(lockPath),
    'Contract Lock file must exist while contractLockStatus is locked')
}

for (const [path, text] of Object.entries(docs)) {
  requireCondition(!text.includes('V2.0.0'),
    `${path} uses prohibited uppercase V2.0.0`)
  requireCondition(!/插件(?:包)?版本[^。\n]*2\.0\.0/u.test(text),
    `${path} mislabels alignment 2.0.0 as plugin/package version`)
  requireCondition(!/(?:Git Tag|GitHub Release|Release)[^。\n]*2\.0\.0/u.test(text),
    `${path} mislabels alignment 2.0.0 as a release`)
  requireCondition(!text.includes('awaiting-final-presentation-contract'),
    `${path} contains deprecated implementation status`)
  requireCondition(!text.includes('implementation_status: not-started'),
    `${path} contains conflicting implementation status`)
}

const frontmatterFiles = normativeFiles.filter(path => path.startsWith('docs/superpowers/'))
for (const path of frontmatterFiles) {
  const text = docs[path]
  requireCondition(text.includes('document_version: 2.0.0'),
    `${path} must declare document_version 2.0.0`)
  requireCondition(text.includes('alignment_baseline: v2.0.0'),
    `${path} must declare alignment_baseline v2.0.0`)
  requireCondition(text.includes('branch: architecture/presentation-project-alignment-v2.0.0'),
    `${path} must declare the exact branch`)
  requireCondition(text.includes('implementation_status: blocked-by-contract-lock'),
    `${path} must use the current implementation status`)
  requireCondition(text.includes('version_matrix: docs/version-matrix.json'),
    `${path} must point to the machine version authority`)
  requireCondition(text.includes('version_authority: docs/VERSIONING.md'),
    `${path} must point to the human version authority`)
}

requireCondition(docs['README.md'].includes('npm 包版本：`0.7.0`'),
  'README must state the executable package version')
requireCondition(docs['README.md'].includes('历史发布标签：`v0.7.0`'),
  'README must state the historical release tag')
requireCondition(docs['README.md'].includes('Contract Lock：`pending`'),
  'README must state the current Contract Lock status')
requireCondition(docs['HANDOFF.md'].includes('Alignment baseline | `v2.0.0`'),
  'HANDOFF must state the alignment baseline')
requireCondition(docs['HANDOFF.md'].includes('Executable npm package | `0.7.0`'),
  'HANDOFF must state the executable package version')
requireCondition(docs['HANDOFF.md'].includes('Presentation Contract Lock | `pending`'),
  'HANDOFF must state the Contract Lock status')
requireCondition(docs['HANDOFF.md'].includes('HANDOFF_HISTORY.md'),
  'HANDOFF must classify the previous handoff as history')
requireCondition(docs['docs/VERSIONING.md'].includes('Presentation `standardVersion` target | `1.0.0`'),
  'VERSIONING must state the Presentation standardVersion target')
requireCondition(docs['docs/VERSIONING.md'].includes('Historical client-report candidate line | `v0.8`'),
  'VERSIONING must classify v0.8 as a historical candidate line')
requireCondition(docs['docs/VERSIONING.md'].includes('Historical handoff bundle label | `FINAL_v2.0`'),
  'VERSIONING must classify FINAL_v2.0 as a historical archive label')

if (failures.length > 0) {
  console.error('PRE_DESIGN_ALIGNMENT_VERSION_CONSISTENCY_FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('PRE_DESIGN_ALIGNMENT_VERSION_CONSISTENCY_PASS')
console.log(JSON.stringify({
  branch: matrix.branch,
  alignmentBaseline: matrix.alignmentBaseline.label,
  executablePackage: `${pkg.name}@${pkg.version}`,
  publishedRelease: matrix.publishedRelease.tag,
  presentationStandard: `${matrix.presentationStandard.majorLine}/${matrix.presentationStandard.standardVersion}`,
  contractLockStatus: matrix.presentationStandard.contractLockStatus,
  historicalCandidate: matrix.historicalLabels.clientReportCandidate.label,
  historicalArchiveLabel: matrix.historicalLabels.handoffBundle.label,
  implementationStatus: matrix.implementation.status,
}, null, 2))
