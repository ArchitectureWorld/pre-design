import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []
const fail = message => failures.push(message)
const read = path => readFile(resolve(root, path), 'utf8')

const forbiddenRuntime = [
  ['src/runtime/workflow-quality.ts', '高风险工作项需要局部人工审核'],
  ['src/runtime/automation-workflow-committer.ts', 'high-risk workflow cannot be automatically committed'],
  ['src/proposals/gateway.ts', 'high-risk-human-review'],
]

for (const [path, phrase] of forbiddenRuntime) {
  const text = await read(path)
  if (text.includes(phrase)) fail(`${path} reintroduced legacy mandatory-human semantics: ${phrase}`)
}

const committer = await read('src/runtime/automation-workflow-committer.ts')
if (/validation_intent:\s*['"]human_review['"]/u.test(committer)) {
  fail('automatic workflow committer must not emit human_review validation intent')
}
if (/requested_state:\s*['"]pending_review['"]/u.test(committer)) {
  fail('automatic workflow committer must not emit pending_review requested state')
}

const researchDir = resolve(root, 'research/v2.0.1')
const specFiles = (await readdir(researchDir))
  .filter(name => /^workflow-research-specs.*\.json$/u.test(name))
  .sort()

const forbiddenResearchPhrases = [
  '提交人工确认',
  '必须人工澄清',
  '必须由实际决策人或授权负责人选定或改写',
  '用途确认列为 G1 前置条件',
  'blocked_external/needs_human',
]

for (const name of specFiles) {
  const path = `research/v2.0.1/${name}`
  const text = await read(path)
  for (const phrase of forbiddenResearchPhrases) {
    if (text.includes(phrase)) fail(`${path} contains operational human-approval phrase: ${phrase}`)
  }
  const document = JSON.parse(text)
  for (const workflow of document.workflows ?? []) {
    for (const source of workflow.preferredSources ?? []) {
      if (source.sourceId === 'dsh-user-statement' && source.required === true) {
        fail(`${path} ${workflow.workflowId}: dsh-user-statement cannot be a mandatory automatic-flow checkpoint`)
      }
    }
  }
}

if (failures.length > 0) {
  console.error('PRE_V2_0_1_AUTOMATION_SEMANTICS_FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('PRE_V2_0_1_AUTOMATION_SEMANTICS_PASS')
console.log(JSON.stringify({ checkedResearchSpecFiles: specFiles.length }, null, 2))
