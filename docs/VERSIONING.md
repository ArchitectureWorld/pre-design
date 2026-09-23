# Pre-design 版本权威

本文件解释 `ArchitectureWorld/pre-design` 当前有效版本。机器可执行权威为 [`version-matrix.json`](version-matrix.json)。

## 1. 当前版本矩阵

| 对象 | 当前值 | 含义 |
|---|---:|---|
| Pre 产品版本 | `2.0.2` | 当前开发/部署候选 |
| Pre DSH 插件版本 | `2.0.2` | Workspace-first / zero-input + A/B/C/D 液态玻璃 |
| Pre npm 包版本 | `@architectureworld/dsh-preplanning-agent@2.0.2` | 当前构建包版本 |
| DSH 兼容基线 | `0.1.5-rc.1` | 当前 Host 与 Browser API 唯一支持基线 |
| Presentation 标准版本 | `0.1.0` | 外部、解耦的数据格式 Contract |
| Node.js 基线 | `>=24.11.0` | 构建与部署运行时要求 |
| V2.0.1 主线基线 | `main@801afcc794b34fa734ba624303ed9552b152407c` | 2.0.2 从该坐标继续演进 |
| 上一正式发布 | `v0.7.0` | 历史发布，不代表当前开发候选 |

固定原则：

- `2.0.2` 只属于 Pre 产品、插件和包；
- `0.1.5-rc.1` 只属于当前 DSH 兼容基线；
- `0.1.0` 只属于 `Presentation Standard Project Directory`；
- Pre 是 DSH Skill / Workspace 插件，实际执行仍由 DSH Agent 完成；
- Presentation-tools 保持工具属性，排版能力仍归 Pre/DSH Skill 层；
- 当前 2.0.2 支线未合并、未打 `v2.0.2` Tag、未创建正式 Release，也未声明 npm 正式发布。

## 2. 当前有效支线

```text
main                    # Pre V2.0.1 主线基线
pre-V2.0.2         # Pre 2.0.2 开发与部署候选
```

历史 `architecture/pre-v2.0.0` 和 `feat/pre-v2.0.0` 可保留用于追溯，但不再作为 2.0.2 的当前基线坐标。

## 3. DSH 0.1.5-rc.1 兼容权威

```text
DSH version: 0.1.5-rc.1
Official tag: dsh-v0.1.5-rc.1
Official commit: 183f08e9c6dde7e36cd2318eaee70b0da08fb35e
Node.js: >=24.11.0
pnpm: 10.15.1
```

2.0.2 Browser 侧使用 rc.1 的正式 owner packages，不再依赖旧 `@deepseek-ai/dsh-client-runtime` facade。核心集成为：

```text
Workspace Controller
    ↓
root sidebar.panellist + main
    ↓
uiWorkspace.connectWorkspace(workspaceId)
    ↓
空白 Session 可直接启动 Pre
```

状态节点通过 `uiConversation.events` 注册；Session 日志读取使用 `snapshotEvents()`；命令附件使用 `input.attachments`；JSON 安全值使用 `@deepseek-ai/dsh-util-values`。

## 4. 外部 Presentation Contract 固定坐标

```text
Standard: Presentation Standard Project Directory
Version: 0.1.0
Repository: ArchitectureWorld/presentation-tools
Commit: 974668d308728386ea005c9e77d58ebff9372f0a
Package: @architectureworld/presentation-contracts@0.1.0
Schema Set SHA-256: 5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc
```

它是 Pre 当前消费的外部格式依赖，不是 Pre 的产品版本，也不参与 Pre 的分支命名。

## 5. Workspace-first / zero-input 项目权威

2.0.2 的项目模型固定为：

```text
一个 DSH Workspace
= 一个项目总文件夹
= 一个 Pre 项目
= 一套 Presentation Standard Project Directory 0.1.0
```

