# Pre-design 共享 Workspace 安全增量写盘设计

## 1. 范围与版本坐标

- 仓库：`ArchitectureWorld/pre-design`
- 开发分支：`feat/pre-v2.0.0`
- Pre 产品版本：`2.0.0`
- 下游 Presentation / Report Studio：`feat/report-studio-v0.2.0-layout`
- 共享格式：`Presentation Standard Project Contract 0.1.0`
- Contract Schema 与 Schema Set Hash：本改造不得修改
- Runtime：DSH 仍是唯一 Agent Runtime
- Node.js 共享验收基线：`>=24.11.0`

## 2. 目标

将 Workspace 发布从“以目录为单位替换输出”收敛为“以文件所有权为边界的增量事务”：

1. Pre 只写入自己拥有的 Canonical 文件和由 Pre 上次发布账本确认拥有的载荷文件。
2. `layouts/**` 始终由 Presentation 独立拥有，Pre 不读取其语义、不写入、不移动、不删除。
3. 未列入 Pre 受管清单的目录、文件及兼容扩展内容保持不变。
4. 任一多文件提交失败后恢复到提交前一致状态；重启时恢复遗留事务。
5. `project.json.projectId` 是共享项目唯一身份来源。

## 3. 文件所有权模型

### 3.1 固定受管 Canonical 文件

Pre 固定拥有以下文件：

```text
project.json
rules.json
outline.json
pages/manifest.json
source-materials/manifest.json
assets/manifest.json
```

清单来自 Contract 0.1.0 与现有 Pre 标准项目构建器，不新增另一套格式。

### 3.2 动态受管载荷

动态载荷仅可来自两类证据：

1. 当前 Pre 构建结果明确生成的页面草案、源材料和采用素材；
2. `PresentationProjectBindingRecord.lastExportedFileHashes` 中由 Pre 上一次成功发布记录的路径。

仅因某路径出现在共享 Manifest 中，不足以证明它属于 Pre。Presentation 或其他兼容扩展在 Manifest 中登记的记录及其载荷应按外部所有处理，除非该路径存在于 Pre 的发布账本。

### 3.3 外部所有路径

以下路径永远不属于 Pre：

```text
layouts/**
任何不在固定清单、当前构建结果或 Pre 上次发布账本中的路径
```

外部路径不得进入 Pre 的提交、删除、备份或回滚动作清单；未知文件要求字节级保留。

### 3.4 共享 Manifest 的兼容扩展

`source-materials/manifest.json` 和 `assets/manifest.json` 可能同时包含 Pre 与外部产品登记的合法记录。Pre 更新自身内容时：

1. 先用 Pre 账本投影出自身记录，判断自身文件是否被外部修改；
2. 将外部记录原样合并进候选 Manifest；
3. 仅为 Contract 全量校验把外部载荷复制到事务暂存区；
4. 外部记录和载荷不进入正式提交动作；
5. 返回并持久化的文件哈希仍是 Pre 自身投影，避免下一次同步把外部内容误认成 Pre 所有。

若候选 Pre 输出试图占用外部记录的 `assetId`、`sourceMaterialId` 或 `relativePath`，发布失败并返回 `EXTERNAL_PATH_MODIFICATION_FORBIDDEN`。

## 4. projectId 单一身份链

唯一身份链为：

```text
project.json.projectId
→ Presentation CanonicalSnapshot.project.projectId
→ Layout Source Projection
→ LayoutPageDocument.projectId
```

Pre 新建标准项目时生成一次 `projectId`。后续同步从已有 Binding 和 `project.json` 读取并复用，不允许页面、草案或排版建立第二来源。

写事务在暂存前执行：

- `project.json` 缺失但 Workspace 已出现保留结构：`PROJECT_ID_MISSING`；
- `projectId` 不符合 Contract 0.1.0：`PROJECT_ID_INVALID`；
- 内部目标与磁盘 `project.json.projectId` 不一致：`PROJECT_ID_CONFLICT`。

