---
document_id: pre-design-presentation-project-alignment
name: Pre-design 与 Presentation 标准项目格式对齐规范
version: 2.0.0
status: frozen-reviewed
approved_at: 2026-09-02
branch: architecture/presentation-project-alignment-v2.0.0
scope: pre-design-execution-and-presentation-format-consumption
implementation_status: awaiting-final-presentation-contract
package_version_impact: none
upstream_format_authority: ArchitectureWorld/presentation-tools
content_baseline: docs/superpowers/specs/2026-09-02-pre-design-presentation-content-baseline-v2.0.0.md
language: zh-CN
---

# Pre-design 与 Presentation 标准项目格式对齐规范 V2.0.0

## 0. 最终结论

第一版继续维持两个独立 DSH 插件，不合并仓库、不合并插件，也不要求修改 `presentation-tools` 的界面或交互。

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
└─ presentation-tools DSH 插件
   ├─ 读取标准化项目文件
   ├─ 将项目内容可视化
   ├─ 供人或当前 DSH Agent 操作
   ├─ 完成页面组织和排版
   └─ 导出最终成果
```

`pre-design` 是一个可执行的 DSH 插件。前期策划 Skill 是插件内部的核心专业能力，但不等于整个插件。插件还包含工作流、工具、命令、状态、资料处理和文件生成能力。

`presentation-tools` 是标准项目文件的可视化交互与排版工具。内容如何生成、是否修改、由谁修改以及何时修改，由人或当前 DSH Agent 通过相应插件和工具决定。

标准化项目文件是两个插件共同读写的中立项目载体。

---

## 1. 版本边界

- 本文件的 `2.0.0` 是架构对齐方案版本。
- 不提升当前 npm 包、DSH 插件、Git Tag 或 GitHub Release 到正式 `2.0.0`。
- 当前生产代码尚未按本方案修改。
- 当前 legacy HTML/PPTX/PDF 路径继续保留。
- `presentation-tools` 是标准项目目录、结构文件和 Schema 的唯一权威。
- 面向 `presentation-tools` 的详细格式要求通过仓库外独立交付文件传递，不在 `pre-design` 仓库复制维护第二套标准。
- 在最终 Presentation Contract、类型和验证器通过审查前，不开始生产代码集成。

---

## 2. 职责边界

### 2.1 `pre-design` 负责

- 执行前期策划专业流程；
- 管理 57 项专业工作流及其专业状态；
- 管理 ProjectBrief、Evidence、Assumption、Question、Gate 和专业 Revision；
- 创建前期策划项目；
- 在项目创建时执行标准项目目录初始化；
- 导入原始项目资料；
- 整理、派生、生成并采用正式素材；
- 把专业成果整理为大纲、页面清单、逐页草案和独立讲解稿；
- 按 Presentation 权威格式写入并验证项目文件；
- 记录自身上一次输出结果，用于避免覆盖外部修改；
- 不生成排版内容。

### 2.2 `presentation-tools` 负责

- 定义并维护 Presentation 标准项目格式；
- 发布版本化 Schema、类型、Fixture、示例和验证器；
- 读取标准项目文件；
- 将大纲、草案、素材和排版可视化；
- 供人或当前 DSH Agent 编辑和操作；
- 管理 Presentation 自己的排版实现和导出。

### 2.3 DSH Harness 负责

- 当前 Agent；
- 模型和 Provider；
- Session；
- Agent Loop；
- Tool 调用；
- 子 Agent；
- 暂停、恢复和取消；
- 执行日志与工具事件。

### 2.4 第一版明确不做

- 不合并两个仓库或插件；
- 不把 `pre-design` 简化成只包含 Prompt 的普通 Skill 文件；
- 不让 `pre-design` 自建第二套 Agent Runtime；
- 不要求 Presentation 理解 PS、DG、OP、SP、IM 等专业对象；
- 不要求修改 Presentation UI、批注、悬浮 Agent、排版界面或导出界面；
- 不在 Presentation 标准中定义 pre-design Gate、Workflow、Proposal 或专业审批；
- 不在 Presentation 标准中定义内容所有权、自动刷新、自动覆盖或上游同步状态机；
- 不让 `pre-design` 生成 `LayoutPageDocument`；
- 不在新路径中继续扩展字体、主题、坐标、页面模板、PPT 母版或 HTML/PDF/PPTX 版式规则；
- 不立即删除现有 legacy 报告能力。

---

## 3. 标准项目目录

默认位置：

```text
<DSH 当前工作区>/
└─ projects/
   └─ <projectId>-<projectSlug>/
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

最终目录名、文件名和字段服从 `presentation-tools` 发布的正式 Contract。上图是 `pre-design` 的目标结构，不是第二套 Schema。

固定规则：

