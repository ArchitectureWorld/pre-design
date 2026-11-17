# PPT Master 技术内核化与 Pre-design 原生设计融合

> **状态：已获用户明确批准，2026-11-17。** 最高架构依据：docs/architecture/REFERENCE_DESIGN_INTEGRATION.md。
> 本规格在 codex/web-v210 实施；不新建产品分支、不部署生产。

## 目标

将 PPT Master 的成熟解析、SVG、Design Spec、Template Designer 和质量检查能力内化到 Pre-design V14，使其成为 V14 的内部工具链；经 Native Design Compiler 转换为 Pre-design 原生 V3 资源，由 V08—V13 直接消费。用户只操作 Pre-design。

## 目标与非目标

目标：
- 固定并完整 vendor PPT Master 上游技术工具链及许可证/完整性门禁。
- PPTX 由上游完整导入器生成 Manifest、Native Structure、Master/Layout/Slide 继承图、Layered/Flat SVG、Authoring View 和素材清单。
- PDF、DOCX、SVG、PNG/JPG/WebP 继续使用各自平台 Adapter，合并到统一 Reference Bundle。
- V14 分阶段产出 Design Spec、页面原型、检查收执和 V3 候选。
- V3 保留 Brand/Style/Layout/Deck、Master/Layout 图、SVG 原型、内容槽、证据、容量和依赖。
- V08—V13 消费 V3，保持 V1/V2 兼容。

非目标：
- 不把 PPT Master 注册为独立 DSH Skill 或独立用户产品。
- 不把原件、客户正文、原始照片、项目事实复制到共享版式库。
- 不安装 PyMuPDF/AGPL PDF 工具链。
- 不声明未经真实导出测试的可编辑 PPTX/PDF 能力。
- 不修改生产端口、用户项目、数据库、模型策略或服务进程。

## 实现方案

唯一方案：完整 vendor 上游必要技术文件（保留原目录结构与守卫）+ Pre-design Adapter + V14 DSH 多阶段编排 + Native Design Compiler V3。直接运行上游 CLI 的地方只限于隔离工作目录和受限子进程；结果经平台校验后进入原任务/资源库，不创建上游工作台或注册库。

## 核心接口

- runPptMasterImport({sourcePath,workspace,signal,timeoutMs}) → {manifest,nativeStructure,layeredSvg,flatSvg,authoringSummary,assetManifest,diagnostics,receipt}。
- runPptMasterQualityCheck({workspace,signal}) → {status,errors,warnings,receipt}。
- buildReferenceBundle({files,sourceRecords,privateArtifacts}) → 统一私有证据索引。
- runReferenceWorkflow(...) 新增 design-spec、prototype、upstream-validate、native-compile 阶段；每个阶段保留实际 DSH 调用收执和失败终态。
- compileNativeDesignPackageV3({designSpec,manifest,nativeStructure,prototypes,evidence,rights}) → pre-design.layout-package.v3。
- renderNativeDesignPageV3({package,pageContent,projectAssets,overrides}) → SVG 原型背景 + HTML 可编辑内容槽。
- V1/V2 的 validatePackage、rendererForPackage 和历史资源行为不变。

## 安全约束

- 上游程序使用绝对脚本路径、参数数组、私有工作目录、固定 Python/LibreOffice 可执行配置、资源限制和超时；取消时杀死进程组并清理临时文件。
- 原件先经 Pre-design ZIP/XML/文件类型/大小校验，再交给上游解析器。
- SVG 必须安全清洗；拒绝 script、foreignObject、事件属性、外部引用、危险 CSS 和任意 HTML/JS。
- V3 不包含原件路径、原始文案、客户素材或业务事实；只保留可复用设计结构、资源引用和来源证据摘要。
- MIT License、Copyright、UPSTREAM 固定版本和文件 SHA 全部保留；Attribution Guard 原样通过。

## 验收

1. PPTX：真实文件经上游导入后产生正确页序、Master/Layout/Slide 继承图、Layered/Flat SVG、Authoring Summary 和素材清单。
2. 多格式：PPTX/PDF/DOCX/PNG/JPG/WebP 的来源和读取限制在 Reference Bundle 中正确表达。
3. V14：Design Spec、原型、质量检查、Native Compile 均为独立阶段；失败/取消不生成可发布候选。
4. V3：真实页面原型与槽位完整，V11实际使用SVG原型，不退化为五种固定布局。
5. 安全：恶意SVG、外部关系、越权读取、路径穿越、超时、取消、资源超限和错误上游完整性均拒绝。
6. 兼容：V1/V2 历史资源与绑定不变；V3修改后旧人工确认失效。
7. 验证：Node回归、Python解析测试、Chromium、隔离PostgreSQL、Web构建和GitHub Actions全部通过。
8. 真实模型：记录实际模型路由/输入页图/阶段收执；如果供应商模型失败，明确列为未完成，不用测试替身冒充。

## 部署

只同步 Git 到 codex/web-v210。 不在本轮操作 192.168.6.45:4320 或 DSH 3080；本地 Agent 按部署交接文件安装和验收。
