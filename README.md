# DSH 前期策划插件

`@architectureworld/dsh-preplanning-agent` 是运行在 DeepSeek Harness Web Profile 内的原生前期策划执行插件。当前可执行 npm 包版本为 `0.7.0`，现有历史发布标签为 `v0.7.0`。

> 版本权威：[`docs/version-matrix.json`](docs/version-matrix.json) 与 [`docs/VERSIONING.md`](docs/VERSIONING.md)。  
> 架构对齐基线为 `v2.0.0`，不是插件 `2.0.0` Release。

## 当前开发状态

| 项目 | 状态 |
|---|---|
| 对齐基线 | `v2.0.0` |
| 当前插件包 | `0.7.0` |
| 当前历史 Release | `v0.7.0` |
| Phase 0 基础 | 已实现 |
| Presentation Contract | 尚未锁定 |
| Contract 依赖集成 | `blocked-by-contract-lock` |
| 包升版、Tag、Release | 未授权 |

当前实施支线：

```text
feature/presentation-phase0-foundation-v2.0.0
```

它基于：

```text
architecture/presentation-project-alignment-v2.0.0
```

## 插件定位

- `pre-design` 是可执行 DSH 插件；前期策划 Skill 是插件内部专业能力之一。
- 插件维护 8 章、57 项专业工作流、Project State、Evidence、Assumption、Question、Gate、Revision、资料和视觉资产。
- DSH Harness 负责 Agent、模型、Session、Tool 调用和子任务运行。
- `presentation-tools` 是独立的可视化交互、排版和导出工具。
- 标准 Presentation 项目文件是双方共同操作的中立载体。

## 现有 `0.7.0` 能力

1. 在 DSH 页面创建项目，并选择人工确认或全自动模式。
2. 通过 Contract Registry 推进 8 章、57 项工作，中断后恢复项目、Gate、视觉任务和报告状态。
3. 模型通过 `preplanning_get_context` 与 `preplanning_apply_commands` 两个受控工具操作。
4. 场地边界、地图、现状照片和统计数据保持真实性门禁。
5. 从同一冻结成果生成 HTML、PPTX 和 PDF。

常用命令：

```text
/preplan-new <name>
/preplan-open <projectId>
/preplan-list
/preplan-status
/preplan-mode manual|automatic
/preplan-confirm <proposalId>
/preplan-report
```

## Phase 0 基础

`src/presentation/` 已建立 Contract 无关代码：

- Contract Port 与失败关闭；
- 双项目身份绑定和独立 Storage Domain；
- Canonical JSON、SHA-256 和路径安全；
- staging、原子写入、校验复制和清理；
- 8 类默认叙事骨架、项目自适应和五类内容块；
- 独立讲解稿与素材引用中间模型；
- 外部修改检测；
- 原始资料和正式素材的分类、去重与安全命名计划。

这些能力不包含任何候选 Presentation Schema，也不会在 Contract Lock 前生成正式 Canonical 项目文件。详见 [`docs/implementation/presentation-phase0-foundation.md`](docs/implementation/presentation-phase0-foundation.md)。

## 兼容与合同

- DeepSeek Harness：`0.1.1-rc.2`
- DSH 源码基线：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- 业务合同：`contracts/v0.6`
- 治理合同：`contracts/v0.7`
- 插件 ID：`preplanning-agent`
- npm 包：`@architectureworld/dsh-preplanning-agent`
- npm 包版本：`0.7.0`
- 历史发布标签：`v0.7.0`

## 验证

```bash
pnpm install --frozen-lockfile
pnpm verify:alignment-versions
pnpm exec vitest run tests/presentation-*.spec.ts --maxWorkers=1
pnpm typecheck
pnpm test
pnpm test:built
```

专项 Phase 0 基线为 6 个测试文件、36 项测试。完整分支交付仍以全量回归、构建产物测试和 GitHub Actions 为准。

## 安装现有 `0.7.0`

安装前备份 DSH Web Profile 的 `package.json`、锁文件和 Cordis 配置，再使用官方 CLI：

```powershell
dsh plugin --profile web remove @architectureworld/dsh-preplanning-agent
dsh plugin --profile web add .\architectureworld-dsh-preplanning-agent-0.7.0.tgz
dsh --profile web --dump-config
dsh --profile web --no-open
```

不要手工删除 Session、Storage、模型设置或凭据。历史验收记录见 [`docs/acceptance.md`](docs/acceptance.md) 与 `evidence/`；其中的候选版本、评分和路径不覆盖当前版本矩阵。
