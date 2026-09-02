---
document_id: pre-design-presentation-project-alignment
name: Pre-design 与 Presentation 标准项目目录对齐规范
version: 2.0.0
status: frozen
approved_at: 2026-09-02
branch: architecture/presentation-project-alignment-v2.0.0
scope: architecture-and-contract-alignment
package_version_impact: none
implementation_status: not-started
upstream_schema_authority: ArchitectureWorld/presentation-tools
language: zh-CN
---

# Pre-design 与 Presentation 标准项目目录对齐规范 v2.0.0

## 0. 一句话结论

第一版继续维持 `pre-design` 与 `presentation-tools` 两个独立 DSH 插件，不合并仓库、不重构为单一插件，也不对 `presentation-tools` 提出任何界面或交互功能改动要求。

本轮只调整 `pre-design` 的职责：创建前期策划项目时，由 `pre-design` 执行 Presentation 标准项目目录初始化；后续按 `presentation-tools` 定义的唯一标准，生成项目基本对象、大纲、逐页草案和已采用素材，不生成排版内容。

## 1. 版本边界

- 本文件版本 `v2.0.0` 表示“Pre-design × Presentation 标准项目目录对齐方案版本”。
- 本版本不是 npm 包、DSH 插件或 GitHub Release 的正式 `2.0.0` 发布。
- 当前 `package.json` 版本、现有 `v0.7.0` Tag 与 Release 均保持不变。
- 本支线现阶段只提交规范、跨仓需求和实施计划，不改动生产代码。
- 在 `presentation-tools` 返回正式目录规范、Schema、初始化及验证接口前，`pre-design` 不得自行发明第二套 Presentation Schema。

## 2. 已冻结的系统关系

```text
DSH
├─ pre-design 插件
│  ├─ 前期策划专业流程与 57 项工作流
│  ├─ ProjectBrief / Evidence / Assumption / Question / Gate / Revision
│  ├─ 大纲与逐页草案生成
│  ├─ 专业素材选择、生成和溯源
│  └─ Presentation 标准项目目录的创建与更新
│
└─ presentation-tools 插件
   ├─ 定义 Presentation Canonical Schema
   ├─ 定义标准项目目录与文件规则
   ├─ 管理大纲、草案、素材、排版和导出
   └─ 第一版不因本次对齐新增界面或交互要求
```

### 2.1 `presentation-tools` 的职责

`presentation-tools` 是下列标准的唯一权威来源：

- 标准项目目录结构；
- 文件名和目录名；
- Canonical JSON Schema；
- Schema 版本和兼容策略；
- 稳定 ID 规则；
- 最小合法初始文件；
- 标准初始化器与验证器接口；
- 后续排版文件结构。

### 2.2 `pre-design` 的职责

`pre-design` 负责：

- 在新建前期策划项目时触发标准目录创建；
- 按标准填写项目基本对象；
- 将用户原始资料复制进 `source-materials/`；
- 将已采用或生成的汇报素材分类写入 `assets/`；
- 从 57 项专业结果生成 Presentation 标准大纲与逐页草案；
- 保留专业来源、证据与 Revision 溯源；
- 在章节 Gate 通过或用户明确要求同步时，正式更新 Presentation 标准文件；
- 不生成排版数据，不决定字体、位置、尺寸、版式和最终媒介渲染。

## 3. 第一版明确不做

- 不合并两个仓库。
- 不把两个插件改造成一个插件。
- 不将 `pre-design` 政名或重构为仅含 Prompt 的普通 Skill 包。
- 不要求修改 `presentation-tools` 的 UI、三阶段交互、批注区、悬浮 Agent 或导出界面。
- 不要求 `presentation-tools` 理解 `PS01`、`DG05`、`OP07`、`SP07` 等前期策划领域对象。
- 不让 `pre-design` 输出 `LayoutPageDocument`。
- 不在 `pre-design` 新路径中继续扩展字体、主题、页面几何、页面模板、HTML/PPTX/PDF 版式策略。
- 不立即删除现有 legacy 报告渲染代码；第一版只停止把它作为新架构的长期事实源继续扩张。

## 4. 标准项目目录

默认项目目录：

```text
<DSH 当前工作区>/
└─ projects/
   └─ <projectId>-<projectSlug>/
      ├─ project.json
      ├─ rules.json
      ├─ outline.json
      │
      ├─ pages/
      │  ├─ manifest.json
      │  └─ drafts/
      │
      ├─ source-materials/
      │  ├─ manifest.json
      │  ├─ documents/
      │  ├─ drawings/
      │  ├─ images/
      │  ├─ videos/
      │  ├─ data/
      │  ├─ models/
      │  └─ other/
      │
      ├─ assets/
      │  ├─ manifest.json
      │  ├─ images/
      │  ├─ videos/
      │  ├─ charts/
      │  ├─ diagrams/
      │  ├─ audio/
      │  └─ other/
      │
      └─ layouts/
```

