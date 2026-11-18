# Sparse Card Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让少内容、无图的真实稿件可使用源卡片风格，明确平台派生。
**Architecture:** 保守识别观察卡组，生成显式派生 Native 变体，经现有 schema/覆盖/浏览器门禁，最后接入现有资源版本流程。
**Tech Stack:** Node ESM、Zod、node:test、Native HTML、Chrome。
**Spec:** docs/superpowers/specs/2026-11-18-sparse-card-variants-design.md

## Global Constraints
不读受限 PDF 对象/文字；不发外部模型；不自动写业务绑定或创建候选；不将合成测试当视觉验收。

## Review Focus
- 多组层级/混合结构必须拒绝，而非误当卡片。
- 缺图片不产生占位；有图片不能丢弃。
- 原段落/要点只消费一次，不虚构卡标题。
- 各版本与源证据隔离，不改变旧资源。
- 超容量真实浏览器拒绝；来源权利不扩大。

### Task 1: 保守卡组识别
Files: 新增 web/app/src/layout-library/sparse-card-family.mjs 与 tests/sparse-card-family.test.mjs。
Interface: inferSparseCardFamily(raw, allowedSources) 返回来源、空间排序组、派生声明，或带明确拒绝原因；不返回业务文案。
- [ ] RED：2/3/4组、不同坐标与ID正例；无正文/交叠/嵌套/孤儿/不等高/宽度极差负例。
- [ ] GREEN：复用 validateComponentObservation；几何判断无页码/名称特例。
- [ ] 回归已有组件测试；提交。

### Task 2: Native 变体及真实只读试排
Files: 同模块、Native相关测试及验证记录。
- [ ] 先写编译/完整内容覆盖测试，包括1/2/3要点、有无段落、图片/textBlocks/表格拒绝。
- [ ] 实现新推断证据及独立派生原型；原版保持；调用已有 Native Compiler 验证。
- [ ] 真实授权PNG对照实际业务页只读试排；Chrome截图与无溢出/原文完整证据；若不满意不宣称完成。
- [ ] 经独立审查后接入现有版本流程；不得未经核验发布。

## 当前验证记录
通用识别、派生编译与严格覆盖当前定向32/32通过。实际授权观察和真实首页已经既有Native编译/resolve选择无图2要点版，未写资源/绑定。Chrome实际视觉待本地私有测试。
完整web测试1085项：1013通过、56失败、16跳过，环境PG/Chromium/Poppler约束仍在，不能称全套通过。独立审查确认私有helper无安全阻断；补最小跨度拒绝及私有观察哈希收执，零要点页仍未支持。尚未接V14或部署，不能把内部函数作为已交付体验。

### Task 3: 原资源上的可信分析派生入口
用户已明确继续通用流程与可试用入口。使用显式资源操作，不触发模型，不创建第二候选。
- 服务端独立 sparse-derivation.mjs 从精确同owner/completed job/resource/version/hash 获取分析，核inventory/observations/profile；客户端不能提交分析或包。现有手工候选没有精确记录则明确拒绝。
- store.deriveSparse 用既有mutation/资源锁保存新版本与私有收执，支持重试幂等，保留原版本/metadata/rights/asset，不继承审核、不自动发布/绑定。
- routes严格校输入；UI在原资源选择参考页并添加无图变体，未保存编辑拒绝，晚到响应不覆盖新会话。完成后预览同资源新版本新增布局。
- TDD覆盖来源错误、重复/并发、metadata、无审核继承、API注入、UI会话生命周期。独立审查及真实PG/Chrome后按既定固定端口备份部署，不把SQLite当PG。
