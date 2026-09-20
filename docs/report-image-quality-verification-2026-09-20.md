# 通用汇报图像质量修订验证

本轮按已批准的 2026-09-19 图像质量方案修改 pre-design 通用程序，沿用 `feat/pre-v2.0.1` 开发目录。没有手工修改少潭河正式 HTML。

## 程序行为

- 按原图家族计算使用量，缩放、裁剪和加字派生图共用额度；每篇最多两次，同一物理页最多一次。
- 完整展示总图及复合分析图；普通照片须保留至少 80% 原图面积和全部关键主体。宽幅图使用适合比例的版面，分页后补充独立原图。
- 顺序流程使用编号和排列次序；分支关系保留必要连线。阶段字幕居中，背景 alpha 0.35，文字不透明。
- 全局子 Agent 设置新增素材审图，模型来自 DSH 实时目录。原图与随机图像输入挑战发送给真实子会话，审核记录绑定实际执行、图片、来源、需求及版面。
- 国内场景默认中文和本土环境；项目定位明确支持国际化时才开放例外。
- 每案围绕面、线、点和借鉴组织 3–4 页，保留真实来源及至少两项共同点。
- 优先项目素材和可信网络原图，生成用于补足缺口；检索和下载保存来源证据，审核与最终展示共用去重及质量规则。
- 继续采用 16:9 单页 HTML。纯文字与表格页占比不超过 15%，未通过实质配图检查的图片不计入合格配图。

## 已完成验证

2026-09-20 最终新鲜运行 `pnpm typecheck` 和 `pnpm test`：186 个测试文件、1524 项测试全部通过，完整测试于 10:00:22 完成，耗时 368.39 秒，含构建、版本一致性和 Presentation Contract 校验。集成回归覆盖原图家族额度、来源变化后的缓存失效、具体用图位置、失败恢复、取消、宽幅排版、原生模型错误传递、空主体范围的拒绝记录和带填充 JPEG 的完整审图链路。

当前发布包由已验证构建通过 `npm pack --ignore-scripts` 打包，未重建。SHA256：`ba474337633e422176e0521a6cc9af7be2e47463e0e8d09346c8a06e6c7bf6f8`。包内 194 个代码文件与验证后的源构建逐一吻合；源码、检查日志和绑定记录见 `work/report-image-quality/release.json`、`pack-verified-ba474337633e.json`。

10:01:15 已备份部署该包。备份：`C:\Users\2899\.dsh\backups\report-image-quality-20260920-100101`。194 个安装代码文件、受保护数据、原稿哈希全部吻合；Sharp 原生探针及 DSH 实时子 Agent 设置接口通过。Gemini 图片输入声明、全局模型路由与原授权在重启后保留。原主会话也通过原生菜单切到 Gemini 3.8 Flash，重启后已确认；没有发送额外模型消息。没有重跑工作流或重写文案。

运行验证还发现大图与诊断问题，已修入通用代码：21.05 MB、3483 万像素的项目原图完整缩放为 1721×2434、1.38 MB 阅读副本，原始文件不变；原图身份比对可取消并让出事件循环；来源、地点及原图哈希参与缓存核验；规范化生成图仍正确采用。三次真实子会话的原生错误信封在独立存储中回放，分别正确显示缺少凭据、登录过期、服务无可用账户。该回放没有新模型请求，不等于真实审图通过。

## 尚未完成的真实验收

同一次 400 次非图像模型授权继续累计，前四次失败审图均已明确终止，失败计数完整保留，没有自动续授：

| 尝试 | 路由 | 原生错误 |
| --- | --- | --- |
| 01 | deepseek-official / deepseek-v4-flash-vision-exp | MISSING_CREDENTIAL |
| 02 | openai-codex / gpt-5.4-mini | OAuth 401 / refresh_token_invalidated |
| 03 | workdubbyAI / global:gpt-6-astra | SERVER 503 / no_healthy_account |
| 04 | antigravity / gemini-3.8-flash-high | DSH 模型声明为仅文字输入，随机图像校验未通过 |

直接查询 Workbuddy 网关：健康账户 0/1，唯一账户被上游以 11140 request illegal 禁用，实时模型列表为空。两个已配置 Ollama 服务也均未连接。09:17 用户明确授权 Workbuddy 失效时由 Gemini 替代，覆盖先前“Gemini 仅生图”的限制。已用实时 DSH 模型目录和 CAS 将全局配置改为 revision 16：文本、网络查询、素材审图采用 `antigravity/gemini-3.8-flash-high`，生图维持 `antigravity/gemini-3.1-flash-image`。

09:28 通过原生设置 CAS 为该 Gemini 模型启用 `[text,image]`，配置即时生效；备份、精确差异见 `work/report-image-quality/gemini-image-input-receipt.json`。按原生子会话终止证据重算并匹配第四次失败的八条需求记录，原样归档到项目 `image-review-recoveries` 后显式恢复一次。失败执行及额度计数未修改，证据见 `gemini-input-recovery.json`。

