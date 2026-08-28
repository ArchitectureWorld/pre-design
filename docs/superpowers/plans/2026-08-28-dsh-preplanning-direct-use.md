# DSH 前期策划直接使用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在真实 DSH 会话内用一句自然语言启动 01-01，并在状态卡完成人工确认，无需手工 slash command 或合同文件搜索。

**Architecture:** Browser 插件在会话头部提供快速启动面板，通过 DSH 官方 `remote.commands.execute` 创建项目，再通过当前 `Session.prompt` 驱动 Qwen。Host 系统提示提供最小可执行合同指南；可回放状态投影携带待确认 proposal ID，状态卡仍通过用户命令路径确认 Gate。

**Tech Stack:** TypeScript ESM、React 18、Cordis Slots、DSH Client Runtime `0.1.1-rc.2`、Vitest、Testing Library、tsdown、pnpm。

**Spec:** `docs/superpowers/specs/2026-08-28-dsh-preplanning-direct-use-design.md`

## Global Constraints

- 实际验收模型固定为 `qwen3.8:27b`，页面显示 `Qwen3.8 27B`。
- 不修改 DSH 核心、用户凭据、旧 Session、Storage 或 `work/profile-backups`。
- 模型工具仍严格只有 `preplanning_get_context` 和 `preplanning_apply_commands`。
- Gate 只能由自然人通过 `/preplan-confirm` 命令处理器确认。
- 所有生产行为先有失败测试，并观察到预期 RED 后再实现。

---

### Task 1: 一句话启动编排

**Files:**
- Create: `src/client/direct-start.ts`
- Test: `tests/direct-start.client.spec.ts`

**Interfaces:**
- Produces `deriveProjectName(statement: string): string`。
- Produces `buildDirectUsePrompt(input: { projectName: string; statement: string }): string`。
- Produces `startDirectPreplanning(port, input): Promise<void>`；`port.executeCommand(line)` 返回命令业务结果，`port.prompt(text)` 返回 prompt 接收结果。

- [ ] **Step 1: 写项目名推导 RED 测试**：以“新建鄂州体育中心项目并完成 01-01 身份校准”为输入，手工期望 `鄂州体育中心项目`；空输入返回空串，长名称截断到 48 字符。
- [ ] **Step 2: 运行 `pnpm vitest run tests/direct-start.client.spec.ts`**，确认因模块不存在失败。
- [ ] **Step 3: 实现最小推导函数**：只做前缀清理、分隔符截断、空白归一和长度限制。
- [ ] **Step 4: 写编排 RED 测试**：命令返回 error 时 prompt 调用数为 0；success 时命令行是 `/preplan-new 鄂州体育中心项目` 且 prompt 仅一次包含用户原话、get-context 和禁止合同搜索要求。
- [ ] **Step 5: 运行聚焦测试**，确认编排 API 缺失导致预期失败。
- [ ] **Step 6: 实现 `buildDirectUsePrompt` 与 `startDirectPreplanning`**，对空项目名/原话、未匹配命令、业务 error、prompt error 返回具体中文错误。
- [ ] **Step 7: 运行聚焦测试和全量 Vitest**，要求通过且无 warning。
- [ ] **Step 8: 提交**：`feat: orchestrate direct preplanning start`。

### Task 2: DSH 会话头部快速启动面板

**Files:**
- Create: `src/client/PreplanningLauncher.tsx`
- Modify: `src/client/index.tsx`
- Modify: `tests/browser-plugin.client.spec.tsx`

**Interfaces:**
- Consumes Task 1 的 `deriveProjectName` 与 `startDirectPreplanning`。
- Produces `PreplanningLauncher({ start })`，`start` 接收 `{ projectName, statement }`。
- Browser `apply()` 通过 `ctx.sessions.binding(sessionId)`、`ctx.remote.commands.execute()` 和 `Session.prompt()` 提供真实 start port。

- [ ] **Step 1: 扩展 Browser RED 测试**：点击“前期策划”后看见一句话输入；输入示例句自动显示项目名；提交后真实组件显示执行中与成功文案。
- [ ] **Step 2: 运行 Browser 聚焦测试**，确认找不到输入与按钮。
- [ ] **Step 3: 实现面板**：使用原生 form/input/textarea/button、`aria-label`、关闭按钮、执行中禁用和错误区域，不引入 UI 依赖。
- [ ] **Step 4: 扩展集成 RED 测试**：完整 remote 返回 success 时记录一条 `/preplan-new ...` 和一条 prompt；命令 error 时页面显示错误且 prompt 为 0。
- [ ] **Step 5: 修改 Browser `inject` 与 Slot 注册**：注入 `sessions`、`remote.commands`，组件回调只使用当前 `sessionId` 的 binding；teardown 仍由 `slots.inject/register` 管理。
- [ ] **Step 6: 运行 Browser 测试、类型检查和全量 Vitest**。
- [ ] **Step 7: 提交**：`feat: add dsh preplanning launcher`。

### Task 3: 无文件搜索的 Qwen 合同指南

**Files:**
- Create: `src/prompts/preplanning-system.ts`
- Modify: `src/index.ts`
- Modify: `tests/host-apply.spec.ts`

**Interfaces:**
- Produces `PREPLANNING_SYSTEM_PROMPT`，由 Host 唯一 system-prompt section 注册。
- 提示覆盖 ProposalEnvelope 与 PS01 的全部必填字段、固定枚举、用户陈述证据和人工 Gate 边界。

