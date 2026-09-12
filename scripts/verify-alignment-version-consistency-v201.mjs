import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const json = path => JSON.parse(read(path))
const exists = path => existsSync(resolve(root, path))
const failures = []
const requireCondition = (condition, message) => { if (!condition) failures.push(message) }

const PRE_VERSION = '2.0.1'
const PRE_PACKAGE = '@architectureworld/dsh-preplanning-agent'
const DEVELOPMENT_BRANCH = 'feat/pre-v2.0.1'
const BASELINE_BRANCH = 'main'
const BASELINE_VERSION = '2.0.0'
const BASELINE_COMMIT = '49140423e14f3d3abcf3815c9bdf68e8e5e26730'
const NODE_BASELINE = '>=24.11.0'
const PRESENTATION_VERSION = '0.1.0'
const PRESENTATION_PACKAGE = '@architectureworld/presentation-contracts'
const PRESENTATION_COMMIT = '974668d308728386ea005c9e77d58ebff9372f0a'
const PRESENTATION_SCHEMASET = '5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc'

const matrix = json('docs/version-matrix.json')
const pkg = json('package.json')
const versionSource = read('src/version.ts')

requireCondition(Number.isInteger(matrix.schemaVersion) && matrix.schemaVersion >= 7,
  'version matrix schemaVersion must be at least 7 for merged-main Pre 2.0.1 baseline')
requireCondition(matrix.repository === 'ArchitectureWorld/pre-design', 'version matrix repository mismatch')
requireCondition(matrix.product?.name === 'pre-design', 'product name must be pre-design')
requireCondition(matrix.product?.version === PRE_VERSION, 'Pre product version must be 2.0.1')
requireCondition(matrix.product?.packageName === PRE_PACKAGE, 'Pre package name mismatch')
requireCondition(matrix.product?.packageVersion === PRE_VERSION, 'Pre package version must be 2.0.1')
requireCondition(matrix.product?.publishedTag === null, 'Pre 2.0.1 must remain unpublished')
requireCondition(matrix.activeBranches?.development === DEVELOPMENT_BRANCH,
  `development branch must be ${DEVELOPMENT_BRANCH}`)
requireCondition(matrix.activeBranches?.baseline === BASELINE_BRANCH,
  `Pre 2.0.1 baseline branch must be ${BASELINE_BRANCH}`)
requireCondition(matrix.activeBranches?.baselineVersion === BASELINE_VERSION,
  `Pre 2.0.1 baseline version must be ${BASELINE_VERSION}`)
requireCondition(matrix.activeBranches?.baselineCommitSHA === BASELINE_COMMIT,
  `Pre 2.0.1 baseline commit must be ${BASELINE_COMMIT}`)

requireCondition(pkg.name === PRE_PACKAGE, 'package.json name mismatch')
requireCondition(pkg.version === PRE_VERSION, 'package.json version mismatch')
requireCondition(pkg.engines?.node === NODE_BASELINE, `package.json must declare Node.js ${NODE_BASELINE}`)
requireCondition(Array.isArray(pkg.files) && pkg.files.includes('research/v2.0.1/**'),
  'packed package must include research/v2.0.1/**')
requireCondition(versionSource.includes("PRE_DESIGN_VERSION = '2.0.1'"), 'src/version.ts must expose Pre 2.0.1')
requireCondition(versionSource.includes("PRESENTATION_PROJECT_FORMAT_VERSION = '0.1.0'"),
  'Presentation project format must remain 0.1.0')

const external = matrix.externalContracts?.presentationProjectFormat
requireCondition(external?.standardVersion === PRESENTATION_VERSION, 'Presentation Contract version mismatch')
requireCondition(external?.packageName === PRESENTATION_PACKAGE, 'Presentation Contract package mismatch')
requireCondition(external?.sourceCommitSHA === PRESENTATION_COMMIT, 'Presentation Contract commit changed')
requireCondition(external?.schemaSetSha256 === PRESENTATION_SCHEMASET, 'Presentation Schema Set changed')
requireCondition(pkg.devDependencies?.[PRESENTATION_PACKAGE] === 'file:vendor/presentation-contracts/architectureworld-presentation-contracts-0.1.0.tgz',
  'Presentation Contract tarball pin changed')

for (const path of [
  'docs/superpowers/specs/2026-09-12-pre-v2.0.1-source-traceable-research-design.md',
  'docs/superpowers/plans/2026-09-12-pre-v2.0.1-source-traceable-research.md',
  'research/v2.0.1/schemas/data-source-catalog.schema.json',
  'research/v2.0.1/schemas/workflow-research-spec.schema.json',
  'research/v2.0.1/schemas/evidence-record.schema.json',
  'research/v2.0.1/schemas/analysis-trace.schema.json',
  'research/v2.0.1/data-sources.json',
  'research/v2.0.1/workflow-research-specs.json',
]) {
  requireCondition(exists(path), `Pre 2.0.1 research authority file is missing: ${path}`)
}

requireCondition(matrix.implementation?.sourceTraceableResearch?.branch === DEVELOPMENT_BRANCH,
  'sourceTraceableResearch branch authority mismatch')
requireCondition(matrix.implementation?.sourceTraceableResearch?.baseline === `${BASELINE_BRANCH}@${BASELINE_COMMIT}`,
  'sourceTraceableResearch merged-main baseline coordinate mismatch')
requireCondition(matrix.implementation?.releaseStatus === 'not-merged-not-published',
  'Pre 2.0.1 release status must remain not merged and not published')

const forbiddenRuntimeIdentity = [
  ['src/version.ts', "PRE_DESIGN_VERSION = '2.0.0'"],
  ['package.json', '"version": "2.0.0"'],
]
for (const [path, needle] of forbiddenRuntimeIdentity) {
  requireCondition(!read(path).includes(needle), `${path} retains forbidden V2.0.0 runtime identity`)
}

if (failures.length > 0) {
  console.error('PRE_DESIGN_V2_0_1_VERSION_CONSISTENCY_FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('PRE_DESIGN_V2_0_1_VERSION_CONSISTENCY_PASS')
console.log(JSON.stringify({
  product: `${matrix.product.name}@${matrix.product.version}`,
  package: `${pkg.name}@${pkg.version}`,
  developmentBranch: matrix.activeBranches.development,
  baseline: `${matrix.activeBranches.baseline}@${matrix.activeBranches.baselineCommitSHA}`,
  baselineVersion: matrix.activeBranches.baselineVersion,
  presentationFormat: external.standardVersion,
  releaseStatus: matrix.implementation.releaseStatus,
}, null, 2))
