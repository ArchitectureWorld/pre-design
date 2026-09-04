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
| Workspace 根目录接入 | 已实现并完成自动化验证 |
| 发布状态 | 未合并、未发布 |
| 上一正式发布 | `v0.7.0`，仅作历史基线 |
| Presentation 项目格式 Contract | 外部依赖 `0.1.0` |
| DSH 兼容基线 | `0.1.1-rc.2` |

## 产品定位

- Pre-design 是独立、可执行的 DSH 插件。
- 插件内部包含前期策划 Skill、8 章 57 项专业工作流、Tools、Commands、状态、Gate、Revision、资料处理和成果生成能力。
- DSH Harness 负责 Agent、模型、Workspace、Session 和工具执行。
- `presentation-tools` 是独立的可视化交互、排版和导出工具。
- 两个项目通过 `Presentation Standard Project Directory 0.1.0` 解耦，产品版本彼此独立。

## 默认使用模型

```text
一个 DSH Workspace
= 一个项目总文件夹
= 一个 Pre 项目
= 一套 Presentation 标准项目文件

一个 Workspace
可以包含多个 DSH Session
这些 Session 共同使用同一个 Pre 项目
```

当前 Session 的 `SessionHeader.cwd` 是项目总文件夹。Pre 不再默认把正常 UI 项目写到用户级公共输出目录。

例如用户在 DSH 中选择：

```text
D:\Projects\武汉站综合枢纽
```

该目录本身就是标准项目根目录：

```text
D:\Projects\武汉站综合枢纽\
├─ project.json
├─ rules.json
├─ outline.json
├─ pages\
├─ source-materials\
├─ assets\
├─ layouts\
└─ 用户自己的其他项目资料
```

Pre 只管理：

```text
project.json
rules.json
outline.json
pages/
source-materials/
assets/
```

以下内容不会被 Pre 的标准项目同步替换：

```text
layouts/
工作区中的其他用户文件和目录
```

## UI 创建和继续流程

打开“前期策划”面板时，UI 显示当前 DSH Workspace 路径。点击“创建或继续全流程”后执行：

```text
/preplan-presentation-sync --probe
```

### 当前 Workspace 没有 Pre 项目

```text
/preplan-new <项目名称>
→ /preplan-presentation-sync
→ /preplan-mode <manual|automatic> <图像预算> <报告深度>
→ /preplan-run
```

### 当前 Workspace 已有 Pre 项目

```text
自动将当前 Session 绑定到已有 Pre 项目
→ 不重复执行 /preplan-new
→ /preplan-presentation-sync
→ 继续既有工作流
```

同一 Workspace 下新增或切换 Session，不需要手工重新选择项目。

## UI 刷新恢复

新建面板中的以下输入按 Workspace 保存在浏览器本地：

- 一句话项目描述；
- 可编辑项目名称；
- 人工确认或全自动；
- 标准汇报或扩展汇报；
- 概念图预算。

页面刷新、关闭面板后重新打开，仍会恢复同一 Workspace 的未提交内容；不同 Workspace 相互隔离。项目创建和标准目录同步成功后，草稿自动清除。

新建面板和项目状态卡底部均显示：

```text
Pre 2.0.0 · Project Format 0.1.0
```

## 打开项目文件夹

新建面板和项目状态卡提供“打开项目文件夹”。它直接打开当前 DSH Workspace。

命令入口：

```text
/preplan-open-project-folder
```

在 Windows 上调用资源管理器，在 macOS 上调用 Finder，在 Linux 上调用系统默认文件管理器。即使 Pre 项目尚未完成初始化，只要当前 Session 已属于 Workspace，也可以打开该文件夹。

## 与 Presentation 交接

同步命令：

```text
/preplan-presentation-sync
```

成功结果包含当前 Workspace 根目录、Presentation Project ID、Pre Revision 和：

```text
PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS
```

Presentation 应直接打开或监听同一个 DSH Workspace 根目录。

默认拒绝覆盖 Pre 上次输出后被外部修改的标准文件。只有用户明确决定覆盖时才使用：

```text
/preplan-presentation-sync --force
```

也可以直接对 DSH Agent 说“把当前项目同步到 Presentation”，Agent 会调用：

```text
preplanning_sync_presentation_project
```

## 历史目录兼容

旧版本默认使用：

```text
~/.dsh/presentation-projects/<projectId>-<projectSlug>/
```

现在该路径与：

```text
PRE_DESIGN_PRESENTATION_PROJECT_ROOT
```

仅作为没有 DSH Workspace 时的显式兼容回退。

已有项目若已在旧公共目录成功发布，第一次迁移到当前 Workspace 根目录需要用户明确执行：

```text
/preplan-presentation-sync --force
```

旧目录不会被自动删除，Stable ID、Pre Revision 和 Presentation Project ID 保持不变。

## Pre 2.0.0 核心能力

1. 创建和维护前期策划项目。
2. 推进 8 章、57 项专业工作流。
3. 管理 Project State、Evidence、Assumption、Question、Gate 和 Revision。
4. 管理原始资料与正式采用素材。
5. 将冻结的 Pre 项目生成 Presentation 标准项目目录。
6. 输出结构化大纲、页面草案、讲解稿和素材引用。
7. 使用稳定 ID、`sourceRefs`、MIME、字节数和 SHA-256 保证可追溯性。
8. 在完整 Contract 验证通过后安全发布标准文件。
9. 保护 Workspace 中非 Pre 托管文件和 `layouts/`。
10. 保留现有 HTML、PPTX 和 PDF 输出路径。

## 外部项目格式依赖

```text
Presentation Standard Project Directory 0.1.0
@architectureworld/presentation-contracts@0.1.0
ArchitectureWorld/presentation-tools
commit 974668d308728386ea005c9e77d58ebff9372f0a
Schema Set 5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc
```

该版本仅表示外部 Contract，不参与 Pre 的分支、产品和发布命名。

## 常用命令

```text
/preplan-new <name>
/preplan-open <projectId>
/preplan-list
/preplan-status
/preplan-mode manual|automatic
/preplan-confirm <proposalId>
/preplan-presentation-sync --probe
/preplan-presentation-sync
/preplan-presentation-sync --force
/preplan-open-project-folder
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

Workspace 根目录代码验证坐标：

```text
HEAD: 700a1675ac5801b4ed824b31de48184be2cc1c6c
Workflow: Pre 2.0.0 Integration
Run: 33835245301
Conclusion: success
```

## DSH 部署验证

```powershell
git switch feat/pre-v2.0.0
git pull --ff-only
pnpm install --frozen-lockfile
pnpm test
pnpm pack
dsh plugin --profile web add .\architectureworld-dsh-preplanning-agent-2.0.0.tgz
dsh --profile web --no-open
```

重新加载浏览器后使用 `Ctrl + F5` 清理旧 Client 缓存。当前开发候选仍未合并主线、未创建 `v2.0.0` Tag 或正式 Release。
