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

# Pre-design 2.0.0 × DSH Workspace × Presentation 标准项目实施 Handoff

## 1. 最终结论

Pre 2.0.0 已从用户级公共输出目录调整为 DSH Workspace 根目录模型：

```text
一个 DSH Workspace
= 用户设置的项目总文件夹
= 一个 Pre 项目
= 一套 Presentation Standard Project Directory 0.1.0

同一 Workspace
├─ Session A
├─ Session B
└─ Session C
   共同使用同一个 Pre 项目
```

当前完整链路：

```text
DSH 选择项目 Workspace
→ SessionHeader.cwd 固定项目总文件夹
→ Pre probe 当前 Workspace
→ 创建或恢复 Workspace 对应的 Pre 项目
→ 将标准文件直接写入 Workspace 根目录
→ Contract 0.1.0 全量验证
→ 保留 layouts 与其他用户资料
→ Presentation 读取同一个 Workspace
```

本轮没有新建支线，没有修改 `ArchitectureWorld/presentation-tools`，没有合并主线，没有创建 Tag 或 Release。

## 2. 固定坐标

| 项目 | 值 |
|---|---|
| Pre 产品／插件／包版本 | `2.0.0` |
| 架构支线 | `architecture/pre-v2.0.0` |
| 开发支线 | `feat/pre-v2.0.0` |
| Workspace 根目录代码提交 | `700a1675ac5801b4ed824b31de48184be2cc1c6c` |
| 验证工作流 | `Pre 2.0.0 Integration` Run `33835245301` |
| 外部标准 | `Presentation Standard Project Directory 0.1.0` |
| Contract 仓库 | `ArchitectureWorld/presentation-tools` |
| Contract 固定提交 | `974668d308728386ea005c9e77d58ebff9372f0a` |
| Contract 包 | `@architectureworld/presentation-contracts@0.1.0` |
| Schema Set SHA-256 | `5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc` |
| 成功标记 | `PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS` |
| 发布状态 | 未合并、未发布 |

## 3. 权威项目目录

当前 Session 的 `SessionHeader.cwd` 是唯一 Workspace 路径来源。Host 对它执行：

```text
绝对路径检查
→ realpath 规范化
→ 目录存在性检查
→ 非符号链接检查
```

标准项目直接落在该目录：

```text
<DSH Workspace>/
├─ project.json
├─ rules.json
├─ outline.json
├─ pages/
│  ├─ manifest.json
│  └─ drafts/
├─ source-materials/
├─ assets/
├─ layouts/
└─ 用户自己的其他项目文件与目录
```

Contract 推荐的 `<projectId>-<projectSlug>` 目录名只用于普通目录工厂；用户选择的 Workspace 文件夹名称可以不同。`project.json` 中的稳定 `projectId` 仍是权威身份，目录名称不作为主键。

## 4. 写盘所有权

Pre 只托管：

```text
project.json
rules.json
outline.json
pages/
source-materials/
assets/
```

Pre 永不替换：

```text
layouts/
Workspace 中其他用户文件和目录
```

原因：Workspace 是完整项目总文件夹，不是 Pre 可以整体原子替换的专用导出目录。

## 5. Workspace Writer

新增：

```text
src/presentation/workspace-project-writer.ts
```

执行流程：

```text
读取 Workspace 托管路径现状
→ 检查上次导出 Hash
→ 在 Workspace 同级建立临时准备目录
→ 复用原有标准 Writer 生成完整候选项目
→ Contract 校验候选项目
→ 备份 Workspace 中现有托管路径
→ 仅安装六类 Pre 托管路径
→ 保留 layouts 与其他资料
→ 对最终 Workspace 再做 Contract 全量验证
→ 成功后删除备份
```

失败时：

- 删除本轮安装的托管路径；
- 恢复备份；
- 清理准备目录；
- 不返回成功标记；
- 不破坏用户其他资料。

首次同步时，Workspace 若已存在 Canonical 托管路径但没有 Pre 输出账本，会拒绝静默接管。只有用户明确 `--force` 才能继续。

## 6. Workspace 与 Pre 项目身份

`PresentationProjectBindingRecord` 增加内部字段：

```text
workspaceRoot
```

它只保存在 Pre 内部 Domain，不进入 Presentation Canonical 文件。

约束：

