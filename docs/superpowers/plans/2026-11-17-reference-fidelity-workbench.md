# Reference Fidelity Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 从三张真实参考建立可核对、可编辑、可复用的版式工作台，不以无溢出代替视觉合格。
**Architecture:** 沿用版式库和 V14，保留 V3 兼容。UI、批注生命周期、视觉能力分步集成；不足显式标注。
**Tech Stack:** Existing Node.js/ES modules, Zod, PostgreSQL, native DOM, Playwright tests.
**Spec:** docs/superpowers/specs/2026-11-17-reference-fidelity-workbench-design.md

## Global Constraints
云端开发；CSADI-Linux 4320 原入口部署。源观察不变，不覆盖已建候选；保留权限/版本/幂等/安全检查。不自动发布共享，不以截图背景替代可编辑结构。

## Review Focus
- 快速切换资源或版本期间旧预览不能覆盖新选择。
- 双击与关闭/返回不应重复操作或遗留观察器。
- 批注提交失败/版本冲突必须保留草稿，不能重复执行。
- 旧资源与无原页资源必须继续可用，缺失视觉能力不能虚报。
- 图组/富文本/表格替换必须完整覆盖内容，不截断或隐藏。

### Task 1: 矩阵及放大预览
Files: create layout-library/matrix-ui.js; modify ui.js/ui.css/conversation-ui.js; tests layout-library-ui.browser.mjs and layout-conversation-ui.test.mjs.
Interface: mountLayoutMatrix(container,{layouts,renderPreview,onSelect,onOpen}) -> {dispose}; previews consume existing /preview HTML and mountNativePreview.
- [ ] Write failing tests for all layout cards, distinct rendered HTML, selection, double click/keyboard open, disposal and stale async responses.
- [ ] Implement matrix with bounded lazy rendering and preview dialog; move assistant controls into closed advanced details.
- [ ] Run node/UI browser tests and build, commit.

### Task 2: 视觉能力与来源/派生审阅
Files: create fidelity-assessment.mjs; extend native contract compatibly; reuse-guide-ui.js/review-ui.js; tests fidelity-assessment.test.mjs.
Interface: assessment is keyed by source hash/page, layout ID, package hash; per feature records observed source evidence, representation/editability, status and reason. No score inferred from geometry.
- [ ] Pin tests for missing/unknown feature, source hash mismatch, derived versus observed, old packages without assessment.
- [ ] Implement explicit comparison checklist with separate geometry/visual/reuse states; preserve old validation gates.
- [ ] Verify original three pages and proposed render capabilities; mark unresolved texture/font/etc explicitly, no fabricated pass.

### Task 3: 版式批注草稿和批量提交
Files: new layout-annotations.mjs/routes and UI adapter using annotation-composer.js; migration in existing database bootstrapping; tests with actual PostgreSQL and browser.
Interface: anchors {resourceId,version,packageHash,layoutId,slotId?}; idempotent note create/edit/delete and batch submit; attach to current V14 conversation/resource without parallel model runner.
- [ ] Test cross-owner denial, stale hash/version, duplicate batch, failed submission retaining drafts and exact component anchoring.
- [ ] Extend existing note lifecycle with resource ownership rather than project spoofing; batch starts one existing V14 job only after explicit submit.
- [ ] Verify resulting new candidate links accepted note IDs; never mark applied merely because job started.

### Task 4: 三页真实可编辑能力
Files: existing composition-contract/render and upstream adapter, versioned native contract/compiler, fixtures/review docs.
- [ ] Inventory actual original source features and authorized reusable assets; map current unsupported features before adding schema.
- [ ] Add minimum required editable component bindings: local card headings/subheads/conclusions, styled spans, image groups, merged tables; write render/coverage/safety regressions first.
- [ ] Create new faithful candidates and separate derived adaptation variants using approved source, preserving originals; reference asset omissions remain explicit.
- [ ] Test alternate genuine content lengths and image ratios, browser overflow and screenshot comparison per feature. No whole-page image shortcut.

### Task 5: 集成与部署
- [ ] Independent review; focused regression, build, typecheck and browser interruption/repeated action coverage. Record unrelated failures.
- [ ] Backup database/code/dist/config; no active jobs; atomic update fixed 4320; verify original data/policy hashes.
- [ ] Real UI/API evidence with user-visible path and honest boundaries; leave drafts private until review.
