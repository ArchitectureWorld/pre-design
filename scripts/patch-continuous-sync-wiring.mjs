import { readFile, writeFile } from 'node:fs/promises'

async function replaceOnce(path, before, after) {
  const current = await readFile(path, 'utf8')
  const count = current.split(before).length - 1
  if (count !== 1) throw new Error(`${path}: expected one replacement, found ${count}`)
  await writeFile(path, current.replace(before, after), 'utf8')
}

await replaceOnce(
  'src/commands/register.ts',
  "import type { GovernanceRepository } from '../governance/repository.ts'\n",
  "import type { GovernanceRepository } from '../governance/repository.ts'\nimport type { PresentationAutoSyncService } from '../presentation/auto-sync.ts'\n",
)

await replaceOnce(
  'src/commands/register.ts',
  "  readonly registry: ContractRegistry\n  readonly createId: () => string\n",
  "  readonly registry: ContractRegistry\n  readonly presentationSync?: Pick<PresentationAutoSyncService, 'request' | 'flush' | 'status'>\n  readonly createId: () => string\n",
)

await replaceOnce(
  'src/commands/register.ts',
  "function successWithStatus(\n  text: string,\n  context: ReturnType<ProjectRepository['readContext']>,\n  dependencies: Pick<CommandDependencies, 'governance' | 'runtime'>,\n): CommandResult {\n",
  "function workspaceRootOf(invocation: CommandInvocation): string | undefined {\n  const cwd = (invocation.agent as unknown as {\n    readonly session?: { readonly header?: { readonly cwd?: unknown } }\n  }).session?.header?.cwd\n  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd.trim() : undefined\n}\n\nfunction requestPresentationSync(\n  dependencies: CommandDependencies,\n  invocation: CommandInvocation,\n  projectId: string,\n  reason: string,\n): void {\n  dependencies.presentationSync?.request(projectId, {\n    ...(workspaceRootOf(invocation) === undefined ? {} : { workspaceRoot: workspaceRootOf(invocation) }),\n    reason,\n  })\n}\n\nasync function flushPresentationSync(\n  dependencies: CommandDependencies,\n  invocation: CommandInvocation,\n  projectId: string,\n  reason: string,\n): Promise<void> {\n  await dependencies.presentationSync?.flush(projectId, {\n    ...(workspaceRootOf(invocation) === undefined ? {} : { workspaceRoot: workspaceRootOf(invocation) }),\n    reason,\n  })\n}\n\nfunction successWithStatus(\n  text: string,\n  context: ReturnType<ProjectRepository['readContext']>,\n  dependencies: Pick<CommandDependencies, 'governance' | 'runtime' | 'presentationSync'>,\n): CommandResult {\n",
)

await replaceOnce(
  'src/commands/register.ts',
  "        }\n        return successWithStatus(\n          `已确认提案 ${result.proposalId}，当前 revision ${result.revision}。`,\n",
  "        }\n        requestPresentationSync(\n          dependencies, invocation, result.projectId,\n          `proposal-confirmed:${proposalId}:revision:${result.revision}`,\n        )\n        return successWithStatus(\n          `已确认提案 ${result.proposalId}，当前 revision ${result.revision}。`,\n",
)

await replaceOnce(
  'src/commands/register.ts',
  "        const record = await dependencies.gates.decideGate(context.project.projectId, gateId, {\n          source: 'human_review',\n          decision: rawDecision as GateDecisionRecord['decision'],\n          actor: actorOf(invocation),\n          ...(reasonParts.length === 0 ? {} : { reason: reasonParts.join(' ') }),\n        })\n        return { kind: 'success', text: `Gate ${record.gateId} 已记录为 ${record.decision}。` }\n",
  "        const record = await dependencies.gates.decideGate(context.project.projectId, gateId, {\n          source: 'human_review',\n          decision: rawDecision as GateDecisionRecord['decision'],\n          actor: actorOf(invocation),\n          ...(reasonParts.length === 0 ? {} : { reason: reasonParts.join(' ') }),\n        })\n        await flushPresentationSync(\n          dependencies, invocation, context.project.projectId,\n          `gate:${record.gateId}:${record.decision}`,\n        )\n        return successWithStatus(\n          `Gate ${record.gateId} 已记录为 ${record.decision}。`,\n          repository.readContext(String(invocation.agent.id)),\n          dependencies,\n        )\n",
)

