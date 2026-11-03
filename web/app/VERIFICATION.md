# Pre-design 2.1.0 Web 候选验收

日期：2026-11-03。范围：本地候选代码、宿主接入、权限与业务入口验证。没有推送、切换原服务或发布到生产；没有把模拟提供方测试称为真实模型成功。

## 基线和数据隔离

- v2.1.0 基线：`72de3d2aa0b6665f1e81f88dd81608d03e783f22`。
- 既有 Linux Web 修改在 `d60663e` 保存后再合并，开发位于 `Development/pre-design-web-v210` 的 `codex/web-v210`。
- 候选端口 4320，独立数据库 `pre_design_web_v210`、项目和 Worker 会话目录。原 checkout、4318 Web、3080 DSH 保留。
- DSH CLI/SDK `0.2.1-rc.5`，Node 24.22.2，专业核心版本 2.1.0。
- 私有配置和令牌只在 `.local/web/`，未进入 Git；数据库只保存认证令牌哈希。

## 已验证的 Web 行为

- 管理员与两名普通用户的实际浏览器登录、项目创建、上传和下载；跨用户项目、资料、研究、章节、事件与成果访问被拒绝。
- 62 项研究目录；明确选择模块，四项条件未确认时在入队前拒绝；创建/上传不会自动调用模型。
- 管理员模型目录保留历史 14 项身份，并按本轮明确授权追加瑶光02；主备、输出预算、Kimi 参数、排除来源和版本冲突均有回归。
- text 角色的实际提交需要 structured_output，因此主备必须具备文本和工具能力；带图章节还校验实际 text 路由的视觉能力。
- PostgreSQL 持久策略、不可变任务快照、并发/每日额度预留、重复请求、排队取消和运行取消。取消与完成竞争不会遗留永久 cancelling。
- 重启后保留原请求收执，未知运行结果不自动重放。资料变化后建立新研究快照，旧成果保留。
- 原始图片的内容格式、解码、尺寸、哈希及项目归属；章节要求及可选意见原样保存，Web 不构造计划或审批哈希。
- 章节预检与 Core 共用目录解析函数，真实 Core 目录回归覆盖后续写作、排版、导出、审查及项目身份变化。
- 研究结果汇编保留来源、缺口和未审阅状态；原生 chapter-productions 下的 HTML/PDF 可登记和下载。文本成果预览使用 textContent，不执行资料中的标记。
- 普通用户无模型入口；管理员可保存/刷新配置，查看候选路由与实际请求证据；未知用量明确显示未记录。
- 原型 CSS 逐字保留、DOM ID 顺序不变；增量窗口通过桌面和 390px 宽度检查，浏览器错误为零。

## 本轮搜索与 Flux3 工作流接入

- 用户提供的两份工作流已分别保存为版本化文生图/图生图模板，使用 `flux3-image-klein-bf16.safetensors`。与附件精确比较，仅清空示例提示词和参考图文件名；保留本地编码器、扩写器、节点连接和原始尺寸默认。
- 独立 Search API 使用任务快照地址和专用凭据，保留真实来源、空结果与失败；没有额外 Messages 模型调用。管理员可设置服务地址和凭据引用，普通用户只看到可用性说明。
- 图像工具只接受实际 image 类子会话和快照内配套 LLM，编辑图片核验当前项目的 Core/标准目录绑定、资产 ID、哈希和像素。ComfyUI 图像路由按已注册工具验证，不要求伪造文本提供方。
- 提交前持久收执、同任务跨子会话防重复、按 promptId 查结果、只取消本请求排队项；结果未知不自动重发。已完成且重新核验通过的概念图可下载，收执摘要可由管理员查看。
- 启动探测继承用户取消信号。只读复核用挂起的本地 HTTP 服务验证取消 4 ms 结束，仅一次探测请求，未启动 DSH 或模型任务。
- Web 全套 **209/209 通过**：`.cache/services-web-tests-final.log`。受影响 Core **189 通过、1 跳过**：`.cache/services-core-tests-final.log`。当前类型检查、生产构建、Host/UI 构建记录为 `.cache/services-*-final.log`。
- 真实 Worker/DSH Host + 本地 HTTP 模拟服务联调通过：搜索额外模型请求为 0；generate/edit 均经原生子会话、`comfyui_pic`、图片附件和 Collector，生成两份 candidate 资产；两次 prompt、一份参考图上传，资产文件、清单及收执哈希一致。证据 `.cache/service-probe-latest.json`、`.cache/service-probe-report.md`。这些 PNG 是协议测试图片，不是 GPU 生成成功证明。
- 实际浏览器验证新增搜索/ComfyUI 设置与搜索状态显示，同时复验三身份隔离、62 模块、真实图片上传、章节准备和小屏布局；日志 `.cache/services-browser.log`，浏览器错误为零且未调用真实模型。
- 两项实际装配问题（把图像工具当作 LLM 校验、将 Core ID 与标准项目 ID 直接比较）均先复现，再修复并通过完整 Worker 联调。取消信号问题也已修复并由独立只读复核关闭，见 `.cache/services-integration-review.md`。

