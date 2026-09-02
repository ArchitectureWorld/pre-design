---
document_id: pre-design-presentation-project-alignment
name: Pre-design 与 Presentation 标准项目目录对齐规范
version: 2.0.0
status: frozen
approved_at: 2026-09-02
branch: architecture/presentation-project-alignment-v2.0.0
scope: pre-design-architecture-and-contract-consumption
package_version_impact: none
implementation_status: not-started
upstream_schema_authority: ArchitectureWorld/presentation-tools
content_baseline: docs/superpowers/specs/2026-09-02-pre-design-presentation-content-baseline-v2.0.0.md
language: zh-CN
---

# Pre-design 与 Presentation 标准项目目录对齐规范 v2.0.0

## 0. 一句话结论

第一版继续维持 `pre-design` 与 `presentation-tools` 两个独立 DSH 插件，不合并仓库、不重构为单一插件，也不要求修改 `presentation-tools` 的界面或交互。

本轮只调整 `pre-design`：新建前期策划项目时，由 `pre-design` 执行 Presentation 标准项目目录初始化；后续按照 `presentation-tools` 提供的权威标准，生成项目基本对象、大纲、页面清单、逐页草案、独立讲解稿和已采用素材，不生成排版内容。

## 1. 版本边界

- 本文件版本 `v2.0.0` 表示 Pre-design 与 Presentation 的架构对齐方案版本。
- 本版本不是 npm 包、DSH 插件、Git Tag 或 GitHub Release 的正式 `2.0.0` 发布。
- 当前 `package.json` 版本和既有 `v0.7.0` Tag / Release 保持不变。
- 本支线当前阶段提交规范和实施基线，不修改生产代码。
- `presentation-tools` 是标准目录、Canonical Schema、稳定 ID、初始化器和验证器的唯一权威。
- `pre-design` 不复制、分叉或私自扩展 Presentation Schema。
- 面向 `presentation-tools` 开发团队的详细要求通过仓库外独立交付文件传递，不存放在 `pre-design` 仓库。

## 2. 第一版系统关系

```text
DSH
├─ pre-design 插件
│  ├─ 前期策划专业流程与 57 项工作流
│  ├─ ProjectBrief / Evidence / Assumption / Question / Gate / Revision
│  ├─ Presentation 标准项目目录初始化的执行
│  ├─ 原始项目资料导入与正式素材采用
│  ├─ 大纲、页面草案和讲解稿生成
│  └─ 节点式同步到 Presentation 标准文件
│
└─ presentation-tools 插件
   ├─ 定义 Presentation 标准与 Schema
   ├─ 读取和维护标准项目文件
   ├─ 可视化编辑、排版和导出
   └─ 第一版不因本次对齐新增界面或交互要求
```

### 2.1 `pre-design` 的产品定位

`pre-design` 在产品语义上是前期策划专业 Skill，在工程上继续维持现有独立 DSH 插件载体。它不是第二套 Harness，也不自建 Agent Runtime、模型路由或独立会话系统。

### 2.2 明确不做

第一版不做以下事项：

- 不合并两个仓库；
- 不合并两个 DSH 插件；
- 不将 `pre-design` 改造成仅包含 Prompt 的轻量包；
- 不要求修改 Report Studio 的 UI、三阶段交互、批注区、悬浮 Agent 或导出界面；
- 不要求 Presentation 理解 `PS01`、`DG05`、`OP07`、`SP07` 等前期策划对象；
- 不让 `pre-design` 生成 `LayoutPageDocument`；
- 不继续在新路径中扩展字体、主题、页面几何、PPT 母版或 HTML/PDF/PPTX 版式规则；
- 不立即删除现有 legacy 报告路径。

## 3. 标准项目目录

默认位置：

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

目录名称和最终文件字段服从 `presentation-tools` 发布的权威标准。上图是当前冻结的消费目标；上游标准如作最小结构修正，`pre-design` 通过版本化 Adapter 适配，不建立第二套标准。

### 3.1 项目身份和路径

- `projectId` 是永久项目身份；
- `projectSlug` 只用于目录可读性，不是主键；
- 文件夹改名不能改变 `projectId`；
- Canonical JSON 与 Manifest 只使用项目内相对路径；
- 项目绝对路径只保存在 DSH / `pre-design` 控制记录中；
- 默认路径允许在创建项目时覆盖，但目录内部仍遵守同一标准；
- 禁止将用户机器绝对路径写入可迁移项目文件。

## 4. 项目创建与强一致初始化

项目记录和标准目录必须作为一个用户可观察的强一致初始化过程完成。

### 4.1 成功流程

