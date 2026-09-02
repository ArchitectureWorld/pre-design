---
document_id: pre-design-presentation-content-baseline
document_version: 2.0.0
alignment_baseline: v2.0.0
status: frozen
approved_at: 2026-09-02
branch: architecture/presentation-project-alignment-v2.0.0
scope: pre-design-content-generation
implementation_status: blocked-by-contract-lock
version_matrix: docs/version-matrix.json
version_authority: docs/VERSIONING.md
parent_spec: docs/superpowers/specs/2026-09-02-pre-design-presentation-project-alignment-v2.0.0-design.md
upstream_format_authority: ArchitectureWorld/presentation-tools
language: zh-CN
---

# Pre-design 大纲、草案与素材输出冻结基线 v2.0.0

## 0. 权威声明

本文件只冻结内容生成规则。版本语义统一读取 [`docs/version-matrix.json`](../../version-matrix.json)，不得在本文件建立另一套包版本、Release、Presentation Contract 或实施状态口径。

`pre-design` 是可执行 DSH 插件，内置前期策划 Skill，并包含专业工作流、Tools、Commands、状态、资料处理和标准文件生成能力。

本文件冻结：

```text
57 项专业成果
→ 汇报大纲
→ 页面清单
→ 逐页草案
→ 独立讲解稿
→ 正式素材引用
```

不冻结排版，不规定字体、字号、颜色、页面坐标、模板、PPT 母版或最终媒介版式。

## 1. 输入边界

投影必须来自同一冻结的 `pre-design` 专业状态：

- Project 与 ProjectBrief；
- 当前有效 State Object；
- Evidence、Assumption 和 Decision；
- Gate 结果；
- Question 和缺失信息；
- 已采用专业素材；
- 当前专业 Revision。

不得读取：

- Presentation DOM 或 React 状态；
- Layout 文件或排版坐标；
- legacy 页面规划；
- 未采用候选素材；
- 已过期、被否决或 supersede 的内容。

## 2. 双项目身份

- 输入专业对象使用 `preDesignProjectId`；
- 输出 Presentation 文档使用 `presentationProjectId`；
- `sourceRefs.sourceProjectId` 使用 `preDesignProjectId`；
- 本地文档 `projectId` 使用 `presentationProjectId`；
- 新 Presentation 稳定 ID 由 Contract ID Factory 生成。

## 3. 内容生成流程

```text
冻结专业状态
→ 有效事实、判断、假设、建议和决策收敛
→ 8 类默认主题基础映射
→ 内置 Skill 与当前 DSH Agent 在约束下项目自适应
→ OutlineDocument
→ 单页单核心结论拆分
→ PageManifest + DraftPageDocument[]
→ scriptBlocks + assetId + sourceRefs
```

禁止：

- 一个专业对象机械对应一页；
- 把 57 项工作流直接变成甲方目录；
- 为凑页数生成重复内容；
- 用排版需求改变专业结论；
- 把具体案例词写进通用默认骨架。

## 4. 默认汇报骨架

| 顺序 | 内部主题键 | 默认主题 | 主要内容 |
|---:|---|---|---|
| 01 | `project_brief` | 项目认知与任务 | 身份、背景、目标、对象、边界和基础约束 |
| 02 | `diagnosis` | 现状与核心问题 | 现状、需求缺口、矛盾、限制和优先级 |
| 03 | `opportunity` | 发展机会 | 政策、趋势、资源、市场和价值窗口 |
| 04 | `positioning` | 项目定位与目标 | 使命、目标、价值主张、定位和非目标 |
| 05 | `program_product` | 产品与功能体系 | 功能、产品、服务对象、内容和使用场景 |
| 06 | `spatial_strategy` | 空间策略 | 结构、网络、分区、节点、尺度和专业图件 |
| 07 | `delivery_model` | 运营、投资与实施 | 运营、投资、主体、分期、路径和风险 |
| 08 | `decision_next_steps` | 决策事项与下一步 | 已决事项、待决事项、授权和后续行动 |

这些主题键只属于 `pre-design` 内部投影规则，不进入 Presentation 通用核心。

## 5. 项目自适应

- 不适用主题省略；
- 内容过多且有多个独立判断链时拆分；
- 高度关联且服务同一结论时合并；
- 确有独立专业主题时新增；
- 调整必须保留专业对象和证据来源；
- 不遗漏影响决策的有效结论；
- 不为了凑齐八章而重复；
- 不将城市更新、滨水、文化街区等案例词写入默认骨架。

相同冻结输入应得到确定性或可解释的稳定输出。

## 6. 基础映射与智能调整

确定性基础映射：

| 专业成果语义 | 默认主题 |
|---|---|
| 身份、启动原因、任务边界、基础条件 | 项目认知与任务 |
| 现状、需求、缺口、矛盾、约束 | 现状与核心问题 |
| 趋势、政策、资源、市场、窗口 | 发展机会 |
| 使命、目标、定位、价值主张、非目标 | 项目定位与目标 |
| 功能、产品、对象、活动、场景 | 产品与功能体系 |
| 结构、网络、分区、节点、尺度、场地分析 | 空间策略 |
| 投资、运营、主体、分期、路径、风险 | 运营、投资与实施 |
| Gate 结论、已决、待决和授权 | 决策事项与下一步 |

