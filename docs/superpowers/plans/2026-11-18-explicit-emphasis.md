# Explicit Emphasis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 来源可追溯的图像强调候选与用户明确选择的项目原文强调。
**Architecture:** 扩展现有 fidelityFeatures 和内容映射，不另建库；版本化候选只作待审证据，项目 spans 通过现有严格投影校验。
**Tech Stack:** JavaScript ESM, existing Zod contracts, node:test, PostgreSQL, Chrome.
**Spec:** docs/superpowers/specs/2026-11-18-explicit-emphasis-design.md

## Global Constraints
- 云端开发；本地仅必要测试部署；固定4320；保留源稿/旧版。
- 零额外模型调用；不读取受限PDF原生内容；不推断共享权。
- 不修改模型prompt/schema/cache；候选仅来自已有图像语义。

## Review Focus
- Unicode surrogate切半不允许；转换为码点offset后精确quote验证。
- 重复短语仅按用户实际选区，不靠indexOf猜。
- 更换原文/版本不得携带旧spans；服务端409保留草稿。
- 候选可达source+slot角色拒绝错挂/权限字段。
- 导出仅版式不包含项目文本/已绑定spans。

### Task 1: Candidate contract and generation
Files: fidelity-assessment.mjs, component-upload-workflow.mjs, reference-components tests.
- [ ] RED: invalid source/role/region/extra data rejected; old package unchanged.
- [ ] Add optional strict emphasisCandidate v1 to fidelity feature and generate from validated semantic review, preserving source and pending status.
- [ ] GREEN focused, old schema/cache tests, commit.

### Task 2: Existing review and mapping UI
Files: review-ui.js, content-mapping-ui.js, canvas-ui.js; focused unit/browser tests.
- [ ] RED: explicit substring selections convert UTF16 selection offsets to Unicode offsets, repeated phrase correctly selected, half-surrogate/overlap refused.
- [ ] Add candidate source display and read-only project text selection with explicit style/add/remove; pass exact spans through mappingForSelections.
- [ ] Reset on source change, preserve failed saves, escape all data, default no emphasis.
- [ ] GREEN focused and real Chrome, commit.

### Task 3: Integrity, reuse and deployment
Files: existing content-mapping integration/browser fixtures and verification doc.
- [ ] Real PG stale/concurrent mapping and export-no-project-text tests; no original draft/package mutation.
- [ ] Independent review; full suite report including existing failures.
- [ ] Build/backup authorized deployment, verify served hashes/4320/user path; do not update already reviewed candidates silently.

## Execution ledger

- [x] Strict versioned candidate metadata and safe source navigation, unchanged model inputs/cache.
- [x] Explicit text selection and mapped spans, prefill/remove, exact original quote preservation.
- [x] Independent review, CRLF/CR correction with surrogate/overlap regression.
- [x] Real PostgreSQL + Chrome interactions, export/source preservation, 0 model calls.
- [x] Backed-up deployment and actual 4320 served hash verification (`325931f`).
- Remaining visual work is not acceptance of this interaction milestone: source-region overlays, title-level precise text binding and complete real multi-page design extraction remain separate future decisions. Do not silently upgrade existing tasks/candidates.