```text
1. 生成 projectId 和安全 projectSlug
2. 检查项目身份、目标路径和同名冲突
3. 在同一文件系统创建 staging 目录
4. 调用 Presentation 标准初始化器创建目录和最小合法文件
5. 调用 Presentation 标准验证器校验完整项目
6. 原子 rename staging 到最终目录
7. 写入 pre-design 项目记录与目录绑定记录
8. 标记 ready 后才返回创建成功
```

### 4.2 失败与恢复

- 任一步失败都不得向用户显示创建成功；
- 初始化失败必须清理本次 staging；
- 最终目录已产生但控制记录未完成时，必须回滚或由启动恢复器处理；
- 启动恢复器必须识别未完成 staging、孤立最终目录、目录缺失及校验失败项目；
- 同一 `projectId` 已存在且目录合法时执行恢复或打开，禁止覆盖重建；
- 同名目录内部 `projectId` 不一致时返回明确冲突；
- 失败路径不得留下可被 Presentation 当作正式项目打开的半成品。

## 5. 创建时的最小合法项目

创建成功时，以下文件必须是通过 Presentation Schema 的合法 JSON，而不是空白文件：

| 文件 | 初始语义 |
|---|---|
| `project.json` | 项目身份、名称、标准版本、项目规则引用、创建来源和创建时间 |
| `rules.json` | 受众、用途、语言、写作要求、真实性要求及基础汇报要求 |
| `outline.json` | 合法空大纲，不创建虚构章节 |
| `pages/manifest.json` | 合法空页面清单，不创建占位页 |
| `source-materials/manifest.json` | 合法空原始资料清单 |
| `assets/manifest.json` | 合法空正式素材清单 |

同时创建：

- 空 `pages/drafts/`；
- 完整 `source-materials/` 分类目录；
- 完整 `assets/` 分类目录；
- 空 `layouts/`。

`layouts/` 为空时项目仍必须是合法 Presentation 项目。

## 6. 原始项目资料

`source-materials/` 保存项目最开始获得的基础资料，包括文档、图纸、图片、视频、数据、模型和其他原始文件。

导入规则：

- 默认复制，不移动用户原文件；
- MVP 不使用软链接、快捷方式或外部路径引用；
- 导入时计算 SHA-256；
- 同一项目内相同内容不重复保存；
- 原始文件尽量保持字节不变；
- 裁切、压缩、转码、标注和提取结果作为新素材进入 `assets/`；
- Manifest 记录稳定身份、原始文件名、分类、相对路径、MIME、字节数、Hash 和导入时间；
- 原始绝对路径不得进入 Canonical 项目文件。

## 7. 正式素材

`assets/` 只保存已经采用、生成或加工后正式进入汇报生产流程的素材。

### 7.1 分类

- 普通图片进入 `assets/images/`；
- 视频进入 `assets/videos/`；
- 数据图表进入 `assets/charts/`；
- 关系图、流程图和空间示意图进入 `assets/diagrams/`；
- 音频进入 `assets/audio/`；
- 其余正式素材进入 `assets/other/`。

### 7.2 采用和来源链

- 原始资料被采用时复制或派生到 `assets/`，不移动或覆盖原件；
- 正式素材使用稳定 `assetId`；
- 页面草案只引用 `assetId`，不重复保存文件路径；
- `assets/manifest.json` 统一维护文件位置、MIME、Hash、元数据和来源链；
- 来源至少区分原始资料直接采用、原始资料派生、`pre-design` 生成、其他工具生成和人工添加；
- 派生素材保留 `sourceMaterialId` 与转换关系；
- `pre-design` 生成素材保留专业对象、证据和来源 Revision；
- 未采用候选、缓存和临时文件不进入正式 AssetManifest。

## 8. Presentation 标准输出边界

`pre-design` 直接生成 Presentation 标准对象，不先生成私有 `pre-design-report.json` 再二次转换。

```text
pre-design 生成
├─ ProjectManifest
├─ ProjectRulesDocument
├─ OutlineDocument
├─ PageManifest[]
├─ DraftPageDocument[]
├─ SourceMaterialManifest
└─ AssetManifest

pre-design 不生成
└─ LayoutPageDocument[]
```

映射原则：

| Presentation 对象 | `pre-design` 来源 |
|---|---|
| ProjectManifest | Project + ProjectBrief |
| ProjectRulesDocument | 受众、用途、语言、真实性和专业表达要求 |
| OutlineDocument | 57 项专业成果的汇报叙事投影 |
| PageManifest[] | 大纲到逐页草案的页面拆分 |
| DraftPageDocument[] | 专业结论、正文、指标、表格、讲解稿和素材引用 |
| SourceMaterialManifest | 原始项目资料导入记录 |
| AssetManifest | 已采用原始素材、专业分析图、图表和概念素材 |

