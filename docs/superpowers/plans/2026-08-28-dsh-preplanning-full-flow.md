# DSH 前期策划全流程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前 PS01 纵向切片扩展为真实 DSH 中可运行、可恢复、支持人工/全自动双模式和 Gemini 项目级生图子 Agent，并从同一确认 Revision 交付甲方可直接使用的 PPTX、PDF、HTML。

**Architecture:** v0.6 的 57 个状态 Schema 和 57 个 Workflow 继续作为业务合同源，新增独立 `preplanning_governance` Domain 保存 v0.7 执行、授权、Gate、视觉和报告状态，避免破坏已有 v1 存储介质。Host 通过数据驱动的 ContractRegistry、WorkflowRuntime 和 ProposalGateway 推进项目；Browser 只调用命令和下载路由。视觉资产由 DSH `spawn` 的可继续子 Agent 生成；ReportPackage 冻结一个 Revision 后原子生成 HTML、PPTX、PDF。

**Tech Stack:** TypeScript 5.9 ESM、React 18、Cordis/DSH `0.1.1-rc.2`、Zod 4、Ajv 8、PptxGenJS、Microsoft Edge/Chromium headless PDF、Vitest、Testing Library、Python contract tests、pnpm、tsdown。

**Spec:** `docs/superpowers/specs/2026-08-28-dsh-preplanning-full-flow-design.md`

## Global Constraints

- DSH 插件保持单一 npm Bundle，不创建第二套独立 Web 产品，不修改 DSH 核心。
- v0.6 的 57 个状态 Schema、57 个 Workflow、8 个 Gate、47 个原子工具业务语义保持可读；模型仍只看到 `preplanning_get_context` 和 `preplanning_apply_commands`。
- `manual` 是默认模式；`automatic` 必须先有有效 `AutomationAuthorization`，且 Gate 来源必须写成 `automation_authorization`。
- 视觉子 Agent 固定为 provider `spawn`、model provider `antigravity`、model id `gemini-3.1-flash-image`、最大递归深度 1；不得静默替换模型。
- 事实地图、现状照片、红线、CAD/BIM 和统计数据不得由生成模型伪造。
- ReportPackage 只从同一冻结 Revision 构建，PPTX/PDF/HTML 必须通过 `staging → validate → publish` 后一起出现。
- 现有 `0.2.0` 修正版、Session、Storage、Profile、模型设置、凭据和 `work/profile-backups` 必须保留；不读取或输出 API Key。
- 所有生产行为遵守 RED → GREEN → 回归；每个任务只提交列出的文件，不能把无关脏改动混入提交。

## File Structure

### 合同与持久化

- `contracts/v0.7/governance/*.schema.json`：v0.7 治理对象的 JSON Schema。
- `contracts/v0.7/manifest.json`：治理版本和 schema 清单。
- `src/governance/contracts.ts`：加载并验证 v0.7 manifest 与八类治理 Schema。
- `src/governance/types.ts`：双模式、工作项运行、Gate、视觉和报告记录类型。
- `src/governance/domain.ts`：独立 `preplanning_governance` v1 Domain；不改已有 `preplanning_agent` v1 Domain 版本。
- `src/governance/repository.ts`：治理记录的串行持久化和项目快照。

### 合同注册与运行时

- `src/contracts/types.ts`：WorkflowDescriptor、GateDescriptor、依赖图类型。
- `src/contracts/registry.ts`：加载 v0.6 全量合同、schema、Gate 和依赖，不维护手写 57 项清单。
- `src/runtime/workflow-runtime.ts`：就绪计算、状态转换、章节进度和下一工作项。
- `src/runtime/automation-service.ts`：授权、撤销、预算和自动模式有效性。
- `src/runtime/gate-service.ts`：人工/自动 Gate Snapshot 与章节批量确认。
- `src/runtime/revision-service.ts`：按依赖图最小重开下游。
- `src/runtime/question-service.ts`：开放问题、责任人、证据需求和阻断级别。
- `src/runtime/coordinator.ts`：按 Agent turn 推进人工/自动模型工作，不直接写业务状态。

### 视觉资产

- `src/visual/types.ts`：VisualTask、VisualAsset 和质量结果。
- `src/visual/asset-store.ts`：候选图文件落盘、SHA-256、Manifest 与路径边界。
- `src/visual/agent.ts`：项目级 continuable subagent 的创建、恢复、模型固定路由和结果收集。
- `src/visual/quality.ts`：分辨率、格式、空文件、哈希、人工/自动采用门禁。
- `src/visual/session-image-collector.ts`：只收集目标视觉 child Session 的 assistant 图片块。

### 甲方报告

- `src/report/types.ts`：ReportDocument 节点、ReportPackage、ArtifactManifest。
- `src/report/build-document.ts`：从冻结 ProjectContext/Gate/视觉资产构建格式无关内容树。
- `src/report/render-chart.ts`：从已冻结数字生成确定性 SVG 图表，不调用生成模型。
- `src/report/render-html.ts`：离线 HTML 目录与响应式样式。
- `src/report/render-pptx.ts`：16:9 可编辑 PPTX。
- `src/report/render-pdf.ts`：使用同一 HTML 打印模板调用 Edge/Chromium 生成 PDF。
- `src/report/package-service.ts`：staging、三格式验证、哈希和原子发布。
- `src/report/download-route.ts`：只读、路径安全的 `/preplan-export/` 下载路由。

### DSH 界面与验收

- `src/client/PreplanningDashboard.tsx`：8 章/57 项、模式、Gate、视觉和报告总览。
- `src/client/PreplanningProjectForm.tsx`：模式、成果深度、视觉预算创建表单。
- `src/client/report-links.ts`：把 ArtifactManifest 变成 DSH 本地下载链接。
- `tests/fixtures/golden-project/`：版本化只读 Golden Project 资料包与来源清单。
- `tests/full-flow-golden.spec.ts`：57 项、8 Gate、视觉清单和三格式闭环。
- `evidence/d3/`：真实 DSH、模型、重启和交付成果验收记录。

---

### Task 1: 冻结已验证的 0.2.0 基线