当前 DSH Agent 可在 Skill 约束下调整归属，但必须：

- 保留来源对象、专业 Revision 和证据；
- 排除过期、否决或 supersede 内容；
- 不因视觉均衡制造无依据章节；
- 对重大调整形成可审计说明。

## 7. 页面拆分

原则：

> 单页只表达一个核心结论，页面总数由内容自然产生。

通常拆页：

- 存在两个独立核心结论；
- 不同结论需要不同证据或素材；
- 某内容需要单独决策；
- 问题判断和解决方向各自形成完整论证链；
- 页面无法形成清晰讲解顺序。

通常不拆页：

- 同一结论的多个证据；
- 共同支撑一个判断的并列要点；
- 属于同一问题的指标、图表和说明；
- 仅为固定页数或平均章节页数。

建议单页组成：

- 1 个页面主标题；
- 1 个核心结论；
- 2–5 个正文、列表、指标组或表格内容块；
- 0–3 个正式素材引用；
- 1 组独立讲解稿；
- 专业来源和证据引用。

以上是内容指导，不是排版限制。

## 8. 五类基础内容块

| 类型 | 用途 |
|---|---|
| `heading` | 页面主标题、副标题和内部小标题 |
| `text` | 核心结论、正文和说明 |
| `list` | 并列要点、步骤和条件 |
| `metric_group` | 指标及说明 |
| `table` | 对比、分类和结构化数据 |

规则：

- 每页最多一个 `heading(role=page_title)`；
- 每页最多一个 `text(role=key_message)`；
- 列表项、指标、表格行列和单元格使用稳定 ID；
- 页面身份、顺序和大纲归属由 PageManifest 管理；
- 时间线、流程图、鱼骨图、关系图和卡片组先用基础语义表达；
- 视觉形式由 Presentation 后续决定；
- 最终字段名服从锁定 Contract。

## 9. 讲解稿

- 与页面展示内容分离；
- 可说明讲解顺序、重点和口头补充；
- 不默认排入页面正文；
- 可引用同页内容块、素材和来源；
- 时长字段可选；
- 修改讲解稿不要求改变 Layout。

## 10. 素材引用

- 草案只引用正式 `assetId`；
- 不重复保存资产文件路径；
- AssetManifest 维护路径、MIME、Hash 和来源链；
- 页面可表达主素材、辅助素材、背景素材或参考素材；
- 不指定几何位置；
- 未采用候选、缓存和临时文件不得进入正式引用；
- 总平、红线和专业分析素材保留治理来源。

## 11. 内容性质

内容性质是语义元数据，不是排版样式或审批状态。

至少支持：

| 内容性质 | 正式草案表达 |
|---|---|
| `fact` | 已确认事实，保留证据或正式来源 |
| `user_statement` | 用户提供信息，未核验时不改写成事实 |
| `professional_judgement` | 有效专业判断，尽量绑定证据 |
| `assumption` | 明确为待验证假设 |
| `recommendation` | 明确为建议并说明条件或依据 |
| `decision` | 对应有效决策记录或 Gate 结果 |
| `missing` | 作为待确认事项，不形成确定结论 |

冲突信息不直接形成结论；过期、否决或 supersede 内容不进入新输出。

## 12. 来源追踪

有业务含义的内容对象可携带通用 `sourceRefs`，至少表达：

- provider；
- `preDesignProjectId`；
- 专业 Revision；
- 专业对象；
- Evidence；
- 必要时的 Decision 或 Assumption。

多个专业对象和多项证据可共同支撑一个内容对象。

`sourceRefs` 只用于追溯，不定义内容所有权、自动刷新、自动覆盖或冲突行为。

## 13. 节点输出

正式输出触发：

- 章节 Gate 通过；
- 用户明确要求更新；
- 已获授权的当前 DSH Agent 明确触发。

流程：

```text
冻结专业 Revision
→ 生成标准对象候选
→ 比较 pre-design 上次输出 Hash
→ 未被外部修改：更新
→ 已被外部修改：返回 review_required
```

输出结果记录：

- created；
- updated；
- unchanged；
- reviewRequired；
- failed。

不得创建或修改 `layouts/`。

## 14. 稳定身份和 Hash

- 标题、页码、数组下标不能作为主键；
- 语义未改变时保留 ID；
- 新增、复制、拆分产生新 ID；
- 新 ID 由锁定 Contract 的 ID Factory 生成；
- 内容 Hash 使用固定 Canonical JSON；
- `pre-design` 保存自身上次输出 Hash；
- Hash 只用于识别是否发生外部修改，不把 Presentation 扩展成同步治理系统。

## 15. 实现边界

本内容基线在 Contract Lock 前保持冻结但不进入生产实现。

Contract Lock 后实现必须：

- 使用精确版本 Contract；
- 不复制 Schema；
- 不读取 Presentation UI 或 Layout 私有状态；
- 保留现有 legacy 报告路径；
- 通过版本一致性、Schema、目录和 E2E 验证。
