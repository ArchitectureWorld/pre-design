# D2 DSH 直接使用验收

日期：2026-08-28（Asia/Shanghai）

## 结论

`0.2.0` 的 DSH 原生快速入口已通过真实 Antigravity Tools / `Gemini 3.7 Flash` 验收。Gemini 只调用 `preplanning_get_context → preplanning_apply_commands`，一次生成合法 `pending_review` 提案；人工确认后 revision 1、PS01/data confirmed、approval approved。页面刷新和安装修正版后的 DSH 进程重启均恢复同一 Session 的最终状态。

## 自动门禁

- Vitest：14 个测试文件、35 项测试、0 失败。
- TypeScript：`pnpm typecheck` 退出码 0。
- 构建：`pnpm build` 退出码 0。
- 构建产物回归：1 个测试文件、2 项测试、0 失败。
- 安装包：359 个条目，`__pycache__` / `.pyc` 为 0。

最终安装包：

- 文件：`outputs/dsh-preplanning-0.2.0-gemini-copyfix/architectureworld-dsh-preplanning-agent-0.2.0.tgz`
- 大小：1,572,189 bytes
- SHA-256：`34BF2175CC1AA4853B4506C24A6F69476AA436F79F77190754F0FB9CE8B3DC43`

## 真实 DSH 验收

- DSH：`http://127.0.0.1:3080/`，HTTP 200。
- Session：`试一试看看通不通`（`session-baa120d0-c326-4e8d-a6fc-503a2b5cbc31`）。
- 模型：Antigravity Tools 的 `gemini-3.7-flash-high`，页面显示 `Gemini 3.7 Flash`。
- 项目：`Gemini直接入口验收项目`。
- projectId：`preplan-10dbd37f-d1fe-4078-b63d-6f3c73068289`。
- proposalId：`prop-PS01-preplan-10dbd37f-d1fe-4078-b63d-6f3c73068289-01-01`。
- 模型工具调用仅出现 `preplanning_get_context` 和 `preplanning_apply_commands`；没有文件、工作区或网页搜索。
- 提案阶段：revision 0、待确认 1、开放问题 1、`pending_review`，模型未确认人工 Gate。
- 人工确认后：revision 1、待确认 0、开放问题 0；Storage 中 PS01 `status=confirmed`、`data.status=confirmed`、`approval.status=approved`，提案 `status=confirmed`、`committedRevision=1`，身份问题 `resolved`。
- 页面刷新后恢复 revision 1；覆盖安装修正版并重启 DSH 后再次恢复 revision 1、待确认 0、开放问题 0。

## 一致性修复

真实页面首次验收发现快速入口把供应商硬编码为“Qwen3.8 27B / Qwen 正在生成”，与会话实际选择的 Gemini 矛盾。回归测试先稳定复现失败，再把入口改为“使用当前会话所选模型 / 模型正在生成待确认提案”。修正版安装并重启后，页面已显示供应商中立文案，模型选择仍为 `Gemini 3.7 Flash`。

## 安全与恢复边界

- 未读取、记录或修改 API Key 或模型凭据。
- 安装前后 `C:\Users\2899\.dsh\settings.yaml` SHA-256 均为 `06C1280D7F05266D5F8A1C04B0EF65D46FCEA718655F3016EB4A264FBEAD5D50`。
- 安装前备份：`work/profile-backups/before-gemini-copyfix-20260828-141405`。
- 不修改 DSH 核心，不删除旧 Session、项目、Storage 或诊断证据。
- 人工 Gate 只由页面“人工确认提案”触发，模型未越权确认。
