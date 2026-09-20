# 前期策划汇报文案修正 Implementation Plan

> For agentic workers: 按文件所有权并行；本会话已获用户要求修正 pre-design 的授权，不增加重复确认。保留已有业务数据及未提交修改，不自动提交或推送。

**Goal:** 从项目资料撰写可以直接进入汇报的文案，取代工作项字段裁剪。

**Architecture:** 业务 State 保留原始分析。配置的 text 子 Agent 形成独立、带来源的 PlanningManuscript，并以业务指纹、版本和章节检查点保存。统一投影到 Presentation 和三种导出；先文案、后按页配图。

真实审读后的修订：七章初稿须经过同一文本类真实子会话的统一成稿编辑，才发布正式文案。编辑失败不采用初稿；正文与依据/图文说明分文件。已完成章节检查点复用，编辑任务也计入既有模型授权额度。

**Tech Stack:** TypeScript、Zod、现有 DSH subagents/AgentClassService、Vitest、现有 Presentation 合同和导出器。

**Spec:** [参考方法与内容契约](../../reference-shiqiao-planning-method.md)。

## 约束

- 主库 `E:\前期策划开发`，当前 `feat/pre-v2.0.1`；项目材料在 `D:\shaotanhe`。
- 不把石桥事实、数字、图像或业态当少潭河数据；不修改原资料。
- 不固定页数、产品数或三条摘要；来源不能静默丢失。
- 生图按需不限量，文本继续使用既有额度与模型配置；不重复执行 57 个工作项。
- 取消、项目切换、版本变化都阻止继续派发和采用；失败留证，禁止旧摘录冒充新稿。

## Task 1：内容契约、真实编写和持久化

Owner: report_content_trace。文件：`src/report/manuscript/*`、`tests/planning-manuscript.spec.ts`。

- [x] 先建立失败测试：来源不存在、产品描述残缺、内部纪要语句、旧版本、取消采用。
- [x] 输出稳定来源索引、通用专业写作要求、结构化章/页合同、校验器。
- [x] 使用 text 类真实 DSH child，分章检查点、有限纠错、同源缓存和原稿归档。
- [x] 通过针对性测试，不调用真实模型。

## Task 2：统一主流程与内容投影

Owner: root。文件：`src/index.ts`、`src/session/report-completion.ts`、`src/report/types.ts`、`src/presentation/projector/client-outline.ts`、`src/presentation/material-registry.ts`、`src/presentation/client-visuals.ts`、`src/commands/register.ts`。

- [x] 失败回归：同章两个产品保留两页；正文表格和完整句子进入草案；未编写时不能静默导出旧摘要。
- [x] FrozenProjectInput 承接同版本内容稿；自动完成和导出都先完成编写。
- [x] 稳定页 ID、来源和图像职责进入投影；资料库采用相同页计划。
- [x] 取消“正文卡片当分析图”，逐页场景 brief 区分体验；旧素材不丢文件但不强行绑新页。

## Task 3：汇报正文输出

Owner: root。文件：`src/report/conditional-report.ts`、`src/report/client-types.ts`、相关 HTML/print/PPTX renderer；新增共用页内容渲染辅助。

- [x] 新内容页保留论点、完整段落、比较/测算表和产品要素。
- [x] 章节标题、可读正文与出处分工；资料条件集中说明，不让审计语句主导全文。
- [x] 同一份文案供草案、网页、打印和 PPTX，保持表格内容一致。

## Task 4：验证实际产物

- [ ] 运行相关回归、类型检查和构建包加载测试。
- [ ] 用实际少潭河输入完成一次真实模型编写，不重跑基础策划。
- [ ] 阅读生成的定位、产品、空间和启动文案；记录内容问题并修正。
- [ ] 展示方法提炼、修改点、实际样稿及仍未验证的边界；不以测试数量或配图率声称内容已获用户接受。
