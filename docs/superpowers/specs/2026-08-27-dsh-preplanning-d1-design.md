# DSH 前期策划 D1 纵向闭环设计

## 目标

交付一个可通过 `dsh plugin --profile web add <package>` 安装到 DeepSeek Harness 0.1.1-rc.2 Web Profile 的第三方 npm 包 `@architectureworld/dsh-preplanning-agent`。包内同时包含 Host 与 Browser 两半，并使用用户在 DSH 中已经配置的真实模型完成 D1 最小纵向闭环。DSH 重启后，项目、Revision、待确认提案、动态问题与 SessionBinding 必须恢复。

## 固定边界

- 仓库名固定为 `dsh-preplanning-agent`，插件 ID 固定为 `preplanning-agent`。
- 只支持 DSH `0.1.1-rc.2`，官方源码基线为 `dsh-v0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。
- 业务合同固定复制自 `pre-design/contracts/v0.6`，合同版本为 `0.6.0`；实现不得回写设计基线仓库。
- 模型只看到 `preplanning_get_context` 与 `preplanning_apply_commands`。T01—T47 不注册为模型工具。
- 不修改 DSH Agent Loop，不创建独立 Web，不创建通用 RuntimeAdapter 或产品级 Mock Runtime。
- Project State 是业务事实源；DSH Session Log 只记录可回放的交互与状态摘要。
- Agent 只能提交 ProposalEnvelope，不能直接写 Project State、批准 Gate 或豁免硬约束。
- Gate 只接受用户通过 `/preplan-confirm` 进行的自然人确认。

## 单 Bundle 结构

包根 `package.json` 同时声明：

- `dsh.bundle.patch: ./cordis.patch.yml`，使该包可以作为 Profile Bundle 被组合；
- `dsh.client.platform: web`，使 Host 的 client-modules 扫描并提供 `exports["./client"]`；
- `cordis.patch.yml` 插入唯一 Host 插件行 `preplanning-agent`，包名为 `@architectureworld/dsh-preplanning-agent`。

Host 仅使用命名导出 `name`、`inject`、`Config`、`apply`。所有命令、工具、存储域与系统提示注册都由 Cordis effect 管理。Browser 只通过 `ctx.slots.inject(...ctx.slots.register(...))` 注册界面，不直接修改 DSH 页面。

## 持久化模型

使用 DSH 已组合的 `ctx.storage.domain`，后端路由保持 Web Profile 默认 `json`。插件 ID 仍为 `preplanning-agent`；Storage Domain 的物理名必须满足 DSH `^[a-z][a-z0-9_]*$` 约束，因此固定为 `preplanning_agent`，schema version 为 1，包含：

- `projects`：项目元数据、当前 revision、当前阶段、更新时间；
- `state_objects`（逻辑名 `stateObjects`）：键为 `<projectId>:<objectId>` 的当前事实对象；
- `revisions`：不可变 revision 快照与提交者；
- `events`：不可变审计事件；
- `bindings`：DSH Session ID 到 project ID 的绑定；
- `proposals`：待复核、已确认或已退回的 ProposalEnvelope；
- `questions`：持久化动态关键问题及回答；
- `idempotency`：`<projectId>:<idempotencyKey>` 到原结果的映射。

所有业务写入串行化，并按 `expected_revision` 做乐观并发校验。任何失败必须在 durable write 前返回；幂等重放返回原 proposal/result，不产生新 Revision 或重复事件。

## D1 数据流

1. 用户执行 `/preplan-new <项目名>`，Host 创建 revision 0 项目、SessionBinding 和一个最高优先级的持久化问题。
2. 用户以自然语言要求模型继续策划；系统提示要求模型先调用 `preplanning_get_context`。
3. 工具按当前 SessionBinding 返回受控上下文切片、revision hash、开放问题和允许动作，不返回全量存储。
4. 模型调用 `preplanning_apply_commands` 提交与 v0.6 合同一致的 ProposalEnvelope；网关校验 actor、workflow、目标对象、expected revision、幂等键、PS01 schema 及人工复核要求。
5. 因 `preplan.wf.01.01` 为 A2/M 且强制人工复核，合法提案进入 `pending_review`，不改变 Project State。
6. 用户执行 `/preplan-confirm <proposalId>`；命令以 `decision_owner` 身份写入 PS01、生成下一 Revision、关闭相关问题并写审计事件。
7. `/preplan-status` 与 Browser Conversation Node 显示项目、revision、状态、待确认项和开放问题。重启 DSH 后重新打开同一 Session，状态必须一致。

## 命令和工具

- `/preplan-new <name>`：新建并绑定项目；重复名称不隐式覆盖。
- `/preplan-open <projectId>`：把当前 Session 绑定到已存在项目。
- `/preplan-list`：列出项目，不改变绑定。
- `/preplan-status`：记录并返回当前绑定项目的可回放状态摘要。
- `/preplan-confirm <proposalId>`：仅用户命令路径可执行人工确认。
- `preplanning_get_context`：只读，输入输出遵循 v0.6 model-tool 合同。
- `preplanning_apply_commands`：只提交 ProposalEnvelope；禁止 human/system actor 冒充、禁止直接确认。

## Browser 表面

Browser 半注册两个贡献：

- `conversation.session.header.actions` 中的“前期策划”状态标识，用于证明静态 Browser 插件真实加载；
- `conversation.chat.node` 的 `preplanning-status` renderer，用于渲染 Session Log 中由原生 `command/done` 与 `tool/result` 携带的持久状态快照。

自定义 Conversation Node 由独立投影定义消费 DSH 原生事件，支持冷启动、分页和重放，不依赖 Host 内存或临时 UI 状态。DSH `0.1.1-rc.2` 的持久化读取器不提供下游事件类型注册面；插件不得追加 `preplanning/status` 等未知事件，否则重启后会话会被拒绝加载。

## 失败与回滚

- 无 SessionBinding：工具和 status 命令返回明确中文错误，绝不猜项目。
- revision 冲突：返回当前 revision 与重新读取提示，不写任何状态。
- schema/rule/permission 失败：proposal 标记 `validation_failed` 或直接 `rejected`，Project State 不变。
- 未授权确认、重复确认、跨项目 proposal：失败关闭。
- 存储无法打开：Host 插件加载失败并在 DSH Loader 中可见，不降级到内存。
- 安装前备份真实 Web Profile；卸载用 `dsh plugin --profile web remove`，不得手工删除 DSH Session、Storage 或凭据。

## 验证分层

1. 合同门禁：复制的 v0.6 继续保持 949/949。
2. 单元测试：仓储、并发、幂等、权限、schema、上下文切片与命令行为。
3. 真实 Loader/Browser 组合测试：Host 通过 Loader 组合；Browser 通过真实 SlotRegistry 注册与卸载。
4. 包门禁：`pnpm pack` 后只含声明文件、Host、Browser、patch 和合同。
5. 真实 DSH：正式安装到 `web` Profile，启动 `dsh --profile web`，确认 Loader、两个模型工具、页面卡和命令。
6. 真模型 D1：使用 DSH 当前 `deepseek-official / deepseek-v4-flash` 完成 get-context → apply-commands → 人工确认。
7. 重启恢复：停止并重启 DSH，打开原 Session 验证项目、Revision、问题、提案和 UI 状态一致。
