---
title: 前期策划 Agent｜DSH 原生插件实现阶段 Handoff
version: 2.0
status: 下一会话开发强制执行基线
handoff_date: 2026-08-27
current_phase: DSH 原生插件实现｜D0 兼容性基线 → D1 真实模型最小闭环
primary_contract: 前期策划_v0.6_DSH完整技术合同包_CANONICAL_949.zip
primary_architecture: 前期策划_章节工具级母架构_LATEST.html
supersedes_for_current_phase:
  - 前期策划_下一会话_HANDOFF_v1.0.md
incorporates:
  - 前期策划Agent_DSH插件直接开发_HANDOFF_v1.2.md
  - 前期策划_DSH插件技术合同_v0.6.md
implementation_decision: 第一可运行产品必须是安装在 DSH Web Profile 中、直接调用真实模型的原生单 Bundle 插件；禁止先做独立 Web、产品级 Mock Runtime 或脱离 DSH 的空壳系统。
---

# 前期策划 Agent｜DSH 原生插件实现阶段 Handoff

## 0. 下一会话只做一件事

> **停止继续扩写架构，直接把已经封版的 v0.6 业务合同实现为 DSH 原生插件，并先跑通真实模型参与的最小纵向闭环。**

新会话接管后必须按以下顺序执行：

```text
1. 阅读本 Handoff
2. 解压并阅读 CANONICAL_949 技术合同包
3. 定位实际 DSH 安装／源码／工作区，实测版本和扩展能力
4. 运行现有合同测试，确认 949 / 949
5. 创建或打开 dsh-preplanning-agent 仓库与独立开发分支
6. 建立 compatibility/dsh-baseline.json
7. 按当前 DSH 官方扩展机制完成最小 Bundle + Client 冒烟
8. 实现 Project State、SessionBinding、两项模型工具和单问题闭环
9. 使用 DSH 已配置的真实模型完成端到端测试
10. 验证 DSH 重启后项目可恢复
```

不得重新讨论“是否做 DSH 插件”“是否先做独立应用”“是否先接 Mock LLM”。这些路线已经否决。

---

# 1. 产品目标与当前真实状态

## 1.1 产品目标

研发一套面向建筑、城市更新、完整社区、公共设施、历史文化街区及片区谋划的前期策划 Agent。产品从极少项目种子或大量资料启动，逐步形成：

```text
01 项目任务
→ 02 现状摸底
→ 03 问题与机会
→ 04 目标与方向
→ 05 方案选择
→ 06 功能与规模
→ 07 空间与技术
→ 08 投资与实施
→ HTML / PPTX / PDF / 结构化项目包
```

核心不是“让模型写一份报告”，而是让模型、专业工具和人工在同一份可审计 Project State 上协作。

## 1.2 已经完成

| 层级 | 当前成果 | 状态 |
|---|---|---|
| 专业章节层 | 01—08 八章决策链 | 已封版 |
| 工作项层 | 57 个业务工作项、8 个独立 Gate | 已封版 |
| 专业能力层 | 14 类数据源、47 个内部原子专业能力 | 已封版 |
| 状态对象层 | 57 个 Project State 对象 | 已封版 |
| 合同层 | 57 个 JSON Schema、57 个 Workflow、47 个 Tool Contract、8 个 Gate Contract | 已封版 |
| 治理层 | ProposalEnvelope、权限、乐观锁、Revision 最小回退、220 条依赖边 | 已封版 |
| 模型工具面 | `preplanning_get_context`、`preplanning_apply_commands` | 已封版 |
| 测试层 | 8 个端到端黄金场景、20 个规则级验收场景 | 已封版 |
| 合同测试 | 当前 canonical 包实测 `949 passed / 0 failed` | 已通过 |

## 1.3 尚未完成

以下内容**没有实现**，下一会话不得把“合同包”误认为“插件已经开发完成”：

- 尚无可安装的 DSH Bundle 代码；
- 尚未锁定实际 DSH 版本、commit、Node 版本和 Web Profile 兼容性；
- 尚未创建或确认正式插件仓库的当前分支和基线 SHA；
- 尚未在 DSH Web 中注册 Host / Browser 插件；
- 尚未实现 Project State Store、事件日志和 SessionBinding；
- 尚未注册 Slash Commands；
- 尚未注册两个模型工具；
- 尚未注入项目上下文和起步 Skill；
- 尚未使用 DSH 已配置的真实 LLM 跑通工具调用；
- 尚未实现最小业务 Conversation Node／项目卡；
- 尚未验证 DSH 重启后的项目恢复；
- 尚未形成真实安装包、安装说明、集成测试和浏览器 E2E 证据。