```text
一个 workspaceRoot → 一个 preDesignProjectId
一个 preDesignProjectId → 一个 workspaceRoot
```

`PresentationBindingRepository` 提供：

```text
findByWorkspaceRoot(workspaceRoot)
```

并拒绝：

- 一个 Workspace 绑定两个 Pre 项目；
- 一个 Pre 项目改绑另一 Workspace；
- 两个 Pre 项目共享同一个 Presentation Project ID。

## 7. 初始化失败恢复

Workspace→Pre 绑定现在先于 Contract 文档构建持久化：

```text
创建 Pre 项目
→ 保存 awaiting_contract Workspace 绑定
→ 构建 Contract 文档
→ 写盘与验证
```

即使 Contract 构建、Schema 资源或写盘失败，刷新页面或切换到同一 Workspace 下另一 Session 时仍能找回原 Pre 项目，不会重复创建同名项目。

## 8. 多 Session 使用

新增 probe：

```text
/preplan-presentation-sync --probe
```

返回之一：

```text
PRE_DESIGN_WORKSPACE_EMPTY
```

或：

```text
PRE_DESIGN_WORKSPACE_PROJECT_ATTACHED
```

逻辑：

1. 先按 Workspace 绑定查找 Pre 项目；
2. 找到后将当前 Session 绑定到该项目；
3. 未找到 Workspace 绑定时，再检查当前 Session 是否已经绑定旧 Pre 项目；
4. 旧 Session 项目被识别为当前 Workspace 项目，首次正常同步时补齐正式 Workspace 绑定；
5. 仅两者都没有时才创建新 Pre 项目。

因此同一 Workspace 的多个 Session 不需要分别执行 `/preplan-open`。

## 9. UI 创建或继续

`src/client/direct-start.ts` 的顺序：

```text
/preplan-presentation-sync --probe
```

### Workspace 为空

```text
/preplan-new <name>
→ /preplan-presentation-sync
→ /preplan-mode ...
→ /preplan-run
```

### Workspace 已有项目

```text
跳过 /preplan-new
→ /preplan-presentation-sync
→ /preplan-mode ...
→ /preplan-run
```

UI 文案已调整为“新建或继续前期策划”和“创建或继续全流程”。

## 10. UI 输入刷新恢复

新增：

```text
src/client/workspace-draft.ts
```

存储键：

```text
pre-design:v2:workspace-draft:<workspace-key>
```

保存字段：

```text
statement
projectName
nameEdited
mode
reportDepth
visualBudget
```

规则：

- 同一 Workspace 下不同 Session 共享草稿；
- 页面刷新、关闭面板后重新打开可恢复；
- 不同 Workspace 相互隔离；
- JSON 损坏或字段非法时安全回退；
- 标准项目创建成功后清除；
- 无 Workspace 时禁用创建并明确提示。

该机制只保存用户尚未提交的 UI 输入，不把草稿写入 Presentation 标准目录，也不污染 Pre 专业 Revision。

## 11. 打开项目文件夹

新增命令：

```text
/preplan-open-project-folder
```

UI 入口：

- 新建/继续面板；
- 前期策划状态卡。

行为：

```text
Windows → explorer.exe
macOS   → open
Linux   → xdg-open
```

当前 Session 有 Workspace 时，直接打开该 Workspace；不要求 Pre 项目或 Presentation 标准文件已经初始化成功。

## 12. 历史兼容

旧默认输出：

```text
~/.dsh/presentation-projects/<projectId>-<projectSlug>/
```

现在仅用于：

- Session 没有 `cwd` 的显式命令行兼容场景；
- 明确设置 `PRE_DESIGN_PRESENTATION_PROJECT_ROOT` 的旧部署。

正常 DSH UI 不再使用该路径。

旧项目已成功发布在公共目录时，迁移到 Workspace 根目录需要：

```text
/preplan-presentation-sync --force
```

迁移不会删除旧目录，并保留：

- Presentation Project ID；
- Outline/Page/Draft/内容块 Stable ID；
- Pre Revision；
- 来源关系。

## 13. 关键新增文件

