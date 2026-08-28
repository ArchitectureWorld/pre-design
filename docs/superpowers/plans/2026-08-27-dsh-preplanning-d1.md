# DSH 前期策划 D1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建、安装并在真实 DSH Web 中验收 `@architectureworld/dsh-preplanning-agent` 的 D1 最小纵向闭环与重启恢复。

**Architecture:** 单 npm 包用 Cordis patch 装载 Host，并由同一包的 `dsh.client` 声明提供 Browser bundle。Host 在 DSH Storage Domain 中持久化业务事实，通过五个 slash commands 与两个模型工具驱动 Proposal → 人工确认 → Revision；Browser 通过 Slots 和可回放 Conversation Node 展示状态。

**Tech Stack:** TypeScript ESM、Cordis、DeepSeek Harness 0.1.1-rc.2、DSH Storage Domain JSON、Ajv 2020、React 18、Vitest、tsdown、pnpm。

**Spec:** `docs/superpowers/specs/2026-08-27-dsh-preplanning-d1-design.md`

## Global Constraints

- npm 包固定为 `@architectureworld/dsh-preplanning-agent`；插件 ID 固定为 `preplanning-agent`。
- DSH 兼容基线固定为 `0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。
- 合同版本固定为 `0.6.0`，复制自 `pre-design/contracts/v0.6`。
- 插件 ID 使用 `preplanning-agent`；受 DSH Storage Domain 命名约束，存储物理名使用 `preplanning_agent`，表名使用 `state_objects`。
- 模型工具严格限制为 `preplanning_get_context` 与 `preplanning_apply_commands`。
- Project State 不允许 Agent、LLM 或 rendered artifact 直接写入。
- 所有 Gate 只能由自然人通过 `/preplan-confirm` 批准。
- 不修改 DSH 核心，不创建独立 Web、通用 RuntimeAdapter 或产品级 Mock Runtime。

---

### Task 1: D0 兼容性与可安装单 Bundle

**Files:**
- Create: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`
- Create: `cordis.patch.yml`, `compatibility/dsh-baseline.json`
- Create: `src/index.ts`, `src/client/index.tsx`, `src/client/PreplanningBadge.tsx`
- Test: `tests/package-manifest.spec.ts`, `tests/loader-composition.spec.ts`, `tests/browser-plugin.client.spec.tsx`

**Interfaces:**
- Produces Host exports `name`, `inject`, `Config`, `apply` and Browser exports `inject`, `apply`.
- Produces package artifacts `lib/index.js`, `lib/client.js`, `lib/types/**`, `cordis.patch.yml`.

- [x] Write package/Loader/Browser tests that fail because the package and plugins do not exist.
- [x] Run `pnpm vitest run tests/package-manifest.spec.ts tests/loader-composition.spec.ts tests/browser-plugin.client.spec.tsx` and preserve the expected RED output.
- [x] Add the minimal manifest, build config, Host registration and Slot badge.
- [x] Run the same tests, `pnpm typecheck`, `pnpm build`, and `pnpm pack --dry-run`; require clean exits.
- [x] Commit as `feat: establish installable dsh bundle`.

### Task 2: Contract Registry 与持久化 Project State

**Files:**
- Create: `contracts/v0.6/**`
- Create: `src/contracts/registry.ts`, `src/state/domain.ts`, `src/state/types.ts`, `src/state/repository.ts`
- Test: `tests/contracts.spec.ts`, `tests/repository.spec.ts`, `tests/restart-recovery.spec.ts`

**Interfaces:**
- Produces `ContractRegistry.validateStateObject(objectId, value)`.
- Produces `ProjectRepository.createProject`, `bindSession`, `readContext`, `saveProposal`, `confirmProposal`, `listProjects`.

- [x] Copy `pre-design/contracts/v0.6` byte-for-byte and run `python tests/test_contracts.py`; require `949 passed / 0 failed`.
- [x] Write RED tests for project creation, session binding, monotonic revision, immutable audit events and reopening a JSON-backed Domain.
- [x] Implement the schema registry and DSH Domain-backed repository with optimistic revision and serialized durable writes.
- [x] Run focused tests and the full suite; mutate the revision/idempotency branches mentally and confirm a test catches each break.
- [x] Commit as `feat: persist preplanning project state`.

