---
document_id: pre-design-presentation-project-alignment
document_version: 2.0.0
alignment_baseline: v2.0.0
status: frozen
approved_at: 2026-09-02
branch: architecture/presentation-project-alignment-v2.0.0
scope: pre-design-execution-and-presentation-format-consumption
implementation_status: blocked-by-contract-lock
version_matrix: docs/version-matrix.json
version_authority: docs/VERSIONING.md
content_baseline: docs/superpowers/specs/2026-09-02-pre-design-presentation-content-baseline-v2.0.0.md
upstream_format_authority: ArchitectureWorld/presentation-tools
language: zh-CN
---

# Pre-design 与 Presentation 标准项目格式对齐规范 v2.0.0

## 0. 权威声明

本文件只定义对齐架构。所有版本语义由 [`docs/version-matrix.json`](../../version-matrix.json) 和 [`docs/VERSIONING.md`](../../VERSIONING.md) 统一管理，本文件不得另行定义第二套版本口径。

当前结论：

- 对齐架构已冻结；
- 内容生成基线已冻结；
- 实施计划已完成；
- 生产集成被 Contract Lock 阻塞；
- 对齐基线不改变可执行包版本、历史 Release 或既有合同目录。

## 1. 系统关系

第一版继续维持两个独立 DSH 插件：

```text
DSH Harness
├─ pre-design DSH 插件
│  ├─ 内置前期策划 Skill
│  ├─ 57 项专业工作流
│  ├─ Tools / Commands
│  ├─ 专业状态、Question、Gate、Revision
│  ├─ 原始资料和专业素材处理
│  └─ 创建并填写标准化 Presentation 项目文件
│
└─ presentation-tools DSH 侺件
   ├─ 定义 Presentation 标准项目格式
   ├─ 读取标准化项目文件
   ├─ 将项目内容可视化
   ├─ 供人或当前 DSH Agent 操作
   ├─ 完成页面组织和排版
   └─ 导出最终成果
```

`pre-design` 是可执行 DSH 插件。前期策划 Skill 是插件内部专业能力之一，不等于整个插件。

`presentation-tools` 是标准项目文件的可视化交互、排版与导出工具。内容如何生成、是否修改、由谁修改以及何时修改，由人或当前 DSH Agent 通过相应插件与工具决定。

标准化项目文件是两个插件共同读写的中立项目载体。

## 2. 职责边界

### 2.1 `pre-design`

负责：

- 执行前期策划专业流程；
- 管理 57 项工作流和专业状态；
- 管理 ProjectBrief、Evidence、Assumption、Question、Gate 和专业 Revision；
- 创建前期策划项目；
- 执行标准 Presentation 项目目录初始化；
- 导入原始项目资料；
- 派生、生成并采用正式素材；
- 把专业成果投影为大纲、页面清单、逐页草案和独立讲解稿；
- 按权威 Contract 写入并验证标准文件；
- 保存上一次自身输出的对象 Hash，用于识别外部修改；
- 不生成或修改 Layout 内容。

### 2.2 `presentation-tools`

负责：

- 定义和维护标准项目格式；
- 发布版本化 Schema、类型、稳定 ID Factory、Fixture、示例、验证器和错误代码；
- 读取标准项目文件；
- 提供可视化编辑、排版和导出能力。

### 2.3 DSH Harness

负责：

- Agent、模型、Provider 和 Session；
- Agent Loop、Tool 调用和子 Agent；
- 暂停、恢复、取消和执行记录。

### 2.4 第一版明确不做

- 不合并两个仓库或插件；
- 不把 `pre-design` 简化成纯 Prompt 或单文件 Skill；
- 不让 `pre-design` 自建第二奔 Agent Runtime；
- 不要求 Presentation 理解 PS、DG、OP、SP、IM 等专业对象；
- 不要求修改 Presentation UI 或交互；
- 不在 Presentation 标准中定义 Gate、Workflow、Proposal 或专业审批；
- 不在 Presentation 标准中定义内容所有权、自动刷新、自动覆盖或上游同步状态机；
- 不依赖 Presentation Head、CAS 或 Revision 映射；
- 不让 `pre-design` 生成 `LayoutPageDocument`；
- 不立即删除现有 legacy HTML/PPTX/PDF 路径。