**Files:**
- Modify: `README.md`
- Modify: `docs/acceptance.md`
- Modify: `package.json`
- Modify: `src/client/PreplanningLauncher.tsx`
- Modify: `tests/browser-plugin.client.spec.tsx`
- Modify: `tests/built-package.spec.ts`
- Create: `.npmignore`
- Create: `evidence/d2/2026-08-28-direct-use-acceptance.md`

**Interfaces:**
- Produces a clean committed `0.2.0` baseline whose launcher says “使用当前会话所选模型”。
- Preserves the already accepted tarball hash `34BF2175CC1AA4853B4506C24A6F69476AA436F79F77190754F0FB9CE8B3DC43` as historical D2 evidence.

- [ ] **Step 1: 运行当前基线测试并确认真实结果**

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm test:built
```

Expected: Vitest 35/35、typecheck、build、built package 2/2 全部通过。

- [ ] **Step 2: 运行 v0.6 合同门禁**

```powershell
Push-Location contracts\v0.6
python tests\test_contracts.py
Pop-Location
```

Expected: 949 passed。

- [ ] **Step 3: 检查只提交 D2 修正版文件**

```powershell
git diff --check
git status --short
```

Expected: `contracts/v0.6/tests/__pycache__/` 与 `work/` 不进入暂存区。

- [ ] **Step 4: 提交基线**

```powershell
git add README.md docs/acceptance.md package.json src/client/PreplanningLauncher.tsx tests/browser-plugin.client.spec.tsx tests/built-package.spec.ts .npmignore evidence/d2/2026-08-28-direct-use-acceptance.md
git commit -m "release: preserve verified gemini dsh baseline"
```

### Task 2: v0.7 治理合同与兼容 Companion Domain

**Files:**
- Create: `contracts/v0.7/manifest.json`
- Create: `contracts/v0.7/governance/automation-authorization.schema.json`
- Create: `contracts/v0.7/governance/project-policy.schema.json`
- Create: `contracts/v0.7/governance/workflow-run.schema.json`
- Create: `contracts/v0.7/governance/gate-decision.schema.json`
- Create: `contracts/v0.7/governance/visual-generation-policy.schema.json`
- Create: `contracts/v0.7/governance/visual-asset-manifest.schema.json`
- Create: `contracts/v0.7/governance/report-package.schema.json`
- Create: `contracts/v0.7/governance/artifact-manifest.schema.json`
- Create: `src/governance/contracts.ts`
- Create: `src/governance/types.ts`
- Create: `src/governance/domain.ts`
- Create: `src/governance/repository.ts`
- Create: `tests/governance-contracts.spec.ts`
- Create: `tests/governance-repository.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `ConfirmationMode = 'manual' | 'automatic'`.
- Produces `GovernanceRepository.open(facility): Promise<GovernanceRepository>`.
- Produces `readProject(projectId): GovernanceProjectContext` and typed put/update methods for policy, authorization, workflow runs, Gate, visual records and report packages.
- Keeps `preplanningDomainSpec.version === 1`; all new tables live in `preplanningGovernanceDomainSpec.version === 1`.

- [ ] **Step 1: 写治理 Schema RED 测试**

```ts
it('validates the complete v0.7 governance manifest', async () => {
  const registry = await GovernanceContractRegistry.open(new URL('../contracts/v0.7/', import.meta.url))
  expect(registry.schemaIds()).toHaveLength(8)
  expect(registry.validate('automation-authorization', validAuthorization).valid).toBe(true)
  expect(registry.validate('gate-decision', { ...validGate, source: 'human' }).valid).toBe(false)
})
```

- [ ] **Step 2: 运行 RED**

```powershell
pnpm vitest run tests/governance-contracts.spec.ts
```

Expected: FAIL，原因是 v0.7 manifest 和 registry 尚不存在。

- [ ] **Step 3: 写明确的治理类型和 Schema**

```ts
export type ConfirmationMode = 'manual' | 'automatic'
export type WorkflowRunStatus = 'not_started' | 'ready' | 'running' | 'blocked' | 'pending_review' | 'confirmed' | 'not_applicable' | 'superseded'
export type GateDecisionSource = 'human_review' | 'automation_authorization'

export interface ProjectPolicyRecord {
  projectId: string
  mode: ConfirmationMode
  reportDepth: 'standard' | 'extended'
  visualPolicyId?: string
  updatedAt: string
}
```

- [ ] **Step 4: 写兼容存储 RED 测试**

```ts
it('opens legacy and governance domains together and survives reopen', async () => {
  const project = await ProjectRepository.open(storage.domain)
  const governance = await GovernanceRepository.open(storage.domain)
  await governance.createPolicy({ projectId: 'p1', mode: 'manual', reportDepth: 'standard', updatedAt: NOW })
  await governance.close()
  await project.close()
  expect((await GovernanceRepository.open(storage.domain)).readProject('p1').policy.mode).toBe('manual')
})
```

- [ ] **Step 5: 运行 repository RED**

```powershell
pnpm vitest run tests/governance-repository.spec.ts
```

Expected: FAIL，原因是 Companion Domain 尚未实现。

- [ ] **Step 6: 实现 Companion Domain 和串行 repository**

```ts
export const preplanningGovernanceDomainSpec = defineDomain({
  name: 'preplanning_governance',
  version: 1,
  tables: {
    project_policies: domainTable<string, ProjectPolicyRecord>(projectPolicySchema),
    authorizations: domainTable<string, AutomationAuthorizationRecord>(authorizationSchema),
    workflow_runs: domainTable<string, WorkflowRunRecord>(workflowRunSchema),
    gate_decisions: domainTable<string, GateDecisionRecord>(gateDecisionSchema),
    visual_tasks: domainTable<string, VisualTaskRecord>(visualTaskSchema),
    visual_assets: domainTable<string, VisualAssetRecord>(visualAssetSchema),
    report_packages: domainTable<string, ReportPackageRecord>(reportPackageSchema),
  },
})
```

- [ ] **Step 7: 运行聚焦和完整测试**

```powershell
pnpm vitest run tests/governance-contracts.spec.ts tests/governance-repository.spec.ts
pnpm test
```

- [ ] **Step 8: 提交**

```powershell
git add contracts/v0.7 src/governance tests/governance-contracts.spec.ts tests/governance-repository.spec.ts package.json pnpm-lock.yaml
git commit -m "feat: add preplanning governance contracts"
```

### Task 3: 数据驱动 ContractRegistry

