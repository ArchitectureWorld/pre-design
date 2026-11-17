# Pre-design 参考设计引擎融合架构原则

> **权威级别：项目级架构原则。** 本文件自 2026-11-17 起，是 Pre-design 参考文件理解、版式生产、版式资源库及其 Skill 接入的最高约束。与本文件冲突的旧方案、旧 Schema、旧实现和旧测试假设，均以本文件为准；历史记录保留，不代表继续有效。

## 1. 核心决定

**Pre-design 是唯一主系统；PPT Master 是被内化的专业技术内核；V14 是唯一参考设计工作流入口；Native Design Compiler 是两者之间的原生编译层；V08—V13 是最终消费方。**

PPT Master 的解析器、SVG 转换器、Design Spec、Template Designer 方法、质量检查和模板预览能力，必须进入 Pre-design 现有 Web / DSH / Skill / 项目总档 / 版式库 / 版本管理体系。它不是另一个产品，不是一个并列 Agent，也不是用户需要单独打开或维护的第二套系统。

## 2. 五条不可违反的原则

1. **唯一主系统。** 用户只使用 Pre-design 的项目、任务、权限、资料、版式库、审阅与交付入口。不得引入 PPT Master 独立用户工作台、独立任务数据库、独立用户资源库或独立发布流程。
2. **技术内核化复用。** 优先原样复用固定上游版本的成熟解析、转换、作者工具和检查器；通过内部 Adapter 调用。不得只摘取少量 OOXML 文件后重新实现一个缩水解析器，也不得仅借鉴提示词而丢弃上游原生结构和 SVG。
3. **V14 唯一编排。** PPTX、PDF、DOCX、SVG、PNG、JPG/JPEG、WebP 及混合资料，均进入 Pre-design 的统一 Reference Bundle，再由 V14 编排。不同格式使用各自解析器；不要求共用一个解析器。JSON 是 Pre-design 原生资源导入，不是参考资料分析。
4. **原生编译，不做有损压扁。** 上游 Manifest、Native Structure、Master/Layout 继承图、分层/平面 SVG、Design Spec、素材引用和原型，经 Native Design Compiler 转为 Pre-design 原生版本化资源。必须保留可追溯的结构、设计语义、页面原型和来源证据；禁止压缩成少量颜色、字号和固定五种布局。
5. **Skill 原生消费。** V08—V13 直接消费同一 Native Design Package：V08 主题/设计系统；V09 页面规划；V10 页面原型与内容匹配；V11 SVG 原型和可编辑内容槽的实际排版；V12 全册一致性；V13 局部修改与人工保护。Q05/Q07/Q08分别负责人工参考确认、实际页面检查、交付格式检查。

## 3. 系统边界和责任

| 层 | 唯一责任 | 不得承担 |
|---|---|---|
| Pre-design Web / DSH | 身份、项目、任务、队列、模型路由、资料权限、版本、审批、资源库和交付 | 不另建第二套业务数据库 |
| Reference Bundle | 原件哈希、文件类型、解析事实、页码、图像、结构、限制及证据来源 | 不把参考文件中的项目事实写入当前项目总档 |
| V14 | 意图识别、解析器调度、设计分析、Design Spec、原型生产、检查编排和资源编译请求 | 不直接绕过平台接口写库或发布 |
| PPT Master 内核 | PPTX/OOXML 解析、Master/Layout/Slide 图、SVG 转换/作者视图、Design Spec 方法、SVG质量检查和PPTX预览工具 | 不拥有用户、项目、任务、权限或平台资源库 |
| Native Design Compiler | 上游成果到 Pre-design Native Design Package 的确定性转换、来源/哈希/能力映射和兼容性校验 | 不自行发明缺失的设计事实，不自动批准发布 |
| Native Design Package / 版式库 | Brand、Style、Layout、Deck 的平台原生资源、版本、依赖、原型、槽位、证据和检查收执 | 不存放无授权的参考原件或客户业务正文作为通用模板 |
| V08—V13 / Q05—Q08 | 真实项目中的选择、应用、编辑、检查、输出 | 不直接调用独立 PPT Master 产品入口 |

## 4. 上游能力复用范围

上游固定版本记录在 web/app/src/layout-library/vendor/ppt_master/UPSTREAM.json。当前锁定研究基线：hugohe3/ppt-master@3af3e8ef774c4d67ee57e1306d9256d08c9ee1bf，MIT License。

