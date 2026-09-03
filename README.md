# Pre-design 2.0.0

`pre-design` 是运行在 DeepSeek Harness 中的前期策划执行插件：

```text
@architectureworld/dsh-preplanning-agent@2.0.0
```

当前有效入口：

```text
架构基线：architecture/pre-v2.0.0
开发支线：feat/pre-v2.0.0
```

> 版本权威：[`docs/version-matrix.json`](docs/version-matrix.json) 与 [`docs/VERSIONING.md`](docs/VERSIONING.md)。

## 当前状态

| 项目 | 状态 |
|---|---|
| Pre 产品／插件版本 | `2.0.0` |
| 当前开发支线 | `feat/pre-v2.0.0` |
| 运行时接入状态 | 已在开发支线完成并通过真实 DSH Host 验证 |
| 发布状态 | 未合并、未发布 |
| 上一正式发布 | `v0.7.0`，仅作历史基线 |
| Presentation 项目格式 Contract | 外部依赖 `0.1.0` |
| DSH 兼容基线 | `0.1.1-rc.2` |

## 产品定位

- Pre-design 是独立、可执行的 DSH 插件。
- 插件内部包含前期策划 Skill、8 章 57 项专业工作流、Tools、Commands、状态、Gate、Revision、资料处理和成果生成能力。
- DSH Harness 负责 Agent、模型、Session 和工具执行。
- `presentation-tools` 是独立的可视化交互、排版和导出工具。
- 两个项目通过标准项目目录交换数据，产品版本彼此独立。

## 已接通的使用链路

通过 DSH UI 创建新项目时，Pre 2.0.0 会依次执行：

```text
创建 Pre 项目
→ 初始化专业工作流
→ 生成 Presentation 标准项目目录
→ 写入 Canonical JSON
→ 运行 Contract 0.1.0 全量验证
→ 验证通过后原子发布
→ 启动前期策划流程
```

UI 只有在标准目录已经创建并验证通过后，才显示：

```text
项目与 Presentation 标准目录已创建，前期策划全流程已经启动。
```

新建面板和项目状态卡底部均显示：

```text
Pre 2.0.0 · Project Format 0.1.0
```

这用于快速判断当前安装版本及其兼容的外部项目格式版本。

## 与 Presentation 交接

默认标准项目根目录：

```text
~/.dsh/presentation-projects
```

可以在启动 DSH 前指定共用目录：

```text
PRE_DESIGN_PRESENTATION_PROJECT_ROOT=<绝对目录>
```

Presentation 需要读取、打开或监听同一个项目根目录。Pre 负责生成和验证标准目录，不修改 Presentation 的 UI、排版逻辑或产品版本。

已有项目可显式同步：

```text
/preplan-presentation-sync
```

默认拒绝覆盖 Pre 上次输出后被外部修改的内容。只有用户明确要求覆盖时才使用：

```text
/preplan-presentation-sync --force
```

也可以直接对 DSH Agent 说：

```text
把当前项目同步到 Presentation
```

Agent 会调用：

```text
preplanning_sync_presentation_project
```

成功结果必须包含目录、Presentation Project ID、Pre Revision 和：

```text
PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS
```

## Pre 2.0.0 核心能力

1. 创建和维护前期策划项目。
2. 推进 8 章、57 项专业工作流。
3. 管理 Project State、Evidence、Assumption、Question、Gate 和 Revision。
4. 管理原始资料与正式采用素材。
5. 将冻结的 Pre 项目生成 Presentation 标准项目目录。
6. 输出结构化大纲、页面草案、讲解稿和素材引用。
7. 使用稳定 ID、`sourceRefs`、MIME、字节数和 SHA-256 保证可追溯性。
8. 在完整 Contract 验证通过后原子发布标准目录。
9. 保留现有 HTML、PPTX 和 PDF 输出路径。

## 外部项目格式依赖

Pre 2.0.0 当前固定消费：

```text
Presentation Standard Project Directory 0.1.0
@architectureworld/presentation-contracts@0.1.0
```

固定来源：

```text
ArchitectureWorld/presentation-tools
commit 974668d308728386ea005c9e77d58ebff9372f0a
Schema Set 5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc
```

该版本仅表示外部 Contract，不参与 Pre 的分支、产品和发布命名。`presentation-tools` 后续升级到 `0.1.1` 或其他版本，不会自动改变 Pre 2.0.0。

## 常用命令

```text
/preplan-new <name>
/preplan-open <projectId>
/preplan-list
/preplan-status
/preplan-mode manual|automatic
/preplan-confirm <proposalId>
/preplan-presentation-sync
/preplan-export
```

## 开发验证

```bash
pnpm install --frozen-lockfile
pnpm verify:alignment-versions
pnpm verify:presentation-contract
pnpm test:presentation-standard
pnpm typecheck
pnpm test
pnpm test:built
git diff --check
```

## DSH 部署验证

```powershell
dsh plugin --profile pre-v2-test add .\architectureworld-dsh-preplanning-agent-2.0.0.tgz
dsh --profile pre-v2-test --dump-config
dsh --profile pre-v2-test --no-open
```

当前代码已通过自动化运行时与全仓回归；在覆盖现用稳定 Profile、合并主线或创建 `v2.0.0` Tag/Release 前，仍应使用目标机器执行一次真实安装烟测。