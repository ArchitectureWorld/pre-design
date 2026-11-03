# Web 2.1.0 DSH Worker

Web 运行入口见 [Web README](../app/README.md)。CLI/SDK 固定 `0.2.1-rc.5`，Node >=24.11。`runtime.mjs` 为每个项目建立独立 DSH 会话，`web-bridge.mjs` 通过本机私有 socket 调用研究、章节和专业核心；浏览器不能直接调用 Worker。

`build-host-probe.mjs` 构建实际使用的 Host 到 `.host-build/lib/index.mjs`，DSH 依赖由锁定的 Worker 安装提供。修改 Core 后必须重建 Host。

```bash
npm ci --prefix web/worker
export PATH="$PWD/web/worker/node_modules/node/bin:$PATH"
pnpm install --frozen-lockfile
pnpm build
node web/worker/build-host-probe.mjs
```

## 接入配置

`settings.example.yaml` 仅为格式示例，地址不可调用，不能作为“已验证”证据。支持传统 `llm-pi-ai.providers` 格式，或含 `id: llm-pi-ai` 的 profile patch。只投影任务快照允许的模型、预算、兼容参数和凭据引用，其他原 profile 插件不会加载。

私有凭据文件采用 DSH 的 `refs` 结构，例如键为 `SENSENOVA_API_KEY`；内容只在服务器本地配置，不能提交 Git。管理员策略中的 `credential:SENSENOVA_API_KEY` 必须与 provider 配置的 `apiKeyEnv` 对应。Web 私有配置只记录这两个文件路径。

`model-runtime.mjs` 固定本任务的主备链；`project-boundary.mjs` 约束父子 Agent 的工具、工作目录和公共网页访问。没有策略的只读 Worker 仍可打开项目、查询目录和恢复原会话，但模型调用会被拒绝。

## 本地验证

```bash
node web/worker/probe-research.mjs
node --test web/app/tests/research*.test.mjs
```

探针验证实际 DSH 进程、62 项目录、会话恢复、请求协议和执行轨迹。使用本机模拟 HTTP 提供方，不调用真实收费模型；本地 401 回执与路由守卫通过不能替代实际模型或图像能力验证。

`smoke.mjs`、`audit-host-types.mjs` 等为保留的早期诊断工具，不是 Web 用户入口，也不作为当前候选版本的成功证据。

## 已知边界

- 14 项目录的验证状态由管理员如实记录。图像适配器尚未装配，图像任务明确拒绝，不能落到被排除的服务。
- DSH 默认搜索会额外使用自己的模型凭据。当前未交接这条策略内的搜索接入，因此关闭独立搜索，保留受控网页原文抓取。
- 研究、部分完成、失败和取消以 Core 真实状态为准。研究结果汇编标记未经报告审查。
- 章节准备只能保存真实用户要求及当前项目上传图片；计划和审批哈希由原生流程生成，Web 不伪造专业成果。
- 原始资料/任务变化后不会强行续用旧快照，也不会自动扩大用户选定范围。
