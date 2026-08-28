# D1 真模型凭据门禁证据

日期：2026-08-27（Asia/Shanghai）

## 实际请求

- 路由：`deepseek-official`
- 模型：`deepseek-v4-flash`
- 页面选择：`DeepSeek-V4-Flash`，推理等级 High
- 请求已从真实 DSH Web Session 发出。

## 实际结果

DSH 返回：

```text
MISSING_CREDENTIAL
no API key for provider route "deepseek-official"
```

这证明请求已经到达真实模型路由选择层，但不证明模型调用成功。由于在 LLM 调用前失败，当前没有 `preplanning_get_context`、`preplanning_apply_commands`、`pending_review` Proposal 或 revision 1 的验收证据。

## 安全边界

- 未读取、复制、生成或修改 API Key。
- 未修改 DSH 核心、现有 Storage 或既有 Session。
- 未删除失败 Session。
- 凭据只能由用户在 DSH Web“模型”页面中配置。

## 恢复点

- Session：`session-f83acedf-6510-4784-a96b-2154f1ef9dc5`
- 项目：`preplan-c0c33d27-0a49-44fc-b279-1aa2c7676a0a`
- 状态：revision 0、阶段 01-01、待确认 0、开放问题 1

配置凭据后应在该 Session 原地重试，并按 `docs/acceptance.md` 完成余下闭环。