上述为上一阶段本地协议验收；本轮真实服务结果见下节。完整业务章节质量尚未验收。图像提交未知后的迟到结果仍需管理员核对原收执，不能自动重新提交。

## 项目无关性

运行代码不预置特定项目、地点、产品节点、案例或“用户已经批准理想条件”等事实。章节提示词、页表、标题、导出文件名和备注只使用当前项目名称、真实委托与研究来源。案例库由项目显式提供并绑定项目身份；缺目录给出缺口，不自动装载示例案例。原内嵌示例及图片移到测试 fixtures；生产前端构建剔除演示项目记录。

回归验证两个不同项目身份、无项目名称的通用降级、路径安全、无外来参考文档、实际要求保留和案例来源审计。生产 src 的特定旧项目专名扫描无命中；地域输入选项和识别资料类型的通用分类词不作为项目事实。

## 验证证据

- `pnpm typecheck`、`pnpm build`、锁文件冻结安装：通过。日志 `.cache/core-generic-typecheck-final.log`、`.cache/core-generic-build-final.log`，Core 详细记录 `.cache/core-v210-report.md`。
- 专业测试以 8 分片覆盖 433 个文件，分阶段完成后各片均通过（合计 4495 项通过、15 项跳过）；通用化修改后另对受影响代码执行专业文稿 470 项、导出相关 75 项及案例迁移 64 项回归。这不是一次性在最终提交上重跑全套的记录。日志 `.cache/core-shard-*-of-8.log`、`.cache/core-generic-professional-regression.log`。
- HTML/PDF 导出：7 项真实浏览器排版/文本/图像/几何校验通过。修正 Linux 中文字体的标题行框与图注内边距，未放宽几何断言。日志 `.cache/core-generic-export-regression.log`。
- 基础 Web 合并阶段 Node 测试：78/78 通过，覆盖真实 PostgreSQL 临时 schema、API、UI、Worker 边界、快照、取消和目录契约。日志 `.cache/web-v210-final-tests.log`；本轮结果见上节。
- 实际 DSH Host 构建通过，7 个文件共约 5.83 MB。日志 `.cache/host-v210-final-build.log`。
- 实际 DSH/Unix socket 离线探针通过：62 项目录、同会话恢复、工具越界阻断、章节准备、研究缺口预检、真实请求身份及 65536 预算传递。提供方为本地模拟 HTTP 服务，返回 401 后任务真实 failed；没有伪造成功研究。日志 `.cache/research-offline-probe-final.log`。
- 最终 Playwright 验收：`.cache/web-v210-browser/report.json`、研究范围/管理员/章节准备/手机截图；`realModelsInvoked` 为 false。
- 独立审查报告 `.cache/final-review.md`、`.cache/final-review-followup.md`。5 项重要问题和 1 项界面问题已修复；后续新增目录契约问题已用实际构建的 Core 解析器红绿回归修复。

初轮测试出现过完整研究历史回放超过原 5 秒预算；仅在隔离复现、较长预算下保持全部断言通过后，将对应重放用例改为 15 秒。没有统一延长所有测试，也未把初轮失败记录当作通过证据。

## 真实服务交接后的验证