### 4.1 目录身份规则

- `projectId` 是永久项目身份。
- `projectSlug` 只用于文件夹可读性，不得承担项目主键职责。
- 文件夹以后改名，不得改变 `projectId`。
- 所有 Canonical 文件和 Manifest 只能使用项目内相对路径。
- 项目绝对路径只保存在 DSH / `pre-design` 控制记录中，不写入正式 Canonical JSON。
- 默认位置允许由用户在创建项目时覆盖，但覆盖后的路径仍必须满足同一标准目录结构。

## 5. 项目创建与强一致初始化

用户创建一个 `pre-design` 项目时，目录和项目记录必须作为一个可恢复的强一致初始化过程完成。

### 5.1 成功流程

```text
1. 生成 projectId 与安全 projectSlug
2. 检查 projectId、目标目录和同名冲突
3. 在 projects/ 下创建同文件系统 staging 目录
4. 调用 Presentation 标准初始化器写入完整目录和最小合法文件
5. 调用 Presentation 标准验证器校验目录与所有初始 JSON
6. 原子 rename staging 目录到最终目录
7. 写入 pre-design 项目记录及项目目录绝对路径
8. 将项目标记为 ready 后才向用户返回创建成功
```

### 5.2 失败与恢复

- 任一步失败都不得向用户暴露为已创建项目。
- 初始化失败必须清除本次 staging 目录。
- 最终目录已 rename、但项目记录写入失败时，必须删除最终目录或由启动恢复器完成清理。
- 进程崩溃后，启动恢复器必须扫描并处理：
  - 未完成的 `.creating-*` staging 目录；
  - 没有有效项目记录的孤立最终目录；
  - 项目记录存在但目录缺失或校验失败的异常项目。
- 同一 `projectId` 已存在且目录合法时，执行恢复或打开，不得覆盖重建。
- 同名目录存在但内部 `projectId` 不一致时，返回明确冲突，不得复用或覆盖。

## 6. 创建时必须存在的最小合法内容

项目创建完成后，下列文件必须已经是符合 Presentation Schema 的合法 JSON，不能只是空白文件：

| 文件 | 创建时语义 |
|---|---|
| `project.json` | 项目身份、名称、Schema 版本、画布预设、规则对象引用、创建来源与创建时间 |
| `rules.json` | 受众、用途、语言、写作规则、真实性约束和基础视觉要求 |
| `outline.json` | 合法空大纲，`nodes` 为空，不创建虚构章节 |
| `pages/manifest.json` | 合法空页面清单，不创建空白占位页 |
| `source-materials/manifest.json` | 合法空原始资料清单 |
| `assets/manifest.json` | 合法空正式素材清单 |

同时创建：

- 空的 `pages/drafts/`；
- 完整的 `source-materials/` 分类目录；
- 完整的 `assets/` 分类目录；
- 空的 `layouts/`。

所有初始文件必须记录其 Presentation Schema 版本。具体字段名、必填项和 `$id` 由 `presentation-tools` 定义，`pre-design` 只实现。

## 7. 原始资料管理

### 7.1 定义

`source-materials/` 保存项目最初获得的基础资料，包括但不限于：

- Word、PDF、任务书和政策文件；
- CAD、总平图、红线图和其他图纸；
- 现状照片；
- 原始视频；
- Excel、CSV、JSON 和其他数据；
- IFC、三维模型和其他模型文件；
- 无法归类的其他原始文件。

### 7.2 导入规则

- 默认复制，不移动用户原文件。
- MVP 不使用软链接、快捷方式或外部绝对路径引用。
- 导入时计算 SHA-256。
- 同一项目中内容 Hash 相同的文件不重复保存。
- 原始文件尽量保持字节不变；需要裁切、压缩、转码或标注时，生成新的正式素材，不覆盖原件。
- Manifest 至少需要表达：稳定 `sourceMaterialId`、原始文件名、分类、相对路径、MIME、字节数、SHA-256、导入时间和导入来源类型。
- 用户原始绝对路径不进入项目 Canonical 文件；如需临时审计，仅保存在受控运行记录中。

## 8. 正式素材管理

### 8.1 定义

`assets/` 只保存已经进入汇报生产流程的正式素材：