await replaceOnce(
  'src/commands/register.ts',
  "        const asset = await dependencies.visual.adopt(\n          context.project.projectId,\n          assetId,\n          context.project.currentRevision,\n        )\n        return { kind: 'success', text: `已采用概念表现图 ${asset.assetId}，绑定 Revision ${asset.adoptedRevision}。` }\n",
  "        const asset = await dependencies.visual.adopt(\n          context.project.projectId,\n          assetId,\n          context.project.currentRevision,\n        )\n        requestPresentationSync(\n          dependencies, invocation, context.project.projectId,\n          `visual-adopted:${asset.assetId}`,\n        )\n        return successWithStatus(\n          `已采用概念表现图 ${asset.assetId}，绑定 Revision ${asset.adoptedRevision}。`,\n          repository.readContext(String(invocation.agent.id)),\n          dependencies,\n        )\n",
)

await replaceOnce(
  'src/commands/register.ts',
  "        return {\n          kind: 'success',\n          text: `已拒绝概念表现图 ${result.rejectedAssetId}，并由已采用资产 ${result.replacementAssetId} 替代。`,\n        }\n",
  "        requestPresentationSync(\n          dependencies, invocation, context.project.projectId,\n          `visual-replaced:${result.rejectedAssetId}:${result.replacementAssetId}`,\n        )\n        return successWithStatus(\n          `已拒绝概念表现图 ${result.rejectedAssetId}，并由已采用资产 ${result.replacementAssetId} 替代。`,\n          repository.readContext(String(invocation.agent.id)),\n          dependencies,\n        )\n",
)

await replaceOnce(
  'src/commands/register.ts',
  "        const record = await dependencies.boundaries.confirm(\n          context.project.projectId,\n          boundaryId,\n          context.project.currentRevision,\n          { boundaryId, submittedRevision, contentSha256, statement },\n          boundaryContext(invocation, dependencies),\n        )\n        return { kind: 'success', text: `场地边界 ${record.boundaryId} 已正式确认。` }\n",
  "        const record = await dependencies.boundaries.confirm(\n          context.project.projectId,\n          boundaryId,\n          context.project.currentRevision,\n          { boundaryId, submittedRevision, contentSha256, statement },\n          boundaryContext(invocation, dependencies),\n        )\n        requestPresentationSync(\n          dependencies, invocation, context.project.projectId,\n          `boundary-confirmed:${record.boundaryId}`,\n        )\n        return successWithStatus(\n          `场地边界 ${record.boundaryId} 已正式确认。`,\n          repository.readContext(String(invocation.agent.id)),\n          dependencies,\n        )\n",
)

const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const continuousTests = [
  'tests/presentation-auto-sync.spec.ts',
  'tests/presentation-migration-guidance.spec.ts',
  'tests/parallel-workflow-executor.spec.ts',
  'tests/automation-workflow-committer.spec.ts',
  'tests/coordinator-parallel.spec.ts',
  'tests/presentation-sync-status.client.spec.tsx',
].join(' ')
packageJson.scripts['test:continuous-sync'] = `vitest run ${continuousTests} --maxWorkers=1`
packageJson.scripts['test:presentation-standard'] = packageJson.scripts['test:presentation-standard']
  .replace(' --maxWorkers=1 && node', ` ${continuousTests} --maxWorkers=1 && node`)
await writeFile('package.json', `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')

await replaceOnce(
  '.github/workflows/presentation-standard-project-integration.yml',
  "      - 'tests/presentation-workspace-*.ts'\n",
  "      - 'tests/presentation-workspace-*.ts'\n      - 'tests/presentation-auto-sync.spec.ts'\n      - 'tests/presentation-migration-guidance.spec.ts'\n      - 'tests/presentation-sync-status.client.spec.tsx'\n      - 'tests/parallel-workflow-executor.spec.ts'\n      - 'tests/automation-workflow-committer.spec.ts'\n      - 'tests/coordinator-parallel.spec.ts'\n",
)

await replaceOnce(
  'tests/host-apply.spec.ts',
  "import { PresentationStandardProjectService } from '../src/presentation/standard-project-service.ts'\n",
  "import { PresentationAutoSyncService } from '../src/presentation/auto-sync.ts'\nimport { PresentationStandardProjectService } from '../src/presentation/standard-project-service.ts'\nimport { ParallelWorkflowExecutor } from '../src/runtime/parallel-workflow-executor.ts'\n",
)

await replaceOnce(
  'tests/host-apply.spec.ts',
  "    expect(ctx.get('preplanning')?.standardProjects).toBeInstanceOf(PresentationStandardProjectService)\n",
  "    expect(ctx.get('preplanning')?.standardProjects).toBeInstanceOf(PresentationStandardProjectService)\n    expect(ctx.get('preplanning')?.presentationSync).toBeInstanceOf(PresentationAutoSyncService)\n    expect(ctx.get('preplanning')?.parallel).toBeInstanceOf(ParallelWorkflowExecutor)\n",
)

console.log('CONTINUOUS_SYNC_RUNTIME_WIRING_APPLIED')
