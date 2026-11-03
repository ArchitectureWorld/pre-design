# Linux P0 实测记录 · 2026-11-03

**当前结论：根依赖已迁移至 DSH0.2.1-rc.5，类型检查通过；真实 Astra SDK/Host、受限子Agent与原Session恢复验证通过。Web 已按原V0.9原型接入，并完成PS01提案→确认→批注修订→Revision2→重启恢复。最终Web验收见 `../app/VERIFICATION.md`。**

下文是P0历轮记录；其中旧路由、41处类型错误、尚未迁移等描述均为历史阶段，不代表当前状态。

## 基线

- pre-design 分支：`web_V1`，起点 `2ef02d1bbcd7af53d24bdcd2d20644cdc06d12ce`。
- 官方 DSH Tag：`dsh-v0.2.1-rc.5`，远端核验提交 `b830ec950faba0a46dda564be3e2d854afed94f1`。
- 本地独立 CLI / SDK：`0.2.1-rc.5`；Node：`24.22.2`；依赖见 package-lock.json。
- 用户选定路由：`ollama-remote / qwen3.8`。没有修改原 DSH 部署、旧会话、现有插件代码和 V0.9 原型。

## 已验证

1. Remote 模型目录：带已有凭据请求 `/v1/models` 返回 200，并列出 `qwen3.8`；没有打印密钥。
2. 实际 SDK 子进程：初始化、设置/读取 Workspace、关闭进程、重新启动并恢复原 Session ID 及目录全部通过。没有执行模型的控制面验证不算 P0-A 通过。
3. 最终脚本带 Remote 配置与凭据引用的控制面记录：`.cache/dsh-p0/run-NC06v6/report.json`。
4. `node --check web/worker/smoke.mjs`、`git diff --check` 通过；`npm ls --prefix web/worker --depth=0` 确认版本。

## 已定位并处理

- 旧 settings.yaml 启动导入未能在首次 SDK initialize 前提供自定义 route，出现 `no adapter registered`。改为启动时显式 model profile patch 后通过。
- 首次真实调用出现模型 `turn/end` 错误 `502 status code (no body)`。当时环境的免代理列表缺少局域网模型主机；测试重跑时显式设置大小写 NO_PROXY，避免通过系统代理访问该地址。
- SDK run 返回不代表推理成功：脚本检查失败 turn、真实工具事件和随机标记，不能仅以 idle 或有 events 判定通过。

## 尚未验收

- 免代理后的真实文件读取在整体 240 秒截止前未完成，验证器关闭 SDK 子进程并以退出码 1 结束；记录：`.cache/dsh-p0/run-ZPwKBz/report.json`。该次记录显示主动关闭触发的 TransportClosedError，脚本现已改为明确记录整体截止原因。P0-A 未通过；未获得真实工具读取及模型历史恢复结果。
- 独立最小 `/v1/chat/completions` 请求（max_tokens=16）在 30 秒内未返回，客户端超时；该观察不能区分排队、加载或推理服务异常。
- P0-B 尚未开始。当前 src/index.ts 仍必需注入 webServer 和 workspaceRegistry；旧插件依赖仍为 0.1.5-rc.1，不能宣称新版专业核心已兼容。

重跑命令见 README.md。验收顺序：真实读取 + 事件 + 重启后的历史恢复通过 → P0-B 依赖迁移与 Web-only 服务拆分 → 专业工具及领域操作实测。

## 更新：yaoguang02-gpt-6-astra 已通过 P0-A

现已使用用户指定的 `yaoguang-codex / yaoguang02-gpt-6-astra`，真实跑通全部 P0-A 检查，退出码 0：

- 实际文件工具读取随机标记，产生 `tool/call` / `tool/result`；首轮 18 个事件。
- 关闭旧进程、启动新进程，恢复同一个 Session ID 和 Workspace。
- 新进程中的模型不调用文件工具，从原会话历史正确返回标记；恢复轮 9 个事件。
- 记录：`.cache/dsh-p0/run-hatp0l/report.json`；结果 `P0-A-passed`。

此前 qwen3.8 的超时仍是历史实测事实，不代表新路由失败。模型配置来自运行中 DSH 的 `state/profiles/web/cordis.patch.yml`，不是旧 `config/settings.yaml`；验证器现在支持这两种输入。只读取所选 route 的凭据引用，未修改原部署。

## 最终 Host 实验及迁移边界

- 最新真实运行：`.cache/dsh-p0/run-q7gk1k/report.json`，退出码 0。
- 加载 `.host-build/lib/index.mjs`，全部 DSH 导入从新版 Worker 解析；无 `webServer`。
- 临时验证工具通过真实命令 `/preplan-new` 创建项目；真实 `preplanning_get_context` 与 `preplanning_read_material` 均成功。首轮 30 个事件，含 command/run、command/done 与专业工具结果。
- 重启前删除测试文件；重启后从 Host 存储读取到同一项目 ID；SDK 恢复原 Session；历史回答正确且没有工具调用（9 个事件）。
- Web 适配器按独立作用域装配/清理。测试先复现卸载后仍残留 3 条路由，再修复 disposer 回收；恢复依赖仅注册一份，Host 卸载清空路由。两种 profile 均通过，独立复查无关键遗漏。
- 最终构建、旧依赖下常规类型检查通过。根依赖维持原有基线以便验证拆分回归；这不等于迁移完成。

### 必须后续迁移的已证实差异

运行 `node web/worker/audit-host-types.mjs` 得到 41 处类型错误（退出 2，日志 `.cache/dsh-target-type-audit.log`）。该审计将官方 DSH 类型入口映射到固定新版，无需修改 manifest：

1. `SubagentRuntime.start`、`startContinuable` 已不存在。涉及 web-query、workflow-analyzer、manuscript、visual/image-inspection/scene-spec 等模块；新版入口包括 startActivation、prompt、sendMessage，需要按新契约适配，不能只改名称。
2. coordinator 的旧 `source.kind = plugin` 不属于新版 MessageSource。
3. 真实 `tool/result` 已把 toolCallId、isError 放在 `data.message`，content 为直接 text 块。当前旧执行保护仍读取嵌套 `tool-result` 块；类型检查不能代替这类行为迁移测试。

因此本轮未发布生产 Worker、未升级根依赖、未宣称多 Agent/全文生成/图片工作流或完整 Web 后台可用。测试建项目工具仅用于隔离实验，不是业务 API。

## 回归检查

- `pnpm test` 执行完整校验、构建和 211 个测试文件：2055 项通过、6 项跳过、2 项触发默认 5 秒超时。原始记录 `.cache/p0-regression.log`，不能把这一轮称为全绿。
- 两个相关文件使用原阈值单独重跑：design-visual-bridge 的 40 项全部通过；built-package 的冷加载测试仍超时。记录 `.cache/p0-retry.log`。
- 构建产物诊断给予 15 秒上限后，实际 6.49 秒完成冷导入与真实 Contract/Domain 初始化，4 项断言全部通过。记录 `.cache/p0-built-diagnostic.log`。
- 仅该项冷加载集成测试改为 15 秒，未改变全局阈值或业务断言。其余测试保持原设置。
- 最终使用正常默认命令复验 built-package 与 host-apply：2 文件、6 项全部通过（`.cache/p0-final-targeted.log`）；没有再次重跑整套 211 文件。因此最终证据是完整一轮记录加失败项/受影响项的定向复验。