## 3. 双项目身份

```text
preDesignProjectId      pre-design 专业项目身份
presentationProjectId   Presentation ProjectManifest.projectId
```

规则：

- 两者通过 `PresentationProjectBindingRecord` 显式映射；
- 不能假定前缀、UUID 版本或校验规则相同；
- `presentationProjectId` 由锁定 Contract 的 ID Factory 生成；
- Presentation 本地文档使用 `presentationProjectId`；
- `createdBy.sourceProjectId` 和 `sourceRefs.sourceProjectId` 使用 `preDesignProjectId`；
- 移动项目目录不得改变任何一方身份。

## 4. 标准项目目录

默认位置：

```text
<DSH 当前工作区>/
└─ projects/
   └─ <presentationProjectId>-<projectSlug>/
      ├─ project.json
      ├─ rules.json
      ├─ outline.json
      ├─ pages/
      │  ├─ manifest.json
      │  └─ drafts/
      ├─ source-materials/
      │  ├─ manifest.json
      │  ├─ documents/
      │  ├─ drawings/
      │  ├─ images/
      │  ├─ videos/
      │  ├─ data/
      │  ├─ models/
      │  └─ other/
      ├─ assets/
      │  ├─ manifest.json
      │  ├─ images/
      │  ├─ videos/
      │  ├─ charts/
      │  ├─ diagrams/
      │  ├─ audio/
      │  └─ other/
      └─ layouts/
```

目录名、文件名和字段最终服从已锁定的 Presentation Contract。上图是消费目标，不是 `pre-design` 自建 Schema。

固定规则：

- `projectSlug` 只用于可读性；
- 标准文件只保存项目内相对路径；
- 绝对目录只保存在 `pre-design` 绑定记录；
- 用户可覆盖项目根目录；
- `layouts/` 创建为空并保持由 Presentation 使用；
- 整个目录可迁移、压缩和归档。

## 5. 项目创建

项目创建的 DSH 使用、文件系统操作、项目记录、失败补偿和恢复均由 `pre-design` 执行。

Presentation Contract只提供：

- Schema 和类型；
- 稳定 ID Factory；
- 最小文档工厂或最小 Fixture；
- 单文档验证器和完整项目验证器；
- 稳定错误代码。

成功流程：

```text
1. 生成 preDesignProjectId
2. 通过 Contract ID Factory 生成 presentationProjectId
3. 生成 projectSlug 并检查冲突
4. 创建同文件系统 .creating-* staging
5. 创建固定目录和六份最小合法 JSON
6. 运行官方完整验证器
7. 原子 rename 到最终目录
8. 写入双项目 ID 与目录绑定
9. 标记 pre-design 项目和绑定为 ready
10. 返回成功
```

失败要求：

- 任一步失败均不得返回成功；
- 清理 staging 和尚未确认的最终目录；
- 无法清理时记录 `recovery_required`；
- 插件启动时处理自身创建残留；
- 不覆盖不同身份的既有目录；
- 不设计跨两个插件的分布式事务。

## 6. 最小合法初始项目

项目 ready 时必须存在并通过验证：

```text
project.json
rules.json
outline.json
pages/manifest.json
source-materials/manifest.json
assets/manifest.json
pages/drafts/
source-materials/全部分类目录
assets/全部分类目录
layouts/
```

以下为空均合法：

- 大纲节点；
- 页面清单；
- 草案目录；
- 原始资料清单；
- 正式素材清单；
- `layouts/`。

不得用虚构章节、占位页或假素材满足 Schema。

## 7. 原始资料

`source-materials/` 保存项目最初获得的基础资料。

规则：

- 默认复制，不移动原文件；
- 不使用软链接、快捷方式或外部路径引用；
- 导入时计算 SHA-256；
- 同项目相同内容不重复保存；
- 原始文件尽量保持字节不变；
- 绝对源路径不写入标准项目文件；
- 裁切、转码、提取和标注结果进入 `assets/`；
- 文件与 Manifest 更新不得形成半写入。

