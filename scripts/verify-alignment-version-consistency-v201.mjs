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
const ARCHITECTURE_BRANCH = 'architecture/pre-v2.0.0'
const DEVELOPMENT_BRANCH = 'feat/pre-v2.0.1'
const BASELINE_BRANCH = 'feat/pre-v2.0.0'
const NODE_BASELINE = '>=24.11.0'
const PRESENTATION_VERSION = '0.1.0'
const PRESENTATION_PACKAGE = '@architectureworld/presentation-contracts'
const PRESENTATION_COMMIT = '974668d308728386ea005c9e77d58ebff9372f0a'
const PRESENTATION_SCHEMASET = '5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc'

const matrix = json('docs/version-matrix.json')
const pkg = json('package.json')
const versionSource = read('src/version.ts')

requireCondition(Number.isInteger(matrix.schemaVersion) && matrix.schemaVersion >= 6,
  'version matrix schemaVersion must be at least 6 for Pre 2.0.1')
requireCondition(matrix.repository === 'ArchitectureWorld/pre-design', 'version matrix repository mismatch')
requireCondition(matrix.product?.name === 'pre-design', 'product name must be pre-design')
requireCondition(matrix.product?.version === PRE_VERSION, 'Pre product version must be 2.0.1')
requireCondition(matrix.product?.packageName === PRE_PACKAGE, 'Pre package name mismatch')
requireCondition(matrix.product?.packageVersion === PRE_VERSION, 'Pre package version must be 2.0.1')
requireCondition(matrix.product?.publishedTag === null, 'Pre 2.0.1 must remain unpublished')
requireCondition(matrix.activeBranches?.architecture === ARCHITECTURE_BRANCH,
  `architecture branch must remain ${ARCHITECTURE_BRANCH}`)
requireCondition(matrix.activeBranches?.development === DEVELOPMENT_BRANCH,
  `development branch must be ${DEVELOPMENT_BRANCH}`)
requireCondition(matrix.activeBranches?.baseline === BASELINE_BRANCH,
  `deployable baseline branch must remain ${BASELINE_BRANCH}`)

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
requireCondition(matrix.implementation?.releaseStatus === 'not-merged-not-published',
  'Pre 2.0.1 release status must remain not merged and not published')

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
  baselineBranch: matrix.activeBranches.baseline,
  presentationFormat: external.standardVersion,
  releaseStatus: matrix.implementation.releaseStatus,
}, null, 2))