- [ ] **Step 1: 写 Host RED 测试**：注册后的真实 system-prompt section 必须能让测试代理从给定 context 和用户陈述构造一个通过 `ContractRegistry.validateStateObject('PS01')` 的最小 payload，并明确禁止读取文件系统合同。
- [ ] **Step 2: 运行 `pnpm vitest run tests/host-apply.spec.ts`**，确认旧的一句提示缺少可执行指南而失败。
- [ ] **Step 3: 实现常量并替换 `src/index.ts` 内联文本**，不改变两工具目录或 Gate 权限。
- [ ] **Step 4: 运行 Host 聚焦测试、合同测试和全量 Vitest**。
- [ ] **Step 5: 提交**：`feat: guide qwen through governed proposal`。

### Task 4: 状态卡人工确认

**Files:**
- Modify: `src/session/events.ts`
- Modify: `src/client/status-definition.ts`
- Modify: `src/client/PreplanningStatusCard.tsx`
- Modify: `src/client/index.tsx`
- Modify: `tests/session-events.spec.ts`
- Modify: `tests/status-definition.client.spec.ts`
- Modify: `tests/browser-plugin.client.spec.tsx`

**Interfaces:**
- Extends `PreplanningStatusEventData` with optional `pendingProposalId?: string`。
- `formatPreplanningStatus` emits an optional proposal ID; `parsePreplanningStatus` accepts both legacy and new text.
- `PreplanningStatusCard` consumes `confirm(proposalId)` and never accesses Repository/Gateway directly.

- [ ] **Step 1: 写序列化 RED 测试**：含 proposal ID 的新文本 round-trip；既有旧文本继续解析为同一核心状态。
- [ ] **Step 2: 运行 session-events 聚焦测试并确认新断言失败**。
- [ ] **Step 3: 实现可选字段构建、格式化和兼容解析**；多个 pending proposal 选择仓储顺序中的第一项。
- [ ] **Step 4: 写投影 RED 测试**：`tool/result` 顶层 `proposalId` 合入 node data；命令文本的 proposal ID 冷启动恢复。
- [ ] **Step 5: 实现投影合并并运行聚焦测试**。
- [ ] **Step 6: 写状态卡 RED 测试**：pending+ID 显示“人工确认提案”；点击只调用一次给定 ID；成功显示完成，error 显示中文错误；无 ID 不渲染按钮。
- [ ] **Step 7: 实现卡片与 Browser confirm 适配**：使用 `ctx.remote.commands.execute('/preplan-confirm ...')` 检查业务 result，禁止自动确认。
- [ ] **Step 8: 运行三个聚焦测试、类型检查和全量 Vitest**。
- [ ] **Step 9: 提交**：`feat: confirm proposals from dsh status card`。

### Task 5: 版本、自动门禁与安装包

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `README.md`
- Modify: `docs/acceptance.md`
- Create: `evidence/d2/2026-08-28-direct-use-acceptance.md`
- Deliverable: `outputs/dsh-preplanning-agent-direct-use-0.2.0.tgz`

**Interfaces:**
- Package version becomes `0.2.0` so official Profile installation cannot reuse the accepted `0.1.0` artifact.

- [ ] **Step 1: 更新版本与使用文档**，明确一句话启动、Qwen 模型和人工确认边界。
- [ ] **Step 2: 运行 `pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm test:built`**，记录准确数量。
- [ ] **Step 3: 在 `contracts/v0.6` 使用现有 Python 环境运行 `python -m pytest tests/test_contracts.py -q`**，要求 949/949。
- [ ] **Step 4: 运行 `pnpm pack --pack-destination <workspace outputs>`**，检查 tarball 只含声明产物；计算 SHA-256。
- [ ] **Step 5: 提交**：`build: package direct dsh acceptance flow`。

### Task 6: 真实 DSH + qwen3.8:27b 验收与重启恢复

**Files:**
- Modify only through official CLI: DSH Web Profile package composition。
- Modify: `evidence/d2/2026-08-28-direct-use-acceptance.md`

**Interfaces:**
- Consumes Task 5 tarball and当前 `qwen3.8:27b` 模型路由。

- [ ] **Step 1: 确认既有时间戳 Profile 备份存在，使用官方 `dsh plugin --profile web remove/add` 安装 `0.2.0`，不手改 Profile。**
- [ ] **Step 2: 启动 DSH 并在全新 Session 选择/核验页面模型 `Qwen3.8 27B`。**
- [ ] **Step 3: 只在快速启动面板输入“新建鄂州体育中心项目并完成 01-01 身份校准”，不执行手工 `/preplan-new`。**
- [ ] **Step 4: 验证 Session Log 中只有受控 `preplanning_get_context → preplanning_apply_commands` 路径，且提案为 `pending_review`；若 Qwen 搜索合同文件则验收失败。**
- [ ] **Step 5: 在状态卡点击“人工确认提案”，验证 revision 1、PS01/data confirmed、approval approved 和 `proposal.confirmed` 审计。**
- [ ] **Step 6: 停止并重启 DSH，重新打开同一 Session，验证绑定、revision、状态对象、审计和卡片恢复。**
- [ ] **Step 7: 更新证据并运行最终新鲜门禁；仅在全部满足后宣告可直接验收。**