- `projectId` 是永久身份；
- `projectSlug` 只用于可读性；
- 项目内只保存相对路径；
- 项目绝对路径只保存在 `pre-design` 的受控绑定记录中；
- 用户可以指定其他项目根目录，但目录内部仍遵守同一标准；
- `layouts/` 由 Presentation 使用，`pre-design` 创建后保持为空；
- 整个项目目录可以整体迁移、压缩和归档。

---

## 4. 项目创建由 `pre-design` 执行

项目创建的业务入口、文件系统操作、状态记录、失败回滚和恢复均由 `pre-design` 负责。

Presentation Contract 只需要提供：

- 版本化 Schema；
- TypeScript 类型；
- 最小合法实例或纯文档工厂；
- 单文档验证器；
- 完整项目验证器；
- 稳定错误代码。

Presentation Contract 不承担：

- `/preplan-new`；
- DSH 项目记录；
- `pre-design` 的创建状态；
- 业务回滚和恢复；
- 用户创建成功或失败反馈。

### 4.1 用户可观察的一致性

项目只有在以下两部分均完成后才返回创建成功：

```text
pre-design 项目状态 ready
+
标准 Presentation 项目目录验证通过
```

### 4.2 创建流程

```text
1. 生成 pre-design projectId 和安全 projectSlug
2. 检查目标项目根、目录冲突和已有绑定
3. 在同一文件系统创建 `.creating-*` staging 目录
4. 根据官方 Schema 和最小文档工厂写入固定目录和六份初始 JSON
5. 调用官方验证器验证整个目录
6. 原子 rename staging 到最终目录
7. 写入或完成 pre-design 项目记录与目录绑定记录
8. 标记 ready
9. 仅在全部完成后向用户返回成功
```

### 4.3 失败与恢复

- 任一步失败都不能返回“项目已创建”；
- 失败时清理本次 staging 和尚未确认的最终目录；
- 无法完成清理时记录 `recovery_required`；
- 插件启动时处理自身留下的 `.creating-*`；
- 同一 `projectId` 已存在且目录合法时执行恢复或打开；
- 同名目录内部身份不一致时拒绝覆盖；
- 不设计跨两个插件的分布式事务；
- 一致性范围限定为 `pre-design` 自身项目记录和项目目录。

---

## 5. 最小合法初始项目

创建成功时必须已有合法 JSON：

```text
project.json
rules.json
outline.json
pages/manifest.json
source-materials/manifest.json
assets/manifest.json
```

同时必须已有：

```text
pages/drafts/
source-materials/全部分类目录
assets/全部分类目录
layouts/
```

允许：

- 空大纲；
- 空页面清单；
- 空草案目录；
- 空原始资料清单；
- 空正式素材清单；
- 空 `layouts/`。

禁止用虚构章节、占位页或假素材满足 Schema。

---

## 6. 原始项目资料

`source-materials/` 保存项目最开始获得的基础资料。

包括：

- 文档和任务书；
- PDF、Word、Excel、CSV、JSON；
- CAD、总平、红线和其他图纸；
- 现状图片；
- 原始视频；
- IFC 和其他模型；
- 其他项目基础文件。

导入规则：

- 默认复制，不移动原文件；
- 不使用软链接、快捷方式或外部路径引用；
- 导入时计算 SHA-256；
- 同一项目内相同内容不重复保存；
- 原始文件尽量保持字节不变；
- 不把用户机器绝对路径写入标准项目文件；
- 裁切、压缩、转码、提取和标注结果进入 `assets/`，不覆盖原件；
- 文件落盘和 Manifest 更新由 `pre-design` 负责避免半写入。

---

## 7. 正式素材

`assets/` 只保存已采用、生成或加工后正式进入汇报的素材。

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

- 原始资料被采用时复制或派生到 `assets/`；
- 不移动或覆盖 `source-materials/` 原件；
- 正式素材使用稳定 `assetId`；
- 草案只引用 `assetId`；
- 文件路径、MIME、字节数、Hash 和来源链由 `assets/manifest.json` 管理；
- 来源至少区分直接采用、原始资料派生、pre-design 生成、其他工具生成和人工添加；
- 未采用候选、缓存和临时文件不进入正式 Manifest；
- `pre-design` 生成的专业素材保留来源专业 Revision、对象和证据。

---

## 8. `pre-design` 的标准输出边界

`pre-design` 直接生成 Presentation 权威格式，不增加私有中间报告格式。

```text
pre-design 生成
├─ ProjectManifest
├─ ProjectRulesDocument
├─ OutlineDocument
├─ PageManifest
├─ DraftPageDocument[]
├─ SourceMaterialManifest
└─ AssetManifest

pre-design 不生成
└─ LayoutPageDocument[]
```

映射：

| Presentation 对象 | `pre-design` 来源 |
|---|---|
| ProjectManifest | Project + ProjectBrief |
| ProjectRulesDocument | 受众、用途、语言、真实性和专业表达要求 |
| OutlineDocument | 57 项专业成果的汇报叙事投影 |
| PageManifest | 大纲到逐页草案的页面拆分 |
| DraftPageDocument[] | 专业结论、正文、指标、表格、讲解稿和素材引用 |
| SourceMaterialManifest | 原始项目资料导入记录 |
| AssetManifest | 已采用原始素材、专业分析图、图表和概念素材 |