**Files:**
- Create: `src/contracts/types.ts`
- Modify: `src/contracts/registry.ts`
- Modify: `tests/contracts.spec.ts`

**Interfaces:**
- Produces `workflow(id: string): WorkflowDescriptor`.
- Produces `workflows(): readonly WorkflowDescriptor[]` sorted by `chapterId/workItemId`.
- Produces `gate(id: string): GateDescriptor`, `dependents(objectId: string): readonly string[]`, and `stateSchema(objectId: string): Readonly<Record<string, unknown>>`.

- [ ] **Step 1: 写 57/8/47 与映射 RED 测试**

```ts
expect(registry.workflows()).toHaveLength(57)
expect(registry.gates()).toHaveLength(8)
expect(registry.atomicToolIds()).toHaveLength(47)
expect(registry.workflow('preplan.wf.08.08')).toMatchObject({ chapterId: '08', targetObjectId: 'IM08', gateId: 'G8' })
expect(registry.workflow('preplan.wf.01.01').targetSchemaId).toBe('urn:preplan:v0.6:state:PS01')
```

- [ ] **Step 2: 运行 RED**

```powershell
pnpm vitest run tests/contracts.spec.ts
```

Expected: FAIL，旧 registry 只返回 ID 列表。

- [ ] **Step 3: 定义 descriptor**

```ts
export interface WorkflowDescriptor {
  workflowId: string
  chapterId: string
  workItemId: string
  title: string
  targetObjectId: string
  targetSchemaId: string
  gateId: string
  requiredUpstream: readonly string[]
  automationLevel: string
  risk: string
  humanReviewMandatory: boolean
  missingDataPolicy: string
}
```

- [ ] **Step 4: 从合同文件和 dependency-graph 加载，不写手工清单**

```ts
const contracts = await Promise.all(files.map(file => readJson<WorkflowContract>(new URL(file, workflowRoot))))
const workflows = contracts.map(contract => toWorkflowDescriptor(contract, stateSchemas))
const dependencyGraph = await readJson<DependencyGraph>(new URL('governance/dependency-graph.json', root))
```

- [ ] **Step 5: 运行测试、typecheck 和合同门禁**

```powershell
pnpm vitest run tests/contracts.spec.ts
pnpm typecheck
Push-Location contracts\v0.6; python tests\test_contracts.py; Pop-Location
```

- [ ] **Step 6: 提交**

```powershell
git add src/contracts tests/contracts.spec.ts
git commit -m "feat: load complete preplanning contract registry"
```

### Task 4: WorkflowRuntime 与 57 项持久执行图

**Files:**
- Create: `src/runtime/workflow-runtime.ts`
- Create: `src/runtime/types.ts`
- Create: `tests/workflow-runtime.spec.ts`

**Interfaces:**
- Produces `initializeProject(projectId: string): Promise<void>`.
- Produces `snapshot(projectId: string): WorkflowSnapshot` with 8 chapter summaries and 57 runs.
- Produces `nextReady(projectId: string): WorkflowDescriptor | undefined`.
- Produces `transition(projectId, workflowId, command): Promise<WorkflowRunRecord>` with fail-closed transition validation.

- [ ] **Step 1: 写初始化与就绪 RED 测试**

```ts
await runtime.initializeProject('p1')
const snapshot = runtime.snapshot('p1')
expect(snapshot.runs).toHaveLength(57)
expect(snapshot.chapters).toHaveLength(8)
expect(runtime.nextReady('p1')?.workflowId).toBe('preplan.wf.01.01')
expect(snapshot.runs.filter(run => run.status === 'ready')).toHaveLength(1)
```

- [ ] **Step 2: 运行 RED**

```powershell
pnpm vitest run tests/workflow-runtime.spec.ts
```

- [ ] **Step 3: 实现状态转换表**

```ts
const ALLOWED: Readonly<Record<WorkflowRunStatus, readonly WorkflowRunStatus[]>> = {
  not_started: ['ready'],
  ready: ['running', 'blocked', 'not_applicable'],
  running: ['blocked', 'pending_review', 'confirmed'],
  blocked: ['ready'],
  pending_review: ['confirmed', 'ready', 'superseded'],
  confirmed: ['superseded'],
  not_applicable: ['superseded'],
  superseded: ['ready'],
}
```

- [ ] **Step 4: 写依赖解锁与阻断 RED 测试**

```ts
await runtime.transition('p1', 'preplan.wf.01.01', { to: 'running' })
await runtime.transition('p1', 'preplan.wf.01.01', { to: 'confirmed', revision: 1 })
expect(runtime.nextReady('p1')?.workflowId).toBe('preplan.wf.01.02')
await runtime.transition('p1', 'preplan.wf.01.02', { to: 'blocked', reason: '缺少权属文件' })
expect(runtime.snapshot('p1').blocked).toHaveLength(1)
```

- [ ] **Step 5: 实现依赖计算和章节统计**

```ts
const ready = descriptor.requiredUpstream.every(id => id === 'ProjectSeed' || committedObjects.has(id))
const progress = runs.filter(run => run.status === 'confirmed' || run.status === 'not_applicable').length
```

- [ ] **Step 6: 运行聚焦、全量和重启测试**

```powershell
pnpm vitest run tests/workflow-runtime.spec.ts tests/restart-recovery.spec.ts
pnpm test
```

- [ ] **Step 7: 提交**

```powershell
git add src/runtime tests/workflow-runtime.spec.ts
git commit -m "feat: execute the 57-item workflow graph"
```

### Task 5: 通用 ProposalGateway 与章内 provisional 提交

**Files:**
- Modify: `src/state/types.ts`
- Modify: `src/state/domain.ts`
- Modify: `src/state/repository.ts`
- Modify: `src/proposals/gateway.ts`
- Modify: `tests/proposal-gateway.spec.ts`
- Create: `tests/proposal-gateway-all-workflows.spec.ts`

**Interfaces:**
- Adds `ProposalStatus = 'pending_review' | 'provisionally_committed' | 'confirmed' | 'returned' | 'validation_failed' | 'rejected'`.
- Produces `commitProposal(proposalId, decision, sessionId): Promise<ConfirmProposalResult>` for any registered workflow target.
- Manual mode writes valid provisional state and defers approval to chapter Gate; automatic mode writes confirmed state only with valid authorization.

