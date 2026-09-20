# 少潭河运行时报错与子 Agent 审查

**最新状态：用户确认部署后，已于 2026-09-16 安装本页指定哈希的包并重启正式 DSH。正式验收及备份见末尾“正式部署验收”；前文未部署表述记录的是审查阶段。**

## 范围和结论

开发目录为 `E:\前期策划开发`，分支 `feat/pre-v2.0.1`，基线 `6d77306a6229c44419cf3bcb5d8a7a976e24711b`。本轮保留此前工作流可靠性和三类子 Agent 全局配置改动，增加执行保护与状态修正；未提交、推送或安装到正式 DSH。

正式会话 `session-454db710-be36-48fb-8307-f06772179109` 的本次日志快照包含 170 步、56 次工具错误，最后以 error 结束。22 个子会话（含后代）均有 turn/end；界面“22 个子代理”是历史数量，没有证据证明此刻有 22 个子 Agent 仍在执行。部分子会话达到 308、311、317 步，表明旧执行路径缺少有效停止条件。

正式 127.0.0.1:3080 仍由原 PID 43504 提供服务，未加载本候选修复。因此本轮可以确认开发修复和隔离宿主行为，不能宣称正式少潭河运行时已修复。

## 原因与处理

| 问题 | 直接证据 | 修整 |
| --- | --- | --- |
| 子 Agent 参数反复错误 | 49 次 subagent 调用缺少 prompt，实际参数只有 description；另有 3 次缺少 meta.name | 受管执行中，同一工具连续返回同一错误 3 次即取消当前轮；累计 8 次工具错误或达到 40 步也停止，不再依赖提示词自行遵守预算 |
| 声称写入但文件不存在 | pwsh 实际命令为 echo `[OK: Action logged - ...]`，随后读取 test.txt 失败 | 已有候选自动流程移入无 Shell 权限的专用分析子会话，材料由原生 PDF/文本工具读取；兼容父流程一轮出现 3 次此类回显时停止，不能把打印成功当作文件操作成功 |
| 反复查找已返回的上下文 | 首次 preplanning_get_context 已返回合同与项目上下文，随后仍委派子 Agent 到磁盘导出 schema | 保留候选的单工作项 Research → 子 Agent → Quality → Gateway 执行路径；自动分析器不可用时阻断，不退回父会话自由探索 |
| EvidenceRef.locator 校验失败 | v0.6 不接受候选中的额外 locator 属性 | 保留兼容映射修复，并复验文件、官方网页、项目状态三种来源；完整定位信息仍留在审计记录，不放宽合同 |
| 活动与结果混淆 | ready/已结束的历史子会话容易被理解为仍运行 | 面板单列真实子会话 activity 和任务结果。运行状态读取 DSH Agent 注册表；不存在的运行实例依据最后 turn/end 判为空闲，否则待核实。终结原因在 dispose 前持久保存，释放 Session 后仍能显示空闲 |
| 错误信息过于泛化 | 网络上游 503 All accounts limited 被缩成“未正常完成” | 保留 DSH provider 提供的安全 diagnostic；本插件主动停止时展示具体保护原因；不展示工具输入、凭据或模型推理 |
| 图像恢复误判结束 | 旧 turn/end 后已有新 turn/start，waitForImage 仍使用任意历史结束事件 | 只按最新一轮的 start/end 判断失败，避免在恢复时提前判定“没有图像” |
| 子会话失败仍可登记任务完成 | 结果保存未核对真实 turn/end.reason.kind | 如果最新轮以 error、aborted 等非 completed 原因结束，拒绝完成登记 |

保护仅作用于本插件带 `preplanning_workflow:`、`preplanning_web:`、`preplanning_visual_task:` 标识的子会话，以及已绑定前期策划项目、当前轮实际调用 preplanning 工具的父会话。每个新 turn 重置预算。普通 DSH 会话和其他插件任务不纳入该范围。一步中并发发出的调用会先收尾，保护在下一步开始前生效。

