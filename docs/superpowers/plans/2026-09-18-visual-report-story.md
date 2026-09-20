# 图文汇报与 HTML 优先交付实施计划

> **For agentic workers:** Use superpowers:subagent-driven-development for independent owned modules. 本轮方案已在对话中获得用户确认，继续开发、测试和现有本地部署，无需重复确认。

**Goal:** 案例每案3–4页，消除正文与表格的重复拆页，纯文字（含表格）≤15%，每个图解阶段都有相关图像，当前交付仅HTML。

**Architecture:** 在既有文稿投影层组织对外摘要，完整原文进入独立资料依据；稳定场景身份连接图片需求、生成采用和版式。导出前检查实际物理页配图与阶段覆盖，不以图标或纯SVG框图作为照片覆盖。

**Tech Stack:** TypeScript、Vitest、DSH VisualAgent、固定16:9 HTML画布。

**Spec:** 用户本轮五项要求及已确认方案（2026-09-18当前对话）。

## Global Constraints

- E:\前期策划开发，既有feat/pre-v2.0.1；保留当前dirty修改，不提交推送。
- 不重跑57项已完成专业流程；原稿、来源和资产历史保留。
- 文字模型额度已用完，不新增文字LLM任务；生图使用既有授权按需补齐。
- 同时最多3个子Agent，独立文件所有权；当前项目单页16:9。
- 配图必须与本页或阶段相关；真实案例照片不以生成图替代。

## Task 1：案例深化

Owner: case_studies_implementation。Files: src/report/case-studies/**、tests/report-case-studies.spec.ts。

- [x] 扩展gallery及来源证据，验证真实来源与照片哈希。
- [x] 每案场地/体验/空间组织/借鉴四页，输出稳定页ID和caseStudyPhotos(bundle)。
- [x] 测试每案例3–4页、独立内容、真实照片覆盖和缓存更新。

## Task 2：阶段图像需求与生成

Owner: diagram_implementation。Files: src/report/manuscript/visual-scenes.ts、src/presentation/report-scene-visuals.ts、page-visual-fill.ts、automatic-visuals.ts、material-registry.ts及相关测试。

- [x] 为阶段及无图页提取稳定场景需求，语义明确时复用相关已验收图片。
- [x] 需求进入真实VisualAgent生成、质量检查、采用与绑定；保持幂等恢复和额度边界。
- [x] 测试覆盖判定、稳定身份、阶段映射、真实source图片保护。

## Task 3：HTML-only导出

Owner: regular_layout_audit。Files: conditional-package-service.ts、validate-artifacts.ts及范围测试。

- [x] ConditionalReportOptions增加formats，默认HTML；显式三格式兼容，formal不改。
- [x] 缓存身份与校验包含格式集合；仅HTML时不调用PDF/PPTX/print。
- [x] 测试单格式与三格式、缓存切换、失败恢复。

## Task 4：内容与版式集成

Owner: root。Files: manuscript/report-story.ts、projector/manuscript-outline.ts、regular/layout.ts、regular/plan.ts、regular/render-html.ts、page-plan.ts、client-types.ts、conditional-report.ts、client-visuals.ts、index.ts及相关测试。

- [x] 同一论点正文去重；与表格重复的表述不再另起正文页。完整原文及表格存独立依据。
- [x] 图文共享版面，图解阶段照片在横/纵阵列中贴边；文字与照片可读。
- [x] 纯文字（含纯表格/纯框图）实际物理页占比不得超过15%；有实质照片覆盖才计图文。
- [x] 检查阶段图像100%绑定、阵列贴边和图片实质面积。

## Task 5：实际项目验收与部署

- [x] 运行范围回归、typecheck和全量测试；必要时修复既有测试中过时的125页/保留重复文案假设。
- [x] 生成诊断页计划；全部33场景已覆盖，首份完整HTML共155页、0纯文字/表格页、143阶段全部有图。
- [x] 全部配图完成后生成当前项目HTML；4案例各4页，0纯文字/表格页，143阶段全部配图，无同源完全重复正文。
- [x] 新包构建、保护数据备份、现有DSH部署；175文件1374测试通过，composition `planning-manuscript-2026-09-19.1` 已部署。
- [x] 原生完整导出；仅HTML，包 `conditional-5e2d72b8-ea3c-42cf-a9f8-aa54c3fef102`。修复通用竖图裁剪后复用现有素材重新导出，新增模型任务0。
- [x] 浏览器实翻155个不同页面，无坏图、文字/表格溢出，43图阵贴边；目视检查10个代表页。交付 `D:\shaotanhe\成果汇报\2026-09-18-r103-v3`，55图片副本hash一致。
- [x] 更新监督自动任务的已补齐配图、部署与验收边界，删除已过期的额度等待指令。
- [x] 正式交付后更新成品验收基准：`work/visual-story-final-receipt.json` 及 `docs/portrait-photo-layout-verification-2026-09-19.md`。不以自动验收替代用户内容评价。
