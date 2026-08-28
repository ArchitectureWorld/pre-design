# DSH 前期策划 Agent

`@architectureworld/dsh-preplanning-agent` 是运行在 DeepSeek Harness Web Profile 内的原生前期策划插件。`0.7.0` 提供 8 章、57 项完整策划流程，支持人工确认和全自动两种模式，并从同一冻结成果版本交付甲方可直接查看的 HTML、PPTX、PDF。

## 兼容与边界

- DeepSeek Harness：`0.1.1-rc.2`
- DSH 源码基线：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- 业务合同：`contracts/v0.6`（57 个状态 Schema、57 个 Workflow、8 个 Gate、47 个原子工具）
- 治理合同：`contracts/v0.7`（模式、授权、Gate、视觉资产与报告包）
- 插件 ID：`preplanning-agent`
- npm 包：`@architectureworld/dsh-preplanning-agent`

插件不修改 DSH 核心、不提供第二套独立 Web，也不允许模型直接写 Project State 或自行批准 Gate。人工模式默认启用；全自动模式必须先获得明确的自动化授权。

## 仓库权威顺序

发生数量、状态或实现边界不一致时，按以下顺序判定：

1. `contracts/v0.6/manifest.json`、`contracts/v0.6/plugin.manifest.json` 与现场执行 `contracts/v0.6/tests/test_contracts.py` 的结果；
2. `contracts/v0.7/manifest.json` 及其治理 Schema；
3. 当前版本源码、自动化测试与 [验收记录](docs/acceptance.md)；
4. `docs/superpowers/` 和早期 `evidence/d0-d2/` 仅用于设计与历史追溯，不覆盖当前版本。

`contracts/v0.6` 是保留不改的业务合同基线；新增治理能力进入 `contracts/v0.7`。HTML、PPTX、PDF 只是冻结 Revision 的投影，不是 Project State 的事实源。全自动模式只能执行自然人 `decision_owner` 已明确签发范围的授权，不能把 Agent 或系统服务记为 Gate 批准人。

## 主要能力

1. 在 DSH 页面创建项目，并选择“人工确认”或“全自动完成”。
2. 通过数据驱动的合同注册表推进 8 章、57 项工作；中断后可恢复项目、Gate、视觉任务和报告包状态。
3. 模型只使用 `preplanning_get_context` 与 `preplanning_apply_commands` 两个受控工具。
4. 项目级视觉子 Agent 固定使用 `spawn / antigravity / gemini-3.1-flash-image`；禁止静默替换模型。
5. 事实地图、现状照片、红线和统计数据不得由生图模型伪造；AI 图只作概念方向表达。
6. 同一成果版本原子生成 HTML、PPTX、PDF，并在 DSH 总览中提供浏览与下载入口。

诊断和恢复命令：

- `/preplan-new <name>`：创建并绑定项目。
- `/preplan-open <projectId>`：绑定已有项目。
- `/preplan-list`：列出项目。
- `/preplan-status`：查看当前项目、57 项、8 Gate、视觉和报告状态。
- `/preplan-mode manual|automatic`：切换确认模式。
- `/preplan-confirm <proposalId>`：人工确认待复核提案。
- `/preplan-report`：从当前冻结成果版本生成报告包。

## 构建、Golden 成果与测试

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:built
pnpm golden:build -- --output C:\temp\dsh-preplanning-golden
```

合同门禁：

```powershell
Push-Location contracts\v0.6
python tests\test_contracts.py
Pop-Location
```

`golden:build` 生成 57 项已确认、8 Gate 已决定、12 张概念图和 17 张确定性图表的同源 HTML/PPTX/PDF。默认使用本机 Microsoft Edge；可通过 `--browser` 或 `PREPLAN_BROWSER_EXECUTABLE` 指定兼容的 Chromium 可执行文件。

## 安装到 DSH Web Profile

先备份 Profile 的 `package.json`、锁文件和 Cordis 配置，再使用官方 CLI：

```powershell
dsh plugin --profile web remove @architectureworld/dsh-preplanning-agent
dsh plugin --profile web add .\architectureworld-dsh-preplanning-agent-0.7.0.tgz
dsh --profile web --dump-config
dsh --profile web --no-open
```

不要手工删除 Session、Storage、模型设置或凭据。插件使用用户已在 DSH 中配置的文本模型；视觉路线只记录 provider/model，不读取或输出 API Key。

## 验收证据

- D1：真实 Qwen3.8 27B 人工确认闭环。
- D2：真实 Gemini 文本模型快速启动闭环。
- D3：0.7.0 全流程、双模式、视觉治理、三格式报告、重启恢复和发布证据。

详细结果见 [docs/acceptance.md](docs/acceptance.md) 与 `evidence/`。