09:34 实际模型链路已验证：第五轮导出的前两个原生 Gemini 子会话均完成，随机色块校验通过，16 个图像与位置组合保存了 `actualImageInput=true` 的审核回执（2 个通过、14 个内容不匹配）。首个成功子会话 `1bfa9c97-ba19-4e3a-ada1-cdb11955e203`，执行 `4480d7bd-4323-4b18-a8f6-b5bf3b5438ef`。这是实际审图证据，尚不代表全篇配图或新 HTML 验收完成。

第五轮第三批因“不相关项返回空主体坐标”被旧 schema 误判整批失败，于 09:34:53 明确结束。原始返回的实际色块全部正确。此次修复允许记录空主体范围的拒绝结果，同时禁止任何空主体范围的图片通过审核。原始返回隔离回放得到 1 个通过、7 个拒绝，未改变生产审核记录；新增两条回归先失败后通过。部署后精确匹配的八条失败记录被完整归档，执行记录和已用 7/400 额度不变，证据 `empty-bounds-recovery.json`。

第六轮又完成三个真实审图任务，累计 40 条回执（4 通过、36 拒绝），随后于 09:50:08 因 JPEG 容器兼容问题明确终止。素材规范化已允许尾部零填充，但原样传给审图入口后被严格容器检查拒绝。现已无损去掉阅读副本的填充，保留原图和编码像素；真实 12 张候选都通过入口格式检查，其中两张象山案例图证实存在尾部填充。原始文件不变，证据 `native-raster-preflight.json`。旧失败记录保留，修正副本以新图像 hash 和来源绑定参与审核。

第七轮正常导出已启动，复用已完成审核，沿用同一授权与原稿，启动前累计使用 10/400 次。最新结果以 `work/report-image-quality/current-export.json` 指向的回执为准。新 HTML 尚未生成和验收。

10:05:30 实测：JPEG 修复后又有四个原生 Gemini 审图任务完成，包含此前失败的象山批次；累计九个审图任务成功，72 条位置回执（8 通过、64 拒绝），第七轮仍在执行且尚无新错误。审核拒绝属于筛选结果，不是模型运行错误；未通过的图不会用于报告。

现有原稿和 r103、57 项工作流及旧交付保持不变；原有 302 条执行记录保留，新增执行继续累计。只读需求核算为 187 个用图位置，分页前至少需要 94 张独立原图；这个数字不是已通过审图的素材数量。真实图片输入、内容匹配和新报告逐页浏览均不能由模拟测试代替。

早前各候选的证据独立保存在 `work/report-image-quality/initial-e50725e9a400-evidence`、`performance-1498-evidence`、`candidate-95aee1d5a8b3-evidence`、`deployed-aed8e69f90be-evidence`。pnpm 打包自动删除 prepack 字段导致 09:03 首次安装严格校验失败并自动回滚，证据保存在 `pack-normalization-83664e073fd8`；随后改用 npm 原样打包并预检，未放宽哈希校验。

### 2026-09-20 10:28 CST — 原生审图输出上限修复

第七轮于10:07:32明确终止，错误IMAGE_REVIEW_FAILED: max-tokens；原生子会话7eb1ba49-4fec-45e6-9740-aa6967468d0d的request/header证实maxTokens=6000且turn/end=max-tokens。当前16/400，10完成6失败，77条审图回执中9通过68拒绝；无新HTML。不能将回执总数当作已完成位置数。

根因位于ImageInspectionAgent硬编码的6000覆盖DSH选定模型配置。修复显式传maxTokens:undefined，清除原生委派继承的主会话临时上限，交DSH按所选模型解析；未写死Gemini或新额度。新增两条测试通过实际resolveChildAgentOptions验证同模型/不同主会话模型均不继承2048限制，先红（实际6000）后绿。另验证max-tokens即使含可解析文本仍拒绝、无自动重试。27个审图/完整配图管道focused测试通过；全量验证10:23启动。

本次八条失败尝试已按原生输入、图hash、来源、需求和路由重算核对，仅dry-run；修复部署后才归档恢复，原失败执行和计费计数保持。证据review-budget-7eb1ba49-4fec-45e6-9740-aa6967468d0d.json、review-budget-red.txt、review-budget-green.txt。

10:30:12 修复包3c182ba014897fe1c24949052e00c8ba511607efde80f15bf479cbfdc1df8562已备份部署。全量186文件1527测试通过（10:29:18），194代码hash匹配且受保护数据未变化，Sharp探针、live类配置及浏览器原会话Gemini选择通过。备份C:\Users\2899\.dsh\backups\report-image-quality-20260920-102958。已精确原样归档第七轮8条失败尝试，executionAccountingUnchanged=true，output-budget-recovery.json。10:31:41启动第八轮原生导出aa676acd-d106-4886-af52-1381ac60bd45，启动时16/400；结果以current-export.json指向的回执为准。未完成的新HTML不作交付。

## 2026-09-20 11:29 CST — Scene correction deployed, attempt09 running