三类配置仍为全局配置：生成图像、网络查询、文本生成；切换项目不改变配置，模型目录沿用 DSH 设置。执行列表只展示通过本插件三类机制新派发的任务，最多 100 条。

## 验证

- 先复现失败测试，再修改实现；定向回归 39 项全部通过，包括原先的 EvidenceRef 错误。
- 类型检查、构建、版本一致性、Presentation 合同锁和自动化语义检查通过。
- 全量回归结果及候选包见下文发布记录。
- 使用独立 DSH_HOME、合成项目与本地受控模型适配器验证真实 DSH Agent loop、工具校验、spawn、取消及 dispose；没有请求外部模型或网页，没有消耗生图额度。
- 父会话执行一次上下文调用和 3 次缺 prompt 调用后停止，共 4 次模型请求、3 次工具错误，turn/end.reason.kind=aborted，停止原因持久化。
- 网络子会话连续 3 次参数错误后停止，父会话模型请求数为 0；任务标为失败，实际模型来自子会话 request/header；dispose 后 Agent 已从注册表移除，面板仍显示“已空闲”。
- 对照普通 DSH 会话完成预设 7 次请求，未被保护误拦截。
- 侧边浏览器检查了同一 React 组件和最新真实宿主输出快照：显示“子会话运行中 0 · 已空闲 1 · 状态待核实 0”、失败任务、实际模型和具体停止原因。该只读快照是界面核验，不是正式壳内联调。

本轮未额外重试已限流的外部模型。上一轮真实模型的网络复验仍受 503 限制；本轮受控适配器验证不等于外部模型服务已经恢复。

## 本地证据

原始日志和隔离宿主快照均位于忽略目录 work，不随包发布：

- `work/runtime-review/shaotanhe-audit.json`：只读正式日志审查。
- `work/runtime-review-focused.log`：定向回归。
- `work/runtime-review-full-tests.log`：全量回归。
- `work/runtime-review-build.log`：构建。
- `work/verification-runtime-guard-1789559794137/result.json`：真实宿主受控验证结果和界面快照。
- `work/runtime-guard-driver.mjs`、`work/prepare-runtime-guard.mjs`：隔离复现脚本，不读取正式凭据。

## 发布记录

- 完整回归：`pnpm exec vitest run --maxWorkers=1 --testTimeout=15000`，848 项中 847 项通过，1 项失败；137 个测试文件中 136 个通过。
- 唯一失败：`tests/report-print-layout.spec.ts:162`，PDF 第 28 页缺少可测量的时段—客群矩阵。相同错误已在未修改的基线 HEAD 复现，证据为 `work/baseline-original-print.log`；本轮没有改动该版式，不能宣称全套测试全绿。
- `pnpm pack --pack-destination work/release` 成功，已重新构建候选包。
- 候选包：`work/release/architectureworld-dsh-preplanning-agent-2.0.1.tgz`。
- SHA-256：`a7a376c9b5496b092725b826b7c75a9cbbea1a71982c8b0a3dc5046da55c0756`。

正式安装及重启仍按 DEVELOPMENT.md 的既定边界，由用户最后确认。正式宿主此前为 Node 22，候选包要求 Node >=24.11；隔离验证使用 Node 25.4.0。正式部署须同时选用满足包要求的运行时，且保留正式配置、项目和会话数据。

## 正式部署验收

用户已在本会话明确回复“确认部署”。于 2026-09-16 完成：

