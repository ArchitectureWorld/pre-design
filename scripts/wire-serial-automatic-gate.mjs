import { readFile, writeFile } from 'node:fs/promises'

async function replaceOnce(path, before, after) {
  const current = await readFile(path, 'utf8')
  const count = current.split(before).length - 1
  if (count !== 1) throw new Error(`${path}: expected one replacement, found ${count}`)
  await writeFile(path, current.replace(before, after), 'utf8')
}

await replaceOnce(
  'src/tools/register.ts',
  "import type { PresentationAutoSyncService } from '../presentation/auto-sync.ts'\n",
  "import type { PresentationAutoSyncService } from '../presentation/auto-sync.ts'\nimport type { AutomaticGateApprover } from '../runtime/automatic-gate-approver.ts'\n",
)

await replaceOnce(
  'src/tools/register.ts',
  "  readonly presentationSync?: Pick<PresentationAutoSyncService, 'request' | 'status'>\n",
  "  readonly presentationSync?: Pick<PresentationAutoSyncService, 'request' | 'status'>\n  readonly gateApprover?: Pick<AutomaticGateApprover, 'approveReady'>\n",
)

await replaceOnce(
  'src/tools/register.ts',
  "            await dependencies.runtime.transition(proposal.projectId, workflowId, {\n              to: 'confirmed',\n              proposalId: proposal.proposalId,\n              revision: committed.revision,\n            })\n            revision = committed.revision\n            dependencies.presentationSync?.request(proposal.projectId, {\n              ...(workspaceRootOf(exec) === undefined ? {} : { workspaceRoot: workspaceRootOf(exec) }),\n              reason: `automatic-workflow:${workflowId}:revision:${committed.revision}`,\n            })\n",
  "            await dependencies.runtime.transition(proposal.projectId, workflowId, {\n              to: 'confirmed',\n              proposalId: proposal.proposalId,\n              revision: committed.revision,\n            })\n            const approvedGates = await dependencies.gateApprover?.approveReady(proposal.projectId) ?? 0\n            revision = committed.revision\n            dependencies.presentationSync?.request(proposal.projectId, {\n              ...(workspaceRootOf(exec) === undefined ? {} : { workspaceRoot: workspaceRootOf(exec) }),\n              reason: `automatic-workflow:${workflowId}:revision:${committed.revision}:approved-gates:${approvedGates}`,\n            })\n",
)

await replaceOnce(
  'src/index.ts',
  "    registry,\n    presentationSync,\n  })\n",
  "    registry,\n    presentationSync,\n    gateApprover,\n  })\n",
)

const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
for (const key of ['test:continuous-sync', 'test:presentation-standard']) {
  const command = packageJson.scripts[key]
  if (typeof command !== 'string') throw new Error(`package.json missing ${key}`)
  if (!command.includes('tests/automatic-gate-after-serial.spec.ts')) {
    packageJson.scripts[key] = command.replace(
      ' --maxWorkers=1',
      ' tests/automatic-gate-after-serial.spec.ts --maxWorkers=1',
    )
  }
}
await writeFile('package.json', `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')

await replaceOnce(
  '.github/workflows/presentation-standard-project-integration.yml',
  "      - 'tests/automation-workflow-committer.spec.ts'\n",
  "      - 'tests/automation-workflow-committer.spec.ts'\n      - 'tests/automatic-gate-after-serial.spec.ts'\n",
)

console.log('SERIAL_AUTOMATIC_GATE_WIRING_APPLIED')
