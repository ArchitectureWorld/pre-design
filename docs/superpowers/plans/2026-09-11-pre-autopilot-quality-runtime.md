# Pre Autopilot Quality Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Pre-design 的自动工作流升级为 Contract 真正可执行、质量可计算、自动返工、例外才人工审核的 Autopilot Runtime。

**Architecture:** 扩展 ContractRegistry 暴露 WorkflowSpec V2 规则；让分析子 Agent 返回 payload + 逐项质量证据；中央 `workflow-quality` 做确定性评分和 disposition；ParallelWorkflowExecutor 承担自动返工和异常分流；GateService 读取质量记录后决定是否可自动放行。保持 DSH 为唯一 Agent Runtime，保持 Presentation 为工具执行层。

**Tech Stack:** TypeScript 5.9, Vitest 3.2, DSH 0.1.1-rc.2, Zod/AJV, GitHub Actions, Node.js >=24.11.0

**Spec:** `docs/superpowers/specs/2026-09-11-pre-autopilot-quality-runtime-design.md`

## Global Constraints

- 继续开发 `feat/pre-v2.0.0`，不新建功能支线。
- DSH 是唯一 Agent/模型/Session/Subagent Runtime。
- Pre-design 负责专业方法、质量判断和汇报设计策略；Presentation 负责工具执行和最终页面状态。
- Automatic 默认 exception-only review；L/M 质量通过自动确认，H 风险进入局部人工审核。
- 不允许 Schema valid 直接等价于专业质量合格。
- 无 Evidence 不得生成伪数据型研究结论。
- 保留 Proposal、Revision、CAS、来源和审计记录。

---

### Task 1: ContractRegistry exposes executable workflow quality rules

**Files:**
- Modify: `src/contracts/types.ts`
- Modify: `src/contracts/registry.ts`
- Test: `tests/contracts.spec.ts`

**Interfaces:**
- Produces `WorkflowDescriptor.evidencePolicy/completionCriteria/reopenTriggers/forbiddenActions/reviewPolicy`.
- Produces `GateDescriptor.precheck/approvalPolicy/returnPolicy` for later Gate V2 work.

- [ ] Add failing tests proving a real v0.6 workflow exposes its completion/evidence/review rules and G1 exposes precheck/approval rules.
- [ ] Run targeted contract test and confirm failure is caused by missing descriptor fields.
- [ ] Extend descriptor types and ContractRegistry parser without changing the v0.6 source-of-truth files.
- [ ] Re-run targeted contract tests.

### Task 2: Structured workflow quality evidence

**Files:**
- Modify: `src/runtime/subagent-workflow-analyzer.ts`
- Create: `src/runtime/workflow-quality.ts`
- Test: `tests/workflow-quality.spec.ts`
- Modify: `tests/parallel-workflow-executor.spec.ts`

**Interfaces:**
- `WorkflowAnalysisCandidate` gains `qualityEvidence`.
- `evaluateWorkflowQuality(descriptor, candidate, options)` returns `WorkflowQualityReport` with disposition `auto_pass | auto_revise | needs_human | blocked_external`.

- [ ] Write failing tests for pass, missing completion coverage, external blocker, low confidence, H-risk escalation and retry-limit escalation.
- [ ] Verify RED.
- [ ] Implement quality types/evaluator.
- [ ] Change analyzer output schema/prompt so every completion criterion and evidence policy is individually assessed.
- [ ] Verify GREEN.

### Task 3: Automatic revision loop

**Files:**
- Modify: `src/runtime/parallel-workflow-executor.ts`
- Modify: `src/runtime/types.ts`
- Modify: `src/governance/types.ts`
- Modify: `src/governance/domain.ts`
- Test: `tests/parallel-workflow-executor.spec.ts`
- Test: `tests/governance-contracts.spec.ts`

**Interfaces:**
- Workflow runs persist the latest `quality` report.
- Analyzer can receive prior quality feedback for a retry.
- Default max attempts = 3 total analyses.

- [ ] Add failing tests: auto-revise retries then confirms; H risk goes pending_review; external blocker goes blocked; exhausted retries go pending_review.
- [ ] Verify RED.
- [ ] Implement retry feedback and quality persistence.
- [ ] Ensure auto confirmation only occurs for `auto_pass`.
- [ ] Verify GREEN.

### Task 4: Proposal automation respects exception-only quality review

**Files:**
- Modify: `src/proposals/gateway.ts`
- Modify: `src/runtime/automation-workflow-committer.ts`
- Test: `tests/proposal-gateway.spec.ts`
- Test: `tests/automation-workflow-committer.spec.ts`

**Interfaces:**
- Automatic commit receives a quality-approved marker/report from the trusted Runtime, never from the model payload.
- H-risk workflows are not auto-committed.

- [ ] Write failing tests for quality-required automatic commit and H-risk rejection.
- [ ] Verify RED.
- [ ] Implement trusted quality handoff.
- [ ] Verify GREEN.

### Task 5: Gate V2 evaluates professional quality

**Files:**
- Modify: `src/runtime/gate-service.ts`
- Modify: `src/runtime/automatic-gate-approver.ts`
- Test: `tests/gate-service.spec.ts`
- Test: `tests/automatic-gate-after-serial.spec.ts`

**Interfaces:**
- `GateEvaluation` gains `qualityReady`, `qualityIssues`, and `needsHuman`.
- AutomaticGateApprover only approves when Gate quality is ready.

- [ ] Add failing tests showing confirmed objects with failed/absent quality cannot auto-approve.
- [ ] Verify RED.
- [ ] Implement quality-aware Gate evaluation.
- [ ] Verify GREEN.

### Task 6: Remove fake-analysis fallbacks from production report planning

**Files:**
- Modify: `src/report/page-plan.ts`
- Test: `tests/report-page-plan.spec.ts`

**Interfaces:**
- Missing evidence produces an explicit analytical gap instead of fabricated audience/daypart levels, amounts, rankings or scores.

- [ ] Add failing tests for no-evidence operation/decision pages.
- [ ] Verify RED.
- [ ] Replace fake data fallbacks with gap/verification-needed visuals or no analytical visual.
- [ ] Verify GREEN.

### Task 7: Production report path authority and legacy renderer deprecation

**Files:**
- Modify: `src/report/package-service.ts`
- Modify: `src/prompts/report-design-skill.ts`
- Modify: `README.md`
- Test: `tests/report-design-skill.spec.ts`

**Interfaces:**
- Production guidance states Presentation Standard Project + Studio is authoritative for final designed pages.
- Legacy report package remains explicitly compatibility/research only until removed.

- [ ] Add failing policy tests.
- [ ] Verify RED.
- [ ] Update runtime guidance and package boundary.
- [ ] Verify GREEN.

### Task 8: Regression and CI gate

**Files:**
- Create: `.github/workflows/pre-autopilot-quality-runtime.yml`
- Modify tests as required only to reflect intentional v2 semantics.

- [ ] Run targeted runtime tests.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm test:built`.
- [ ] Run `git diff --check` equivalent in CI.
- [ ] Do not claim completion until the workflow run on the branch is green.