The generic source-grounded scene resolver is deployed as package e349c2c93ebb675a6c2fcb47dc0438caadf576621e9817e0f8431d8434369524 at11:27:43. All196 installed code files match; protected settings/storage/report-studio and original manuscript are unchanged. Native Sharp, live class API and the original browser session with Gemini3.8Flash selection were verified. Backup C:\Users\2899\.dsh\backups\report-image-quality-20260920-112729.

Validation evidence is precise:118 targeted tests passed. The fresh full run covered188 files and1588 tests:1587 passed and one existing page-fill integration test hit its5s timeout. That complete14-test file then passed unchanged; the previously timed-out test took2543ms. final-full-suite.exit remains1 and its original log is preserved. prepare-release.mjs only accepts this explicitly matched sole timeout plus its later full-file passing receipt; no assertion failure is waived or result relabeled. Typecheck/build passed; npm packing and196-file tar preflight passed.

Scene version report-scene-spec-2026-09-20.3 preserves exact source citations without making natural-sentence coverage into an entity rule. Complete cited statements accompany resolved briefs as sceneGrounding for actual pixel review. Search and generation also receive original full manuscript context. Real source replay confirms the two detected false rejections now accept the complete observable phrases.

The eight cancelled attempt08 records were verified against native input/source/image/brief/route hashes and moved intact to .pre-design/image-review-recoveries/scene-spec-cancelled-fdd46fd7-c642-40cf-b307-59311b6980ed. scene-spec-cancellation-recovery.json retains proof and hashes; execution accounting stayed unchanged at29/400.

Attempt09 started normally at03:29:00.100Z, RPC ddecf662-c29b-4fda-ae63-3d84990b9019, owned HTTP client PID69976. First scene child c1a52bad-3fdd-47ee-b302-7b9e49dc8c31 has actual Gemini3.8Flash header maxTokens65536. Scene completion, review, gap fill and new HTML remain to be verified. Read current-export.json before any action; no competing RPC, restart or source edit while active.

## 2026-09-20 11:45 CST — Provider compatibility correction

Attempt09 failed with native max-tokens despite a65536 header. Exact installed Antigravity Tools v4.7.2 source confirms its OpenAI request schema only accepts max_tokens. The installed pi-ai adapter sends max_completion_tokens for the local custom provider unless compat is explicit. Actual pi-ai requests to a local synthetic endpoint reproduced the mismatch and verified max_tokens65536 after correction, with zero real model calls.

Changed only DSH providers.antigravity.compat.maxTokensField=max_tokens via native settings CAS, checked exact namespace readback and live apply. Backup C:\Users\2899\.dsh\backups\gemini-token-field-2026-09-20T03-44-06.075Z; evidence work/report-image-quality/gemini-token-field-receipt.json. The correction applies to the provider across projects, not to project data or manuscript content. Real-model outcome remains pending.

Preserved the failed execution04cb5d67-7cb3-45b4-afa6-d8ec53d451dc and30/400 accounting. Eight failed scene-cache records were independently matched to native request hashes and archived intact for one explicit continuation. Attempt10 RPC fee0a632-fe4b-44a7-a1d0-2e3f44d8a8bd started03:45:25.137Z. The previous HTML is still the only delivered report; a successful export and actual browser checks remain required.

## 2026-09-20 12:10 CST — Scene protocol .4 deployed

Attempt10's native child completed normally with a full, parseable eight-item response, verifying the previous truncation no longer occurred on this batch after the provider field correction. Business validation then exposed an empty current-node scene and two overly generic facility subjects. Their original failed execution and eight .3 cache records remain unchanged.

Generic protocol .4 explicitly allows citations from all supplied source fields including the current node, adds safe field/constraint diagnostics, and permits at most two correction requests only for a completed model response with known validation errors. Each correction reserves a separate model task and preserves attempt IDs. Unknown/transport/truncated/cancelled outcomes do not redispatch. Independent review found and reproduced a correction-count reset after a budget pause; the final guard keeps not-started records with existing attempt history blocked for explicit handling, preserving both history and the original correction bound. No schema or source-evidence requirement was relaxed.

Verification: diagnostic62tests and scene-agent9tests passed after observed red regressions. Integrated130tests passed. Final fresh typecheck/build and full188files/1600tests passed at12:06:50. The earlier incomplete full run was preserved with explicit interrupted status. Package9abd451790e1fb1d5e8590b677dc8d40f5560bc45f2fb4479e0f9ec441ec05fc passed196-file tar verification and installed12:07:57.771, backup C:\Users\2899\.dsh\backups\report-image-quality-20260920-120744. All196 installed hashes and protected-data hashes match; native Sharp and live class API passed. The global revision16 routes and max_tokens compatibility setting were verified after restart. The original browser session title was restored; historical413 errors in its history are not new failures.

Attempt11 began04:08:51.820Z through the normal export command, RPC e14938cf-f645-4238-ad7f-c891e3b622eb, owned clientPID58916. Same400-task authorization;31 were used before starting, first task reserves32. Original manuscript hash remains unchanged. No new HTML has yet been delivered; native scene completion, material acquisition/review, export and browser acceptance remain required.
