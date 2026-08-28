# DSH 前期策划全流程与甲方成果交付设计

## 目标

把当前只支持 `preplan.wf.01.01 / PS01` 的 DSH 原生插件扩展为可执行完整前期策划流程的交付系统。插件必须覆盖现有 v0.6 合同定义的 8 章、57 个工作项、57 个状态对象、8 个章节 Gate 与 47 个内部原子工具，并允许用户在项目创建时选择人工确认或全自动完成。最终验收先证明插件在真实 DSH 中正常运行，再展示可直接用于甲方汇报的 PPTX、PDF 与 HTML 成果。

## 成功标准

1. DSH Web Profile 能通过官方 CLI 安装单一 npm Bundle，Host 与 Browser 两半均真实加载。
2. 用户能创建项目、选择确认模式、查看 8 章/57 项进度、处理问题与修订、恢复重启前状态。
3. 全流程运行不再硬编码 `01-01 / PS01`，而是从合同注册中心解析并执行全部工作项。
4. Gemini 文本模型只能读取受控上下文并提交 Proposal，不能绕过验证直接写 Project State。
5. 人工模式按章确认 8 个 Gate；全自动模式在用户明确授权后自动推进，并在硬阻断条件出现时暂停。
6. 项目级视觉资产子 Agent 固定通过 DSH 调用 Antigravity 的 `gemini-3.1-flash-image`，生成并管理概念表现图。
7. 一个不可变 ReportPackage 同源生成 PPTX、PDF 与 HTML，三者的数字、结论、图片和版本一致。
8. 自动化测试覆盖合同、运行时、双模式、图像资产、报告渲染、安装包与重启恢复；真实 DSH 验收覆盖文本模型和图像模型。

## 固定边界

- 运行时固定为 DSH 原生插件，不新建第二套独立 Web 产品，不修改 DSH 核心。
- Project State 是业务事实源；Session Log 是交互与执行轨迹；报告文件只是确认状态的投影。
- 模型表面仍保持最小化。文本模型使用 `preplanning_get_context` 与 `preplanning_apply_commands`；新增视觉能力只暴露给受限视觉子 Agent。
- 任何事实型地图、现状照片、红线、测绘、CAD/BIM 或统计数据不得由生成式模型伪造。
- 现有项目、Session、Storage、模型配置、凭据和诊断证据必须原样保留并兼容读取。
- 未知事实必须形成缺口、假设或开放问题，不能为了完成报告而编造。
- PPTX 是甲方现场汇报主成果，PDF 是正式归档版，HTML 是交互浏览与证据补充版。

## 合同版本与兼容策略

现有 57 个状态对象 Schema、57 个工作流合同与 47 个原子工具的业务语义继续以 v0.6.0 为基线。为了支持双确认模式，插件新增治理版本 `preplan.runtime.v0.7.0`，只扩展项目执行策略、自动化授权、Gate 决策来源、视觉资产和 ReportPackage，不改写 v0.6 状态对象的业务字段。

新增治理合同包括：

- `ConfirmationMode = manual | automatic`。
- `AutomationAuthorization`：由 `decision_owner` 在项目创建或模式切换时签署，记录项目、授权起始 Revision、允许自动推进的工作项/Gate 范围、视觉生成预算、阻断策略与撤销信息。授权对该范围内后续 Revision 持续有效，直到被撤销、范围发生变化或项目转入人工模式；不会因为一次正常提交产生新 Revision 而自动失效。
- `GateDecisionSource = human_review | automation_authorization`。自动模式的 Gate 记录必须引用有效授权，不能伪装成人工逐章审核。
- `VisualAssetManifest`：记录视觉任务、参考资产、生成模型、提示词摘要、时间、尺寸、哈希、质量检查与采用状态。
- `VisualGenerationPolicy`：记录是否启用生图、目标数量、单任务最大尝试次数、允许分辨率与项目预算上限；达到尝试或预算上限时必须暂停，不得静默扩大调用量。
- `ReportPackage` 与 `ArtifactManifest`：锁定源 Revision、章节内容、视觉资产、渲染警告和三种成果文件哈希。