- [ ] **Step 1: 写移除 D1 硬编码 RED 测试**

```ts
for (const descriptor of registry.workflows()) {
  const envelope = envelopeFor(descriptor, fixtureFor(descriptor.targetObjectId))
  await expect(gateway.submitProposal(envelope, SESSION)).resolves.toMatchObject({ projectId: PROJECT })
}
```

- [ ] **Step 2: 运行 RED 并确认 `outside-d1` 失败**

```powershell
pnpm vitest run tests/proposal-gateway-all-workflows.spec.ts
```

- [ ] **Step 3: 用 descriptor 校验目标**

```ts
const descriptor = registry.workflow(envelope.workflow_id)
if (envelope.target_object_id !== descriptor.targetObjectId) throw new GatewayError('target-object-mismatch', descriptor.workflowId)
if (envelope.target_schema_id !== descriptor.targetSchemaId) throw new GatewayError('target-schema-mismatch', descriptor.targetSchemaId)
const stateValidation = registry.validateStateObject(descriptor.targetObjectId, envelope.change_set.payload)
```

- [ ] **Step 4: 写 provisional/automatic RED 测试**

```ts
expect((await gateway.commitProposal(id, { source: 'manual_workflow', actor: SYSTEM }, SESSION)).status).toBe('provisionally_committed')
await expect(gateway.commitProposal(id2, { source: 'automation_authorization', authorizationId: 'missing', actor: SYSTEM }, SESSION))
  .rejects.toMatchObject({ code: 'authorization-invalid' })
```

- [ ] **Step 5: 实现通用状态提升和 repository 批次写入**

```ts
const committedPayload = {
  ...payload,
  status: confirmed ? 'confirmed' : 'provisional',
  revision: nextRevision,
  updated_at: committedAt,
  approval: confirmed ? approvedRecord(decision) : pendingApproval(payload.approval),
}
```

- [ ] **Step 6: 运行 57 项矩阵、旧 D1 回归和 typecheck**

```powershell
pnpm vitest run tests/proposal-gateway.spec.ts tests/proposal-gateway-all-workflows.spec.ts
pnpm typecheck
```

- [ ] **Step 7: 提交**

```powershell
git add src/state src/proposals tests/proposal-gateway.spec.ts tests/proposal-gateway-all-workflows.spec.ts
git commit -m "feat: generalize governed proposals to all workflows"
```

### Task 6: 双模式、Gate 与最小修订重开

**Files:**
- Modify: `src/state/types.ts`
- Modify: `src/state/domain.ts`
- Modify: `src/state/repository.ts`
- Create: `src/runtime/automation-service.ts`
- Create: `src/runtime/gate-service.ts`
- Create: `src/runtime/revision-service.ts`
- Create: `src/runtime/question-service.ts`
- Create: `tests/automation-service.spec.ts`
- Create: `tests/gate-service.spec.ts`
- Create: `tests/revision-service.spec.ts`
- Create: `tests/question-service.spec.ts`

**Interfaces:**
- Produces `authorize(projectId, input, actor): Promise<AutomationAuthorizationRecord>` and `revoke(...)`.
- Produces `evaluateGate(projectId, gateId): GateEvaluation` and `decideGate(projectId, gateId, decision): Promise<GateDecisionRecord>`.
- Produces `reopen(projectId, changedObjectIds, request): Promise<readonly string[]>`.
- Produces `openQuestion(projectId, input)`, `resolveQuestion(projectId, questionId, evidenceIds)` and `blockingQuestions(projectId)`.

- [ ] **Step 1: 写授权生命周期 RED 测试**

```ts
const auth = await automation.authorize('p1', { baseRevision: 0, workflowIds: ALL, gateIds: GATES, maxImages: 20 }, OWNER)
expect(automation.requireValid('p1', 12).authorizationId).toBe(auth.authorizationId)
await automation.revoke('p1', auth.authorizationId, OWNER)
expect(() => automation.requireValid('p1', 13)).toThrowError(/authorization/)
```

- [ ] **Step 2: 写 8 Gate 双来源 RED 测试**

```ts
await expect(gates.decideGate('p1', 'G1', { source: 'human_review', actor: AGENT })).rejects.toThrow(/decision_owner/)
expect((await gates.decideGate('p1', 'G1', { source: 'human_review', actor: OWNER })).source).toBe('human_review')
expect((await gates.decideGate('p2', 'G1', { source: 'automation_authorization', authorizationId: authId, actor: SYSTEM })).source)
  .toBe('automation_authorization')
```

- [ ] **Step 3: 写最小下游重开 RED 测试**

```ts
const reopened = await revisions.reopen('p1', ['PS04'], request)
expect(reopened).toEqual(registry.dependents('PS04'))
expect(runtime.snapshot('p1').runs.find(run => run.workflowId === 'preplan.wf.01.01')?.status).toBe('confirmed')
```

- [ ] **Step 4: 运行 RED**

```powershell
pnpm vitest run tests/automation-service.spec.ts tests/gate-service.spec.ts tests/revision-service.spec.ts tests/question-service.spec.ts
```

- [ ] **Step 5: 实现授权、Gate Snapshot 和依赖重开**

```ts
const source: GateDecisionSource = mode === 'automatic' ? 'automation_authorization' : 'human_review'
const affected = new Set(changedObjectIds.flatMap(id => registry.dependents(id)))
await Promise.all([...affected].map(id => runtime.supersedeByObject(projectId, id, request.requestId)))
if (question.blockingLevel === 'hard' && question.evidenceIds.length === 0) await runtime.block(question.workflowId, question.prompt)
```

- [ ] **Step 6: 运行聚焦和全量回归**

```powershell
pnpm vitest run tests/automation-service.spec.ts tests/gate-service.spec.ts tests/revision-service.spec.ts tests/question-service.spec.ts
pnpm test
```

- [ ] **Step 7: 提交**

```powershell
git add src/state src/runtime tests/automation-service.spec.ts tests/gate-service.spec.ts tests/revision-service.spec.ts tests/question-service.spec.ts
git commit -m "feat: govern manual and automatic preplanning modes"
```

### Task 7: 受控上下文、全流程工具与 Agent Coordinator

