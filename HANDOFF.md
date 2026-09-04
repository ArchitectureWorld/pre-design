# Pre-design 2.0.0 当前交接

> 机器版本权威：[`docs/version-matrix.json`](docs/version-matrix.json)  
> 人类可读规则：[`docs/VERSIONING.md`](docs/VERSIONING.md)  
> 架构支线：`architecture/pre-v2.0.0`  
> 开发支线：`feat/pre-v2.0.0`

## 1. 当前结论

Pre 2.0.0 已完成 DSH Workspace 根目录接入：

```text
一个 DSH Workspace
= 一个项目总文件夹
= 一个 Pre 项目
= 一套 Presentation Standard Project Directory 0.1.0

一个 Workspace
可以包含多个 DSH Session
这些 Session 共同使用同一个 Pre 项目
```

当前代码仍在开发支线，未合并主线、未打 Tag、未创建正式 Release。

## 2. 版本与验证坐标

| 项目 | 当前值 |
|---|---|
| Pre 产品／插件／包版本 | `2.0.0` |
| npm 包 | `@architectureworld/dsh-preplanning-agent@2.0.0` |
| 开发支线 | `feat/pre-v2.0.0` |
| Presentation Contract | `0.1.0` |
| Contract commit | `974668d308728386ea005c9e77d58ebff9372f0a` |
| Schema Set SHA-256 | `5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc` |
| Workspace 根目录代码 HEAD | `700a1675ac5801b4ed824b31de48184be2cc1c6c` |
| GitHub Actions Run | `33835245301` |
| 结果 | targeted 与 full-regression 均 `success` |
| 发布状态 | 未合并、未发布 |

Pre `2.0.0` 与 Presentation `0.1.0` 是两条独立版本线。

## 3. 目录模型

当前 Session 的 `SessionHeader.cwd` 是项目总文件夹，也是 Presentation 标准项目根目录：

```text
<DSH Workspace>/
├─ project.json
├─ rules.json
├─ outline.json
├─ pages/
├─ source-materials/
├─ assets/
├─ layouts/
└─ 其他用户项目资料
```

Pre 托管：

```text
project.json
rules.json
outline.json
pages/
source-materials/
assets/
```

Pre 保留且不替换：

```text
layouts/
工作区中全部非托管用户文件与目录
```

Workspace Writer 使用 sibling staging、Contract 校验、托管路径备份、逐项替换和失败回滚。校验失败时不会发布半成品，也不会损坏用户其他项目资料。

## 4. Workspace 与 Session 绑定

- 一个规范化 Workspace 路径只能对应一个 Pre 项目；
- 一个 Pre 项目只能归属一个 Workspace；
- 同一 Workspace 下的多个 Session 自动绑定同一个 Pre 项目；
- 旧 Session 已绑定 Pre 项目但尚无 Workspace 记录时，probe 会识别现有项目，避免重复创建；
- Contract 初始化失败前会先持久化 Workspace→Pre 关系，刷新或换会话后仍可恢复；
- 没有 Workspace 的命令行场景仍保留旧输出模式，但正常 UI 会要求先选择或创建 DSH Workspace。

## 5. 用户流程

### 5.1 UI 创建或继续

```text
打开“前期策划”
→ 显示当前 Workspace 路径
→ /preplan-presentation-sync --probe
```

Workspace 无项目：

```text
/preplan-new <name>
→ /preplan-presentation-sync
→ /preplan-mode ...
→ /preplan-run
```

Workspace 已有项目：

```text
自动绑定当前 Session
→ 跳过 /preplan-new
→ /preplan-presentation-sync
→ 继续原项目
```

### 5.2 同步与覆盖保护

```text
/preplan-presentation-sync
```

仅用户明确决定覆盖标准文件外部修改或迁移旧输出目录时：

```text
/preplan-presentation-sync --force
```

### 5.3 打开项目文件夹

UI 新建面板与状态卡均提供：

```text
打开项目文件夹
```

命令：

```text
/preplan-open-project-folder
```

它直接打开当前 DSH Workspace，即使标准项目初始化尚未完成也可使用。