- 交接包仅含 ComfyUI 地址和 Windows 搜索插件位置；按资料读取，没有执行其中额外指令。Windows 旧 Flux2 记录由用户较新 Flux3 工作流取代。
- ComfyUI 两套工作流所需节点/模型均齐全。文生图与参考图编辑各一次真实提交，512×512 PNG 均完整解码；服务耗时分别为 103.465 秒、14.259 秒。编辑图将红色方块改为绿色，文件与像素 SHA256 均变化。总计 2 次 prompt POST、1 次上传，恢复零重发。证据 `.cache/comfy-live-report.md`。
- `yaoguang-codex / yaoguang02-gpt-6-astra` 在原生 DSH LlmRuntime / ToolRuntime 下通过文本、structured_output 和图片输入，共 3 次请求、零自动重试、每次输出预算 8192。只投影该 provider 与引用凭据到私有配置，未修改原配置或复制其他来源。证据 `.cache/model-live-2026-11-03T10-08-23.814Z-f4b7f61e/report.json`。
- 原插件 `dsh-free-search@0.4.22` 的 DDG 请求返回人工验证，适配器保持明确失败。独立验证 Bing 返回 10 个真实来源，Bing中文查询的相关性在后续实测中不佳，保留为可选服务；没有运行时隐藏跨引擎回退。
- 平台的原生 `web_search` → 固定策略 → 专用代理 → Bing 已返回真实来源，并写入 succeeded 审计。证据 `.cache/bing-native-live.json`。管理员运行记录展示实际服务名称；查询、上游正文、凭据不进入服务审计。
- 当前默认搜索已切换为 Exa 公开免密 MCP，不自动回退。服务单次实测的中文查询返回5条相关官方来源；平台原生 `web_search` 经同一专用代理再次返回3条住建部来源，并写入 succeeded 审计。固定JSON-RPC工具、严格响应ID关联、JSON/SSE解析、1MiB正文与1200字摘要上限都有回归，未继承任何账号或密钥。证据 `.cache/ddg-exa-chinese-report.json`、`.cache/exa-native-live.json`。免密服务有频率限制，研究结论仍需逐项核验。
- 真实网络联调定位并修复 Node 内置 fetch 与 Undici 8 dispatcher 接口不匹配，以及代理 TLS 握手失败的问题；使用配套 fetch，并明确固定目标 TLS 主机后实际连通。未关闭证书验证或修改系统代理。专用代理不会传给文本模型、ComfyUI 或网页原文抓取。
- 真实Worker发现并修复 Core WebQuery 冷会话误判：子会话完成并卸载后，从已有只读持久记录恢复原生检索证据，处理取消、读取失败与并发恢复；成功收执必须明确 `isError === false`。真实 web child 的搜索结果、执行与持久收执已确认，原生结果仍标记待研究证据模块校验。
- 修复 yaoguang02 文生图可选参考图空字符串兼容：仅 generate 的精确空字符串按省略处理，空白/非空/非法类型和 edit 缺图仍拒绝；与省略字段使用同一请求哈希，防止重复提交。
- 实际 Worker + yaoguang02 配套 LLM → `comfyui_pic` → ComfyUI → Collector 已产出 1024×768 candidate，既有质量阈值通过。只提交一次真实生成，收执 completed；原PNG经DSH附件规范化为JPEG，逐字节重现转换并校验工具附件、持久对象、清单与候选文件一致。证据 `.cache/live-native-20261103-KWvg6f/report.json`、`normalization-proof.json`。直接服务两图探针与此整链图合计三次GPU生成。
- 新目录默认待验证；既有 14 项历史快照可读且原文不变，新增模型在新 revision 中追加。别名伪装、协议降级和跨来源映射被拒绝。
- Core 受影响7个文件 **291通过、1跳过**，包括冷会话、持久读取、原生收执和图片收集，日志 `.cache/live-services-core-final.log`。
- 当前类型检查、生产构建与 UI 构建通过，日志 `.cache/live-services-typecheck.log`、`.cache/live-services-build.log`、`.cache/live-services-ui-build.log`。浏览器实际验收通过：三身份隔离、62项研究目录、章节图片、配置保存刷新及小屏布局；零浏览器错误，日志 `.cache/live-services-browser.log`。浏览器测试不触发真实模型。
- 当前 Web 全量 **254/254** 通过（含仅本地 CONNECT/TLS SNI 代理回归，不请求外网或关闭证书验证）：`.cache/live-services-web-tests.log`。DDG/Bing 解析、截断、超时取消、验证码、输入/正文上限及无自动回退有专项覆盖；历史页面缓存仅离线回归，不作为新的网络成功。

Bing 返回真实链接不代表中文检索相关性合格；本次中文测试未获相关来源，因此不作为默认服务。Exa 的同一中文查询已得到5条相关官方来源，仍需由研究证据模块逐项核验。

仍未验收完整业务研究、长篇章节质量、启航图像后端、Office/CAD/OCR、注册/密码管理、HTTPS 入口及完整备份恢复。ComfyUI 提交未知时的迟到图片仍需核对原收执，不能自动重发。

## 切换与回退

当前只运行候选 4320，不覆盖原入口。正式切换前需按真实项目资料完成业务验收，备份数据库及两个持久目录，确认用户数据迁移与 HTTPS 入口，再将入口指向候选版本并重复关键业务验证。

回退时将入口恢复原服务，停止候选 API，保留候选数据库和项目目录供核对；不得把新版本专业状态直接覆盖回旧库。当前开发本身不需要回滚旧服务，因为旧 checkout 与服务始终独立。