大纲、草案、内容性质和页面拆分的详细冻结规则见：

`docs/superpowers/specs/2026-09-02-pre-design-presentation-content-baseline-v2.0.0.md`

## 9. 内容同步

采用“持续准备、节点提交”：

```text
专业工作流持续推进
        ↓
内部准备大纲、草案和素材候选
        ↓
章节 Gate 通过，或用户明确触发更新
        ↓
同步 Presentation Canonical 文件
        ↓
记录 pre-design Revision → Presentation Revision 映射
```

规则：

- 单个工作项变化不自动产生大量正式 Presentation Revision；
- 同步基于同一冻结 `pre-design` Revision；
- 相同来源 Revision 的重试必须幂等；
- 未满足正式草案准入条件的内容不得静默写入；
- 已被 Presentation 人工修改的同一对象不得被静默覆盖；
- 冲突返回结构化结果并停止相关对象更新；
- 同步结果记录新增、修改、未变、冲突和失败对象；
- 同步不得创建或修改任何 Layout 内容。

## 10. Revision 边界

### 10.1 `pre-design` Revision

表示专业策划状态变化，例如项目定位、专业指标、策略、投资、红线、证据或决策发生变化。

### 10.2 Presentation Revision

表示汇报项目内容或排版发生变化，例如大纲、页面草案、讲解稿、素材引用或 Layout 修改。

两者不能共用同一自增序号，必须保存明确映射：

```text
pre-design Revision 42
        ↓ sync
Presentation Revision 8
```

## 11. 标准消费边界

`pre-design` 通过窄 Adapter 消费 `presentation-tools` 发布的版本化标准能力。Adapter 至少需要：

- 读取标准版本；
- 初始化最小合法项目；
- 验证项目目录和单个 Canonical 文件；
- 读取、提交或更新 Presentation Revision；
- 返回稳定错误代码；
- 校验稳定 ID、相对路径、Hash 和来源链。

具体接口签名、字段名、Schema 路径、发布方式和验证命令由 `presentation-tools` 在仓库外独立交付文件中反馈。`pre-design` 不在本仓库预先固定未确认的接口细节。

## 12. Legacy 报告路径

第一版不大规模删除现有报告能力：

```text
阶段 A：保留 legacy HTML/PPTX/PDF，同时新增 Presentation 标准目录输出
阶段 B：使用同一真实项目并行验证两条路径
阶段 C：标准路径能力等价后，将 legacy 排版路径标记 deprecated
阶段 D：另行授权后才删除 legacy 排版和渲染代码
```

本 v2.0.0 支线当前只冻结阶段 A 的架构与实施计划。

## 13. 实现准入条件

进入生产代码实现前，至少必须取得 `presentation-tools` 的以下正式结果：

- 标准目录版本；
- 可执行 Canonical Schema；
- 最小合法项目实例；
- 初始化器和验证器契约；
- 稳定 ID 规则；
- `sourceRefs` 与素材来源链规则；
- Revision 和冲突判断所需字段；
- 带版本与 Hash 约束的跨仓消费方式；
- 可重复执行的验证命令和通过结果。

这里只记录 `pre-design` 的实现准入条件，不在本仓库规定 `presentation-tools` 的内部实现方案。

## 14. 验收标准

- 两个 DSH 插件继续独立；
- 项目创建时由 `pre-design` 执行标准目录初始化；
- 创建失败不留下可见半成品；
- 初始项目在没有页面、素材和 Layout 时仍合法；
- 原始资料与正式素材分离；
- 原始资料复制、Hash 去重和相对路径规则明确；
- 正式素材分类、采用、来源链和页面引用规则明确；
- `pre-design` 能从冻结专业 Revision 生成标准大纲和草案；
- Presentation 不需要理解 57 项领域对象；
- `pre-design` 不生成排版内容；
- 同步可重试、幂等且不静默覆盖人工修改；
- legacy 报告路径第一版仍可兼容；
- 没有对 Presentation UI 或交互提出改动要求。

## 15. 当前状态

- 架构关系：已冻结；
- 标准项目目录消费目标：已冻结；
- 强一致初始化、原始资料、正式素材、同步和 Revision 边界：已冻结；
- 大纲、逐页草案、讲解稿、内容块和内容性质：已在独立内容基线中冻结；
- 生产代码：未修改；
- 插件正式版本：未提升；
- 下一外部依赖：取得 `presentation-tools` 的标准文件与验证反馈；
- 下一内部动作：外部标准通过审查后，按实施计划启动 `pre-design` 代码开发。
