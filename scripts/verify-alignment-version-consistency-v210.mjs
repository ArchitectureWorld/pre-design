import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname,'..'), read = p => readFileSync(resolve(root,p),'utf8'), json = p => JSON.parse(read(p))
const m = json('docs/version-matrix.json'), p = json('package.json'), failures = []
const check = (ok,message) => {if (!ok) failures.push(message)}
check(p.version === '2.1.0' && m.product.version === p.version && m.product.packageVersion === p.version,'current version')
check(m.product.status === 'development-foundation' && m.product.publishedTag === null,'development-only status')
check(m.activeBranches.current === 'v2.1.0' && m.activeBranches.development === 'v2.1.0','development branch')
check(m.activeBranches.baselineVersion === '2.0.2' && m.activeBranches.baselineCommitSHA === 'a1c1ad12b469d086037ec66e4bd89c7c0e4ac422','merged main baseline')
check(read('src/version.ts').includes("PRE_DESIGN_VERSION = '2.1.0'"),'runtime version')
check(p.engines.node === '>=24.11.0' && m.dshCompatibility.version === '0.1.5-rc.1' && m.dshCompatibility.pnpm === '10.15.1','runtime requirements')
const e = m.externalContracts.presentationProjectFormat
check(e.standardVersion === '0.1.0' && e.sourceCommitSHA === 'fc54e4052e2ac2b2aa607391a55ab04fb79f4211' && e.schemaSetSha256 === 'cc954d1d47cf3a75146190e055be3c3e62eac91f760f9382a9348191e3b19f33','Presentation pin')
check(p.devDependencies['@architectureworld/presentation-contracts'] === 'file:vendor/presentation-contracts/architectureworld-presentation-contracts-0.1.1.tgz','Presentation dependency')
for (const folder of ['contracts/v0.6','contracts/v0.7','research/v2.0.1','research/planning-v1.2']) check(existsSync(resolve(root,folder)) && p.files.includes(`${folder}/**`),`retained/packed ${folder}`)
check(m.implementation.researchV210.execution === 'planning_only' && m.implementation.researchV210.automatic62Execution === false,'62-module runtime status must not overclaim')
check(m.implementation.liquidGlassUI.branch === 'pre-V2.0.2','retain UI provenance')
check(m.implementation.releaseStatus === 'development-not-merged-not-published','release status')
if (failures.length) {console.error('PRE_DESIGN_V2_1_0_VERSION_CONSISTENCY_FAIL',failures);process.exit(1)}
console.log('PRE_DESIGN_V2_1_0_VERSION_CONSISTENCY_PASS')