**Files:**
- Modify: `src/context/build-context.ts`
- Modify: `src/tools/register.ts`
- Modify: `src/prompts/preplanning-system.ts`
- Create: `src/runtime/coordinator.ts`
- Modify: `src/commands/register.ts`
- Modify: `src/index.ts`
- Modify: `tests/tools.spec.ts`
- Modify: `tests/commands.spec.ts`
- Modify: `tests/host-apply.spec.ts`
- Create: `tests/coordinator.spec.ts`

**Interfaces:**
- `preplanning_get_context` returns mode, authorization, next workflow descriptor, exact target schema, upstream snapshot, blockers, chapter/Gate progress and report/visual summary.
- `preplanning_apply_commands` remains the only model mutation tool and routes through gateway/runtime.
- Adds commands `/preplan-mode`, `/preplan-run`, `/preplan-pause`, `/preplan-gate`, `/preplan-revise`, `/preplan-export` while retaining existing commands.
- Produces `AutomationCoordinator.start(agent, projectId)` and `pause(projectId)`.

- [ ] **Step 1: 写工具表面与上下文 RED 测试**

```ts
expect(ctx.tools.list(agent).map(row => row.name).filter(name => name.startsWith('preplanning_')))
  .toEqual(['preplanning_apply_commands', 'preplanning_get_context'])
expect(context.nextWorkflow).toMatchObject({ workflowId: 'preplan.wf.01.01', targetObjectId: 'PS01' })
expect(context.targetSchema.$id).toBe('urn:preplan:v0.6:state:PS01')
```

- [ ] **Step 2: 写 Coordinator RED 测试**

```ts
await coordinator.start(fakeAgent, 'p-auto')
expect(fakeAgent.followups[0]).toContain('只处理 nextWorkflow')
await fakeAgent.finishTurn()
expect(fakeAgent.followups).toHaveLength(2)
await coordinator.pause('p-auto')
await fakeAgent.finishTurn()
expect(fakeAgent.followups).toHaveLength(2)
```

- [ ] **Step 3: 运行 RED**

```powershell
pnpm vitest run tests/tools.spec.ts tests/coordinator.spec.ts tests/commands.spec.ts
```

- [ ] **Step 4: 实现每轮一个工作项的可恢复协调**

```ts
while (this.running.has(projectId)) {
  const next = this.runtime.nextReady(projectId)
  if (!next) return
  agent.followup(userMessageFor(next))
  await agent.whenIdle()
  if (this.runtime.snapshot(projectId).blocked.length > 0) return
}
```

- [ ] **Step 5: 更新系统提示为 descriptor 驱动**

```ts
export const PREPLANNING_SYSTEM_PROMPT = `前期策划工作只能来自 preplanning_get_context 返回的 nextWorkflow。每轮只提交该 workflow 的一个 ProposalEnvelope；禁止猜测其他 Schema、绕过 blocked、直接确认 Gate 或写 Project State。`
```

- [ ] **Step 6: 接入 Host 服务和命令**

```ts
export const inject = ['agents', 'commands', 'llm', 'storage', 'storageDomain', 'subagents', 'systemPrompt', 'tools', 'webServer']
```

- [ ] **Step 7: 运行工具、Host、命令、typecheck 和全量测试**

```powershell
pnpm vitest run tests/tools.spec.ts tests/coordinator.spec.ts tests/commands.spec.ts tests/host-apply.spec.ts
pnpm typecheck
pnpm test
```

- [ ] **Step 8: 提交**

```powershell
git add src/context src/tools src/prompts src/runtime/coordinator.ts src/commands src/index.ts tests/tools.spec.ts tests/coordinator.spec.ts tests/commands.spec.ts tests/host-apply.spec.ts
git commit -m "feat: orchestrate the complete dsh preplanning flow"
```

### Task 8: 项目级 Gemini 视觉子 Agent