### Task 3: Proposal Gateway、五个命令和两个模型工具

**Files:**
- Create: `src/proposals/gateway.ts`, `src/commands/register.ts`, `src/tools/register.ts`, `src/context/build-context.ts`
- Create: `src/session/events.ts`
- Modify: `src/index.ts`
- Test: `tests/proposal-gateway.spec.ts`, `tests/commands.spec.ts`, `tests/tools.spec.ts`, `tests/session-events.spec.ts`

**Interfaces:**
- Produces `submitProposal(envelope, sessionId)` and `confirmProposal(proposalId, humanActor, sessionId)`.
- Registers slash commands `preplan-new`, `preplan-open`, `preplan-list`, `preplan-status`, `preplan-confirm`.
- Registers only tools `preplanning_get_context`, `preplanning_apply_commands`.

- [x] Write RED tests for no-binding, revision conflict, actor spoofing, invalid PS01, pending human review, idempotent replay and human-only confirmation.
- [x] Implement ProposalEnvelope validation and fail-closed permission/workflow guards.
- [x] Write RED Loader-visible tests for the exact command and tool catalog, then register all commands/tools as lifecycle effects.
- [x] Add controlled context construction and status snapshots carried by native `command/done` / `tool/result` events; run focused and full tests.
- [x] Commit as `feat: add governed d1 interaction flow`.

### Task 4: 可回放 Browser 项目状态卡

**Files:**
- Create: `src/client/status-definition.ts`, `src/client/PreplanningStatusCard.tsx`
- Modify: `src/client/index.tsx`
- Test: `tests/status-definition.client.spec.ts`, `tests/browser-plugin.client.spec.tsx`

**Interfaces:**
- Registers a projection definition for native `command/done` / `tool/result` events and Chat node kind `preplanning-status`.
- Registers keyed renderer through `conversation.chat.node`.

- [x] Write RED tests showing cold replay and pagination derive identical card payloads from Session Log events.
- [x] Implement the event definition without Host-memory reads.
- [x] Write RED tests for keyed Slot registration, late declaration, teardown and Chinese copy.
- [x] Implement the renderer and run jsdom tests plus client bundle build.
- [x] Commit as `feat: render replayable preplanning status`.

### Task 5: 真实 Profile 安装与 D0 验收

**Files:**
- Modify only through CLI: `C:/Users/2899/.dsh/profiles/web/package.json`, lockfile/node_modules generated by `dsh plugin`.
- Evidence: `evidence/d0/**`.

**Interfaces:**
- Consumes packed local tarball through `dsh plugin --profile web add <tarball>`.

- [x] Re-verify the timestamped Web Profile backup and pack the package.
- [x] Install with the official plugin CLI; run desensitized `--dump-config` and assert one enabled `preplanning-agent` row.
- [x] Start `dsh --profile web --no-open --port 0`, capture the printed URL, probe HTTP and open it in the browser.
- [x] Verify Host inventory, exactly two model tools, Browser badge/status contribution and clean unload/reload behavior.
- [x] Stop DSH cleanly; remove/re-add through the official CLI to prove uninstall/install lifecycle.

### Task 6: 真模型 D1 与重启恢复

**Files:**
- Evidence: `evidence/d1/**`
- Deliverable: `README.md`, `docs/acceptance.md`

**Interfaces:**
- Uses the user's configured DSH model route; no model override or credential mutation.

- [ ] In DSH Web execute `/preplan-new`, then ask the real model to continue the 01-01 workflow.
- [ ] Verify the Session Log contains real `preplanning_get_context` and `preplanning_apply_commands` calls and that the proposal remains `pending_review`.
- [ ] Execute `/preplan-confirm <proposalId>` as the user and verify revision 1 plus PS01 provisional/confirmed state according to the command contract.
- [ ] Stop and restart DSH, reopen the same Session, and verify binding, revision, PS01, audit history and status card all recover.
- [ ] Run contract tests, unit/integration tests, typecheck, build and package inspection fresh; record exact counts and failures.
- [ ] Commit as `test: prove d1 in real dsh web` only after all evidence is fresh.
