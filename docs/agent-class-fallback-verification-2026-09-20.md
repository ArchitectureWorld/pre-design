# 全局子 Agent 备用模型验证

日期：2026-09-20；目录：`E:\前期策划开发`；分支：`feat/pre-v2.0.1`。

## 行为与兼容

- 图像、网络、审图、文本四类分别保存一个主模型和最多 16 个有序备用模型；均来自同一 DSH 实时模型目录。无默认备用，也不修改父会话默认模型。
- 配置仍是全局 domain v1 的可选增量字段 `fallbacks`，沿用 revision/CAS；旧客户端省略 `fallbacks` 或可选 `review` 路线时保留旧值。显式空列表删除该类备用；主备去重。
- 每条执行链冻结配置版本、主备顺序和任务组 `chainId`；每次预留分别记录 `routeIndex`、`fallbackFromExecutionId`、选定/实际路线、子会话和终态。设置后续变化不改写已有执行链。
- 接入 Web、审图、场景规格、图像生成、工作流文本分析、文稿撰写、成稿编辑。场景和文稿中的服务失败切换不消耗内容纠错次数；工作流原有单次超时重试独立保留。
- 图像备用调用递增原任务的 `attempts` 并使用新预留 childId；已收到图像或原付费请求终态未知时不转派。既有图像恢复和拒收保护继续生效。

## 可切换与停止条件

只认原生 `turn/end.reason.kind=error` 中结构化 `error.code/status`，不匹配模型文字或报错消息。支持：

| 分类 | 原生依据 |
| --- | --- |
| Provider 可用性 | `AUTH`、`MISSING_CREDENTIAL`、`INVALID_CREDENTIAL`、`NO_ADAPTER`、`MODEL_NOT_FOUND`、`PROVIDER_NOT_FOUND`、`QUOTA` |
| 传输 | `TRANSPORT`、`NETWORK`、`CONNECTION`、`ECONNREFUSED`、`ECONNRESET`、`ENOTFOUND`、`EAI_AGAIN` |
| 限流 | `RATE_LIMIT` 或结构化 HTTP 429 |
| 服务失败 | `SERVER` 或结构化 HTTP 500–599 |
| 目录不可用 | 主备路线已不在实时 DSH 模型目录 |

`QUOTA` 在当前 DSH 中明确指 Provider 账户余额/额度耗尽，不能等同项目授权预算。`PREPLANNING_MODEL_TURN_LIMIT`、`PREPLANNING_VISUAL_BUDGET_LIMIT` 等项目授权边界仍由原预算逻辑阻断，失败不退还、重置或续增预算。每个备用调用另行预留一轮；目录不可用的预留也按原有保守语义保留。

用户取消、未知/恢复中的付费请求、JSON/内容/像素/审图质量问题不切换。`CONTEXT_WINDOW_EXCEEDED`、`INVALID_ARGS`、`EMPTY_RESPONSE`、`ABORTED`、`CANCELLED` 即使附带 HTTP 状态也不切换。运行中的原子会话、发生新 turn 的子会话、实际模型不符、其他父会话或重复 continuation 均被拒绝。

`begin` 新增可选第五参数 `signal`，所有七个入口均传入；目录查询期间取消会保留取消记录且不再尝试备用。

Web `query` 新增可选第五参数 `{ maxToolCalls?: number }`，仅接受 1–20 的整数，非法值在预算预留前拒绝。设置时使用原生 label `preplanning_web:<projectId>:retrieval=N` 并要求到限收束；不设置时维持原行为。子工具硬预算执行与发布页提取由另一协作分工实施。

## 本轮验证

- 原生入口红测：六项预期失败、四项通过；接入后全部通过。
- Web 工具预算接口红测：五项预期失败；接入后通过。
- 边界红测验证并修复目录查询期间取消、旧客户端省略 review、新 turn 禁止接续三项。
- 最终定向回归：12 文件，250/250 通过，含 UI 增删/排序、CAS、三路线顺序、并发只预留一次、各类原生终态、预算不重置、文稿并发停止派发及付费图像恢复。
- 严格 TypeScript：`pnpm exec tsc --noEmit -p tsconfig.json`，退出码 0。
- 独立只读审查未发现新增阻断；另核实已安装 DSH 的 spawn `run.result` 会先等待 child 空闲，再返回结果。
- 日志：`work/report-image-quality/fallback-final-tests.log`、`work/report-image-quality/fallback-final-types.log`；红测记录同目录 `fallback-native-red.log`、`web-tool-budget-red.log`、`fallback-edge-red.log`。

测试采用真实全局配置/执行持久化服务与受控原生会话记录，未调用真实模型。本分工未构建、部署或修改正式宿主配置；正式主备端到端执行仍需主线发布后的验证。

## 主线集成验证

2026-09-20 15:53，源码冻结后重新执行完整 `pnpm typecheck` 和 `pnpm test`（含构建及已安装原生 DSH driver 回归）：191 个测试文件、1758 项全部通过，测试持续 384.93 秒。候选包 `0449e16f40a446806120692ac65ee2ff179e762946f5d4dd19b5f203ff0d020c` 通过 197 个包内代码文件哈希核对。运行及安装结果另记，测试通过不等于真实供应商切换已验证。

## 浏览器修补与复验

实际浏览器验证发现：5秒自动轮询会关闭尚未选择的备用模型下拉框。确定性定时测试先复现，再将普通刷新保留选择器；保存/显式刷新仍关闭。client回归7/7通过。独立浏览器测试页已验证新增两个备用、上移、删除和放弃草稿，未覆盖用户原页面中正在编辑的生图备用。
第二次完整检查：类型检查与构建成功，191文件1759项中1758通过；唯一失败是未修改的57工作流矩阵测试超过5000ms。原始失败日志保留。随即用相同默认超时重跑该完整文件，5/5通过，原超时项1241ms。该结果是全量加定向复验，不声称第二次全量零失败。发布包67cbf896ccb5f11897a7f8766d932369e36cf7bb393707d1e08cf7b15fcbbf50逐项绑定两组原日志、源码和197个构建文件。