- 被采用的原始图片或视频；
- 从原始总平、红线、图纸或文档派生的图像；
- 已确认的分析图；
- 数据图表；
- 关系图、流程图和示意图；
- AI 生成且已采用的概念图；
- 剪辑或转码后采用的视频、音频；
- 其他正式进入草案的媒介文件。

### 8.2 分类规则

- 图片进入 `assets/images/`。
- 视频进入 `assets/videos/`。
- 数据图表进入 `assets/charts/`。
- 关系图、流程图和空间示意图进入 `assets/diagrams/`。
- 音频进入 `assets/audio/`。
- 其余正式素材进入 `assets/other/`。

### 8.3 采用与溯源

- 原始资料被采用时，复制或派生到 `assets/`，不得移动或覆盖 `source-materials/` 原件。
- 已采用素材使用稳定 `assetId`。
- 草案只引用 `assetId`，不在每个页面中重复保存文件路径。
- `assets/manifest.json` 统一维护 `assetId → 相对路径` 映射。
- Manifest 必须区分素材来源：原始资料直接采用、原始资料派生、`pre-design` 生成、其他工具生成或人工添加。
- 由原始资料派生的素材必须保留 `sourceMaterialId`、转换或裁切关系及 Hash。
- 由 `pre-design` 生成的素材必须保留专业对象、证据和 `pre-design` Revision 来源。
- 未采用的 AI 候选图、缓存和临时文件不进入正式 `assets/` 目录。

## 9. `pre-design` 的 Presentation 标准输出边界

`pre-design` 必须直接生成符合 `presentation-tools` Canonical Schema 的对象，不增加一套私有 `pre-design-report.json` 再由下游二次转换。

```text
pre-design 负责生成
├─ ProjectManifest
├─ ProjectRulesDocument
├─ OutlineDocument
├─ PageManifest[]
├─ DraftPageDocument[]
└─ AssetManifest

pre-design 不生成
└─ LayoutPageDocument[]
```

### 9.1 映射关系

| Presentation 对象 | `pre-design` 来源 | 责任 |
|---|---|---|
| `ProjectManifest` | Project + ProjectBrief | 提供项目身份和基础属性 |
| `ProjectRulesDocument` | 汇报受众、用途、语言、真实性与专业表达规则 | 提供全项目内容要求 |
| `OutlineDocument` | 57 项专业成果的汇报叙事投影 | 形成大章节、小章节和摘要 |
| `PageManifest[]` | 大纲到逐页草案的拆分页规划 | 提供稳定 `pageId`、顺序和所属大纲节点 |
| `DraftPageDocument[]` | 已确认专业结论、证据、讲解稿和素材引用 | 提供每一页讲什么 |
| `AssetManifest` | 原始资料采用、专业分析图、图表和已采用概念素材 | 提供正式素材及来源链 |
| `LayoutPageDocument[]` | 无 | 由 `presentation-tools` 后续生成 |

### 9.2 草案内容范围

逐页草案至少可以包含 Presentation 标准允许的：

- 页面主标题；
- 核心结论；
- 正文；
- 列表；
- 指标组；
- 表格；
- 独立讲解稿；
- 本页素材的 `assetId` 引用；
- 领域来源引用。

草案不得包含：

- `x / y / w / h`；
- 字体、字号和颜色；
- 页面模板；
- `split / editorial / full-bleed` 等版式；
- PPT 母版；
- HTML CSS；
- 元素裁切和排版几何。

## 10. 57 项专业成果到汇报内容的投影

`presentation-tools` 不负责理解 `pre-design` 的领域对象。转换必须发生在 `pre-design` 内部：

```text
57 项专业 State Object
        ↓
专业判断与证据收敛
        ↓
OutlineDocument
        ↓
PageManifest[]
        ↓
DraftPageDocument[]
        ↓
Presentation 标准项目目录
```

禁止采用“一个 State Object 对应一页”的机械映射。多个专业对象可以汇聚为一个汇报结论，一个复杂结论也可以拆为多页。

页面内容应以甲方理解和决策为目标，不以展示内部工作流为目标。

## 11. 稳定 ID 与来源追踪

- `outlineNodeId`、`pageId`、`contentBlockId`、`listItemId`、`metricId`、`sourceMaterialId` 和 `assetId` 必须遵守 Presentation 标准。
- 显示标题、页码和数组位置不能作为主键。
- 同一对象在增量同步后应尽量保留原 ID。
- 每个由 `pre-design` 生成的内容块允许保留通用领域来源引用。

建议由 `presentation-tools` 将来源扩展正式定义为类似下列语义：

```json
{
  "provider": "pre-design",
  "projectId": "project_001",
  "sourceRevision": 42,
  "objectIds": ["DG05"],
  "evidenceIds": ["evidence_031"]
}
```

