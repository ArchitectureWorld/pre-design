# Presentation Tools 标准项目目录需求交接 v2.0.0

## 1. 来源

- 仓库：`ArchitectureWorld/pre-design`
- 支线：`architecture/presentation-project-alignment-v2.0.0`
- 权威规范：`docs/superpowers/specs/2026-09-02-pre-design-presentation-project-alignment-v2.0.0-design.md`
- 性质：跨仓架构与 Contract 需求，不包含 UI 或交互改动要求

## 2. 已冻结关系

第一版继续维持 `pre-design` 与 `presentation-tools` 两个独立 DSH 插件。

- `presentation-tools`：标准项目目录、Canonical Schema、稳定 ID、版本与兼容规则的唯一权威。
- `pre-design`：在创建项目时执行目录初始化，并按权威标准生成项目基本对象、大纲、逐页草案、原始资料清单和正式素材清单。
- `pre-design` 不生成排版文件，`layouts/` 初始为空。
- 本轮不要求修改 Report Studio 的任何 UI、批注、悬浮 Agent、排版或导出功能。

## 3. 待 Presentation Tools 定义的标准目录

```text
<projectId>-<projectSlug>/
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

`source-materials/` 保存原始项目输入；`assets/` 保存经过采用、生成或加工后正式进入汇报的素材。项目内只使用相对路径，`projectId` 是永久身份。

## 4. 必须完成的标准定义

1. 正式命名并冻结 `Presentation Standard Project Directory v1`。
2. 定义并提交版本化 JSON Schema：
   - `ProjectManifest`
   - `ProjectRulesDocument`
   - `OutlineDocument`
   - `PageManifest`
   - `DraftPageDocument`
   - `SourceMaterialManifest`
   - `AssetManifest`
3. 为以下文件提供最小合法实例：
   - `project.json`
   - `rules.json`
   - `outline.json`
   - `pages/manifest.json`
   - `source-materials/manifest.json`
   - `assets/manifest.json`
4. 空大纲、空页面清单、空素材清单和空 `layouts/` 必须合法，不能用虚构章节或占位页满足 Schema。
5. 定义稳定 ID：`projectId`、`projectRulesId`、`outlineDocumentId`、`outlineNodeId`、`pageId`、`contentBlockId`、`listItemId`、`metricId`、`sourceMaterialId`、`assetId`。
6. 定义路径、文件名、MIME、SHA-256、同名冲突、去重、路径逃逸、符号链接和文件/Manifest 一致性规则。
7. 定义原始资料 Manifest，至少覆盖原始名称、分类、相对路径、MIME、字节数、SHA-256、导入时间和状态；不得要求保存用户机器绝对路径。
8. 定义正式素材 Manifest，至少覆盖分类、语义角色、相对路径、MIME、Hash、适用媒介元数据、采用状态及来源链。
9. 定义通用 `sourceRefs`，支持不同领域插件保存 `provider`、项目、来源 Revision、对象和证据引用，不得绑定 `pre-design`。
10. 定义 `Presentation Revision`、`baseRevision`、`lastModifiedRevision`、上游同步幂等和人工修改冲突的结构性规则。
11. 定义项目初始化器与验证器的接口语义、错误代码、版本读取和跨仓消费方式；本轮可以只完成架构与 Contract。
12. 提交一个完整且尚未排版的示例项目目录，并提供可重复的验证命令和 PASS 结果。
13. 选择一个带版本与 Hash 约束的跨仓消费方式，禁止长期手工复制并分别修改 Schema。

## 5. DraftPageDocument 的最低语义

草案至少需要支持：

- 页面主标题；
- 核心结论；
- 正文；
- 列表；
- 指标组；
- 表格；
- 独立讲解稿；
- 本页 `assetId` 引用；
- 通用 `sourceRefs`。

草案不得包含：字体、字号、颜色、`x/y/w/h`、页面模板、版式名称、PPT 母版和 CSS。

## 6. 要求反馈给 pre-design 的结果

请提供一份正式反馈文件，至少列出：

```text
standardVersion
architectureDocumentPath
contractsRoot
minimalFixturePath
fullExamplePath
validationCommand
consumerMethod
branch
commitSHA
```

同时说明：

- 对本交接目录结构是否原样接受；
- 如有调整，逐项解释调整原因；
- `sourceRefs` 最终结构；
- 原始资料与正式素材 lineage 最终结构；
- `pre-design` 应如何调用或消费初始化器、验证器和 Schema；
- 仍存在的非阻断风险。

## 7. 禁止越界

本轮不得：

- 修改 Report Studio UI 或交互；
- 增加 `pre-design` 专用界面；
- 把 `pre-design` 的 57 项对象写入 Presentation 核心模型；
- 合并两个仓库或插件；
- 发布未经完整验收的正式产品版本。

## 8. 验收条件

- 七类 Schema 均可执行验证。
- 六个初始文件均有合法最小实例。
- 稳定 ID、路径和分类规则无歧义。
- `source-materials/` 与 `assets/` 的职责明确分离。
- 素材来源链可追溯。
- `layouts/` 为空时项目仍合法。
- Revision 与冲突检测具有明确数据基础。
- 跨仓消费方式已冻结。
- 示例项目通过验证。
- 没有 UI 或交互修改。