**Files:**
- Create: `src/visual/types.ts`
- Create: `src/visual/asset-store.ts`
- Create: `src/visual/quality.ts`
- Create: `src/visual/agent.ts`
- Create: `src/visual/session-image-collector.ts`
- Create: `tests/visual-asset-store.spec.ts`
- Create: `tests/visual-quality.spec.ts`
- Create: `tests/visual-agent.spec.ts`
- Create: `tests/visual-session-image-collector.spec.ts`
- Modify: `src/index.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `VisualAgentService.ensureProjectAgent(parent, projectId): Promise<string>`.
- Produces `probeModel(): Promise<{ provider: 'antigravity'; model: 'gemini-3.1-flash-image'; advertised: boolean }>`; advisory catalog absence is recorded, while a failed exact-route call blocks without substitution.
- Produces `generate(parent, task): Promise<VisualAssetRecord>` and `adopt(projectId, assetId, revision)`.
- Stores the exact route `spawn / antigravity / gemini-3.1-flash-image` and child id in governance records.

- [ ] **Step 1: 写 provider/model/深度 RED 测试**

```ts
await visual.ensureProjectAgent(parent, 'p1')
expect(llm.listModels).toHaveBeenCalledWith('antigravity')
expect(subagents.startContinuable).toHaveBeenCalledWith(expect.objectContaining({
  provider: 'spawn',
  request: expect.objectContaining({
    agentOptions: { provider: 'antigravity', model: 'gemini-3.1-flash-image' },
    maxDepth: 1,
    toolFilter: { allow: [] },
  }),
}))
```

- [ ] **Step 2: 写模型缺失和禁止静默替换 RED 测试**

```ts
subagents.startContinuable.mockRejectedValueOnce(new Error('model not found'))
await expect(visual.ensureProjectAgent(parent, 'p1')).rejects.toMatchObject({ code: 'visual-model-unavailable' })
expect(governance.readProject('p1').visualTasks[0]?.status).toBe('blocked')
```

- [ ] **Step 3: 写资产边界和质量 RED 测试**

```ts
await expect(store.saveCandidate(task, { mimeType: 'image/png', data: PNG_BASE64 })).resolves.toMatchObject({ sha256: expect.any(String) })
await expect(store.saveCandidate(task, { mimeType: 'text/html', data: 'x' })).rejects.toThrow(/image/)
expect(checkQuality({ width: 64, height: 64, bytes: 12 }).accepted).toBe(false)
```

- [ ] **Step 4: 运行 RED**

```powershell
pnpm vitest run tests/visual-agent.spec.ts tests/visual-asset-store.spec.ts tests/visual-quality.spec.ts tests/visual-session-image-collector.spec.ts
```

- [ ] **Step 5: 实现精确模型预检、continuable child 创建和恢复**

```ts
const advertised = (await this.llm.listModels('antigravity')).some(row => row.id === 'gemini-3.1-flash-image')
const start = await this.subagents.startContinuable({
  provider: 'spawn',
  label: `preplanning_visual_agent:${projectId}`,
  childId: persistedChildId,
  request: {
    parent,
    prompt: [{ type: 'text', text: initialVisualPersona(projectId) }],
    agentOptions: { provider: 'antigravity', model: 'gemini-3.1-flash-image', maxTokens: 8192 },
    maxDepth: 1,
    toolFilter: { allow: [] },
    persona: VISUAL_PERSONA,
  },
  signal,
})
```

- [ ] **Step 6: 实现生成、事件收集、落盘和 adopted 门禁**

```ts
await this.subagents.followup(parent, childId, taskPrompt(task), { source: coordinatorSource(parent), signal })
const image = await this.collector.waitForImage(childId, task.taskId, signal)
const candidate = await this.store.saveCandidate(task, image)
return this.quality.accept(candidate) ? this.repository.recordCandidate(candidate) : this.repository.rejectCandidate(candidate)
```

- [ ] **Step 7: 运行聚焦、全量、build**

```powershell
pnpm vitest run tests/visual-agent.spec.ts tests/visual-asset-store.spec.ts tests/visual-quality.spec.ts tests/visual-session-image-collector.spec.ts
pnpm test
pnpm build
```

- [ ] **Step 8: 提交**

```powershell
git add src/visual src/index.ts tests/visual-agent.spec.ts tests/visual-asset-store.spec.ts tests/visual-quality.spec.ts tests/visual-session-image-collector.spec.ts package.json pnpm-lock.yaml
git commit -m "feat: add governed gemini visual subagent"
```

### Task 9: 同源 ReportDocument 与甲方级 HTML

**Files:**
- Create: `src/report/types.ts`
- Create: `src/report/build-document.ts`
- Create: `src/report/render-html.ts`
- Create: `src/report/render-chart.ts`
- Create: `src/report/theme.ts`
- Create: `tests/report-document.spec.ts`
- Create: `tests/report-html.spec.ts`
- Create: `tests/report-chart.spec.ts`

**Interfaces:**
- Produces `buildReportDocument(input: FrozenProjectInput): ReportDocument`.
- Produces `renderHtml(document, outputDir): Promise<RenderedArtifact>`.
- ReportDocument contains client-facing sections, not raw state JSON.

- [ ] **Step 1: 写 17 章节结构与无调试字段 RED 测试**

```ts
const document = buildReportDocument(goldenInput)
expect(document.sections.map(section => section.id)).toEqual(EXPECTED_REPORT_SECTIONS)
expect(JSON.stringify(document)).not.toMatch(/debug|raw json|tool call/i)
expect(document.meta.sourceRevision).toBe(goldenInput.revision)
```

- [ ] **Step 2: 写 HTML 离线交付 RED 测试**

```ts
const artifact = await renderHtml(document, outputDir)
const html = await readFile(join(outputDir, 'html', 'index.html'), 'utf8')
expect(html).toContain('核心结论与需甲方决策事项')
expect(html).toContain('data-report-revision="57"')
expect(await findBrokenLocalLinks(join(outputDir, 'html'))).toEqual([])
```

- [ ] **Step 3: 运行 RED**

```powershell
pnpm vitest run tests/report-document.spec.ts tests/report-html.spec.ts
```

- [ ] **Step 4: 定义格式无关节点**

```ts
export type ReportNode =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string; evidenceIds?: readonly string[] }
  | { type: 'metric'; label: string; value: string; basis: string }
  | { type: 'table'; columns: readonly string[]; rows: readonly (readonly string[])[] }
  | { type: 'chart'; chartId: string; chartType: 'bar' | 'line' | 'donut'; labels: readonly string[]; values: readonly number[]; unit: string }
  | { type: 'map'; assetId: string; caption: string; evidenceIds: readonly string[] }
  | { type: 'image'; assetId: string; caption: string }
  | { type: 'comparison' | 'timeline' | 'warning' | 'decision'; title: string; items: readonly string[] }
```

- [ ] **Step 5: 实现语义映射与证据边界**

```ts
const chapters = REPORT_SECTIONS.map(section => buildSection(section, input.stateObjects, input.gates, input.visualAssets))
return deepFreeze({ meta: reportMeta(input), executiveSummary: buildExecutiveSummary(input), sections: chapters })
```

- [ ] **Step 6: 实现自包含 HTML 主题和本地资源**

```ts
const charts = await renderDeterministicCharts(document, join(htmlDir, 'assets'))
await writeFile(join(htmlDir, 'index.html'), renderDocumentShell(document, { css: CLIENT_REPORT_CSS, charts }), 'utf8')
await copyAdoptedAssets(document, htmlDir)
```

- [ ] **Step 7: 运行聚焦、无断链和视觉 smoke**

```powershell
pnpm vitest run tests/report-document.spec.ts tests/report-html.spec.ts tests/report-chart.spec.ts
pnpm typecheck
```

- [ ] **Step 8: 提交**

```powershell
git add src/report tests/report-document.spec.ts tests/report-html.spec.ts tests/report-chart.spec.ts
git commit -m "feat: render client-ready preplanning html"
```

### Task 10: PPTX、PDF 与原子 ReportPackage

**Files:**
- Create: `src/report/render-pptx.ts`
- Create: `src/report/render-pdf.ts`
- Create: `src/report/package-service.ts`
- Create: `src/report/validate-artifacts.ts`
- Create: `src/report/download-route.ts`
- Create: `tests/report-pptx.spec.ts`
- Create: `tests/report-pdf.spec.ts`
- Create: `tests/report-package.spec.ts`
- Create: `tests/download-route.spec.ts`
- Modify: `src/index.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces `renderPptx(document, outputPath): Promise<RenderedArtifact>`.
- Produces `renderPdf(htmlPath, outputPath, browserExecutable): Promise<RenderedArtifact>`.
- Produces `ReportPackageService.publish(projectId, revision): Promise<ArtifactManifestRecord>`.
- Registers read-only `/preplan-export/:packageId/:fileName` under `ctx.webServer`.