root/blank-session UI 的项目根路径权威来自 **DSH Workspace Controller 的 `WorkspaceView.path`**。`SessionHeader.cwd` 仅保留为已经存在 Session 时的 Host/命令侧兼容与恢复路径，不再作为第一条消息之前 root UI 选择 Workspace 的唯一权威。

项目显示名来自 Workspace 文件夹名；项目身份仍由 `project.json.projectId` 决定。Pre 不保存项目名/项目描述草稿，不使用 `localStorage-per-workspace` 创建项目身份，也不发送占位 `hello` 或任何合成用户消息。

当前目录职责：

```text
DSH Workspace/
├─ 原始资料/          # 用户拥有；Pre 只读扫描
├─ project.json       # Pre 管理
├─ rules.json         # Pre 管理
├─ outline.json       # Pre 管理
├─ pages/             # Pre 管理
├─ source-materials/  # Pre 管理的标准化副本
├─ assets/            # Pre 管理
└─ layouts/           # Pre 不接管
```

固定规则：

- `原始资料/` 与 `source-materials/` 永不合并、重命名或互换职责；
- `原始资料/` 缺失时允许创建目录，但其中原文件不得移动、重命名、覆盖或删除；
- `原始资料/` 为空时进入 `等待原始资料`，不启动分析；
- Pre 只写自己明确拥有的 Canonical 文件；`layouts/**` 与未知/无关用户文件必须原样保留；
- 项目初始化为 zero-input，不再要求项目名或“一句话描述项目和目标”。

## 6. Automatic-first 权威

默认运行方式是 Automatic-first：DSH Agent 根据资料、规则、批注与工作流自动推进。Proposal/Gate 历史能力可作为底层兼容与审计机制继续存在，但默认 UI 不暴露人工 Proposal 审批流程，也不要求用户逐步 Gate 确认。

## 7. Source-Traceable Research 权威

设计：

```text
docs/superpowers/specs/2026-09-12-pre-v2.0.1-source-traceable-research-design.md
```

实施计划：

```text
docs/superpowers/plans/2026-09-12-pre-v2.0.1-source-traceable-research.md
```

Research Runtime 资源统一位于：

```text
research/v2.0.1/
```

数据可信原则：项目正式资料、政府/法定机构、官方标准和权威专业数据优先；LLM inference / assumption 不能作为独立事实依据；关键结论必须可通过 Evidence 与 AnalysisTrace 回溯数据源、方法与输入。

## 8. UI 版本标识

2.0.2 分支显示：

```text
Pre 2.0.2 · Project Format 0.1.0
```

## 9. 部署权威

部署说明：

```text
docs/deployment-dsh-v0.1.5-rc.1.md
```

部署应固定到通过完整 CI 的精确 commit SHA，而不是长期跟随移动的 `pre-V2.0.2` 分支头。

## 10. 版本禁止事项

不得：

- 将 DSH `0.1.1-rc.2` 或旧 `dsh-client-runtime` 写成当前兼容基线；
- 将 `feat/pre-v2.0.0` 继续写成 2.0.2 活动基线；
- 将 Presentation `0.1.0` 写成 Pre 产品版本；
- 将 Pre `2.0.2` 写成 Presentation 标准版本；
- 把历史 `v0.7.0` 当成当前插件版本；
- 把 `contracts/v0.6`、`contracts/v0.7` 改名为 `v2.0.2`；
- 把 `原始资料/` 当成 Pre 可改写的 Canonical 存储；
- 在 root/blank-session UI 中重新要求虚构 prompt 才能实例化 Pre；
- 在未完成完整测试、真实部署验收和合并审批前创建正式 `v2.0.2` Release。

## 11. UI/UX 更新边界

C 是 A 的深色版，D 是 B 的深色版，同组面板几何与光学参数相同。主题偏好仅保存在浏览器，不写入模型配置。研究模块继续使用 `research/v2.0.1`，其版本不随本轮 UI 包升级。当前未安装至用户 DSH，真实宿主验收尚未进行。
