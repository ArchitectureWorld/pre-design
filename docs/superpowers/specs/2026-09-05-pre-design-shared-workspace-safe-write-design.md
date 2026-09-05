# Pre-design / Report Studio 共享 Workspace 安全增量写盘设计

## 1. 目标

在不修改 `Presentation Standard Project Contract 0.1.0` 的前提下，将 `pre-design` 的共享 Workspace 发布路径改造为基于明确文件所有权的增量事务写入。

固定关联坐标：

- Pre：`ArchitectureWorld/pre-design`，分支 `feat/pre-v2.0.0`；
- Presentation：`ArchitectureWorld/presentation-tools`，排版分支 `feat/report-studio-v0.2.0-layout`；
- Report Studio：`0.2.0-beta.1`；
- 共享 Contract：`0.1.0`，Schema Set SHA-256 保持 `5bd329fcc8503ff7a48b3430e41b38dd264ae486cee7372a39cbbcccc2de2ebc`。

## 2. 单一项目身份

共享项目的唯一正式身份是 `project.json.projectId`。身份链为：

```text
project.json.projectId
→ Presentation CanonicalSnapshot.project.projectId
→ Layout Source Projection
→ LayoutPageDocument.projectId
```

`preDesignProjectId` 仅是 DSH 内部项目键，不是第二个 Canonical projectId。创建后，Canonical projectId 必须从现有 `project.json` 或持久化 Presentation Binding 恢复；二者不一致时以 `PROJECT_ID_CONFLICT` 失败关闭，且写盘前不得修改任何正式文件。

## 3. 文件所有权

### 3.1 固定受管文件

以下清单来自当前 `buildPresentationStandardProject()` 实际生成的 Contract 0.1.0 文档：

```text
project.json
rules.json
outline.json
pages/manifest.json
source-materials/manifest.json
assets/manifest.json
```

### 3.2 动态受管文件

动态文件只能来自候选 Build 和现有合法 Manifest 的精确路径：

```text
pages/manifest.json.pages[*].draftPath
source-materials/manifest.json.materials[*].relativePath
assets/manifest.json.assets[*].relativePath
```

不得把 `pages/`、`source-materials/` 或 `assets/` 整棵目录作为所有权边界。只有 Manifest 明确声明的精确文件属于 Pre。

### 3.3 Presentation 所有路径

```text
layouts/
layouts/**
```

`layouts/` 是 Presentation 的不透明资产边界。共享 Workspace 写事务不得枚举、读取业务内容、备份、移动、重命名、删除或写入其后代。初次建立 Contract 项目时，仅允许确保 Contract 要求的空 `layouts/` 根目录存在；此后不参与任何 Pre 事务计划。

### 3.4 未知路径

任何不在精确受管清单中的文件或目录均为外部所有。Pre 不得触碰，包括位于项目根目录的第三方扩展目录。

## 4. 增量写入计划

发布器先生成并验证完整候选快照，但最终 Workspace 提交只计算精确受管文件的差异：

```text
候选路径不存在于 Workspace → create
候选哈希与现有哈希不同      → replace
现有 Manifest 声明、候选不再声明 → delete
哈希相同                    → no-op
```

语义无变化的文件不得重写。目录本身不得整体替换，项目根目录不得删除、清空或重命名。

## 5. 兼容扩展字段

Canonical JSON 的已知字段由候选内容覆盖；现有对象中候选未声明、且合并后仍通过 Contract 0.1.0 的兼容键予以保留。数组由候选整体负责，避免错误合并有序语义结构。

该策略用于保留例如 `rules.json.terminology` 中 Report Studio 新增而 Pre 当前不认识的兼容键，同时不会改变 Contract Schema。

## 6. 写事务

每个 Workspace 使用同文件系统的唯一同级事务目录和原子 `mkdir` 写锁：

```text
.<workspace-hash>.pre-design-transaction/
├── owner.json
├── journal.json
├── candidate/
└── backup/
```

流程：

1. 获取 Workspace 写锁；
2. 检测并恢复死亡进程遗留事务；
3. 校验 `project.json.projectId`；
4. 校验现有 Contract 项目；
5. 生成候选、合并兼容字段并再次校验；
6. 计算精确文件动作；
7. 写入持久化 Journal；
8. 按路径顺序逐文件备份并替换；
9. 对最终 Workspace 执行完整 Contract 校验；
10. 成功后删除事务目录；
11. 任一步骤失败，按 Journal 逆序恢复旧文件并删除新建文件。

锁持有者 PID 仍存活时，第二个写入返回 `WORKSPACE_WRITE_LOCKED`。PID 已死亡时，下一次启动或写入先恢复事务。事务及备份永远不写入 Contract 正式项目结构。

## 7. 错误码

应用层稳定错误码：

```text
PROJECT_ID_CONFLICT
PROJECT_ID_MISSING
PROJECT_ID_INVALID
WORKSPACE_WRITE_LOCKED
WORKSPACE_TRANSACTION_FAILED
WORKSPACE_RECOVERY_FAILED
MANAGED_PATH_VIOLATION
EXTERNAL_PATH_MODIFICATION_FORBIDDEN
CONTRACT_VALIDATION_FAILED
```

这些错误码不进入 Contract Schema。

## 8. 跨平台门禁

共享 Workspace 安全测试必须在 `ubuntu-latest` 与 `windows-latest`、Node.js `24.11.0` 上执行同一 npm script，覆盖：

- 所有权和未知路径保留；
- projectId 稳定与冲突失败关闭；
- 故障回滚和遗留事务恢复；
- 并发写锁；
- 兼容扩展字段；
- Contract 0.1.0 全量校验。

## 9. 非目标

- 不修改 Contract 0.1.0 或 Schema Hash；
- 不把 LayoutPageDocument、OpenPencil 或 live/detached/orphaned 状态复制到 Pre；
- 不改变 DSH 唯一 Agent Runtime；
- 不重构非共享 Workspace 的独立历史输出路径；
- 不合并 `main`，不创建新分支。