大纲、页面和草案的详细规则见内容基线文件。

---

## 9. 标准文件更新

采用“持续准备、节点输出”：

```text
pre-design 专业工作流持续推进
        ↓
插件内部准备大纲、草案和素材候选
        ↓
章节 Gate 通过、用户明确触发，
或当前 DSH Agent 在已授权任务中触发
        ↓
pre-design 更新标准项目文件
```

### 9.1 外部修改保护

标准项目文件可能被人、当前 DSH Agent 或其他合法工具修改。

`pre-design` 不判断修改者身份，也不要求 Presentation 管理内容所有权。  
`pre-design` 只比较：

```text
当前对象或文件语义 Hash
与
pre-design 上一次输出时记录的 Hash
```

处理规则：

- 一致：允许更新；
- 不一致：不静默覆盖，返回 `review_required`；
- 新对象：创建；
- 已删除的 pre-design 对象：不自动删除外部修改后的内容；
- 由人或当前 DSH Agent 决定如何处理 `review_required`。

### 9.2 `pre-design` 自身记录

`pre-design` 控制记录至少保存：

```text
projectId
projectDirectory
standardVersion
state
lastExportedPreDesignRevision
lastExportedAt
lastExportedObjectHashes
```

这些控制信息不写入 Presentation 标准核心 Schema。

### 9.3 明确不建立

第一版不建立：

- Presentation Head 依赖；
- Presentation Revision 映射；
- `baseRevision` / CAS 协议；
- UpstreamSyncRecord；
- 自动刷新资格；
- 内容所有权状态；
- Presentation 同步状态机。

---

## 10. Legacy 报告路径

采用兼容迁移：

```text
阶段 A：保留 legacy HTML/PPTX/PDF，并新增标准项目目录输出
阶段 B：同一真实项目并行验证两条路径
阶段 C：标准路径能力等价后，另行决定 legacy 是否 deprecated
阶段 D：只有明确授权后才删除 legacy 排版与渲染代码
```

V2.0.0 第一版只实施阶段 A。

---

## 11. Presentation Contract 消费边界

`pre-design` 只消费 `presentation-tools` 发布的只读、版本化 Contract。

最低需要：

```text
standardVersion
schemaSetSha256
JSON Schema
TypeScript types
minimal fixture or document factory
document validator
project validator
stable error codes
```

消费规则：

- 精确锁定版本；
- 提交 lockfile integrity；
- 启动时核对标准版本和 Schema Set Hash；
- 不复制后独立修改 Schema；
- 官方 Contract 缺失或版本不兼容时，标准项目输出能力不可用；
- legacy 路径不因此被删除；
- 不依赖 Presentation UI 或排版引擎私有结构。

---

## 12. 实现准入条件

进入生产代码实现前必须取得并审查：

- 标准正式名称和版本；
- 七类 Schema；
- TypeScript 类型；
- 最小合法项目；
- 完整未排版示例；
- 单文档验证器；
- 项目验证器；
- 稳定 ID 规则；
- `sourceRefs` 与素材 lineage；
- 精确版本和 Schema Set Hash；
- 可重复执行的验证结果。

---

## 13. 验收标准

- 两个 DSH 插件继续独立；
- `pre-design` 被正确定位为可执行插件，Skill 是其内部能力；
- DSH Harness 是唯一 Agent Runtime；
- 项目创建由 `pre-design` 执行；
- 目录创建失败不返回成功；
- 最小空项目合法；
- 原始资料和正式素材分离；
- 原始资料复制、Hash 去重和相对路径正确；
- 正式素材分类、采用和来源链正确；
- 57 项专业成果能生成通用大纲和逐页草案；
- Presentation 不需要理解专业对象；
- `pre-design` 不生成排版；
- 外部修改不会被静默覆盖；
- 外部修改处理交给人或当前 DSH Agent；
- 不引入 Presentation Head、CAS、自动刷新或内容所有权系统；
- legacy 报告路径保持兼容；
- 没有 Presentation UI 或交互改动要求。

---

## 14. 当前状态

- 架构关系：已修正并冻结；
- pre-design 插件与内置 Skill 的关系：已修正；
- 标准项目目录消费目标：已冻结；
- 项目创建执行责任：已归属 pre-design；
- 原始资料与正式素材边界：已冻结；
- 大纲、草案、讲解稿与内容性质：见内容基线；
- 外部修改保护：已简化为 pre-design 自身 Hash 检测；
- Presentation Revision / Head / 自动刷新依赖：已从第一版移除；
- 生产代码：尚未修改；
- 插件正式版本：未提升；
- 下一步：取得按仓库外 FINAL 要求修订后的 Presentation Contract，再按实施计划开发。