**当前阶段从“可编码合同”进入“真实 DSH 插件实现”，不是继续做第三份架构报告。**

---

# 2. 权威资料与冲突处理顺序

## 2.1 权威优先级

发生信息冲突时，按以下顺序处理：

1. **本 Handoff**：规定当前开发目标、顺序和停止线；
2. **`前期策划Agent_DSH插件直接开发_HANDOFF_v1.2.md`**：规定首版必须直接做 DSH 原生插件、真实 LLM 和禁止路线；
3. **`前期策划_v0.6_DSH完整技术合同包_CANONICAL_949.zip`**：规定业务对象、工具、Workflow、Gate、权限和测试合同；
4. **`前期策划_章节工具级母架构_LATEST.html`**：规定 01—08 专业语义与章节边界；
5. **案例资料**：只用于黄金测试和反模式验证，不是产品模板；
6. 更早版本文件：只作历史参考，不得覆盖以上基线。

## 2.2 已明确废止的旧工程路线

早期开发稿中出现过“先做独立 Web”“先做通用 RuntimeAdapter”“先用 Mock Runtime”等工程建议。对于首版实现，这些内容已被 DSH 插件直接开发 Handoff 替代。

禁止：

1. 先开发独立 Web、API、Worker，再后接 DSH；
2. 先发布没有真实模型的 Mock 产品；
3. 只实现状态机和静态鱼骨，宣称 Agent 已可用；
4. 修改或 Fork DSH 核心 Agent Loop 承载业务；
5. 把 DSH Session 当作项目数据库；
6. 用硬编码分类、问题和回复伪装模型推理；
7. 一次性把 T01—T47 全部暴露给模型；
8. 在 D1 通过前开发高级鱼骨、完整文件解析或正式报告生产。

## 2.3 DSH API 的权威规则

此前文件列出的 `dsh.bundle`、`dsh.client`、`ctx.tools`、`ctx.commands`、`agent.inject()`、`SessionEventMap`、`ConversationNodeDefinition` 等名称，是基于当时 DSH 扩展基线形成的候选实现映射。

**下一开发 Agent 必须以实际安装版本和当前官方源码／文档为准重新核对。**

处理原则：

```text
DSH API 名称变化
→ 更新兼容层和 compatibility baseline
→ 不修改 Project State、Proposal、Workflow、Gate 的业务语义
```

如果用户当前使用的是 `BeforeWave/dsh-with-chatgpt` 或其他分支，必须记录具体来源和 commit，确认其是否保留目标 DSH 插件接口；不得静默切换到另一套 Runtime。

---

# 3. 不可破坏的产品与治理约束

1. **第一产品形态**：单个 DSH Bundle，包含 Host half 与 Browser half。
2. **真实模型优先**：第一条可验收链路必须使用 DSH 已配置的真实 LLM。
3. **唯一事实源**：Project State 是业务事实；聊天、Session、HTML、PPTX、PDF 都不是事实源。
4. **项目与会话分离**：一个 Project 可绑定多个 Session；一个 Session 同时只绑定一个 Project；`Project ID ≠ Session ID`。
5. **提案式写入**：Agent、LLM、Tool 和渲染器不得直接写 Project State。
6. **统一写入链**：

   ```text
   Agent / Tool Result
   → preplanning_apply_commands
   → ProposalEnvelope
   → Schema / Rule / Permission / Evidence / Revision 校验
   → 新 State Revision
   ```

7. **乐观并发**：所有写入必须带 `expected_revision`；冲突必须显式返回，禁止静默覆盖。
8. **幂等与审计**：所有写入必须带 `actor`、`reason`、`idempotency_key`，并追加可回放事件。
9. **人工决策权**：Agent 与 system service 均不得批准 Gate；Gate 只能由被指派的自然人 `decision_owner` 批准。
10. **最小回退**：新证据或条件变化只重开受影响对象及传递下游，保留全部历史和旧 DecisionSnapshot。
11. **单问题交互**：全项目同一时刻最多存在一个阻断性问题；问题和回答必须持久化、可恢复、可审计。
12. **成果是投影**：HTML、PPTX、PDF 只能从冻结 revision 生成，不能反向成为业务事实。
13. **模型工具面固定为两个**：

   ```text
   preplanning_get_context
   preplanning_apply_commands
   ```

   T01—T47 是 Workflow 内部能力，不注册成 47 个无约束模型工具。

