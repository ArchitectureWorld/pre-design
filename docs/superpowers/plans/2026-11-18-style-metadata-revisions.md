# Style Metadata Revisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让风格适配资源改名后仍能按真实来源审核选用，拒绝未验证设计修改而不破坏latest。
**Architecture:** revise事务从服务端上一收执验证来源，元数据白名单不变式，全新hash收执。旧资源修订兼容，审核仍精确版本绑定。
**Tech Stack:** Node ESM/Zod/PostgreSQL/原生UI/Chromium。
**Spec:** docs/superpowers/specs/2026-11-18-style-metadata-revisions-design.md

## Global Constraints
- 零外部模型调用；云开发，必要本地测试/部署固定4320。
- 仅name/description/tags，本轮不声称theme/几何普通编辑可用。
- 失败不产生不可审latest，不暴露私有收执，不继承审核/发布。

## Review Focus
- 删除提交marker也须由旧服务器receipt触发保护。
- 连续多次改名不能丢来源；新收执不能沿用旧hash。
- 同owner以外不得继承他人收执；源删除/冲突拒绝。
- 非白名单theme/assets/rights/designSpec变化写入前拒绝。
- 并发幂等及真实UI/预览/冻结HTML保持。

### Task 1: 元数据来源连续性
Files: resource-style-origin.mjs/store.mjs与专门test。
- [ ] RED：V2→V3→V4改名继续解析原源，公开返回无receipt；改theme/marker/rights/assets/旧layout失败且无新版本；普通资源兼容。
- [ ] 最小helper验证元数据白名单及原/新hash；revise事务基于old私有receipt生成新receipt并剥离public返回。
- [ ] GREEN、回归、独立审查后提交。

### Task 2: 真实体验回归
Files: 公共/私有resource-style.browser脚本与验收文档。
- [ ] 增加API连续改名及真实UI改名，重新validate/review，实际项目预览/应用HTML一致。
- [ ] 分别记录受控公共CI与真实私有输入，不能混淆；完整回归/CI后安全备份部署。