读取旧项目时缺省使用 `manual`，保持 v0.6 行为。新治理字段采用存储域 schema migration 增量加入，不修改已有记录。

## 运行时组件

### ContractRegistry

加载并索引状态 Schema、工作流、Gate、依赖图、权限矩阵和工具合同。对外提供按章节排序的 `WorkflowDescriptor`，包括 workflow ID、目标对象、目标 Schema、上游依赖、Gate、允许的确认路径和缺失数据策略。运行时不得维护第二份手写的 57 项清单。

### WorkflowRuntime

根据 ContractRegistry 和 Project State 计算下一可执行工作项。每次执行包含上下文切片、模型 Proposal、T42 合同验证、提交策略、状态更新、审计事件和下游解锁。工作项可以在合同允许时标记 `not_applicable`，但必须保存理由、证据和决策来源。

项目阶段使用以下状态：

- `not_started`
- `ready`
- `running`
- `blocked`
- `pending_review`
- `confirmed`
- `not_applicable`
- `superseded`

### ProposalGateway

移除当前只允许 `preplan.wf.01.01 / PS01` 的 D1 硬编码。网关从 WorkflowDescriptor 验证 workflow、目标对象、目标 Schema、actor、expected Revision、幂等键、证据、权限和确认策略。所有提交先形成不可变 ProposalRecord。

### GateService

人工模式在每章最后生成 Gate Snapshot，用户查看章节摘要、关键假设、未决问题和报告预览后确认或退回。全自动模式使用有效 AutomationAuthorization 继续推进，但仍生成独立 Gate Snapshot 和 `automation_authorization` 来源的 DecisionSnapshot。授权失效、数据冲突、硬约束失败或重大未知项会把 Gate 转为 `blocked`，不能自动通过。

### RevisionService

项目意见或资料变化形成 RevisionRequest。服务依据 dependency graph 计算最小影响范围，将被影响对象及下游标记为 `superseded/ready`，保留全部历史快照、提案、Gate 和报告包。已导出成果不会被覆盖，而是生成新 Revision 的新报告包。

### QuestionService

开放问题绑定工作项、优先级、责任人、阻断等级和所需证据。人工模式允许用户逐项回答；全自动模式只自动处理可由已登记证据确定的问题，缺少关键事实时暂停。

### ReportPackageService

从指定的已确认或自动完成 Revision 构建不可变 ReportPackage。正文、数字、表格、图表、视觉资产、假设和证据均在此阶段冻结。Renderer 只消费 ReportPackage，不直接读取模型对话或重新生成结论。

## 双确认模式

### 人工确认模式

- 默认模式，适合正式项目。
- 模型与系统可完成章内工作项的受控提案和验证。
- 每章结束时必须由 DSH 用户确认一个 Gate，共 8 个 Gate。
- 用户可以退回章内任意工作项并说明原因。
- 最终成果状态为“已人工确认”。

### 全自动完成模式

- 用户在项目开始时显式选择并签署 AutomationAuthorization。
- 系统自动执行 57 个工作项、验证 Proposal、提交 Revision、生成 Gate Snapshot 并继续推进。
- 以下情况强制暂停：Schema/规则/权限失败、上游数据冲突、硬约束否决、关键证据缺失、重大假设、图像质量不合格、报告渲染校验失败。
- 自动模式的审计来源明确为 `automation_authorization`，不能显示为人工逐章审核。
- 最终成果状态为“自动流程完成”，审计附录记录授权和暂停/恢复轨迹；甲方封面不添加影响观感的水印。

模式切换必须由 `decision_owner` 操作并形成审计事件。`automatic → manual` 立即生效；`manual → automatic` 需要新授权，且不能追溯性改变已有 Gate 来源。

## 项目级 Gemini 视觉资产子 Agent