## 8. 正式素材

`assets/` 只保存已经采用、生成或加工后进入汇报的素材。

分类：

```text
images
videos
charts
diagrams
audio
other
```

规则：

- 原始资料采用时复制或派生，不移动原件；
- 正式素材使用稳定 `assetId`；
- 草案只引用 `assetId`；
- Manifest 维护路径、MIME、字节数、Hash 和来源链；
- 来源区分直接采用、原始资料派生、pre-design 生成、其他工具生成和人工添加；
- 未采用候选、缓存和临时文件不进入正式 Manifest；
- pre-design 生成素材保留专业 Revision、对象和证据来源。

## 9. 标准输出边界

`pre-design` 直接生成锁定 Contract 的标准对象：

```text
ProjectManifest
ProjectRulesDocument
OutlineDocument
PageManifest
DraftPageDocument[]
SourceMaterialManifest
AssetManifest
```

不生成：

```text
LayoutPageDocument[]
字体、字号、颜色
x / y / w / h
页面模板、PPT 母版
CSS 和最终版式参数
```

详细的大纲、页面、草案、讲解稿和内容性质规则由内容基线文件定义。

## 10. 标准文件更新

采用“持续准备、节点输出”：

```text
专业工作流推进
→ 插件内部生成候选
→ Gate 通过、用户明确触发，或已获授权的当前 DSH Agent 触发
→ 比较当前标准对象与 pre-design 上次输出 Hash
→ 未被外部修改：更新
→ 已被外部修改：停止覆盖并返回 review_required
```

`pre-design` 保存：

- `lastExportedPreDesignRevision`;
- `lastExportedAt`;
- `lastExportedObjectHashes`;
- 双项目 ID 与目录绑定。

“外部修改”指任何 `pre-design` 之外的人、Agent、插件或工具对同一对象的修改。

本方案不要求 Presentation 提供 Head、CAS、Revision 映射、自动刷新或冲突状态机。

## 11. Contract Lock

本分支只接受由 `presentation-tools` 发布的一个精确 Contract。

锁文件位置：

```text
docs/contracts/presentation-standard-project-v1-lock.json
```

锁文件必须包含：

```text
standardName
standardVersion
packageName
packageVersion
schemaSetSha256
typesEntry
idFactoryEntry
documentValidatorEntry
projectValidatorEntry
minimalFixturePath
fullExamplePath
validationCommand
sourceCommitSHA
```

在锁文件不存在或验证失败时：

- 生产集成不得开始；
- 不选择候选 Presentation 分支；
- 不猜测包名、导出入口或 Hash；
- 不复制 Schema 到本仓库后独立维护。

Contract Lock 的状态变更必须按 `docs/VERSIONING.md` 的原子更新规则执行。

## 12. Legacy 路径

第一版保留现有 HTML/PPTX/PDF：

```text
阶段 A：增加标准项目目录输出，legacy 路径保留
阶段 B：真实项目并行验证
阶段 C：能力等价后另行标记 deprecated
阶段 D：单独授权后才删除
```

本对齐基线只冻结阶段 A。

## 13. 实现准入

开始生产代码实现前必须同时满足：

- Contract Lock 已创建并通过校验；
- 版本矩阵状态已原子更新；
- 精确 Contract 包和 Schema Set Hash 已固定；
- ID Factory、类型、Fixture 和验证器入口明确；
- 最小项目和完整示例均验证通过；
- `pnpm verify:alignment-versions` 通过。

## 14. 验收标准

- 两个 DSH 插件保持独立；
- 版本矩阵是唯一版本权威；
- 对齐基线不冒充插件 Release；
- 双项目身份明确；
- 项目目录由 `pre-design` 执行创建；
- 创建失败不留下可见半成品；
- 原始资料与正式素材分离；
- 标准文件只使用相对路径；
- 大纲、草案和素材在没有 Layout 时可验证；
- pre-design 不生成排版；
- 外部修改不会被静默覆盖；
- legacy 路径保留；
- Contract Lock 前不进入生产集成。
