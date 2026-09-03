import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const json = path => JSON.parse(read(path))
const failures = []
const requireCondition = (condition, message) => {
  if (!condition) failures.push(message)
}

const pkg = json('package.json')
const matrix = json('docs/version-matrix.json')
const lock = json('docs/contracts/presentation-standard-project-v0.1.0-lock.json')
const artifact = json('vendor/presentation-contracts/contract-artifact.json')

requireCondition(pkg.name === '@architectureworld/dsh-preplanning-agent',
  'unexpected Pre package name')
requireCondition(pkg.version === '2.0.0',
  'Pre package version must be 2.0.0')
requireCondition(matrix.product?.version === '2.0.0',
  'version matrix must identify Pre 2.0.0')
requireCondition(matrix.activeBranches?.development === 'feat/pre-v2.0.0',
  'current development branch must be feat/pre-v2.0.0')
requireCondition(matrix.externalContracts?.presentationProjectFormat?.relationship
    === 'decoupled-external-contract',
  'Presentation format must remain a decoupled external Contract')

for (const candidate of [lock, artifact, matrix.externalContracts?.presentationProjectFormat]) {
  requireCondition(candidate?.standardVersion === '0.1.0',
    'Presentation standard version must be 0.1.0')
  requireCondition(candidate?.sourceCommitSHA === '974668d308728386ea005c9e77d58ebff9372f0a',
    'Presentation Contract commit mismatch')
  requireCondition(candidate?.schemaSetSha256
      === '5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc',
    'Presentation Schema Set mismatch')
}

const implementationFiles = [
  'src/presentation/standard-contract.ts',
  'src/presentation/standard-project-adapter.ts',
  'src/presentation/standard-project-types.ts',
  'src/presentation/standard-project-writer.ts',
  'src/presentation/standard-project-service.ts',
  'src/presentation/standard-project-error.ts',
  'src/presentation/identity-ledger.ts',
  'src/presentation/material-plan.ts',
  'src/presentation/filesystem.ts',
]
for (const path of implementationFiles) {
  requireCondition(existsSync(resolve(root, path)), `missing implementation file: ${path}`)
}

const standardSource = implementationFiles
  .filter(path => existsSync(resolve(root, path)))
  .map(read)
  .join('\n')

const forbiddenCanonicalFields = [
  'ProjectHead',
  'baseRevision',
  'presentationRevision',
  'syncOrigin',
  'UpstreamSyncRecord',
  'automaticRefresh',
  'fontSize',
  'pptMaster',
  'templateName',
]
for (const field of forbiddenCanonicalFields) {
  requireCondition(!standardSource.includes(`'${field}'`)
      && !standardSource.includes(`\"${field}\"`),
    `standard-project implementation contains forbidden Canonical field ${field}`)
}

const tests = [
  'tests/presentation-standard-contract.spec.ts',
  'tests/presentation-standard-adapter.spec.ts',
  'tests/presentation-standard-writer.spec.ts',
  'tests/presentation-standard-project-e2e.spec.ts',
  'tests/presentation-standard-identity.spec.ts',
]
for (const path of tests) {
  requireCondition(existsSync(resolve(root, path)), `missing integration test: ${path}`)
}

requireCondition(existsSync(resolve(root,
  'handoff/PRE_DESIGN_PRESENTATION_STANDARD_PROJECT_V0.1.0_IMPLEMENTATION.md')),
'handoff is missing')

if (failures.length > 0) {
  console.error('PRESENTATION_STANDARD_PROJECT_V0_1_0_FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS')
console.log(JSON.stringify({
  preDesignVersion: pkg.version,
  branch: matrix.activeBranches.development,
  externalContractVersion: lock.standardVersion,
  contractCommit: lock.sourceCommitSHA,
  schemaSetSha256: lock.schemaSetSha256,
}, null, 2))