- 备份目录：`C:\Users\2899\.dsh\backups\preplanning-runtime-20260916-200627`。包含完整 web profile（含 node_modules）、业务存储、少潭河会话日志和配置文件；未将凭据或原始日志加入仓库。
- 使用 DSH 官方 `plugin --profile web add --save-exact` 安装已核验的 tgz。profile 的前期策划依赖现在指向 `E:/前期策划开发/work/release/architectureworld-dsh-preplanning-agent-2.0.1.tgz`，其他依赖声明保持原值。
- 正式旧进程 PID 43504 已停止；新进程 PID 3564 使用 `C:\Program Files\nodejs\node.exe`（Node 25.4.0），继续监听 `127.0.0.1:3080`。没有停止 Tailscale 的同端口转发监听。
- 安装后服务器 `lib/index.js` 和客户端 `lib/client.js` 的 SHA-256 均与已验证构建相同。原生 PDF 依赖随包安装。
- 正式浏览器中的“前期策划”已加载全局三类配置，少潭河项目绑定为 `preplan-46f9dc1c-2af4-4d5e-96ea-7b23ed90f19f`，工作目录仍是 `D:\shaotanhe`。
- 正式配置接口返回 43 个 DSH Provider 条目。首次迁移沿用原默认路由：图像 `antigravity/gemini-3.1-flash-image`，网络和文本 `antigravity/gemini-3.8-flash-high`。
- 保存原样配置后再读取，版本为 1，三类实际选择没有改变；正式面板刷新读取成功。新配置持久化在独立全局域。
- 部署后核对原 settings、credentials、cordis.patch、三个前期策划业务存储及 Report Studio runtime 的文件哈希，全部保持不变。新服务 stderr 日志为空。

正式验收覆盖安装内容、实际运行进程、原生界面、项目绑定、模型目录和配置保存读取。本次没有向少潭河会话发送新的业务任务，也没有额外请求付费模型；上文真实 DSH 受控执行验收仍是执行循环保护的直接证据。历史会话错误保留，不伪造或清除旧日志。原有 PDF 第 28 页测试问题和此前外部模型 503 限制仍按上文记录。

本地部署凭据：`work/deployment-receipt.json`、`work/deployment-settings-check.json`、`work/deployment-install.log`。启动日志可能含本地认证链接，仅保留在忽略目录，不纳入报告或公开输出。

后续手动启动应显式使用满足版本要求的 Node：

```powershell
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\2899\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js' --profile web --no-open
```

回滚时先停止经端口和命令行核验的正式 DSH 进程，使用备份的 profile 恢复旧插件、依赖和启动配置。业务存储与会话仅在确认受损时恢复，避免覆盖部署后新产生的数据。

## 正式宿主真实模型冒烟测试（20:28—20:35）

用户要求“你来直接执行测试看看”后，在当前 3080 正式 DSH 中新建独立合成测试项目，实际调用外部模型。测试目录为 `E:\前期策划开发\work\formal-smoke-1789561683206`，会话为 `session-7a0aa260-9320-47ba-b679-024ff7ea004e`，项目为 `preplan-3a051774-ef78-4a10-98c9-99c5c87a8177`。

沿用用户当前全局配置 revision 3：图像 `antigravity/gemini-3.1-flash-image`，文本和网络 `ollama-remote/qwen3.8`。本轮未保存或替换三类配置。

| 类别 | 真实子会话 | 结果 |
| --- | --- | --- |
| 文本生成 | `20008a7a-5ba8-4090-879d-c09f1b51a7fe` | 工作项 01.01 已派发；模型返回 `502 status code (no body)`，turn/end 为 error，未产生有效分析结果。 |
| 图像生成 | `preplanning-visual-a2504d40f7c8e9799f9f46fb` | 完成一次请求，生成 1024×1024 JPEG，候选资产 `0d67f14f-42f3-4700-ad7a-91ee39c86305`；未采用到正式报告。 |
| 网络查询 | `9496ed15-08aa-4d01-a837-2d69a5aad03b` | 模型返回同样的 HTTP 502；未执行网页工具，因此没有检索成功证据。 |

三类子会话 request/header 中实际 provider/model 均与各自全局派发配置一致。每个子会话仅有一个模型请求记录，均已有 turn/end。图像文件已目视检查并核验 SHA-256：`726c6395724cf0f11943436a98f7ead6e3bfcd5788ffe07581be3af675f08c34`，副本为测试目录下 `smoke-image.jpg`。它符合概念场景，但输出为正方形，未遵循提示中的横向构图要求；尺寸通过不等于完整视觉要求通过。