---

# 4. 当前 canonical 交付物

## 4.1 下一会话必须携带

| 优先级 | 文件 | 用途 |
|---|---|---|
| P0 | `前期策划Agent_DSH插件开发_HANDOFF_FINAL_v2.0.md` | 当前开发指令与接管基线 |
| P0 | `前期策划_v0.6_DSH完整技术合同包_CANONICAL_949.zip` | 唯一 canonical 可编码合同包 |
| P0 | `前期策划_章节工具级母架构_LATEST.html` | 专业语义、章节关系和人工审阅 |
| P1 | `前期策划_全章节循环自检报告_v0.6.html` | 各章边界、反模式与自检结果 |
| P1 | `前期策划_DSH插件技术合同_v0.6.md` | 人读版接口、权限和 Revision 说明 |
| P1 | `前期策划Agent_DSH插件直接开发_HANDOFF_v1.2.md` | DSH 原生承载路线和第一版完成定义 |

## 4.2 canonical 文件校验值

```text
前期策划_v0.6_DSH完整技术合同包_CANONICAL_949.zip
SHA256 5560fc79f75cf3730842a9698a5512f4582e2d7c4a5f86a8088c9a1e261f8308

前期策划_章节工具级母架构_LATEST.html
SHA256 22e174dc7fc807484c2c36f8d0254ad8ce95d45d1d869096f2eb5c26e5b26dde

前期策划_全章节循环自检报告_v0.6.html
SHA256 78e4570247a28f1544a6b8fbe3b41947057199a48e8f7c23067adfd082a3fa15

前期策划_DSH插件技术合同_v0.6.md
SHA256 334453100bd250ccf03751d07b1e71844759b984b2b732de3bad29aacc2b3d30

前期策划_开发合同源数据_v0.6.json
SHA256 0c61dd87bdcd5238ae44673046d774ae6cc8646312477e7f431e4d0cd7957bc9
```

## 4.3 旧 ZIP 警告

旧文件 `前期策划_v0.6_DSH完整技术合同包.zip` 是模型工具合同和最终验收断言补齐前的快照，内部仍记录 `797/797`，且比 canonical 版本少 11 个文件。

**下一会话不得把旧 ZIP 作为开发源。**

使用 `CANONICAL_949` 包，其内容包括：

- 57 个状态对象 Schema；
- 47 个内部原子 Tool Contract；
- 2 个 DSH 模型工具 Contract；
- 57 个 Workflow Contract；
- 8 个 Gate Contract；
- 8 个可执行黄金案例；
- 20 个规则级验收场景；
- 949 项合同断言。

解压后首先运行：

```bash
python tests/test_contracts.py
```

期望：

```text
949 passed
0 failed
```

## 4.4 `plugin.manifest.json` 的性质

合同包中的 `plugin.manifest.json` 是**业务技术合同清单**，不是已经可被 DSH 安装的成品插件 Manifest。下一开发 Agent 必须根据实测 DSH 版本创建真正的 `package.json`、Bundle 配置、Host/Client 入口和安装描述。

---

# 5. 固定插件身份与建议仓库结构

## 5.1 固定身份

```text
仓库：dsh-preplanning-agent
npm 包：@architectureworld/dsh-preplanning-agent
插件 ID：preplanning-agent
产品版本目标：v0.1.0-dsh-plugin
交付形态：单 DSH Bundle（Host half + Browser half）
```

首个开发分支内不得混用多个仓库名、包名或插件 ID。

## 5.2 建议仓库结构

以下是实现默认，不是替代 DSH 官方规范。实际入口文件名应在 D0 阶段按当前 DSH 版本调整。

```text
dsh-preplanning-agent/
├─ package.json
├─ README.md
├─ compatibility/
│  └─ dsh-baseline.json
├─ contracts/
│  └─ v0.6/                  # canonical 合同包的受控副本或生成产物
├─ src/
│  ├─ host/
│  │  ├─ plugin.ts
│  │  ├─ commands/
│  │  ├─ model-tools/
│  │  ├─ context/
│  │  ├─ project-state/
│  │  ├─ workflow/
│  │  ├─ gate/
│  │  └─ revision/
│  ├─ client/
│  │  ├─ plugin.tsx
│  │  ├─ nodes/
│  │  └─ views/
│  └─ shared/
│     ├─ generated-contract-types/
│     ├─ errors/
│     └─ events/
├─ methods/
│  └─ preplanning-method-v0.6.json
├─ tests/
│  ├─ unit/
│  ├─ dsh-contract/
│  ├─ integration/
│  └─ e2e/
└─ evidence/
   └─ acceptance-runs/
```

