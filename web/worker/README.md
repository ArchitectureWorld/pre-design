> Web实际入口与启动说明见 [web/app/README.md](../app/README.md)。本目录同时保留P0诊断脚本；`runtime.mjs`与`web-bridge.mjs`用于本地Web接入。

# DSH P0 Linux 验证器（实验代码）

此目录独立于旧插件依赖，用来验证 RFC 的 **P0-A**。不包含业务 API，不代表 pre-design Core 已适配。CLI 与 SDK 固定为 `0.2.1-rc.5`，npm 锁文件锁定传递依赖。本地 Node 固定 `24.22.2`。

在仓库根目录执行：

```bash
npm ci --prefix web/worker
export PATH="$PWD/web/worker/node_modules/node/bin:$PATH"
node --version
# 只验证 SDK 控制面，不调用模型，不算 P0-A 通过
PRE_DSH_SETTINGS="$PWD/web/worker/settings.example.yaml" \
PRE_DSH_PROVIDER=p0-ollama PRE_DSH_MODEL=qwen3.8:27b \
node web/worker/smoke.mjs --control-only
```

真实模型测试：准备本地 settings.yaml（格式见示例），配置可达的模型端点；所需密钥通过配置中的 `apiKeyEnv` 对应环境变量提供；也可设置 `PRE_DSH_CREDENTIALS` 指向已有 DSH 凭据文件，脚本只读取所选 provider 的引用并传给子进程，不复制凭据文件。模型配置会转换为显式 profile patch，不依赖旧 settings 导入。不要将密钥提交 Git。

```bash
PRE_DSH_SETTINGS=/absolute/path/to/settings.yaml \
PRE_DSH_PROVIDER=your-provider PRE_DSH_MODEL=your-model \
node web/worker/smoke.mjs
```

每次测试创建全新的 `.cache/dsh-p0/run-*`，包含独立 `home`、`workspace` 和 `report.json`。真实测试将随机标记写入测试目录，要求 Agent 调工具读取，再关闭 Worker，恢复原 Session，让模型从历史返回标记。事件保存在该目录，只用于本地排障，可能含模型输出；不要上传整个 DSH_HOME。

失败返回非零退出码；控制面成功标记为 `control-only-passed-not-P0`；只有实际读取和历史恢复都通过才标记 `P0-A-passed`。请求超时 180 秒，整体截止 240 秒，清理时间额外由 SDK 限定。每次运行均在 finally 中关闭 SDK 子进程。验证器继承当前进程环境，因此只能在可信开发机运行；生产 Worker 的凭据隔离仍需另外实现。

P0-A 通过后才能继续 P0-B：将 pre-design 的 DSH 依赖迁移到新版本、拆分 Web-only 路由、加载真实专业核心并验证工具与领域状态。此脚本不会自动完成 P0-B。

已确认本机 Remote 的重跑命令（从仓库根目录）：

```bash
NO_PROXY="${NO_PROXY},192.168.5.221" no_proxy="${no_proxy},192.168.5.221" \
PRE_DSH_SETTINGS="$PWD/../deepseek-harness/config/settings.yaml" \
PRE_DSH_CREDENTIALS="$PWD/../deepseek-harness/state/.credentials.yaml" \
PRE_DSH_PROVIDER=ollama-remote PRE_DSH_MODEL=qwen3.8 \
web/worker/node_modules/node/bin/node web/worker/smoke.mjs
```

局域网模型地址必须加入大小写两种免代理变量；本机的全局 HTTP 代理不一定能访问局域网服务。此命令只读取已有配置，不修改原部署。

已通过 P0-A 的 Astra 路由（从仓库根目录）：

```bash
PRE_DSH_SETTINGS="$PWD/../deepseek-harness/state/profiles/web/cordis.patch.yml" \
PRE_DSH_CREDENTIALS="$PWD/../deepseek-harness/state/.credentials.yaml" \
PRE_DSH_PROVIDER=yaoguang-codex PRE_DSH_MODEL=yaoguang02-gpt-6-astra \
web/worker/node_modules/node/bin/node web/worker/smoke.mjs
```

输入可以是传统 settings.yaml，也可以是包含 `id: llm-pi-ai` 的 profile patch。只选取目标 provider，不加载原 Web profile 的其他插件。

### Host 兼容性实验（不是生产 Worker）

先在根目录安装锁定依赖并准备 Contract，再构建实验 Host：

```bash
export PATH="$PWD/web/worker/node_modules/node/bin:$PATH"
corepack pnpm install --frozen-lockfile
node scripts/prepare-presentation-contract-runtime-assets.mjs
node web/worker/build-host-probe.mjs
```

在上述 Astra 重跑命令前增加 `PRE_DSH_HOST=1`。实验 bundle 将 DSH 导入外置，从 Worker 的新版 node_modules 解析；不会把旧 DSH 实现打进 bundle。探针只在隔离运行中装配，提供临时 `p0_create_project` 工具调用真实 `preplan-new` 命令，随后要求模型调用 `preplanning_get_context` 和 `preplanning_read_material`。重启时验证项目记录仍在，再检查无工具的历史回答。成果根目录强制位于当前 runRoot 下，不继承外部成果目录。

通过结果标为 `host-load-probe-passed-not-full-P0-B`，因为根项目的正式依赖与专业流程尚未全面迁移。不要把该 bundle 或测试建项目工具作为生产接口发布。

新版类型差异可复现检查：

```bash
node web/worker/audit-host-types.mjs
```

此命令以配置覆盖的方式对照新版 DSH 类型检查 src，不修改根 manifest。当前预期退出 2（存在尚未迁移的旧 Subagent 接口等），与旧依赖下通过的常规 `typecheck` 是两种检查。