```text
src/presentation/workspace-context.ts
src/presentation/workspace-project-writer.ts
src/presentation/open-directory.ts
src/client/workspace-draft.ts

tests/workspace-project-root.spec.ts
tests/presentation-workspace-runtime.spec.ts
tests/presentation-standard-workspace-recovery.spec.ts
tests/direct-start-workspace.client.spec.ts
tests/workspace-form-draft.client.spec.tsx
tests/workspace-open-folder-ui.client.spec.tsx

docs/superpowers/specs/2026-09-04-pre-v2.0.0-workspace-root-and-ui-recovery-design.md
docs/superpowers/plans/2026-09-04-pre-v2.0.0-workspace-root-and-ui-recovery.md
```

## 14. 重点修改文件

```text
src/presentation/types.ts
src/presentation/binding-domain.ts
src/presentation/binding-repository.ts
src/presentation/standard-project-types.ts
src/presentation/standard-project-service.ts
src/presentation/runtime-integration.ts
src/presentation/index.ts
src/client/direct-start.ts
src/client/index.tsx
src/client/PreplanningLauncher.tsx
src/client/PreplanningProjectForm.tsx
src/client/PreplanningStatusCard.tsx
package.json
README.md
HANDOFF.md
docs/version-matrix.json
docs/VERSIONING.md
scripts/verify-alignment-version-consistency.mjs
```

## 15. 自动化验证

Workspace 根目录代码提交：

```text
700a1675ac5801b4ed824b31de48184be2cc1c6c
```

GitHub Actions：

```text
Workflow: Pre 2.0.0 Integration
Run: 33835245301
pre-v2-targeted: success
full-regression: success
```

覆盖：

- Workspace 根目录直接通过 Contract 0.1.0；
- Workspace 用户文件保留；
- `layouts/` 保留；
- 重复同步 Stable ID 不变；
- 托管文件外部修改被拒绝；
- 一 Workspace 一 Pre 项目；
- 多 Session 自动共享；
- 旧 Session 项目恢复；
- 初始化失败后绑定恢复；
- UI 输入刷新恢复；
- Workspace 草稿隔离与清理；
- UI 和命令打开文件夹；
- Windows/Linux 路径一致性；
- Contract 运行时资源打包；
- 构建后 Host 运行；
- HTML/PPTX/PDF 和 57 项流程全仓回归。

验证命令：

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

## 16. DSH 部署

```powershell
git fetch origin
git switch feat/pre-v2.0.0
git pull --ff-only
git rev-parse HEAD

pnpm install --frozen-lockfile
pnpm test
Remove-Item .\architectureworld-dsh-preplanning-agent-2.0.0.tgz -ErrorAction SilentlyContinue
pnpm pack

dsh plugin --profile web add .\architectureworld-dsh-preplanning-agent-2.0.0.tgz
dsh --profile web --no-open
```

浏览器重新打开后执行：

```text
Ctrl + F5
```

验收：

1. 在 DSH 中选择或创建一个项目 Workspace；
2. 新建该 Workspace 下的 Session；
3. 打开“前期策划”，确认显示正确项目总文件夹；
4. 输入一部分表单内容并刷新页面，确认恢复；
5. 创建或继续项目；
6. 确认标准文件直接出现在 Workspace 根目录；
7. 点击“打开项目文件夹”；
8. 新建同 Workspace 的第二个 Session，再打开 Pre；
9. 确认没有创建第二个 Pre 项目；
10. 在 Presentation 中打开同一个 Workspace。

## 17. 回滚

代码改造前基点：

```text
96dfc29ab0295093f2ef9e050734a5f70462d6dc
```

回滚时：

- 不删除 Workspace 中已生成的标准文件；
- 不删除旧公共输出目录；
- 卸载当前测试包并安装上一已知可用包；
- 保留 Pre Domain 数据用于审计；
- 不修改 Presentation Contract 源码。

## 18. 下一开发入口

```text
Repository: ArchitectureWorld/pre-design
Branch: feat/pre-v2.0.0
Version authority: docs/version-matrix.json
Human version rules: docs/VERSIONING.md
Workspace resolution: src/presentation/workspace-context.ts
Workspace writer: src/presentation/workspace-project-writer.ts
Runtime integration: src/presentation/runtime-integration.ts
Workspace binding: src/presentation/binding-repository.ts
UI draft persistence: src/client/workspace-draft.ts
UI composition: src/client/index.tsx
Contract lock: docs/contracts/presentation-standard-project-v0.1.0-lock.json
```

下一步继续在 `feat/pre-v2.0.0` 上处理真实 DSH 与 Presentation 联调反馈，不得新增支线；完整验证后再申请合并和发布。