需要作为内部技术内核评估并复用：

- pptx_template_import.py、template_import/manifest.py、template_import/native_structure.py：事实清单、资源清单、Master/Layout/Slide身份及继承。
- pptx_to_svg/：完整 OOXML 到 SVG 的原生转换、分层/平面视图、图片/表格/图表/图形/文本处理和诊断。
- svg_authoring_view.py、extract_svg_assets.py、相关 SVG 资产工具：非破坏性作者视图、装饰资产规范化及来源映射。
- svg_quality_checker.py、svg_quality/：结构、槽位、页面族、资源和 SVG 原型质量检查。
- template_preview_pptx.py、svg_to_pptx/：在依赖和兼容性通过后，用于从 SVG 原型生成/检查 PPTX。
- workflows/create-template*、references/template-designer.md、shared-standards-core.md、native-shape-authoring.md、preset-shape-vocabulary.md、Design Spec Schema：作为 V14 内部工作流和设计生产规则的来源，移植/适配到平台现有 DSH 调用，不作为第二个 Skill 入口。

不得把上游 PDF 转换链中受 AGPL 约束的 PyMuPDF 依赖悄悄加入平台分发。PDF 继续使用平台已验证的 Poppler/页面渲染链；DOCX、图片等使用平台各自 Adapter，最后进入同一 Reference Bundle。上游依赖按实际调用路径拆分安装，不得无差别安装全部可选依赖。

必须保留上游 MIT License、Copyright、固定版本、文件来源与哈希。若上游 Attribution Guard 要求完整分发结构和执行门禁，则按原样保留，不得禁用、删除或伪造通过结果。上游 Skill 文件只作为 vendor 内部技术文档和 guard 依据，不注册为平台独立 Skill。

## 5. Reference Bundle：统一资料，不统一解析器

每个来源文件保留：
- sourceId、原始文件名/格式、原件 SHA256、大小、上传者和权限；
- 总页数、实际读取页码、未读取范围、解析器版本及限制；
- 分页文字、页面尺寸、页面图像、原生对象和关系；
- 每项事实的 provenance（extracted / observed / inferred / user）；
- 原件、派生图像、SVG 和结构化中间文件的独立哈希。

格式策略：
- PPTX：上游完整导入器；保留 Manifest、Native Structure、Master/Layout/Slide 图、分层 SVG、平面验证视图、authoring summary 和素材清单；另用平台安全页面渲染器产生真实视觉预览。
- PDF：平台 Poppler/文本解析器；保留页码、页面图像、文字、读取上限及权限限制；不声称未读取页已分析。
- DOCX：平台正文解析；若要分析页面风格，必须转换为真实页面图像或 PDF。纯文本只能支撑文字层级判断。
- SVG：校验外部资源、脚本、事件属性和引用；使用上游/平台 SVG 工具生成可追溯作者视图。
- PNG/JPG/JPEG/WebP：保留原件和实际送入视觉模型的派生图像哈希、尺寸及变换记录。
- 混合资料：按文件分别解析，再合并为一个 Reference Bundle；证据不跨文件伪造页码。

## 6. V14 参考设计生产流程

V14 是唯一入口，至少分为以下可审阅阶段：

1. **意图与范围**：区分 Brand、Style、Layout、Deck；区分 standard（按参考建立精简系统）、fidelity（较高程度保留设计特征并适配内容）、mirror（仅对具备原生结构的来源保留页面关系，明确不可支持项）。
2. **解析与覆盖清单**：输出每个来源文件、页数、读取范围、解析结果、结构和限制；解析失败不得回退到默认模板。
3. **页面观察**：按页/页组提供实际页面图像和原生结构证据；记录页面类型、版式、网格、信息密度、图文关系、颜色、字体、组件、装饰、来源页和置信度。
4. **Design Spec**：形成可读、可校验的设计规范，覆盖画布、品牌、视觉语言、字体、网格、页面家族、组件、图片处理、数据表达、容量、适配和禁用项；每条结论关联来源证据或标为推断/用户决定。
5. **Template Designer**：基于已确认 Design Spec 和真实参考证据，生成完整 SVG 页面原型、Master/Layout/槽位契约、素材引用及页面家族；不得仅输出抽象颜色/字号 JSON。
6. **工具检查与实际试排**：调用上游 SVG 质量工具和 Pre-design 自身内容/权限/几何检查；使用真实项目内容制作代表页，原页与新页并排审阅。
7. **Native Design Compiler**：编译为平台原生资源候选；保留上游结构和 SVG 原型引用、内容槽、组件、页面家族、依赖、来源证据、格式能力和检查收执。
8. **用户确认与入库**：Q05 人工确认绑定候选哈希、原型、检查版本和试排收执；确认后才允许发布/共享。模型分析、自动检查或测试替身均不能代替人工确认。