不要在首版拆成多个 npm 包；先证明单 Bundle 纵向闭环。

---

# 6. D0｜兼容性基线与最小插件冒烟

## 6.1 目标

在写业务代码前，证明当前 DSH 版本确实支持所需插件扩展点，并锁定可复现环境。

## 6.2 必须产出

`compatibility/dsh-baseline.json` 至少包含：

```json
{
  "distribution": "official-dsh | dsh-with-chatgpt | other",
  "source": "实际包名或仓库 URL",
  "dshVersion": "实测值",
  "dshCommit": "源码版精确 commit；npm 版可为 null",
  "nodeVersion": "实测值",
  "packageManager": "npm | pnpm | yarn",
  "verifiedAt": "ISO-8601",
  "profiles": ["web"],
  "capabilities": {
    "bundleInstall": false,
    "hostPlugin": false,
    "browserClient": false,
    "toolRegistration": false,
    "slashCommands": false,
    "contextInjection": false,
    "userQuestion": false,
    "conversationNode": false,
    "sessionEventExtension": false,
    "skillProvider": false
  },
  "commandsRun": [],
  "knownIncompatibilities": []
}
```

## 6.3 冒烟要求

最小插件必须证明：

1. 可以安装到 Web Profile；
2. `dump-config` 或当前等价方式能够看到插件层；
3. Host 入口被加载；
4. Browser Client 被加载；
5. 一个只读测试工具可以被模型或测试 Agent 调用；
6. 一个 Slash Command 可以执行；
7. 一个业务 Conversation Node／卡片可以在 DSH Web 显示；
8. 卸载后注册项全部释放。

## 6.4 D0 退出标准

```text
实际 DSH 版本、入口、配置、安装命令和扩展点均有可复现证据；
不再依赖“某 API 应该存在”的猜测。
```

D0 未通过，禁止进入完整业务开发。

---

# 7. D1｜真实模型最小纵向闭环

## 7.1 D1 唯一目标

跑通：

```text
DSH 已配置真实模型
→ 安装前期策划插件
→ /preplan-new 创建无资料项目
→ Session 绑定 Project
→ 模型调用 preplanning_get_context
→ 模型形成 provisional 判断与一个关键问题
→ 用户回答
→ 模型调用 preplanning_apply_commands
→ Proposal 校验并生成新 revision
→ DSH Web 卡片同步更新
→ 重启 DSH
→ /preplan-open 恢复同一项目和 revision
```

## 7.2 D1 最小业务范围

D1 不要求实现全部 57 个 Workflow，但底层必须按合同设计，不能写成只能服务一个硬编码案例的脚本。

首条纵向切片建议激活：

```text
PS01 ProjectIdentity
PS02 DecisionBrief
PS07 EvidenceGapRegister
G1  资格评估与权限路径（不绕过完整 Gate 合同）
```

并保留：

- Project Seed；
- Project revision；
- SessionBinding；
- 当前阶段；
- 已确认事实；
- Agent 推断／假设；
- 当前唯一阻断问题；
- 问题回答记录；
- 事件日志；
- Gate 资格状态、阻断原因与权限校验记录；
- 仅在完整测试 Fixture 满足 G1 条件时生成 DecisionSnapshot；
- 审计信息。

## 7.3 模型工具

只注册：

### `preplanning_get_context`

- 读取当前 Session 绑定项目的受控上下文切片；
- 不返回全量 Project State；
- 不返回全部文件全文；
- 不写状态。

### `preplanning_apply_commands`

- 接收结构化命令；
- 必须携带 `project_id`、`expected_revision`、`actor`、`reason`、`idempotency_key`、`workflow_id`；
- 转成 ProposalEnvelope；
- 执行 Schema、规则、权限、证据、版本和 Workflow Guard 校验；
- 只能返回校验失败、待人工复核或 provisional commit 结果；
- 不批准 Gate。

## 7.4 Slash Commands

命令按阶段实现，不允许注册无真实能力的占位命令。

D1 必须实现：

```text
/preplan-new      创建项目并绑定当前 Session
/preplan-open     打开项目并绑定当前 Session
/preplan-list     列出当前工作区项目
/preplan-status   查看阶段、revision、当前问题和 Gate 资格状态
/preplan-confirm  仅由授权自然人执行；不满足 Gate 合同时必须拒绝
```

