# 会话附件交互 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan in the current session.

**Goal:** 把版式参考上传与待发送附件集中到会话输入框，显式发送后再分析，并部署及推送现有支线。

**Architecture:** `conversation-ui.js`负责附件状态与消息归属，`ui.css`负责紧凑输入框与拖入反馈；继续使用现有二进制上传、会话和下载接口。

**Tech Stack:** 原生JavaScript/CSS、Fastify、PostgreSQL、Node测试、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-16-layout-chat-attachments-design.md`

## Global Constraints

- 固定HTTP4320，DSH保持HTTPS3080；不更改模型配置。
- PDF100 MiB/前30页、权限解析、取消及原件保存继续有效。
- 选文件只上传解析；普通参考须显式发送才运行Agent。原生版式导入保持现有语义。

## Review Focus

- 上传中点击发送、解析失败后重试：不提前调用模型。
- 发送后继续输入/上传、切换会话：新草稿保留，迟到回调不串会话。
- 粘贴普通文字与输入法回车：保留编辑行为。
- 同名不同文件、旧消息缺少附件列表：原件下载入口完整。
- 792px窄屏、长文件名及多附件：输入、发送和取消控件可见，无横向溢出。

## Task 1: 会话附件与交互验收

- [x] 在`layout-conversation-ui.test.mjs`先验证附件不自动发起模型、显式发送携带文字与文件ID、消息归属、拖入/粘贴与取消。
- [x] 调整`conversation-ui.js`和`ui.css`的输入框布局、附件状态及历史消息；不新增后端操作。
- [x] 更新`layout-library-ui.browser.mjs`、`layout-upload.browser.mjs`及`layout-large-pdf.browser.mjs`为显式发送，验证宽/窄屏与原有上传能力。
- [x] 执行相关程序与浏览器检查，构建、备份部署到4320，正式页面验证且不触发测试模型任务。
- [x] 保存验证记录，提交并推送`codex/web-v210`，回读远程提交（提交号见部署收执与交付回复）。