### 配置

- 子 Agent 名称：`preplanning_visual_agent`。
- DSH Subagent Provider：`spawn`。
- 模型 Provider：`antigravity`。
- 模型 ID：`gemini-3.1-flash-image`。
- 生命周期：每个项目一个可持续恢复的子 Agent，记录在项目视觉配置中；同一项目恢复既有 descriptor，不重复创建。
- 最大递归深度：1，禁止继续派发子 Agent。
- Persona：建筑策划视觉导演，遵循项目 StyleBible、参考资产、证据边界和禁止伪造规则。
- 工具过滤：只允许读取已确认视觉任务书和指定参考资产、提交候选图片、登记视觉资产；文件落盘、哈希与清单写入由 Host 受控服务完成。禁止 Shell、网页搜索、Project State 写入和 Gate 确认。

项目启动时先通过 Antigravity 模型发现接口验证精确模型 ID `gemini-3.1-flash-image`。模型不存在、无配额或不可调用时，视觉任务进入 `blocked` 并显示诊断；插件不得静默改名或替换为其他模型。只有用户修改项目视觉配置后才能重新路由。

### 视觉任务类型

1. 事实证据图：真实资料接入、哈希和引用；生成模型禁用。
2. 数据表达图：地图、图表、流程、面积、投资和进度；由确定性 Renderer 生成。
3. 概念表现图：愿景、方向、方案、空间场景和重点节点；由视觉子 Agent 生成。

### 章节计划

- 01 项目任务：封面主视觉和项目定位图。
- 02 现状摸底：真实照片、地图和问题标注，不生成虚假现状。
- 03 问题与机会：问题热力图、机会结构图和因果图。
- 04 目标与方向：每个候选方向生成统一风格概念图组。
- 05 方案选择：为候选方案生成可公平比较的总图意向、典型场景和关键节点。
- 06 功能与规模：面积、容量和功能关系图，主要采用确定性制图。
- 07 空间与技术：选定方案的鸟瞰、典型空间、剖面意向和重点节点，是主要生图章节。
- 08 投资与实施：投资、分期、进度和风险图表，不用装饰图替代数据。

一套正式项目的默认目标范围为 12–20 张 AI 概念表现图、15–25 张数据图表或示意图，以及按真实资料数量使用的证据图片。目标数量受 VisualGenerationPolicy 约束，可在项目创建时调整。所有候选图进入 VisualAssetManifest。人工模式在方向、方案和最终空间表现节点选择图片；自动模式执行质量评分并自动优选，必需图像低质量时暂停。

每个 VisualTask 必须标记 `required` 或 `optional`。`required` 任务未获得合格 adopted 资产时禁止发布正式报告；`optional` 任务失败时可在 ReportPackage 中记录明确警告并继续，但不得留下破图、空白页或虚假占位图。

### 质量规则

检查建筑逻辑、透视、比例、文字乱码、人物与车辆异常、参考图一致性、风格漂移、事实边界和分辨率。每张采用图保存内容哈希、模型、提示词摘要、参考资产 ID、尺寸、生成时间、质量结果和采用 Revision。PPTX、PDF 与 HTML 只引用同一 adopted 资产。

## 甲方报告结构

PPTX 主汇报为 16:9，目标 35–60 页，并根据项目规模确定深度：

1. 封面与项目身份
2. 汇报目录
3. 核心结论与需甲方决策事项
4. 项目任务与策划边界
5. 现状摸底
6. 核心问题与发展机会
7. 目标体系与发展方向
8. 候选方案与硬约束筛选
9. 推荐方案与选择理由
10. 功能配置与建设规模
11. 空间结构与重点节点
12. 概念表现图
13. 技术策略
14. 投资估算与压力测试
15. 分期实施与时间计划
16. 风险、前置条件和下一步工作
17. 数据、证据与自动化审计附录