D4 在真实 HTML 渲染链成立后再增加：

```text
/preplan-export   从指定冻结 revision 生成阶段性 HTML
```

D1 实现顺序：

```text
new → open → list → status → confirm
```

命令调用项目服务，不依赖模型自由文本。

## 7.5 Project Context Injector

每次模型步骤前只注入：

```text
项目 ID 与 revision
原始 Project Seed
当前阶段与激活 Workflow
已确认事实
材料原结论
Agent 推断与假设
当前阻断与唯一问题
已确认决策
允许调用的两个模型工具
```

禁止将全量项目 JSON、全部文件文本和全部历史事件无差别塞入 Prompt。

## 7.6 持久化最低要求

推荐默认目录如下；可按 DSH 工作区规范调整，但业务语义不可改变：

```text
<workspace>/.preplanning/
├─ projects/<project-id>/
│  ├─ current.json
│  ├─ revisions/<revision>.json
│  ├─ events.ndjson
│  ├─ questions.ndjson
│  ├─ gates/
│  └─ artifacts/
└─ session-bindings.json
```

要求：

- 原子写入；
- append-only 事件；
- 乐观锁；
- 幂等键去重；
- 不删除历史；
- Session 删除或分叉不导致 Project 丢失；
- 新 Session 能重新绑定已有 Project。

## 7.7 最小 Web 投影

D1 只需在 DSH Web 中提供真实业务卡，不做高级鱼骨：

```text
项目名称
Project ID
当前 revision
当前阶段
当前唯一问题
阻断项
最近一次状态变化
G1 状态
```

卡片完全从 Project Snapshot 投影，不从聊天文本临时拼接。

## 7.8 D1 退出标准

- 使用真实模型；
- 模型真实调用两个插件工具；
- 用户回答导致 Project revision 真实变化；
- 没有未经工具写入的“假状态”；
- 重启 DSH 后可以恢复；
- 工具序列、模型、DSH 版本、revision 前后值有完整证据；
- 无资料黄金场景通过。

D1 未通过前，禁止开始大规模资料解析、复杂鱼骨、03—08 专业扩展和正式报告生产。

---

# 8. P0 开发 Backlog

| ID | 任务 | 完成定义 |
|---|---|---|
| DSH-P0-001 | 锁定 DSH 基线 | `compatibility/dsh-baseline.json` 完整；版本、commit、Node、Profile 和扩展能力均实测 |
| DSH-P0-002 | 建立仓库与开发分支 | 仓库名、包名、插件 ID 唯一；记录 base SHA 与当前 HEAD |
| DSH-P0-003 | 最小 Bundle + Client 冒烟 | 可安装、Host 加载、Client 加载、测试卡显示、卸载清理 |
| DSH-P0-004 | 导入合同注册表 | 可按 `contract_id + version` 加载 v0.6 合同；现有 949 项测试在仓库中通过 |
| DSH-P0-005 | 实现 Project State Store | revision、乐观锁、幂等、append-only 历史和原子更新测试通过 |
| DSH-P0-006 | 实现 SessionBinding | 多 Session 可绑定同一 Project；一个 Session 同时只绑定一个 Project |
| DSH-P0-007 | 实现 D1 Slash Commands | `new/open/list/status/confirm` 按顺序可用，命令 Schema 有测试；`export` 留到 D4 |
| DSH-P0-008 | 注册两个模型工具 | 输入输出均按 Draft 2020-12 校验；无直接状态写权限和 Gate 权限 |
| DSH-P0-009 | 实现 Proposal Gateway | `expected_revision`、权限、Schema、规则、证据和幂等校验通过 |
| DSH-P0-010 | 实现 Context Injector 与起步 Skill | 模型只读受控切片；上下文能追溯到 project revision |
| DSH-P0-011 | 实现单问题循环 | 同时最多一个阻断问题；问题与回答可持久化和恢复 |
| DSH-P0-012 | 实现最小业务卡 | DSH Web 显示真实 Project Snapshot，不使用静态 Mock 数据 |
| DSH-P0-013 | 实现 Gate 权限与 G1 合同路径 | Agent / service 无批准权；不满足 G1 条件时拒绝；完整测试 Fixture 下仅授权自然人可创建不可变 DecisionSnapshot |
| DSH-P0-014 | 真实模型 E2E | 创建项目→读上下文→模型提交命令→用户回答→revision 变化，全链有日志 |
| DSH-P0-015 | 重启恢复 | 关闭并重启 DSH 后，项目、问题、revision、Session 绑定可恢复 |
| DSH-P0-016 | 安装包与交付证据 | 安装说明、兼容矩阵、测试报告、截图／日志、版本号和变更记录齐全 |