上例只表达已冻结语义，最终字段名、基数和 Schema 仍由 `presentation-tools` 统一定义。

## 12. 内容同步时机

采用“持续准备、节点提交”策略：

```text
pre-design 专业工作流持续推进
        ↓
内部生成或更新大纲、草案和素材候选
        ↓
章节 Gate 通过，或用户明确执行“更新汇报内容”
        ↓
正式更新 Presentation Canonical 文件
        ↓
记录 pre-design Revision 与 Presentation Revision 的对应关系
```

规则：

- 单个专业工作项变化不应自动制造大量正式 Presentation Revision。
- 未确认的专业判断不得静默进入正式大纲或草案。
- 正式同步以同一 `pre-design` Revision 的冻结输入为基础。
- 同步结果必须记录新增、修改、保留、冲突和失败对象。
- 第一版不得静默覆盖已经被 Presentation 修改的同一内容对象；冲突应返回结构化结果并停止相关对象更新。
- 同步过程必须可重试且幂等。

## 13. Revision 边界

### 13.1 `pre-design` Revision

表示专业策划状态变化，例如项目定位、指标、策略、投资、红线或专业证据发生变化。

### 13.2 Presentation Revision

表示汇报内容或排版项目变化，例如大纲、页面草案、讲解稿、素材引用或排版发生变化。

两者不得共用同一个自增序号。必须保存明确映射：

```text
pre-design Revision 42
        ↓ sync
Presentation Revision 8
```

## 14. 对现有 `pre-design` 报告代码的处理

第一版不大规模删除现有报告能力，采用兼容迁移：

```text
阶段 A：保留 legacy HTML/PPTX/PDF 输出，同时新增 Presentation 标准目录输出
阶段 B：使用同一真实项目并行验证两条输出
阶段 C：Presentation 标准路径达到能力等价后，将 legacy 排版路径标记 deprecated
阶段 D：另行授权后才删除 legacy 排版与渲染代码
```

本次 v2.0.0 支线不实施阶段 B、C、D。

## 15. 对 `presentation-tools` 的唯一需求范围

当前不要求任何 UI 或交互改动。只需要 `presentation-tools` 完成并反馈：

1. 正式命名并冻结 `Presentation Standard Project Directory v1`。
2. 确认本文件第 4 章目录结构，或给出最小修正。
3. 定义以下 JSON Schema：
   - `ProjectManifest`
   - `ProjectRulesDocument`
   - `OutlineDocument`
   - `PageManifest`
   - `DraftPageDocument`
   - `SourceMaterialManifest`
   - `AssetManifest`
4. 定义每个文件的最小合法空实例。
5. 定义稳定 ID、相对路径、文件名和分类规则。
6. 定义草案内容块、讲解稿、本页素材引用和通用 `sourceRefs`。
7. 定义原始资料与正式素材的 provenance / lineage 字段。
8. 定义 Schema 版本、兼容、迁移和读取旧版本规则。
9. 提供可被其他插件调用的初始化器与验证器契约。
10. 提供一个完整、可验证、尚未排版的示例项目目录。
11. 给出跨仓消费方式，保证 `pre-design` 不复制并私自修改 Schema。
12. 将结果写入 `presentation-tools` 的权威架构母文件或其正式 ADR / Contracts，并提供精确路径、版本和 commit SHA。

## 16. 验收标准

只有同时满足下列条件，本对齐方案才可进入代码实现：

- `presentation-tools` 已明确标准目录版本与 Schema 权威位置。
- 所有初始 JSON 有可执行 Schema 和最小合法示例。
- 初始化器和验证器契约明确。
- `pre-design` 不需要了解 Presentation UI 或排版引擎私有结构。
- `pre-design` 可以仅凭标准契约创建合法项目目录。
- 新项目创建失败不会留下用户可见半成品。
- 原始资料复制、Hash 去重和分类规则明确。
- 正式素材采用、分类、来源链和页面引用规则明确。
- 大纲、页面草案和素材可以在没有任何 Layout 文件的情况下通过验证。
- 所有文件引用为相对路径。
- `layouts/` 可合法为空。
- 现有两个 DSH 插件仍保持独立。
- 没有新增 Presentation UI 或交互改动要求。

## 17. 当前状态

- 架构方向：已冻结。
- `pre-design` 支线：`architecture/presentation-project-alignment-v2.0.0`。
- 生产代码：未修改。
- 插件正式版本：未提升。
- 下一外部依赖：`presentation-tools` 返回第 15 章所列标准定义与验证材料。
- 下一内部动作：外部标准通过审查后，按同支线中的实施计划执行 `pre-design` 代码调整。