- [ ] **Step 1: 添加锁定版本依赖**

```powershell
pnpm add pptxgenjs@4.0.1
```

- [ ] **Step 2: 写 PPTX/PDF RED 测试**

```ts
await renderPptx(document, pptxPath)
const pptx = await inspectPptx(pptxPath)
expect(pptx.slideCount).toBeGreaterThanOrEqual(35)
expect(pptx.slideCount).toBeLessThanOrEqual(60)
expect(pptx.missingRelationships).toEqual([])
await renderPdf(htmlPath, pdfPath, fakeBrowser)
expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe('%PDF-')
expect(await inspectPdf(pdfPath)).toMatchObject({ blankPages: [], chineseFontsEmbeddedOrReferenced: true })
```

- [ ] **Step 3: 写原子发布 RED 测试**

```ts
renderer.pdf.mockRejectedValueOnce(new Error('print failed'))
await expect(service.publish('p1', 57)).rejects.toThrow(/print failed/)
expect(await pathExists(publicDir)).toBe(false)
expect(repository.latestPublished('p1')).toBeUndefined()
await expect(service.publish('p2', 57)).rejects.toThrow(/required visual asset/)
```

- [ ] **Step 4: 写下载路径穿越 RED 测试**

```ts
expect(await request('/preplan-export/pkg/../settings.yaml')).toMatchObject({ status: 404 })
expect(await request('/preplan-export/pkg/report.pdf')).toMatchObject({ status: 200, headers: expect.objectContaining({ 'content-type': 'application/pdf' }) })
```

- [ ] **Step 5: 运行 RED**

```powershell
pnpm vitest run tests/report-pptx.spec.ts tests/report-pdf.spec.ts tests/report-package.spec.ts tests/download-route.spec.ts
```

- [ ] **Step 6: 实现 PPTX 主题、母版和可编辑元素**

```ts
const pptx = new pptxgen()
pptx.layout = 'LAYOUT_WIDE'
pptx.author = 'ArchitectureWorld 前期策划'
applyTheme(pptx, REPORT_THEME)
for (const section of document.sections) addSectionSlides(pptx, section, assets)
await pptx.writeFile({ fileName: outputPath })
```

- [ ] **Step 7: 实现 Edge/Chromium PDF 端口**

```ts
await spawnChecked(browserExecutable, [
  '--headless=new', '--disable-gpu', `--print-to-pdf=${outputPath}`, '--print-to-pdf-no-header', pathToFileURL(htmlPath).href,
])
```

- [ ] **Step 8: 实现 staging 原子发布和 manifest 哈希**

```ts
const staging = await mkdtemp(join(packageRoot, '.staging-'))
await Promise.all([renderHtml(doc, staging), renderPptx(doc, join(staging, 'report.pptx')), renderPdf(join(staging, 'html/index.html'), join(staging, 'report.pdf'), browser)])
const manifest = await validateAndHash(staging, doc.meta.sourceRevision)
await rename(staging, publishedDir)
await governance.publishReportPackage(manifest)
```

- [ ] **Step 9: 运行聚焦、build、built package**

```powershell
pnpm vitest run tests/report-pptx.spec.ts tests/report-pdf.spec.ts tests/report-package.spec.ts tests/download-route.spec.ts
pnpm build
pnpm test:built
```

- [ ] **Step 10: 提交**

```powershell
git add src/report src/index.ts tests/report-pptx.spec.ts tests/report-pdf.spec.ts tests/report-package.spec.ts tests/download-route.spec.ts package.json pnpm-lock.yaml
git commit -m "feat: publish atomic pptx pdf and html reports"
```

### Task 11: DSH Browser 总览、双模式和成果下载

**Files:**
- Create: `src/client/PreplanningDashboard.tsx`
- Create: `src/client/PreplanningProjectForm.tsx`
- Create: `src/client/report-links.ts`
- Modify: `src/client/PreplanningLauncher.tsx`
- Modify: `src/client/PreplanningStatusCard.tsx`
- Modify: `src/client/status-definition.ts`
- Modify: `src/client/index.tsx`
- Modify: `src/session/events.ts`
- Modify: `tests/browser-plugin.client.spec.tsx`
- Modify: `tests/session-events.spec.ts`
- Modify: `tests/status-definition.client.spec.ts`
- Create: `tests/preplanning-dashboard.client.spec.tsx`

**Interfaces:**
- Project form chooses `manual|automatic`, report depth and visual policy before start.
- Dashboard displays plugin status, model route, 8 chapters/57 items, blockers, Gate, visual counts, revision and three download buttons.
- Every write uses `remote.commands.execute`; file links use `/preplan-export/` URLs.

- [ ] **Step 1: 写项目创建双模式 RED 测试**

```tsx
fireEvent.click(view.getByLabelText('全自动完成'))
fireEvent.change(view.getByLabelText('概念图预算上限'), { target: { value: '20' } })
fireEvent.click(view.getByRole('button', { name: '创建并开始全流程' }))
expect(commandLines).toEqual(expect.arrayContaining(['/preplan-mode automatic']))
```

- [ ] **Step 2: 写总览和下载 RED 测试**

```tsx
expect(view.getByText('8 章 · 57 项')).toBeTruthy()
expect(view.getByText('人工确认')).toBeTruthy()
expect(view.getByRole('link', { name: '下载 PPTX' })).toHaveAttribute('href', expect.stringContaining('/preplan-export/'))
expect(view.getByRole('link', { name: '下载 PDF' })).toBeTruthy()
expect(view.getByRole('link', { name: '浏览 HTML' })).toBeTruthy()
```

- [ ] **Step 3: 运行 RED**

```powershell
pnpm vitest run tests/preplanning-dashboard.client.spec.tsx tests/browser-plugin.client.spec.tsx
```

- [ ] **Step 4: 扩展可回放状态投影**

```ts
export interface PreplanningStatusEventData {
  projectId: string
  revision: number
  mode: 'manual' | 'automatic'
  chapters: readonly { id: string; completed: number; total: number; gateStatus: string }[]
  blocked: number
  visual: { candidates: number; adopted: number; blocked: number }
  reportPackage?: { id: string; pptx: string; pdf: string; html: string }
}
```