## 7. Native Design Package 与兼容策略

新增 pre-design.layout-package.v3，不破坏 V1/V2：
- V1/V2 保持原 renderer 和历史资源可读。
- V3 保留 brand、style、canvas、designSystem、masterLayoutGraph、pageArchetypes、components、slots、prototypeSvg/artifact refs、contentFitRules、sourceEvidence、rendererCompatibility、skillDependencies、validationReceipts。
- V3 中的 SVG 必须经安全白名单清洗；拒绝 script、foreignObject、事件属性、外部 URL、危险 CSS、任意 HTML/JS。原件图像与业务图片只通过当前项目的受权资产引用注入，不复制到共享资源。
- 所有页面原型与 Master/Layout 关系必须能被 V10 选择、V11 渲染和 V13 局部修改。无法映射的原生对象必须进入 limitations，不得静默丢弃。
- formats 和 renderer 能力必须按实际验证声明。HTML、PDF、可编辑 PPTX 分别验收；未通过不得标记支持。PDF 可由已验收的 HTML 页面打印，但不等于原生 PPTX 母版保真。
- 编译资源只含可复用设计知识，不含参考原件字节、原文、客户数据、项目图片或本地路径；来源哈希/页码/证据摘要可保留。

## 8. Skill 接口

- V08 读取 Brand/Style 与 Design System。
- V09 依据内容任务和章节结构生成页面计划，不受参考文件原页数强制约束。
- V10 匹配 page archetype、Master/Layout 图、组件与内容容量；匹配失败应提出拆页/改写建议，不强行套版。
- V11 使用 SVG 原型和声明式槽位填充项目内容，保留原型装饰和可编辑内容；不得把所有页面退化成通用卡片。
- V12 检查跨页一致性、页面节奏和版式家族。
- V13 只改指定页面/槽位/属性，保护人工锁和未修改页面。
- Q05 人工审阅原页与新页、使用范围和权利。
- Q07 检查真实渲染尺寸、溢出、遮挡、缺失素材、槽位容量和可读性。
- Q08 检查实际 HTML/PDF/PPTX 交付文件与声明能力一致。
- 所有 Skill 调用通过现有 DSH Worker/模型策略/任务队列；不建立第二个模型服务。

## 9. 安全、版本与运行原则

- 原件与中间分析产物按上传者/项目隔离；共享资源不能泄露原始参考文件。
- 模板资源不可变版本；项目绑定固定资源版本；模板更新不自动重排已确认成果。
- 资源包、renderer、compiler 版本、上游工具版本和验证 fixtures 均写入收执；升级后检查兼容性。
- 保存配置与实际应用分开；生成页面记录实际应用的资源版本和编译器版本。
- 解析、转换、渲染均有文件大小、页数、解压、时间、内存和并发上限；子进程使用固定可执行路径与参数数组，取消时杀死进程组并清理临时文件。
- 不改现有 Web/DSH 固定端口、身份、数据库、项目资料或生产服务；部署由用户本地 Agent 执行。

## 10. 完成标准

只有同时满足以下条件，才称为“PPT Master 与 Pre-design 完成融合”：
1. 上游代码固定版本、许可证、来源哈希和完整性门禁可复核。
2. PPTX 通过上游真实导入器生成 Manifest、Native Structure、Layered SVG、Flat Preview 和素材清单；不再使用缩水的重复解析器代替。
3. V14 的 Design Spec 与 SVG 原型由现有 DSH 工作流生产，并保留阶段级真实模型调用收执。
4. Native Design Compiler 产出的 V3 能被 V08—V13 直接调用，且保留设计原型和内容槽，不退化为 V1/V2 五种固定布局。
5. 真实项目内容试排与原页对照通过；人工确认绑定正确版本。
6. 至少验证 HTML 实际渲染；PPTX/PDF 只有通过各自真实导出验收后才声明支持。
7. Web/DSH 全量回归、浏览器、解析器、取消/权限/版本/失败路径测试通过。