PDF 使用同一内容树优化为正式阅读和打印版。HTML 提供章节导航、高清图片、方案切换、响应式图表、证据追踪和成果下载。未获得的信息在正文显示“待补资料”及影响，在附录给出详细假设和证据缺口。

## 报告渲染架构

`ReportDocument` 是格式无关的内容树，节点类型包括 section、heading、paragraph、metric、table、chart、map、image、comparison、timeline、decision、warning 和 appendix。三种 Renderer 消费同一份冻结后的内容树：

- HTML Renderer：生成可离线打开的 HTML 目录，包含本地资源和响应式样式。
- PPTX Renderer：生成 16:9 可编辑 PPTX，使用统一主题、母版、页脚、章节色和版式规则。
- PDF Renderer：从同一 HTML 打印模板生成 PDF，保持目录、分页、字体和图片清晰度。

默认成果目录为 `<workspace>/preplanning-deliverables/<project-slug>/revision-<N>/<report-package-id>/`。包含 `.pptx`、`.pdf`、HTML 目录、`artifact-manifest.json` 和可选的审计附件。Host 提供 `/preplan-export`，Browser 提供“生成成果”和“下载成果”入口。

报告生成采用 `staging → validate → publish` 原子流程。ReportPackage 先冻结源 Revision 和内容树，三个 Renderer 在 staging 目录完成并分别校验；只有必需产物全部通过后才一次性发布目录和最终 ArtifactManifest。任一必需 Renderer 失败时，旧的已发布报告保持不变，本次 staging 不出现在下载入口，从而避免 PPTX、PDF 与 HTML 指向不同版本。

## DSH Browser 用户体验

### 项目创建

快速启动面板增加确认模式选择、成果深度和视觉资产开关。默认值为人工确认、标准汇报、启用概念表现图。模式说明明确展示成本、人工参与和报告状态差异。

### 项目总览

页面显示：

- 插件运行状态与当前模型路由；
- 8 章进度和 57 项完成统计；
- 当前工作项、阻断项、开放问题和待处理 Gate；
- 人工/全自动模式与授权状态；
- 视觉资产数量、生成状态和待选图片；
- 最新 ReportPackage 与 PPTX/PDF/HTML 下载入口；
- Revision 与审计摘要。

### 运行控制

用户可开始/暂停/继续全流程，人工确认或退回 Gate，切换模式，回答问题，发起修订，生成报告和下载成果。每个操作通过 Host 命令或受控 RPC 进入服务层，Browser 不直接写 Storage。

## 数据流

1. 用户创建项目并选择确认模式。
2. ContractRegistry 构建 57 项执行图，WorkflowRuntime 选择 `ready` 工作项。
3. Gemini 文本模型读取受控上下文并提交 ProposalEnvelope。
4. ProposalGateway 验证合同、权限、证据、Revision 和幂等性。
5. 人工模式进入章节 Gate；自动模式依据有效授权提交，出现阻断条件则暂停。
6. 状态更新产生新 Revision、审计事件和下游就绪状态。
7. 视觉任务进入项目级 Gemini 视觉子 Agent；候选图通过质量检查后写入 VisualAssetManifest。
8. 57 项与 8 章达到可交付状态后，ReportPackageService 锁定 Revision。
9. 三个 Renderer 生成 PPTX、PDF、HTML 和 ArtifactManifest。
10. DSH 页面先展示插件运行状态，再展示报告预览与下载入口。

## 失败处理

- 合同或 Schema 失败：Proposal rejected，Project State 不变，显示可定位错误。
- Revision 冲突：重新读取上下文并要求重建 Proposal，禁止覆盖。
- 缺少关键证据：工作项和自动模式进入 blocked，不生成伪结论。
- 模型失败或超时：按有限重试策略重试；达到上限后保留任务和诊断，可继续恢复。
- 图像模型失败：保留 VisualTask 和已生成候选，不回滚已确认文字状态；`required` 任务阻止报告发布，`optional` 任务按 ReportPackage 警告策略处理。
- 图像质量失败：不进入 adopted 资产；`required` 任务在自动模式暂停，人工模式要求重新生成或由用户提供合格资产。
- Renderer 失败：不发布不完整 ReportPackage；保留日志和已成功的临时文件用于诊断。
- DSH 重启：从 Storage、SessionBinding、子 Agent descriptor、任务状态和 ArtifactManifest 恢复，不依赖内存状态。
- 模式授权失效或撤销：自动推进立即停止，已提交 Revision 保留，后续转人工处理。