执行纪律：每完成一个 Backlog 项，必须先运行相关单元／集成测试并记录结果，再进入下一项。

---

# 9. 第一条真实模型黄金场景

## 9.1 输入

```text
地区：鄂州市
项目性质：在老城区谋划一个全民健身中心
资料：暂无
```

## 9.2 预期行为

1. `/preplan-new` 创建项目并绑定当前 Session；
2. Project Seed 原文被完整保存；
3. 模型调用 `preplanning_get_context`；
4. 模型可以形成 provisional 项目理解，但不得直接锁定功能、规模、资金模式或唯一方案；
5. 模型结合当前状态生成**一个**真正影响方向的问题；
6. 测试不固定问题原文，只校验其与当前项目状态相关、非重复、非多问题拼接；
7. 用户回答后，模型调用 `preplanning_apply_commands`；
8. Proposal 通过校验后生成新 revision；
9. UI 卡片显示新的阶段状态和问题状态；
10. DSH 重启后项目仍可打开；
11. 全程不存在模型文本直接变成事实的旁路。

## 9.3 必须记录的证据

```text
DSH 版本与 commit
Node / 包管理器版本
真实模型名称
插件安装命令与结果
工具调用序列
ProposalEnvelope
校验报告
revision before / after
事件日志片段
DSH Web 截图
重启恢复结果
失败与重试记录
```

完成 D1 后，再使用 `鄂州市全民健身中心建设项目谋划汇报4.1.pptx` 建立有资料黄金场景；文件页码证据解析属于后续 D2，不得反过来阻塞无资料闭环。

---

# 10. 测试与验收纪律

## 10.1 测试层级

### 合同测试

```bash
python tests/test_contracts.py
```

必须保持 `949 / 949`。

### 单元测试

至少覆盖：

- Contract Registry；
- Project State revision；
- 乐观锁冲突；
- 幂等写入；
- 事件重放；
- SessionBinding；
- 问题状态机；
- Gate 快照；
- Prompt 上下文切片；
- Slash Command Schema。

### DSH 集成测试

至少覆盖：

- Bundle composition；
- Host 注入；
- Browser Client 加载；
- 模型工具注册与返回 Schema；
- Slash Commands；
- Session event 扩展；
- Conversation Node 重放；
- 卸载清理；
- Web Profile 重启恢复。

### 真实模型测试

必须覆盖：

```text
创建项目
→ 模型读取项目
→ 模型调用写入工具
→ 动态形成一个问题
→ 用户回答
→ 模型继续一步
→ Project revision 改变
```

## 10.2 禁止以假代真

- fake service 只能用于单元测试；
- 不得发布 Mock 模型演示版；
- 不得用硬编码回复通过真实模型验收；
- 不得只证明工具“注册了”，却没有模型实际调用；
- 不得只证明聊天有回答，却没有 Project State 变化；
- 不得在公开 UI 中显示“这是演示”“这里将来接模型”等解释性占位语；
- 不得用静态 JSON 或截图冒充可恢复业务状态。

## 10.3 完成声明规则

下一 Agent 在宣称“完成”“可用”“已修复”前，必须给出：

```text
命令
退出码
测试总数
通过／失败数
DSH 版本
真实模型名称
关键日志或截图
当前 commit SHA
```

没有证据，不得作完成声明。

## 10.4 沿用的循环自检与成果交付纪律

过程要求继续保持不变。每完成一个 Phase 或可独立验收的 P0 工作包，必须执行完整闭环：

```text
实现
→ 单元／合同／集成测试
→ 边界与权限自检
→ 失败修正
→ 全量复测
→ 浏览器或真实模型验收
→ 记录证据
→ 更新版本化成果
→ 才能进入下一工作包
```

任何阻断项未关闭，不得以“后续再补”方式跨阶段。每轮至少交付：

1. 当前源码、仓库、分支和 commit；
2. 可安装的 DSH 插件包或本阶段可复现构建产物；
3. 版本化实施成果报告 HTML，只记录稳定成果和真实状态；
4. 同版本循环自检报告 HTML；
5. 机器可读 QA JSON；
6. 测试命令、退出码、日志、截图和真实模型调用证据；
7. 变更清单、未决阻断、下一条准确命令；
8. 同步更新 `LATEST` 成果与本 Handoff 的 Live Status。