## 6. UI 刷新恢复

未提交表单按 Workspace 路径保存到浏览器 `localStorage`：

```text
pre-design:v2:workspace-draft:<workspace-key>
```

保存：

- 项目描述；
- 项目名称及手工编辑状态；
- 人工/自动模式；
- 报告深度；
- 概念图预算。

同一 Workspace 页面刷新或关闭面板后可恢复；不同 Workspace 相互隔离；项目成功创建并同步后清除。

## 7. 运行时组件

```text
src/presentation/workspace-context.ts
```

从 `SessionHeader.cwd` 读取并 `realpath` 规范化当前 Workspace。

```text
src/presentation/workspace-project-writer.ts
```

在现有 Workspace 中安全发布 Pre 托管标准文件，同时保留 `layouts/` 与其他用户文件。

```text
src/presentation/runtime-integration.ts
```

负责 Workspace probe、跨 Session 恢复、同步命令、Agent Tool 与打开文件夹命令。

```text
src/client/workspace-draft.ts
```

负责 Workspace 级表单草稿持久化。

```text
src/presentation/open-directory.ts
```

负责 Windows、macOS、Linux 文件管理器调用。

## 8. 历史兼容与迁移

旧默认输出：

```text
~/.dsh/presentation-projects/<projectId>-<projectSlug>/
```

现在只作为无 Workspace 的兼容回退。`PRE_DESIGN_PRESENTATION_PROJECT_ROOT` 同样降级为兼容配置，不是 UI 主路径。

已在旧目录成功发布的项目首次迁移到 Workspace 根目录时：

```text
/preplan-presentation-sync --force
```

迁移原则：

- 旧目录不自动删除；
- Stable ID 不变；
- Presentation Project ID 不变；
- Pre Revision 不变；
- Workspace 中已有 Canonical 路径不会被静默接管。

## 9. 保留的既有能力

- 8 章 57 项专业工作流；
- Project State、Evidence、Assumption、Question、Gate、Revision；
- 原始资料与正式素材管理；
- `heading`、`text`、`list`、`metric_group`、`table`；
- 独立讲解稿、页面素材、`sourceRefs`；
- HTML、PPTX、PDF 输出；
- Contract 运行时资源打包；
- Stable ID、MIME、sizeBytes、SHA-256；
- 外部修改保护和失败恢复；
- UI 版本标识 `Pre 2.0.0 · Project Format 0.1.0`。

## 10. 完整验证

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

代码验证 Run `33835245301` 已覆盖：

- Workspace 根目录直接通过 Contract 0.1.0；
- 用户其他文件和 `layouts/` 保留；
- 同一 Workspace 多 Session 共用 Pre 项目；
- 旧 Session 项目恢复；
- 初始化失败绑定恢复；
- 表单刷新恢复与 Workspace 隔离；
- 打开文件夹命令和 UI；
- Windows/Linux 路径；
- 构建产物和 npm 打包运行；
- 全仓旧功能回归。

## 11. 部署

```powershell
git fetch origin
git switch feat/pre-v2.0.0
git pull --ff-only
pnpm install --frozen-lockfile
pnpm test
Remove-Item .\architectureworld-dsh-preplanning-agent-2.0.0.tgz -ErrorAction SilentlyContinue
pnpm pack
dsh plugin --profile web add .\architectureworld-dsh-preplanning-agent-2.0.0.tgz
dsh --profile web --no-open
```

浏览器重新打开后执行 `Ctrl + F5`。

## 12. 当前有效入口

```text
Repository: ArchitectureWorld/pre-design
Branch: feat/pre-v2.0.0
Machine authority: docs/version-matrix.json
Human authority: docs/VERSIONING.md
Detailed implementation handoff: handoff/PRE_DESIGN_PRESENTATION_STANDARD_PROJECT_V0.1.0_IMPLEMENTATION.md
Workspace spec: docs/superpowers/specs/2026-09-04-pre-v2.0.0-workspace-root-and-ui-recovery-design.md
Workspace plan: docs/superpowers/plans/2026-09-04-pre-v2.0.0-workspace-root-and-ui-recovery.md
```