网络测试最初使用 Qwen 父会话，该父请求也返回 502。随后仅将测试父会话设为原 DSH 默认模型 `antigravity/gemini-3.8-flash-high`，由其调用一次 `preplanning_web_query`，网络子会话仍严格使用用户配置的 Qwen，没有对该类做模型回退。父会话收到工具失败后正常结束。测试选模型操作曾触发 DSH 保存默认模型的行为，收尾时已恢复原值，整个 settings.yaml 的解析内容与部署备份一致。

只读探测已配置的远端模型目录 `http://192.168.5.221:4001/v1/models` 也遇到连接关闭（`UND_ERR_SOCKET`）。证据将阻断点定位到远端 Qwen 请求/连接路径；尚未确定远端进程、网关或网络层的具体原因，不能宣称服务已修好。面板能显示失败、实际模型与空闲状态，但文本和网络错误摘要尚未直接包含底层 502 详情，详细原因目前需从子会话日志读取。

正式浏览器刷新后显示“子会话运行中 0 · 已空闲 3 · 状态待核实 0”。测试项目已暂停自动推进并切回人工确认模式。对少潭河项目在 preplanning_agent、preplanning_governance、preplanning_presentation 三个存储中的相关记录分别与部署备份比较，内容均未变化；用户全局三类配置仍为 revision 3。

本轮证据：`work/formal-smoke-result.json`、`work/formal-smoke-session-evidence.json`、`work/formal-smoke-upstream.json`。结论为：独立子会话派发、模型映射和收尾状态已验证；图像真实生成成功；文本与网络真实业务成功路径受远端 502 阻断，整套验收未通过。

## 本地 Ollama 复测（20:44—20:58）

用户切换到本地 Ollama 后要求再测，并提示首次加载可能较慢。检查时浏览器两类下拉框已选中本地模型，但还未保存；经点击“保存配置”，全局配置变为 revision 4，文本和网络均为 `ollama-local/qwen3.8:27b`，地址 `http://127.0.0.1:11434/v1`。图像配置未变，本轮未重复生图。

所有测试仍使用独立合成项目，按顺序执行，未并行挤占本地模型。测试父会话继承原 DSH 模型，只负责发出网络子任务；文本分析与实际网页读取由本地 Qwen 子会话执行。

| 测试 | 子会话 | 结果 |
| --- | --- | --- |
| 文本冷启动 | `b14a42d0-a5d8-4357-b37a-fc7b1f944204` | 300.041 秒后被插件取消；Ollama 已完成加载并持续生成，未出现 502。 |
| 文本热启动 | `6abcf07e-a9aa-4fdb-b6b9-633253afc3f7` | 复用已加载模型及上下文缓存，仍在 300.061 秒被插件取消；Ollama 日志记录约 13,388 个已生成 token，尚未形成可提交的完整结果。 |
| 网络查询 | `10757f80-e705-44f6-80b7-0ac7313b24f8` | 17.773 秒完成；真实调用 `web_fetch` 读取 `https://example.com/`，工具返回 HTTP 200、标题 Example Domain 和原文，随后正常结束。 |

两次文本任务均为 `cancelled / idle`，turn/end 为 aborted，工作项 01.01 因分析取消而 blocked，未产生有效业务提交。网络任务为 `completed / idle`，结果包含真实 retrievals；`verifiedEvidence=false` 表示尚未经过项目 Research 来源校验，不影响本次网页读取链路验收。

本轮定位到具体宿主限制：`src/runtime/subagent-workflow-analyzer.ts` 默认使用 `AbortSignal.timeout(300_000)`，`src/index.ts` 未传入覆盖值。加载与生成共用该上限，且热启动也超时，因此不能把剩余问题仅归因于首次加载。需要后续优化文本任务的生成长度、任务超时和超时错误展示；本轮是现有正式版本复测，没有修改或部署新的超时策略。

冷启动项目 `preplan-66d0bd51-dc88-4258-8a77-e788f63e679d` 与热启动项目 `preplan-19691ddb-ea47-46f1-a0fc-71ac12a9a510` 均已暂停并切回人工确认模式；三个测试子会话全部空闲。少潭河在三个业务存储中的记录再次比较，均未变化。本地两类配置保持 revision 4。