产品 UI 和正式成果中不得出现“这里以后接模型”“当前仅演示”“为什么这样设计”等解释性占位语。开发解释、失败原因和变更过程只进入自检报告、日志或 Handoff，不进入用户业务界面。

---

# 11. v0.1.0-dsh-plugin 完成定义

只有同时满足以下条件，才可发布第一版：

- [ ] 可以按当前 DSH 实测方式安装到 Web Profile；
- [ ] 不修改 DSH 核心源码；
- [ ] DSH Web 中出现插件真实业务节点；
- [ ] 使用 DSH 已配置的真实 LLM；
- [ ] `/preplan-new` 可创建项目；
- [ ] `/preplan-open` 可跨 Session 打开项目；
- [ ] 模型能读取受控 Project Context；
- [ ] 模型能调用 `preplanning_apply_commands` 提交结构化修改；
- [ ] 问题由模型结合项目状态动态生成；
- [ ] 用户回答进入 Project State 新 revision；
- [ ] revision 和事件日志可审计、可回放；
- [ ] G1 只能由授权自然人批准；
- [ ] 重启 DSH 后项目可恢复；
- [ ] DSH Session 与 Project State 权威边界清晰；
- [ ] 无资料黄金场景通过；
- [ ] canonical 949 项合同测试全部通过；
- [ ] 新增 DSH 集成测试和浏览器 E2E 通过；
- [ ] 提供安装说明、兼容基线和测试证据；
- [ ] 没有独立前端、通用 RuntimeAdapter 产品或产品级 Mock Runtime。

---

# 12. D1 之后的阶段顺序

只有 D1 通过后，才按以下顺序继续：

## D2｜资料与证据闭环

- PDF / PPTX / DOCX / 表格接入；
- 文件、页码／页序、片段和版本登记；
- 事实、材料结论、Agent 推断、假设、缺失分开；
- 新证据触发 Revision 最小回退；
- 使用全民健身中心和新民街资料建立有资料 E2E。

退出标准：关键判断能追溯到文件页码或 PPT 页序。

## D3｜鱼骨工作台

- 01—08 主骨；
- 节点状态、问题和影响关系；
- 节点详情和证据跳转；
- Gate 卡；
- Session 回放与刷新一致。

退出标准：鱼骨只来自 Project Snapshot。

## D4｜HTML 实质性阶段稿

- 项目基本盘；
- 事实、判断、缺口、问题和决策；
- 鱼骨与来源索引；
- 指定 revision 重建。

退出标准：成果包含真实模型分析和真实证据，不是流程摘要。

## D5｜03—08 专业能力扩展

```text
问题与机会
→ 目标与方向
→ 多方案粗算
→ 功能与规模
→ 空间与技术
→ 投资与实施
```

此阶段才逐步实现更多 Workflow、专业 Adapter、Workflow Engine 和必要的 Subagent。

## D6｜PPTX / PDF 与生产化

- 可编辑 PPTX，禁止 HTML 截图拼接；
- 稳定 PDF；
- 三格式与同一 revision 一致；
- 权限、备份、监控、多项目和企业部署。

---

# 13. 首版明确不做

D1 不做：

- 全部 47 个专业 Adapter 的真实接入；
- 全量 PDF／PPTX 解析；
- 复杂 GIS、BIM、造价和财务引擎；
- 高级可旋转／可缩放鱼骨画布；
- 03—08 全流程自动执行；
- 完整 HTML、PPTX、PDF 生产；
- 多人实时协作；
- 云端集中项目库；
- 企业级 RBAC；
- 多 Runtime 共用业务服务；
- 独立 Web 管理后台；
- 多 Bundle／多 npm 包拆分；
- 大规模多 Agent 编排。

这不是删减长期目标，而是保护第一条真实闭环。

---

# 14. 已知风险与待核事项

## 14.1 DSH 版本风险

DSH 仍可能快速变化。所有 API、配置和安装命令必须实测。任何兼容性修改都应记录在 `compatibility/dsh-baseline.json` 和测试中。

## 14.2 Runtime 分支风险

用户近期可能使用官方 DSH，也可能使用 `dsh-with-chatgpt` 等衍生版本。下一 Agent 必须先识别实际目标，不得在未确认的情况下针对另一分支开发。

## 14.3 合同复杂度风险