上述错误必须在任何正式文件变更前失败关闭。

## 5. 写盘事务

事务目录位于 Workspace 同级目录：

```text
.pre-design-transaction-<workspace-path-sha256-prefix>/
├── owner.json
├── journal.json
├── candidate/
└── backup/
```

事务数据不进入 Contract 正式项目结构。

流程：

1. 解析并锁定 Workspace 对应的唯一事务目录；
2. 验证事务目录所有权，拒绝接管无 `owner.json` / `journal.json` 的同名外部目录；
3. 验证 `projectId` 与现有 Contract 项目；
4. 依据固定清单、当前构建和上次发布账本计算受管路径；
5. 在同一文件系统的候选目录生成完整候选项目；
6. 合并兼容扩展字段及外部 Manifest 记录，执行 Contract 0.1.0 校验；
7. 比较 SHA-256，只为发生语义或字节变化的 Pre 路径生成动作；
8. 写入 Journal，逐文件备份并原子重命名；
9. 对最终 Workspace 再次执行 Contract 全量校验；
10. 标记验证完成并清理事务目录。

失败恢复：

- `replace` / `delete` 从备份恢复；
- 已提交的 `create` 被删除；
- 新建且为空的 Pre 目录按逆序清理；
- 新项目为满足 Contract 建立的空 `layouts/` 仅在仍为空时清理；
- Presentation 既有 `layouts/` 不进入 Journal，因此不参与任何回滚动作；
- 应用重启后根据 Journal 游标继续执行回滚并清理遗留事务。

## 6. 错误码

| 错误码 | 含义 |
|---|---|
| `PROJECT_ID_CONFLICT` | 内部项目身份与磁盘正式身份不一致 |
| `PROJECT_ID_MISSING` | 保留结构中缺少正式 `project.json` |
| `PROJECT_ID_INVALID` | `projectId` 不符合 Contract 0.1.0 |
| `WORKSPACE_WRITE_LOCKED` | 另一有效写事务持有 Workspace 锁 |
| `WORKSPACE_TRANSACTION_FAILED` | 事务准备、提交或校验阶段失败 |
| `WORKSPACE_RECOVERY_FAILED` | 遗留事务不可安全验证或恢复 |
| `MANAGED_PATH_VIOLATION` | Pre 候选或 Journal 路径越过受管边界 |
| `EXTERNAL_PATH_MODIFICATION_FORBIDDEN` | Pre 尝试占用或修改外部路径 |
| `CONTRACT_VALIDATION_FAILED` | 现有、候选或最终项目未通过 Contract 0.1.0 |

错误码属于应用层，不修改 Contract Schema。

## 7. 跨平台策略

- 仅使用 Node.js `fs/promises` 和 `path` API；不依赖 Bash Glob 作为测试入口。
- 候选、备份和正式路径位于同一文件系统，正式提交使用同卷 `rename`。
- Windows 的临时占用错误采用有限重试；Linux 保持相同事务语义。
- GitHub Actions 在 `ubuntu-latest` 与 `windows-latest` 上执行同一 `pnpm test:workspace-safety`。

## 8. 职责边界

Pre 负责：大纲、草案、原始素材、采用素材、Pre Canonical 文件及其安全发布。

Presentation / Report Studio 负责：`layouts/**`、`LayoutPageDocument`、OpenPencil 派生文件，以及 `live / detached / orphaned` 状态。Pre 不解释或修改这些状态。

## 9. 验收边界

Pre 仓库内完成真实 Contract 0.1.0 共享目录 Fixture：Pre 创建项目、模拟 Presentation 写入 `layouts/` 与合法外部资产记录、Pre 再次更新、校验外部字节不变及最终 Contract 合法。

该 Fixture 证明格式与文件系统兼容，但不等同于两个仓库同时运行的联合 E2E。Presentation 分支仍需在真实共享 Workspace 上执行其 `verify:workspace` 与 `verify:layout`，并核对 Layout Source Projection 的 `projectId` 传递。