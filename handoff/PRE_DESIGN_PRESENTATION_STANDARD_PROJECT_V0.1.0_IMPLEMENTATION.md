---
document_id: pre-v2-workspace-root-standard-project-handoff
document_version: 2.0.0
status: workspace-root-usage-ready-verified-development-candidate
pre_design_version: 2.0.0
presentation_contract_version: 0.1.0
architecture_branch: architecture/pre-v2.0.0
development_branch: feat/pre-v2.0.0
verified_runtime_code_commit: 700a1675ac5801b4ed824b31de48184be2cc1c6c
verified_workflow_run: 33835245301
contract_commit: 974668d308728386ea005c9e77d58ebff9372f0a
schema_set_sha256: 5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc
language: zh-CN
---

# Pre-design 2.0.0 Workspace 根目录实施 Handoff

## 1. 最终模型

```text
一个 DSH Workspace
= 用户设置的项目总文件夹
= 一个 Pre 项目
= 一套 Presentation Standard Project Directory 0.1.0

同一 Workspace 下的多个 DSH Session
共同使用同一个 Pre 项目
```

本轮只修改 `ArchitectureWorld/pre-design` 的 `feat/pre-v2.0.0`，未新增支线、未修改 `presentation-tools`、未合并主线、未创建 Tag 或 Release。

## 2. 固定坐标

| 项目 | 值 |
|---|---|
| Pre 产品／插件／包版本 | `2.0.0` |
| Presentation Contract | `0.1.0` |
| Contract commit | `974668d308728386ea005c9e77d58ebff9372f0a` |
| Schema Set SHA-256 | `5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc` |
| 已验证代码 HEAD | `700a1675ac5801b4ed824b31de48184be2cc1c6c` |
| GitHub Actions Run | `33835245301` |
| 结果 | targeted 与 full-regression 均 `success` |
| UI 版本标识 | `Pre 2.0.0 · Project Format 0.1.0` |

## 3. 目录与所有权

当前 Session 的 `SessionHeader.cwd` 是项目总文件夹。标准文件直接位于 Workspace 根目录：

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

Pre 不替换：

```text
layouts/
其他用户文件和目录
```

`src/presentation/workspace-project-writer.ts` 通过 sibling staging 生成并验证候选项目，然后只备份和替换上述六类托管路径。最终 Workspace 再执行 Contract 全量验证；失败时回滚托管路径并清理 staging。

## 4. Workspace 与多 Session

`PresentationProjectBindingRecord.workspaceRoot` 仅保存在 Pre 内部 Domain，不进入 Presentation Canonical 文件。

固定约束：

```text
一个 workspaceRoot → 一个 preDesignProjectId
一个 preDesignProjectId → 一个 workspaceRoot
```

探测命令：

```text
/preplan-presentation-sync --probe
```

探测结果：

```text
PRE_DESIGN_WORKSPACE_EMPTY
PRE_DESIGN_WORKSPACE_PROJECT_ATTACHED
```

同一 Workspace 的新 Session 会自动绑定既有 Pre 项目。旧 Session 已绑定项目但尚无 Workspace 记录时，也会被识别并在首次同步时补齐 Workspace 绑定，避免重复创建项目。

Workspace 绑定先于 Contract 文档构建持久化；即使初始化失败，刷新或换会话后仍可恢复。

## 5. UI 使用流程

UI 先执行：

```text
/preplan-presentation-sync --probe
```

Workspace 为空：

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
→ 继续既有工作流
```

同步命令：

```text
/preplan-presentation-sync
```

仅用户明确覆盖或迁移旧公共目录时：

```text
/preplan-presentation-sync --force
```

Agent Tool：

```text
preplanning_sync_presentation_project
```

## 6. UI 刷新恢复

`src/client/workspace-draft.ts` 使用：

```text
pre-design:v2:workspace-draft:<workspace-key>
```

按 Workspace 保存：

- 项目描述；
- 项目名称及手工编辑状态；
- 人工/自动模式；
- 报告深度；
- 概念图预算。

同一 Workspace 刷新或重新打开面板后恢复；不同 Workspace 相互隔离；创建和同步成功后清除。草稿只存在于浏览器本地，不进入 Pre Revision 或 Presentation 标准目录。

## 7. 打开项目文件夹

UI 新建/继续面板和项目状态卡均提供“打开项目文件夹”。命令：

```text
/preplan-open-project-folder
```

它直接打开当前 DSH Workspace，不要求 Pre 项目或 Presentation 标准文件已经初始化成功。

平台：

```text
Windows → explorer.exe
macOS   → open
Linux   → xdg-open
```

## 8. 历史兼容与迁移

旧输出：

```text
~/.dsh/presentation-projects/<projectId>-<projectSlug>/
```

以及：

```text
PRE_DESIGN_PRESENTATION_PROJECT_ROOT
```

只保留为无 Workspace 的显式兼容回退，不再是正常 UI 默认路径。

旧项目已成功发布在公共目录时，第一次迁移到 Workspace 根目录必须由用户执行：

```text
/preplan-presentation-sync --force
```

旧目录不自动删除，Stable ID、Presentation Project ID 与 Pre Revision 保持不变。

## 9. 关键实现文件

```text
src/presentation/workspace-context.ts
src/presentation/workspace-project-writer.ts
src/presentation/open-directory.ts
src/presentation/runtime-integration.ts
src/presentation/binding-repository.ts
src/presentation/standard-project-service.ts
src/client/workspace-draft.ts
src/client/direct-start.ts
src/client/index.tsx
src/client/PreplanningProjectForm.tsx
src/client/PreplanningStatusCard.tsx
```

关键测试：

```text
tests/workspace-project-root.spec.ts
tests/presentation-workspace-runtime.spec.ts
tests/presentation-standard-workspace-recovery.spec.ts
tests/direct-start-workspace.client.spec.ts
tests/workspace-form-draft.client.spec.tsx
tests/workspace-open-folder-ui.client.spec.tsx
```

## 10. 验证

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

Run `33835245301` 已验证：

- Workspace 根目录直接通过 Contract 0.1.0；
- 用户文件和 `layouts/` 保留；
- 多 Session 共用项目；
- 旧 Session 项目恢复；
- 初始化失败绑定恢复；
- UI 输入刷新恢复；
- 打开文件夹 UI 与命令；
- Windows/Linux 路径；
- 构建产物、npm pack 与全部旧功能回归。

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

## 12. 回滚与下一入口

改造前基点：

```text
96dfc29ab0295093f2ef9e050734a5f70462d6dc
```

回滚不得删除 Workspace 中已生成的文件或旧公共输出目录。

下一开发入口：

```text
Repository: ArchitectureWorld/pre-design
Branch: feat/pre-v2.0.0
Version authority: docs/version-matrix.json
Workspace writer: src/presentation/workspace-project-writer.ts
Runtime: src/presentation/runtime-integration.ts
UI draft: src/client/workspace-draft.ts
```

后续联调继续在 `feat/pre-v2.0.0` 上进行，不得新增支线。