57 个 Schema 是完整产品合同，不意味着 D1 必须一次性实现全部业务逻辑。正确做法是：

```text
合同全量加载和版本化
＋
运行时核心通用实现
＋
首条工作流最小激活
```

禁止把 57 个工作项硬编码成 57 套重复业务代码。

## 14.4 模型非确定性风险

E2E 不校验问题的逐字文本，而校验：

- 是否只提出一个阻断问题；
- 是否与当前 Project State 相关；
- 是否未提前锁定方案；
- 是否通过工具提交结构化状态；
- 是否可恢复和审计。

## 14.5 资料案例误用风险

案例只用于验证方法覆盖范围和反模式，不得把案例中的定位、功能、规模或商业业态自动复制到新项目。

## 14.6 测试口径风险

旧资料中存在 `797/797`，canonical 包为 `949/949`。下一 Agent 应以：

```text
manifest.json
＋
plugin.manifest.json
＋
现场执行 tests/test_contracts.py
```

为准。

---

# 15. 每次中断前必须更新的 Live Status

后续 Agent 必须在本文件副本顶部维护以下状态块，不得只写“继续开发”：

```markdown
## Live Status

- Active phase:
- Active backlog item:
- Repository:
- Workspace path:
- Branch:
- Base SHA:
- Current HEAD:
- DSH distribution:
- DSH version / commit:
- Node / package manager:
- Last completed task:
- Tests run:
- Test result:
- Real-model E2E: not run / failed / passed
- Files changed:
- Open blockers:
- Open risks:
- Next exact command:
- Production touched: no / yes + authorization reference
```

每完成一个 P0 任务，同时更新：

- 完成定义是否满足；
- 测试证据路径；
- 当前 commit；
- 下一条准确命令。

---

# 16. 下一会话首次回复的最低要求

下一开发 Agent 在阅读材料后，首次回复应直接给出：

```text
1. 已确认的目标 DSH 分布、版本和工作区
2. 当前插件仓库、分支、base SHA
3. canonical 合同测试结果
4. D0 能力矩阵当前状态
5. 本轮将执行的 P0 任务
6. 下一条实际命令
```

不得再次输出一篇“为什么要做前期策划 Agent”的长篇说明，也不得在没有实际检查 DSH 环境前声称“可以直接开发”。

---

# 17. 可直接复制到新会话的启动指令

```text
请先读取《前期策划Agent_DSH插件开发_HANDOFF_FINAL_v2.0.md》，再解压并读取《前期策划_v0.6_DSH完整技术合同包_CANONICAL_949.zip》，同时打开《前期策划_章节工具级母架构_LATEST.html》作为专业语义基线。

本会话不再讨论产品方向或重新设计母架构，直接进入 DSH 原生插件实现。第一产品形态必须是单 DSH Bundle（Host + Browser），第一条可验收链路必须使用 DSH 已配置的真实模型；禁止先做独立 Web、产品级 Mock Runtime、通用 RuntimeAdapter 或修改 DSH 核心源码。

先定位并实测我当前使用的 DSH 分布、版本、commit、Node 版本和 Web Profile 扩展能力，建立 compatibility/dsh-baseline.json；运行 canonical 合同测试，必须得到 949/949。随后按 DSH-P0-001 起执行，先完成 D0 最小插件冒烟，再实现 D1：/preplan-new 创建无资料项目、Session 绑定 Project、模型调用 preplanning_get_context、动态提出一个关键问题、用户回答后模型调用 preplanning_apply_commands、Project revision 真实变化、DSH Web 业务卡同步更新、重启 DSH 后项目恢复。

模型只注册 preplanning_get_context 和 preplanning_apply_commands；T01—T47 仅作为 Workflow 内部能力。Agent、LLM、Tool 和成果文件不得直接写 Project State，不得批准 Gate。每完成一个任务先运行测试并保留命令、退出码、日志、截图和 commit 证据，再进入下一任务。

首次回复直接报告：DSH 实测版本、工作区、仓库与分支、base SHA、949 项合同测试结果、D0 能力矩阵和下一条实际命令，然后开始开发。
```

---

# 18. 一句话架构结论

> **前期策划 Agent 首先是一个 DSH 原生专业插件：DSH 提供真实模型、Agent Loop、工具调度、Session 和 Web 宿主；插件提供前期策划方法、Project State、证据、单问题、Gate、Revision、鱼骨和成果。项目状态独立于 Session，但从第一天起就在 DSH 插件内真实运行。**