## 自动化测试

### 合同层

- 现有 v0.6 949 项断言继续全部通过。
- 新增 v0.7 治理合同测试：确认模式、AutomationAuthorization、Gate 来源、VisualAssetManifest、ReportPackage 和 ArtifactManifest。
- 枚举检查确保 8 章、57 workflow、57 state schema、8 Gate 与 47 tool 一一对应。

### 单元与集成层

- ContractRegistry 正确解析依赖、顺序、目标对象和 Schema。
- WorkflowRuntime 覆盖 ready、blocked、pending_review、confirmed、not_applicable、superseded。
- ProposalGateway 对 57 个工作项使用数据驱动测试，不允许任何 D1 硬编码回归。
- 人工模式验证 8 个 Gate 的确认、退回和恢复。
- 自动模式验证授权、自动提交、阻断、撤销和模式切换。
- RevisionService 验证最小下游重开与历史保留。
- VisualAssetService 验证事实图禁生、模型路由、哈希、质量门禁和 adopted 选择。
- ReportDocument 与三 Renderer 验证同源内容、页数/章节、链接、图片、字体、哈希和失败关闭。

### 端到端与产物层

- 8 个 Golden Scenario 各覆盖一章，另有一个 57 项完整项目场景。
- 完整 Golden Project 使用版本化、只读且可复现的输入资料包，至少包含项目任务书、场地边界与来源明确的地图、现状照片、功能规模输入、投资假设、决策角色和证据清单；每项事实保留来源与哈希，未提供的事实只能形成缺口或显式假设。
- Browser 真实 SlotRegistry 验证总览、双模式、Gate、视觉状态和成果下载。
- 构建产物加载 Host/Browser；tarball 禁止缓存和开发垃圾文件。
- PPTX 通过 ZIP 结构、幻灯片数量、关系和媒体完整性检查。
- PDF 验证文件头、页数、字体和无空白页。
- HTML 通过语义、资源、导航、响应式和无断链检查。
- Golden Project 的三种成果必须通过一致性检查和人工版式抽检；正文不得出现调试字段、测试术语、原始 JSON 或内部日志，除审计附录外应达到可直接向甲方展示的正式报告质量。

### 真实 DSH 验收

1. 备份 Web Profile、设置和当前运行状态。
2. 官方 CLI 安装最终 tarball，验证插件和模型设置未被修改。
3. 真实 Gemini 文本模型运行一条人工模式项目和一条自动模式项目。
4. 真实 `gemini-3.1-flash-image` 子 Agent 生成至少一个方向图组和一个方案图组。
5. 用冻结的 Golden Project 资料包完成 57 项全流程，生成同一 ReportPackage 的 PPTX、PDF、HTML；抽查核心数字、推荐结论、采用图片和 Revision 在三种格式中一致。
6. 页面首先展示插件正常运行证据，其次展示报告预览和下载。
7. 重启 DSH 后复核项目、57 项状态、Gate、视觉资产、ReportPackage 和下载文件。

## 交付物

- 可安装的 `@architectureworld/dsh-preplanning-agent` npm tarball。
- 自动化测试与分层验收记录。
- DSH 插件运行页面证据。
- 完整 Golden Project 的 PPTX 主汇报、PDF 归档和 HTML 交互成果。
- ArtifactManifest、VisualAssetManifest、Revision 和 Gate 审计记录。
- 安装前备份、最终包哈希和回滚说明。