- [ ] **Step 5: 实现响应式 Dashboard 和命令适配**

```tsx
return <section aria-label="前期策划项目总览">
  <ProjectHeader status={status} />
  <ChapterGrid chapters={status.chapters} />
  <VisualSummary visual={status.visual} />
  <ReportDownloads reportPackage={status.reportPackage} />
</section>
```

- [ ] **Step 6: 运行 Browser、回放、无障碍和 typecheck**

```powershell
pnpm vitest run tests/preplanning-dashboard.client.spec.tsx tests/browser-plugin.client.spec.tsx tests/session-events.spec.ts tests/status-definition.client.spec.ts
pnpm typecheck
pnpm test
```

- [ ] **Step 7: 提交**

```powershell
git add src/client src/session tests/preplanning-dashboard.client.spec.tsx tests/browser-plugin.client.spec.tsx tests/session-events.spec.ts tests/status-definition.client.spec.ts
git commit -m "feat: add full preplanning dsh dashboard"
```

### Task 12: Golden Project、三格式一致性和真实 DSH 验收

**Files:**
- Create: `tests/fixtures/golden-project/project-brief.json`
- Create: `tests/fixtures/golden-project/evidence-manifest.json`
- Create: `tests/fixtures/golden-project/state/*.json`
- Create: `tests/fixtures/golden-project/assets/*`
- Create: `tests/full-flow-golden.spec.ts`
- Create: `scripts/build-golden-project.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/acceptance.md`
- Create: `evidence/d3/2026-08-28-full-flow-acceptance.md`
- Deliverable: `outputs/dsh-preplanning-0.7.0/architectureworld-dsh-preplanning-agent-0.7.0.tgz`
- Deliverable: `outputs/dsh-preplanning-0.7.0/golden-project/report.pptx`
- Deliverable: `outputs/dsh-preplanning-0.7.0/golden-project/report.pdf`
- Deliverable: `outputs/dsh-preplanning-0.7.0/golden-project/html/index.html`

**Interfaces:**
- `pnpm golden:build` creates one 57-item, 8-Gate, same-Revision report package from the frozen fixture pack.
- Final package version is `0.7.0`.

- [ ] **Step 1: 写完整闭环 RED 测试**

```ts
const result = await runGoldenProject(fixtureRoot, outputRoot)
expect(result.workflowCounts).toEqual({ total: 57, confirmed: 57, blocked: 0 })
expect(result.gateCounts).toEqual({ total: 8, decided: 8 })
expect(result.visualCounts.aiConcepts).toBeGreaterThanOrEqual(12)
expect(result.visualCounts.aiConcepts).toBeLessThanOrEqual(20)
expect(result.visualCounts.deterministicCharts).toBeGreaterThanOrEqual(15)
expect(result.visualCounts.deterministicCharts).toBeLessThanOrEqual(25)
expect(result.manifest.sourceRevision).toBe(result.project.currentRevision)
expect(result.manifest.artifacts.map(row => row.format).sort()).toEqual(['html', 'pdf', 'pptx'])
```

- [ ] **Step 2: 写跨格式一致性 RED 测试**

```ts
const expected = { revision: manifest.sourceRevision, recommendation: manifest.recommendationId, adoptedAssets: manifest.adoptedAssetIds }
expect(await inspectHtml(htmlPath)).toMatchObject(expected)
expect(await inspectPptx(pptxPath)).toMatchObject(expected)
expect(await inspectPdfMetadata(pdfPath)).toMatchObject({ revision: expected.revision })
```

- [ ] **Step 3: 运行 RED**

```powershell
pnpm vitest run tests/full-flow-golden.spec.ts
```

- [ ] **Step 4: 建立冻结资料包和构建脚本**

```ts
const fixture = await loadAndVerifyEvidenceManifest(fixtureRoot)
const project = await seedGoldenProject(fixture, repositories)
await completeAllWorkflows(project, runtime, gateway, gates)
return reports.publish(project.projectId, project.currentRevision)
```

- [ ] **Step 5: 生成并程序化核验三种成果**

```powershell
pnpm golden:build
pnpm vitest run tests/full-flow-golden.spec.ts
```

- [ ] **Step 6: 进行甲方质量人工抽检**

```text
PPTX：16:9、35–60 页、无溢出、无调试字段、核心结论先行、采用图清晰。
PDF：目录和分页正确、无空白页、中文字体正常、打印阅读清晰。
HTML：离线打开、章节导航有效、图片和图表无断链、三种格式结论一致。
```

- [ ] **Step 7: 运行全部新鲜门禁**

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm test:built
Push-Location contracts\v0.6; python tests\test_contracts.py; Pop-Location
```

- [ ] **Step 8: 打包 0.7.0 并核验内容与哈希**

```powershell
pnpm pack --pack-destination ..\..\outputs\dsh-preplanning-0.7.0
Get-FileHash -Algorithm SHA256 ..\..\outputs\dsh-preplanning-0.7.0\architectureworld-dsh-preplanning-agent-0.7.0.tgz
```

- [ ] **Step 9: 官方 CLI 安装并进行真实 DSH 双模式验收**

```powershell
dsh plugin --profile web remove @architectureworld/dsh-preplanning-agent
dsh plugin --profile web add <final-0.7.0-tarball>
dsh --profile web --dump-config
```

Acceptance: Host/Browser 均加载；真实 Gemini 文本模型各运行一条 manual 与 automatic 流；`spawn / antigravity / gemini-3.1-flash-image` 生成方向图组和方案图组；页面先展示插件运行证据，再展示 PPTX/PDF/HTML 预览和下载。

- [ ] **Step 10: 重启恢复验收**

```text
正常停止并重启 DSH；重新打开相同 Session，核对项目绑定、57 项状态、8 Gate、授权来源、视觉 child id、adopted 资产、ReportPackage 和三种下载文件。
```

- [ ] **Step 11: 更新证据和提交交付版**

```powershell
git add tests/fixtures/golden-project tests/full-flow-golden.spec.ts scripts/build-golden-project.ts package.json pnpm-lock.yaml README.md docs/acceptance.md evidence/d3
git commit -m "release: deliver full dsh preplanning reports"
```