证据：`work/formal-smoke-local-cold-evidence.json`、`work/formal-smoke-local-evidence.json`、`work/formal-smoke-local-result.json`。结论：本地模型连接及真实网页工具链路通过；文本业务工作项因固定 5 分钟超时仍未通过。

## shaotanhe 正式重跑（21:03 起）

用户明确要求重新执行 shaotanhe 前期策划。正式项目 `preplan-46f9dc1c-2af4-4d5e-96ea-7b23ed90f19f` 当时 revision 为 0，01.01 为旧 running 状态，其余工作项未开始，因此使用原会话 `session-454db710-be36-48fb-8307-f06772179109` 的原生 `/preplan-run` 重新执行第一项，没有清空项目或替换工作区。

执行前备份目录：`C:\Users\2899\.dsh\backups\shaotanhe-rerun-2026-09-16T13-03-56-155Z`。保存四个前期策划存储、原父会话日志，以及六个既有工作区成果文件的哈希清单。

原生命令返回已启动，但 Research 校验在模型调用前发现缺少 project-location 和 project-trigger，工作项转为 blocked，本轮尚未创建新的模型子会话。

随后直接读取原始 66 页 PDF 的第 1—15 页，确认封面为《新洲区少潭河水库“一库一策”方案（2021-2025年）》，2022 年 6 月编制，现状基准年为 2020 年。PDF 第 11 页（印刷第 6 页）明确地点为湖北省武汉市新洲区旧街街。新增 `D:\shaotanhe\pre-design.research.json`，只写入已核验名称、所在地、原文定位、文件哈希及资料年代，没有编造本次开发目标。

当时使用同一 ResearchRuntime 只读复核，必填缺口缩小为 project-trigger，因本次策划目标待确认而暂停。用户随后明确回复“文旅休闲开发”，该方向已按用户确认来源写入正式研究输入；原《一库一策》的编制目的不替代本次项目任务。

本轮还发现两项旧资料污染风险：`envelope_final.json` 将所在地误写为湖北省鄂州市；Research 的 JSON 字段递归发现机制把 `target_schema_ps01_complete.json` 中 `/targetSchema/$defs/TimeConstraint` 的 Schema 定义误选为 time-constraint 证据。原文件保留，这些候选不能作为业务事实；恢复执行前需要排除技术 Schema/示例数据的误采集。既有本地文本 5 分钟超时问题同样尚未修复。

本地证据：`work/shaotanhe-rerun-state.json`、`work/shaotanhe-rerun-research-check.json`、`work/shaotanhe-source-first10.json`、`work/shaotanhe-source-pages-11.json`。

## 文旅休闲开发方向确认后的修复（21:19 起）

已备份 `pre-design.research.json` 后补入用户原话、确认日期和未知边界。防洪、灌溉与生态要求作为基于原材料的策划约束，明确标注为助手整理，未伪装为用户原话或2026年核验事实。

新增失败用例后修复：Research发现排除技术Schema、示例/调试目录、生成Proposal及其字段；显式 `/preplan-run` 仅在启动时重排符合上游条件的blocked项一次，仍完整执行Research、质量、授权和Gate检查；Ollama文本任务上限由5分钟改为20分钟，其他Provider保持5分钟，同时保留调用方取消、有限超时、计时器清理及可辨识错误。正式运行并发上限设为3。

验证：31项定向回归、58项Research/质量/Gate/授权/命令回归和5项构建产物测试全部通过；typecheck、build、自动化语义、版本一致性、Presentation合同锁检查通过。第一项Research必需覆盖率为1，仅接受正式研究输入中的名称、地点、启动方向三个事实；未再出现TimeConstraint Schema。之前全量测试的PDF第28页排版基线失败仍存在，本轮未修改排版也未宣称全量全绿。

候选包：`work/release/shaotanhe-retry-20260916/architectureworld-dsh-preplanning-agent-2.0.1.tgz`，SHA256 `881e55971e5666b6aaf353eb20fc3395ef1fdb5860da756cf4c72c92991b73e4`。安装与后续实测见 `work/rerun-deployment-receipt.json` 及后续记录。

