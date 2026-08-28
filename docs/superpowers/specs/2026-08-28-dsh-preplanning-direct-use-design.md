# DSH 前期策划直接使用设计

## 目标

用户在 DSH 当前会话中输入一句自然语言，例如“新建鄂州体育中心项目并完成 01-01 身份校准”，插件自动完成项目创建、Session 绑定和模型任务发送。`qwen3.8:27b` 生成合法 ProposalEnvelope 后，用户在 DSH 状态卡内点击按钮完成人工 Gate；全程不要求手工输入 `/preplan-*`、查找合同文件或离开 DSH 页面。

## 固定边界

- 兼容 DSH `0.1.1-rc.2`，不修改 DSH 核心。
- 保留 v0.6 两个模型工具：`preplanning_get_context` 与 `preplanning_apply_commands`；不新增可写模型工具。
- Project State 仍只允许 Proposal Gateway 在规则通过后写入。
- 模型只能生成待复核提案，不能批准 Gate；确认必须来自当前 DSH 用户的 `decision_owner` 命令路径。
- 不读取或修改模型凭据；验收时使用用户已在 DSH 选择的 `qwen3.8:27b`。
- 旧 Session、Storage 和 `work/profile-backups` 原样保留。

## 用户体验

### 快速启动

会话头部的“前期策划”控件从静态徽章升级为按钮。点击后展开一个轻量面板：

1. 用户只需填写“一句话描述项目和目标”。
2. 插件从“新建/创建/启动……并/，/。”等中文句式中推导项目名，并展示可编辑结果。
3. 点击“开始 01-01 身份校准”后，面板依次：
   - 通过官方 `commands/execute` 执行 `/preplan-new <项目名>`；
   - 仅当命令结果为 `success` 时，通过当前 `Session.prompt()` 将用户原话发送给模型；
   - 显示“项目已创建，Qwen 正在生成待确认提案”。
4. 命令未匹配、业务返回错误、Session 不存在或 prompt 被拒绝时，停止后续动作并在面板内显示中文错误；不伪报成功。

项目名推导规则保持确定性：去掉开头的礼貌词和“新建/创建/启动”，截取第一个“并/然后/，/。/；”之前的非空片段；无匹配时取首个非空分句，最长 48 个 Unicode 字符。用户始终可在提交前修改项目名。

### Qwen 受控执行

Host 系统提示直接提供 D1 所需的最小合同指南：

- 必须先调用 `preplanning_get_context`；
- 禁止搜索工作区、文件系统或网页中的合同；
- 明确 ProposalEnvelope 顶层字段、PS01 必填字段和枚举边界；
- 用户原话按 `user_statement` 证据处理，未知字段使用空数组、`unknown` 或显式 assumptions，不捏造事实；
- `preplanning_apply_commands` 必须接收 JSON 对象而非字符串；
- 提案进入 `pending_review` 后停止，并向用户说明需要人工确认。

Browser 发送的任务提示重复强调该受控路径，同时带入用户原话与识别后的项目名。它不包含绝对合同路径，因此模型没有广域搜索合同的理由。

### 人工确认

`preplanningStatus` 增加可选 `pendingProposalId`。模型工具结果以及命令状态文本都携带该 ID；旧状态文本仍可解析。状态卡在 `pending_review` 且存在 ID 时显示“人工确认提案”按钮。按钮通过官方 `commands/execute` 调用 `/preplan-confirm <proposalId>`，业务成功后由原生 Session Log 产生 revision 1 的新状态卡。

确认按钮不直接调用 Repository/Gateway，不把人工权限暴露给模型，也不自动点击。命令错误时保留 pending 状态并显示错误。

## 代码边界

- `src/client/direct-start.ts`：自然语言项目名推导、模型任务文案、`command → prompt` 编排。
- `src/client/PreplanningLauncher.tsx`：快速启动面板和局部状态。
- `src/client/PreplanningStatusCard.tsx`：状态展示与人工确认交互。
- `src/client/index.tsx`：把 DSH `sessions` 与 `remote.commands` 适配成上述组件回调。
- `src/prompts/preplanning-system.ts`：D1 最小合同指南，Host `index.ts` 只负责注册。
- `src/session/events.ts` 与 `src/client/status-definition.ts`：可选 proposal ID 的可回放编码、兼容解析和投影。

## 验收标准

1. 自动测试证明一句话能推导项目名，命令失败不会发送 prompt，命令成功只发送一次受控 prompt。
2. Browser 真实 SlotRegistry 测试证明快速启动组件可见、失败可见、成功可见，且 teardown 无残留。
3. 状态投影对新旧命令文本均可冷启动/分页重放；pending 卡仅在有 proposal ID 时提供人工确认按钮。
4. 模型工具目录仍严格为两个，合同测试仍为 949/949。
5. 类型检查、Vitest、构建、构建产物测试和 tarball 内容门禁全部通过。
6. 用官方 CLI 安装到真实 DSH Web Profile 后，在一个全新 Session 中只通过快速启动面板输入自然语言；页面实际模型为 `Qwen3.8 27B`。
7. Qwen 必须调用 `preplanning_get_context → preplanning_apply_commands`，生成 `pending_review`；用户在卡片点击确认后得到 revision 1、PS01 confirmed、approval approved。
8. 重启 DSH 并重新打开同一 Session 后，项目绑定、revision、PS01、审计记录与页面状态保持一致。
