# 子 Agent 类全局设置验收记录

本页保留首次候选验证记录。后续运行时报错审查、状态修整及最新候选包见 [运行时审查](runtime-error-review-2026-09-16.md)，其中发布记录取代本页旧包哈希。

日期：2026-09-16。开发目录：`E:\前期策划开发`；分支：`feat/pre-v2.0.1`。

## 最终行为

- 固定三类：生成图像、网络查询、文本生成。配置作用于当前 DSH 宿主的所有前期策划项目，不随项目切换。
- 无需先创建项目即可配置。旧行为仅在首次初始化时捕获一次 DSH 模型；之后更换项目或父会话模型不会改变全局设置。图像初始值保留原有视觉模型。
- 模型来自 DSH 的 `listProviders`、`listConfigurableProviders` 和 `listModels`。面板不另建可选模型名单，不读取或返回凭据。
- 保存使用全局版本检查；每次派发再次验证模型是否仍在目录中。不可用时明确失败，不自动选择另一个模型。
- 文本分析、图像生成、`preplanning_web_query` 分别接入对应类别。每次执行保存配置版本、派发模型、真实子会话 ID、实际请求模型及状态。
- 全局配置修改只影响后续任务。已有执行快照不会改写；视觉任务恢复沿用原 attempt、childId、executionId 与模型，保留禁止重复付费的原保护。
- 执行列表按当前项目显示最近 100 次任务。网络查询必须有成功网页工具记录；模型摘要仍属于待校验资料，不自动成为 Project State 事实。

## 验证

- `pnpm typecheck`：通过。
- `pnpm build`：通过。
- 版本对齐、Presentation 合同锁及自动化语义检查：通过。
- `pnpm exec vitest run --maxWorkers=1 --testTimeout=15000`：837 项中 836 项通过，1 项失败；135 个测试文件通过。
- 唯一失败为 `tests/report-print-layout.spec.ts` 的 PDF 第 28 页时段—客群矩阵断言。此前已在原始 HEAD `6d77306` 复现，本次未改变该版式；原始证据在 `work/baseline-original-print.log`。
- 新增 16 项回归覆盖动态目录、全局配置保存及重开、跨项目一致、旧配置冲突、移除模型、真实请求路由校验、网页工具执行证明、同源接口、无项目设置、界面刷新与旧响应隔离、付费图像恢复不重派发。
- 完整测试记录：`work/agent-class-full-tests.log`。

## 真实 DSH 隔离执行

使用独立 DSH_HOME 和合成项目，Node 25；未修改正式 `C:\Users\2899\.dsh` 配置或少潭河资料。

全局版本文本验证：

- 父会话：`session-be821d31-de04-47bf-b938-6a0ab8a89be7`，配置模型 `antigravity / gemini-3-pro`。
- 文本子会话：`4b075ad5-9976-409c-afa7-f19a5b78174d`。
- 派发与实际请求均为全局选择的 `antigravity / gemini-3.8-flash-high`；父会话模型调用为 0。
- 工作流批次 attempted=1、completed=1、blocked=0；子会话调用 `structured_output` 并正常结束。
- 创建另一项目、使用不同父会话模型后，全局配置保持完全一致。

网络查询实测包含成功和失败路径：

- 首次独立子会话 `f89cec68-2ea1-4dda-94f3-3572dc7bdbdf` 成功执行网页工具并返回待校验资料，实际使用配置模型；记录在 `work/verification-agent-classes/result.json`。
- 全局版本第二次查询子会话 `90c97d8d-d2b6-4a00-b829-e5b6e6409773` 遇到两次网页 fetch 失败及上游 `503 Token error: All accounts limited`。面板显示失败、保留实际路由，没有降级模型或误记成功。
- 全局运行原始结果：`work/verification-agent-classes-global/result.json`；脱敏 Session 证据：`work/agent-class-session-evidence.json`。
- 复测环境重启曾碰到测试项目重名及 Windows storage rename 的 EPERM，均发生在模型派发前；改用独立测试目录，保留旧记录。
- 最后一次仅重试网络类：子会话 `80236a03-9029-4278-8378-35a1fe6e9210` 仍收到上游 `503 Token error: All accounts limited`，未发生网页工具调用，正确记为失败。没有继续重复请求或切换模型。结果在 `work/verification-agent-classes-retry/web-retry-result.json`，Session 证据在 `work/agent-class-web-retry-evidence.json`。因此最后一轮网络成功复验受外部模型服务阻断，不宣称本轮全部真实模型验收通过。

## 浏览器验收

侧边浏览器在 `http://127.0.0.1:3108/work/agent-class-preview.html` 打开同一 React 组件，连接隔离 DSH 的真实配置接口，非模拟数据。

已验证模型选择与保存、保存反馈、刷新、配置版本保留、实际模型与派发模型分开展示、运行到完成/失败状态更新。

在项目 A 将文本模型保存为 `gemini-3-pro-high` 后切换项目 B，三类配置保持一致；项目 B 不显示项目 A 的执行记录。切回项目 A，已执行记录仍为原来的 `gemini-3.8-flash-high`。已检查页面截图。

## 候选包和边界

候选包：`work/release/architectureworld-dsh-preplanning-agent-2.0.1.tgz`。

SHA-256：`3cc15a28c44cc89924f5890fbeea3ea6bc836beca718a6e69ad178195755b198`。

此包包含本轮前期策划流程可靠性修复和子 Agent 类全局配置。未提交、推送、合并或安装到正式 DSH。

图像路径完成自动化路由及恢复验证，本轮未额外调用付费生图。DSH 目录不提供输出图像能力元数据，因此不根据模型名字或图像输入能力伪造“可生图”标识；选择模型后仍由真实图像返回及质量检查判定结果。

浏览器验证是隔离组件与真实 Host 接口联调，正式 DSH 壳内加载和正式环境端到端验收须在安装重启后完成。正式宿主当前仍运行少潭河会话，重启需最后确认。