用户补充三项用途“都需要”：开发可行性判断、业态定位、招商方案。已写入 `decision_question`、`decision_context`、`output_purpose`，保留未知的投资、红线、时序与决策主体；未为通过Research而伪造主体。

部署备份：`C:\Users\2899\.dsh\backups\shaotanhe-retry-deploy-20260916-212737`。在线安装已完成链接但卡在可选跨平台依赖下载；终止该安装子进程后，通过官方 `dsh plugin --profile web add --offline --save-exact <candidate>` 使用缓存完成，退出码0。正式宿主恢复为PID29112。代码入口与构建产物哈希一致；settings、credentials、四个preplanning存储及Report Studio runtime与备份全部一致。

21:35:02 对原少潭河会话执行 `/preplan-run`，01.01从blocked重新进入running，attempt2；真实子会话 `5c993f2b-96ca-4060-8259-1a99048c9809` 的request/header确认模型为 `ollama-local/qwen3.8:27b`。侧边浏览器已打开前期策划面板，显示运行中1、派发与实际模型一致。此时仍在生成，尚未提交State Object。

21:39:51 该子会话以completed结束，耗时288.727秒，类执行记录为completed/idle，产出payload和qualityEvidence，未被取消。随后中央质量评估为blocked_external：完成条件2“项目发起人或项目负责人确认项目对象及启动原因”缺少角色依据，完成度0.5、置信度0.65；revision仍为0，未提交业务对象。检查合同确认该条确实存在，不是模型自行把投资额度、红线等后续要求变成前置条件；这些后续缺口在候选中明确不阻断本项。

已把用户后续确认的三类决策用途同步到PS01实际采集的project_trigger字段，避免只在其他字段保存而子Agent看不到。当时错误地向用户询问成果确认人并暂停等待；用户随后明确“不需要人确认”和“旧流程的残留要清理掉”。该等待理由已撤销，法定角色仍保持未知，不能把未知角色当作自动策划的人工审批节点。候选及业务检查见 `work/shaotanhe-candidate-5c993f2b-96ca-4060-8259-1a99048c9809.json`、`work/shaotanhe-active-evidence.json`。

追加完整Research模块回归50项全部通过（与前述94项有重叠）。结论：新版安装、正式blocked重试、真实本地子会话执行及正常结束已验证；超过5分钟的本地存活通过虚拟时钟测试验证，本次真实生成不足5分钟，不能将其描述为超过原上限的真实验收。整份前期策划与正式报告尚未完成。

## 旧人工确认流程清理（用户纠正后）

用户明确要求全自动策划，先前索取负责人确认的做法已撤销。修复运行时的57项完成条件、缺失资料策略和8个Gate描述，保留专业质量检查以及真实证据、授权、版本和Schema检查。资料不足按Research策略形成有明确限制的条件式研究，不伪造角色或审批。冻结v0.6源合同保留作历史兼容，不再把人工条款作为自动模式前置。

详细修复、测试、安装包和部署备份见 [自动策划旧流程清理](automatic-workflow-cleanup-2026-09-16.md)。全量873/874通过，仅既有PDF第28页矩阵基线失败；最终定向16/16和构建产物5/5通过。22:11完成正式安装并核验受保护数据不变；22:12原少潭河会话恢复自动执行，真实Ollama子会话 `dab1a94b-7c20-4344-aae3-ea1f92186231` 收到有效自动规则，已确认输入中不再含旧负责人确认条件。最终业务结果以随后实测记录为准。

22:21复核：01.01经一次自动修订后由真实子会话 `39a95bb9-e9ea-49e4-b08d-aeea572ae297` 完成，质量auto_pass、置信度0.88、无blocker，正式自动提交revision1；系统继续派发01.02。当前阻断0、待确认0，全程未索取负责人签认。Presentation同步到revision1，但还有工作区原件关联提示；整份策划及报告尚未完成。
