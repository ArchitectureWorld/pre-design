# DSH 前期策划插件

`@architectureworld/dsh-preplanning-agent` 是运行在 DeepSeek Harness Web Profile 内的原生前期策划执行插件。当前可执行 npm 包版本为 `0.7.0`，现有发布标签为 `v0.7.0`。

> **版本权威：** [`docs/version-matrix.json`](docs/version-matrix.json) 与 [`docs/VERSIONING.md`](docs/VERSIONING.md)。  
> 当前支线承载的是架构对齐基线 `v2.0.0`，不是插件 `2.0.0` Release。Presentation 标准目标属于 `v1` 主线，其 `standardVersion` 为 `1.0.0`；精确 Contract 包和 Schema Set Hash 尚未锁定。

## 兼容与边界

- DeepSeek Harness：`0.1.1-rc.2`
- DSH 源码基线：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- 业务合同：`contracts/v0.6`（57 个状态 Schema、57 个 Workflow、8 个 Gate、47 个原子工具）
- 治理合同：`contracts/v0.7`（模式、授权、Gate、视觉资产与报告包）
- 插件 ID：`preplanning-agent`
- npm 包：`@architectureworld/dsh-preplanning-agent`
- npm 包版本：`0.7.0`
- 历史发布标签：`v0.7.0`

插件不修改 DSH 核心、不提供第二套独立 Agent Runtime，也不允许模型直接写 Project State 或自行批准 Gate。人工模式默认启用；全自动模式必须先获得明确的自动化授权。

## 当前对齐支线

支线：

```text
architecture/presentation-project-alignment-v2.0.0
```

该支线只冻结 `pre-design` 对 Presentation 标准项目格式的消费方式、内容投影和实施计划：

- 对齐基线：`v2.0.0`
- 可执行包版本：仍为 `0.7.0`
- 已发布标签：仍为 `v0.7.0`
- Presentation 标准主线：`v1`
- Presentation `standardVersion`：`1.0.0`
- 历史未发布客户报告候选线：`v0.8`（仅历史证据，不是包版本或 Release）
- 历史交接目录标签：`FINAL_v2.0`（仅归档名，不是 SemVer）
- Contract Lock：`pending`
- 生产集成状态：`blocked-by-contract-lock`

该支线不得把 `v2.0.0` 写成 npm 包版本、插件 Release、Git Tag 或 GitHub Release。

## 仓库权威顺序

发生版本、数量、状态或实现边界不一致时，按以下顺序判定：

1. `docs/version-matrix.json` 与 `docs/VERSIONING.md`：当前支线的版本语义；
2. `docs/superpowers/specs/2026-09-02-pre-design-presentation-project-alignment-v2.0.0-design.md`：对齐架构；
3. `docs/superpowers/specs/2026-09-02-pre-design-presentation-content-baseline-v2.0.0.md`：大纲、草案和素材输出规则；
4. `docs/superpowers/plans/2026-09-02-pre-design-presentation-project-alignment-v2.0.0.md`：实施计划；
5. `package.json`：可执行 npm 包版本；
6. `contracts/v0.6` 与 `contracts/v0.7`：既有业务和治理合同；
7. `HANDOFF.md`：当前交接摘要，但不高于版本矩阵和规范；
8. `HANDOFF_HISTORY.md`、历史 evidence 和旧候选记录：仅用于历史追溯，不定义当前支线版本状态。

## 主要能力

1. 在 DSH 页面创建项目，并选择“人工确认”或“全自动完成”。
2. 通过数据驱动的合同注册表推进 8 章、57 项工作；中断后可恢复项目、Gate、视觉任务和报告包状态。
3. 模型只使用 `preplanning_get_context` 与 `preplanning_apply_commands` 两个受控工具。
4. 项目级视觉子任务通过 DSH Harness 路由；禁止插件自建第二套模型运行时。
5. 事实地图、现状照片、红线和统计数据不得由生图模型伪造；AI 图只作概念方向表达。
6. 现有 `0.7.0` 路径可从同一冻结成果生成 HTML、PPTX、PDF。
7. 对齐基线 `v2.0.0` 计划新增标准 Presentation 项目目录、大纲、草案和素材输出，但在 Contract Lock 前不进入生产实现。

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
pnpm verify:alignment-versions
pnpm typecheck
pnpm test
pnpm test:built
pnpm golden:build -- --output C:\temp\dsh-preplanning-golden
```

合同门禁：

```powershelll
PUsh-Location contracts\v0.6
python tests\test_contracts.py
Pop-Location
```

``golden:build` 生成现有�`0.7.0` 路径的同源 HTML/PPTX/PDF。默认使用本机 Microsoft Edge；可通过 `--browser` 或 `PREPLAN_BROWSER_EXECUTABLE` 指定兿宺的 Chromium 可执行文件。

## 安装到 DSH Web Profile

先备份 Profile 的 `package.json`、蔁文件和 Cordis 配置，再使用官方 CLI：

```powershell

dsh plugin --profile web remove @architectureworld/dsh-preplanning-agent
dsh plugin --profile web add .\architectureworld-dsh-preplanning-agent-0.7.0.tgz
dsh --profile web --dump-config
dsh --profile web --no-open
```

不要手工删除 Session、Storage、模型设置或凭据。插件使用用户已在 DSH 中配置的文本模型；视觉路线只记录 provider/model，不读取或输出 API Key。

## 验收证据

- D1：真实模型人工确认闭环。
- D2：真实文本模型快速启动闭环。
- D3：`0.7.0` 全流程、双模式、视觉治理、三格式报告、重启恢复和发布证据。

详细结果见 [docs/acceptance.md](docs/acceptance.md) 与 `evidence/`。历史记录中的候选版本、评分和路径不覆盖当前版本矩阵。
