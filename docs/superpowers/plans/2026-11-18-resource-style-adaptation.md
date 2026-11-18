# Resource Style Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给既有资源提供明确风格重新设计的少内容版本，并证明真实页面可预览和使用。
**Architecture:** 独立style-adaptation请求和收执，不修改已有可信观察派生的来源要求。复用V3安全编译器与资源版本事务，源是已保存package，不是原PDF或模型job。
**Tech Stack:** Node ESM, Zod, PostgreSQL,现有原生UI/Chromium。
**Spec:** docs/superpowers/specs/2026-11-18-resource-style-adaptation-design.md

## Global Constraints
- 云端开发，真实测试/部署可用CSADI固定4320；零外部模型调用。
- 保留原版本/元数据/素材/权限；新增草稿不发布不绑定；不能伪造观察。
- 原可信派生门禁保持，不把缺来源候选送入旧接口。

## Review Focus
- 新旧派生路径被混淆：独立策略、请求、证据与收执测试。
- 并发新版本/过期hash：事务锁与幂等回归。
- 旧SVG/assets被重编译丢失：原版保持及明确拒绝测试。
- UI迟到响应和编辑丢失：POST+GET锁、关闭/切资源回归。
- 实际短正文与不同要点数：真实Chrome文字/几何/冻结HTML一致且无假图片。

### Task 1: 安全风格派生与版本API
Files: sparse-card-family.mjs（最小共享布局构造）, 新 resource-style-adaptation.mjs, store.mjs, routes.mjs；tests resource-style-adaptation.test.mjs/store/route。
- [ ] 写失败测试：无job输入可产生明确user请求+inferred平台派生；旧观察不增加/改写，原布局字节不变；缺权限/hash错误/坏canvas/assets不能静默通过。
- [ ] 实跑RED，再实现独立deriveStylePackage({actor,resource,request})；request含id/version/expectedHash/requestId/strategyVersion=1，styleAcknowledged=true，不接受客户端package或观察。
- [ ] 新增store.deriveStyle，沿用mutation锁与新增版本；receipt标sourceKind=resource-style、resource/version/hash及outputhash。
- [ ] 路由 /:id/:version/derive-style-adaptation 严格body。
- [ ] 受影响测试GREEN与旧可信门禁回归，提交。

### Task 2: 可试用入口
Files: ui.js；tests layout-style-ui.test.mjs。
- [ ] RED：独立“基于当前风格创建内容适配版”按钮及确认文字；dirty拒绝、等待禁用、迟到响应不能覆盖。
- [ ] 最小实现复用现有run/post生命周期保护，不自动替换项目或审核。
- [ ] GREEN，build静态依赖回归，提交。

### Task 3: 真实业务验证与交付
Files: 新browser脚本及CI，验证文档。
- [ ] 私有复制已有授权业务资源与实际页，不伪造jobs；走真实derive/validate/review/binding/visual/HTML链，保持源限制与原文，不生产复制候选。
- [ ] Chrome比较预览和最终内容/结构/几何，作者实际看图；缺失或溢出停止，不修改断言掩盖。
- [ ] 独立审查、完整回归/CI，精确树同步、安全备份部署及4320验证。
