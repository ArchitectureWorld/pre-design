# DSH 前期策划甲方产品级成果层 v0.8 设计规格

> 状态：待用户审阅
> 日期：2026-08-29（Asia/Shanghai）
> 权威上游：`HANDOFF-前期策划甲方产品手册改版-2026-08-28.md`
> 首个甲方标杆项目：鄂州城市更新—明塘＋洋澜湖地块
> 当前工程基线：`@architectureworld/dsh-preplanning-agent@0.7.0`，提交 `8a24fca`

## 1. 目标

在保留 DSH 治理、版本追踪、自动化生成、证据与审计能力的前提下，把当前偏内部台账的报告层升级为甲方可直接正式汇报、传阅和决策的建筑策划产品册。

首个标杆成果采用“鄂州城市更新—明塘＋洋澜湖地块”。它用于验证内容、视觉和真实交付质量，但不得硬编码进渲染器。后续替换项目时，只更换项目画像、冻结内容、证据与视觉资产，不修改报告核心类型、页面规划器或三种渲染器。

## 2. 已确认范围

### 2.1 受众与媒介

- 核心受众：甲方管理层、投资与运营决策者。
- 次级受众：规划、建筑、招商、运营和实施专业负责人。
- HTML：沉浸浏览、方案对比和会后传播。
- PPTX：16:9 现场汇报，核心元素可编辑，目标 32—48 页。
- PDF：正式传阅与归档，目标 48—72 页，允许比 PPTX 保留更多证据与说明。
- 三种格式共享同一客户叙事和事实口径，但不要求逐页像素复制。

### 2.2 主册叙事

固定主线为：

> 背景与命题 → 现状判断 → 机会价值 → 定位愿景 → 策略体系 → 产品体系 → 空间场景 → 运营投资 → 实施路径 → 决策结论

前三个内容单元必须回答项目是什么、为什么现在必须做、甲方最应记住的价值是什么。至少 80% 的内容页使用结论型标题。

### 2.3 不在 v0.8 范围内

- 不开发通用 PDF/PPTX 原始资料自动理解系统。
- 不复制 Apple 品牌、网页结构、字体、产品图或受保护视觉资产。
- 不重写 57 个工作流、8 个 Gate、Storage Domain 或 DSH 会话体系。
- 不删除现有治理、版本、审计、manifest 或失败恢复能力。
- 不覆盖 v0.7.0 Golden。
- 不把 Reference 原始文档提交到公开仓库，也不修改、重存或覆盖原始文档。

## 3. 方案选择

### 3.1 采用方案：显式客户投影层

在冻结治理输入与渲染器之间增加 `ClientReportProjection`。治理事实先被转换为纯客户叙事模型，之后由媒介页面规划器生成 HTML、PPTX 和 PDF 所需结构。

优点：

- 客户层与治理层从类型和接口上隔离，不依赖渲染器临时删词。
- 同一客户模型支持后续项目替换。
- 三种格式可以媒介化重排，又保持事实和资产一致。
- 可以分别测试内容合同、页面节奏、渲染和内部追溯。

### 3.2 未采用方案

仅在渲染器中过滤 `Gate`、`Revision` 等字段：改动较小，但内部台账结构仍会决定页面叙事，容易漏词和回归。

完全新建独立报告服务：边界最干净，但会复制现有冻结、发布、下载和 manifest 链路，增加长期维护成本。

## 4. 总体架构

```text
Project State + Governance Domain + Visual Asset Store
                       │
                       ▼
              FrozenProjectInput
                       │
                       ▼
          createClientReportBundle()
             ├─ ClientReport
             ├─ ArtifactIdentity
             └─ GovernanceAppendix
                       │
          validateClientReportPolicy()
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
   HTML Page Plan  PPTX Page Plan  PDF Page Plan
         │             │             │
         └─────────────┼─────────────┘
                       ▼
            staging → validate → publish
                       │
             Artifact Manifest + QA
```

`ClientReport` 只包含客户可见的判断、证据、价值、产品、场景、实施与视觉资产。`ArtifactIdentity` 和 `GovernanceAppendix` 保留 Revision、Gate、工作项、内部状态和审计信息，但不能进入客户正文节点。

## 5. 核心接口

### 5.1 客户成果包

```ts
export interface ClientReportBundle {
  readonly report: ClientReport
  readonly identity: ArtifactIdentity
  readonly governanceAppendix: GovernanceAppendix
}

export interface ArtifactIdentity {
  readonly projectId: string
  readonly sourceRevision: number
  readonly recommendationId: string
  readonly adoptedAssetIds: readonly string[]
}

export interface GovernanceAppendix {
  readonly sourceRevision: number
  readonly gateDecisions: readonly GovernanceGateSummary[]
  readonly workflowCounts: Readonly<{ total: number; completed: number; blocked: number }>
}

export interface GovernanceGateSummary {
  readonly gateId: string
  readonly decision: 'approved' | 'approved_with_conditions' | 'returned' | 'blocked'
  readonly revision: number
}
```

`ArtifactIdentity` 只允许写入 manifest、文件属性、PPTX 演讲者备注或 HTML 不可见校验元数据；不得显示在封面、页脚、章节、图表、表格和客户可见文案中。

### 5.2 客户叙事模型

```ts
export interface ClientReport {
  readonly schemaVersion: 'preplan.client-report.v1'
  readonly identity: ClientProjectIdentity
  readonly proposition: ClientProposition
  readonly chapters: readonly ClientChapter[]
  readonly products: readonly ClientProduct[]
  readonly evidence: readonly ClientEvidence[]
  readonly assets: readonly ClientVisualAsset[]
  readonly theme: ClientTheme
}

export interface ClientProjectIdentity {
  readonly projectId: string
  readonly projectName: string
  readonly reportTitle: string
  readonly reportDate: string
  readonly audience: 'executive-and-professional'
  readonly locale: 'zh-CN'
}

export interface ClientProposition {
  readonly projectDefinition: string
  readonly urgency: string
  readonly coreValue: string
  readonly positioning: string
  readonly keywords: readonly string[]
}

export interface ClientChapter {
  readonly id: string
  readonly role: 'brief' | 'diagnosis' | 'opportunity' | 'positioning' | 'strategy' | 'product' | 'spatial' | 'operation' | 'implementation' | 'decision'
  readonly headline: string
  readonly claim: string
  readonly blocks: readonly ClientContentBlock[]
}

export interface ClientProduct {
  readonly productId: string
  readonly name: string
  readonly valueProposition: string
  readonly audiences: readonly string[]
  readonly contents: readonly string[]
  readonly usageScenarios: readonly string[]
  readonly spatialCarrier: string
  readonly operatingModel: string
  readonly valueContribution: string
  readonly evidenceIds: readonly string[]
}

export type ClientContentBlock =
  | { readonly type: 'narrative'; readonly statement: string; readonly evidenceIds: readonly string[] }
  | { readonly type: 'metric'; readonly label: string; readonly value: string; readonly unit: string; readonly evidenceIds: readonly string[] }
  | { readonly type: 'evidence'; readonly headline: string; readonly evidenceIds: readonly string[]; readonly assetIds: readonly string[] }
  | { readonly type: 'comparison'; readonly headline: string; readonly before: string; readonly after: string; readonly evidenceIds: readonly string[]; readonly assetIds: readonly string[] }
  | { readonly type: 'map'; readonly headline: string; readonly assetId: string; readonly evidenceIds: readonly string[] }
  | { readonly type: 'product'; readonly productId: string; readonly assetIds: readonly string[] }
  | { readonly type: 'scene'; readonly headline: string; readonly productIds: readonly string[]; readonly assetIds: readonly string[] }
  | { readonly type: 'timeline'; readonly headline: string; readonly phases: readonly ClientPhase[]; readonly evidenceIds: readonly string[] }
  | { readonly type: 'investment'; readonly headline: string; readonly items: readonly ClientInvestmentItem[]; readonly evidenceIds: readonly string[] }
  | { readonly type: 'decision'; readonly headline: string; readonly asks: readonly string[]; readonly rationaleEvidenceIds: readonly string[] }

export interface ClientPhase {
  readonly phaseId: string
  readonly name: string
  readonly actions: readonly string[]
  readonly prerequisites: readonly string[]
}

export interface ClientInvestmentItem {
  readonly name: string
  readonly amount: string
  readonly unit: string
  readonly assumption: string
}
```

`ClientContentBlock` 必须是有业务语义的联合类型：`narrative`、`metric`、`evidence`、`comparison`、`map`、`product`、`scene`、`timeline`、`investment`、`decision`。不提供通用“任意表格加任意文字”逃生口。

### 5.3 事实、测算与视觉资产

```ts
export interface ClientEvidence {
  readonly evidenceId: string
  readonly kind: 'fact' | 'observation' | 'policy' | 'case' | 'assumption' | 'calculation'
  readonly statement: string
  readonly sourceLabel: string
  readonly sourceDate: string
  readonly locator: string
  readonly unit?: string
  readonly assumption?: string
}

export interface ClientVisualAsset {
  readonly assetId: string
  readonly role: 'hero' | 'site-photo' | 'map' | 'diagram' | 'chart' | 'product-scene' | 'before' | 'after' | 'material'
  readonly chapterId: string
  readonly productId?: string
  readonly caption: string
  readonly sourceKind: 'project-source' | 'deterministic' | 'ai-concept'
  readonly sourcePath: string
  readonly sha256: string
  readonly width: number
  readonly height: number
  readonly disclosure?: '概念示意'
}

export interface ClientTheme {
  readonly themeId: string
  readonly tokens: ClientThemeTokens
}

export interface ClientThemeTokens {
  readonly colors: Readonly<{
    background: string
    surface: string
    ink: string
    muted: string
    primary: string
    accent: string
  }>
  readonly fonts: Readonly<{ display: string; body: string; fallbacks: readonly string[] }>
  readonly grid: Readonly<{ columns: 12; safeMarginRatio: number; spacingBase: 8 }>
  readonly typeScale: Readonly<{
    pptxPt: Readonly<{ cover: number; chapter: number; title: number; body: number; caption: number }>
    htmlPx: Readonly<{ cover: number; chapter: number; title: number; body: number; caption: number }>
  }>
  readonly motion: Readonly<{ durationMs: number; easing: 'ease-out'; respectsReducedMotion: true }>
}
```

- `fact`、`policy` 和 `case` 必须填写来源日期与定位信息。
- `calculation` 必须填写单位和关键假设。
- `ai-concept` 必须填写 `disclosure: '概念示意'`。
- 每个视觉资产必须绑定章节；产品场景图还必须绑定具体产品。
- 删除任意 AI 概念图后，事实和判断证据链仍必须完整。

## 6. 项目可替换设计

首个项目的专属性由 `ClientProjectProfile` 提供：

```ts
export interface ClientProjectProfile {
  readonly identity: ClientProjectIdentity
  readonly proposition: ClientProposition
  readonly themeOverrides: ClientThemeOverrides
  readonly chapters: readonly ClientChapterBlueprint[]
  readonly products: readonly ClientProduct[]
  readonly evidence: readonly ClientEvidence[]
  readonly assetBindings: readonly ClientAssetBinding[]
  readonly requiredVisualRoles: readonly ClientVisualAsset['role'][]
}

export interface ClientChapterBlueprint {
  readonly id: string
  readonly role: ClientChapter['role']
  readonly headline: string
  readonly claim: string
  readonly sourceObjectIds: readonly string[]
  readonly blocks: readonly ClientContentBlock[]
}

export interface ClientAssetBinding {
  readonly assetId: string
  readonly role: ClientVisualAsset['role']
  readonly chapterId: string
  readonly productId?: string
  readonly sha256: string
  readonly width: number
  readonly height: number
  readonly disclosure?: '概念示意'
}

export interface ClientThemeOverrides {
  readonly colors?: Readonly<Partial<ClientThemeTokens['colors']>>
  readonly fonts?: Readonly<Partial<ClientThemeTokens['fonts']>>
}
```

鄂州标杆项目只提供项目名称、价值主张、江湖蓝绿或场地材料色、章节蓝图、产品、证据、视觉角色和冻结内容。每个章节蓝图通过 `sourceObjectIds` 声明其治理来源；投影器必须拒绝不存在的对象 ID。渲染器不得出现“鄂州”“明塘”“洋澜湖”等字符串判断，也不得根据资产序号决定页面位置。

后续替换项目必须满足：

1. 新建项目画像和冻结客户内容。
2. 提供证据与视觉资产 manifest。
3. 运行同一内容政策、页面计划和三格式测试。
4. 不修改通用渲染器，除非发现真正的跨项目媒介缺陷。

## 7. 页面规划与视觉系统

### 7.1 页面类型

```ts
export type ClientPageKind =
  | 'cover'
  | 'opening-claim'
  | 'chapter-divider'
  | 'evidence'
  | 'opportunity'
  | 'positioning'
  | 'product'
  | 'scene'
  | 'implementation'
  | 'decision'
  | 'appendix'

export type ClientMedium = 'html' | 'pptx' | 'pdf'

export interface ClientPagePlan {
  readonly medium: ClientMedium
  readonly pages: readonly ClientPage[]
  readonly layoutContract: Readonly<{
    safeMarginRatio: number
    minimumTitle: number
    minimumBody: number
    minimumCaption: number
  }>
}

export interface ClientPage {
  readonly pageId: string
  readonly kind: ClientPageKind
  readonly layoutVariant: 'full-bleed' | 'split' | 'editorial' | 'data' | 'timeline' | 'summary'
  readonly chapterId: string
  readonly headline: string
  readonly primaryFocus: Readonly<
    | { type: 'claim'; statement: string }
    | { type: 'asset'; assetId: string }
    | { type: 'product'; productId: string }
    | { type: 'decision'; asks: readonly string[] }
  >
  readonly blockIndexes: readonly number[]
  readonly assetIds: readonly string[]
  readonly evidenceIds: readonly string[]
}
```

页面规划器通过 `planClientPages(report, medium)` 返回有序 `ClientPagePlan`。每页只有一个 `primaryFocus`，并声明标题、主要视觉、证据引用和允许的辅助内容。`kind` 表示业务页面类型，`layoutVariant` 表示实际构图；连续重复规则检查构图而不是把全部专业附录误当成同一版式。

### 7.2 公开函数边界

```ts
export function createClientReportBundle(
  input: FrozenProjectInput,
  profile: ClientProjectProfile,
): ClientReportBundle

export function validateClientReportPolicy(report: ClientReport): readonly ClientPolicyViolation[]

export function planClientPages(
  report: ClientReport,
  medium: ClientMedium,
): ClientPagePlan

export interface ClientPolicyViolation {
  readonly code: string
  readonly path: string
  readonly message: string
}
```

`ReportPackageService.publish()` 必须按“构建 bundle → 校验客户政策 → 为三种媒介生成页面计划 → 渲染 → 校验产物 → 原子发布”执行。客户政策出现任意 violation 时终止发布。

规则：

- 同一 `ClientPageKind` 不得连续出现三页。
- 封面之后必须连续形成“项目宣言—为什么现在—项目答案”。
- 技术密集页之后安排章节总结、产品或场景页。
- 地图、总平面、轴测和主视觉获得页面 60%—100% 的主面积。
- 多图矩阵仅用于确有比较逻辑的内容，不作为默认布局。
- PPTX 页数为 32—48；PDF 为 48—72；HTML 不设模拟页数，但保持相同叙事顺序。

### 7.3 设计令牌

`ClientThemeTokens` 显式包含：

- 12 列网格、5%—7% 安全边距和 8pt 间距体系。
- 75%—85% 中性色、10%—20% 项目主色、约 5% 强调色。
- 首个标杆默认使用暖白 `#F5F5F7`、主文字 `#1D1D1F`、次级文字 `#6E6E73`、江湖蓝绿 `#0D5D66` 和克制赭色 `#B85C3A`；新项目可通过画像覆盖主色与强调色。
- 字体优先 `Noto Sans CJK SC`，Windows 回退为 `Microsoft YaHei`，英文和数字回退为 `Segoe UI`；实现时必须验证四种输出环境，不能静默换成不可控字体。
- PPTX 标题不低于 24pt，正文不低于 14pt并优先 16pt 以上，图注与来源不低于 10pt。
- HTML 普通正文和背景对比度不低于 WCAG 4.5:1。
- HTML 动效 300—700ms，尊重 `prefers-reduced-motion`。
- 深色页只用于开篇、章节转换和叙事高潮。

苹果式质感只转译单一焦点、价值优先、尺度、留白、真实材质、连续叙事和精密完成，不复制 Apple 的品牌资产或页面结构。

## 8. 媒介实现

### 8.1 HTML

- 首屏直接显示项目定义、紧迫性和核心价值。
- 使用语义化章节、键盘可达导航、清晰焦点态和 reduced motion。
- 交互只用于地图、前后对比、产品查看和场景切换。
- 核心信息不得依赖悬停。
- 无横向溢出、控制台错误、断链、空白模块或远程依赖。
- PDF 页面计划先生成独立的打印 HTML，再由浏览器打印为 PDF；它与浏览版 HTML 同源，但可以增加专业附录页面。

### 8.2 PPTX

- 16:9，32—48 页，一页一个判断。
- 文本、形状、图表和关键标注保持可编辑。
- 使用多个有业务语义的页面构图，不再固定“每章两页”。
- 图片按安全裁切规则放置；不得拉伸。
- 来源可进入 10—12pt 图注或演讲者备注；内部 Revision 只能进入备注或文件属性。
- 必须在真实 Microsoft PowerPoint 中检查字体回退、溢出、错位和动画。

### 8.3 PDF

- 从同一客户模型和 PDF 页面计划生成，不是低清 PPT 截图拼接。
- 48—72 页，保留目录、页码、来源、专业附录和必要书签。
- 字体嵌入，地图与文字放大后可读，兼顾屏幕和打印。
- PDF 即使没有动效也必须完整表达结论、证据和行动。

## 9. 客户层与治理层边界

客户可见正文禁用：

- `Gate`、Gate ID、`Workflow`、Workflow ID。
- `Revision`、成果版本 `Rxx`、工作项、完成度和审批状态。
- `approved`、`approved_with_conditions`、`returned`、`blocked` 等内部枚举。
- 测试日志、JSON、manifest、本地路径、调试截图和自动化运行证明。
- “我们完成了什么”“本轮已确认”“需甲方确认”等内部会议主持口吻。

允许保留的位置：

- `artifact-manifest.json`。
- 独立内部治理附件和 QA 包。
- PPTX 演讲者备注、文件属性和 HTML 不可见校验元数据。
- DSH 内部界面和运行证据页面。

内容政策必须扫描结构化客户模型和最终三种成果，不能只扫描源 JSON 或单一渲染器。

## 10. 错误与降级策略

- 事实缺少来源：客户投影构建失败，不得自动改写为无来源结论。
- 测算缺少单位或关键假设：构建失败。
- 必需视觉资产缺失、哈希不符或分辨率不足：发布失败。
- 可选视觉资产缺失：页面规划器切换到无图构图，不留下空白框或占位符。
- AI 图缺少“概念示意”：发布失败。
- 资产无法绑定章节或产品：发布失败，不允许在报告末尾按序号堆放。
- 任一渲染器失败：整个 staging 包不发布，旧发布成果保持不变。
- 客户禁词命中：发布失败，并报告格式、页面和命中上下文。
- 字体回退、溢出或断链：在 QA 门禁中失败，不以警告代替通过。

## 11. 测试策略

### 11.1 结构与政策测试

- `tests/client-report-projection.spec.ts`：验证治理输入被投影为纯客户模型，内部事实进入独立附件。
- `tests/client-report-policy.spec.ts`：验证禁词、来源、测算假设、AI 披露和资产绑定。
- `tests/report-page-plan.spec.ts`：验证三页开场、页面类型节奏、页数、安全区和字号底线。
- `tests/report-project-profile.spec.ts`：使用第二个小型项目画像证明替换项目不改渲染器。

### 11.2 渲染与一致性测试

- 扩展 `tests/report-html.spec.ts`：语义、键盘、reduced motion、断链、横向溢出和禁词。
- 扩展 `tests/report-pptx.spec.ts`：页数、媒体、布局类型、字体、边界、可编辑元素和禁词。
- 扩展 `tests/report-pdf.spec.ts`：页数、字体、空白页、元数据和禁词。
- 扩展 `tests/validate-artifacts.spec.ts`：三格式身份、内容口径、资产哈希和失败关闭。
- 扩展 `tests/full-flow-golden.spec.ts`：从同一客户模型生成三格式，并验证核心结论、证据和资产一致。

### 11.3 Golden 分层

保留两类 Golden：

1. 工程 Golden：仓库内确定性、非敏感夹具，用于 CI 和自动回归。
2. 甲方标杆 Golden：使用本机 Reference 中的鄂州项目资料，用于真实内容、视觉和客户成果验收。

甲方标杆输入不把原始大文件提交到公开仓库。使用本地 source manifest 记录文件名、SHA-256、页码或幻灯片定位、提取时间和授权边界。自动化 CI 不把外部 Reference 缺失当成工程失败；正式发布验收必须在本机完成标杆 Golden。

## 12. 新 Golden 与输出边界

旧基线保持只读：

`C:\Users\2899\Documents\Codex\2026-08-27\yue-du\outputs\dsh-preplanning-0.7.0\golden-project`

新标杆建议输出到：

`C:\Users\2899\Documents\Codex\2026-08-27\yue-du\outputs\dsh-preplanning-0.8.0\showcase-mingtang-yanglanhu-r1`

输出命令必须拒绝覆盖已经存在且包含 `artifact-manifest.json` 的目录。新目录包含：

- `html/index.html` 与本地资产。
- `report.pptx`。
- `report.pdf`。
- `artifact-manifest.json`。
- `qa/ppt-render/`、`qa/pdf-render/`。
- `qa/ppt-montage.png`、`qa/pdf-montage.png`。
- `qa/visual-score.json` 和人工复查记录。

## 13. 视觉 QA 与验收

### 13.1 自动检查

- 无 `TODO`、`TBD`、`XXX`、lorem、placeholder。
- 客户正文禁词扫描为零。
- 无文字溢出、对象越界、断链、空页、缺图和低于字号底线的正文。
- 图片分辨率满足实际使用尺寸，裁切不拉伸。
- 来源、日期、单位、假设和 AI disclosure 完整。
- HTML 无横向溢出、控制台错误和不可达关键操作。
- 三格式的核心结论、关键数字和采用资产 ID 一致。

### 13.2 人工检查

必须完成：

1. 全册缩略图节奏检查。
2. 每页 5 秒主次判断。
3. 封面与正文视觉母题连续性检查。
4. 文字、网格、边距、裁切、对比度、地图和图表可读性检查。
5. 至少一次“发现问题—修改源模型或渲染器—重新渲染—复查”的闭环。

### 13.3 双门禁

- 内容产品性：不低于 85/100。
- 苹果式美学：不低于 88/100，目标 90 以上。
- 任一 handoff 一票否决项出现时，不能宣称完成。

## 14. 真实 DSH E2E

新成果层自动化和视觉门禁通过后，在真实 DSH 中执行：

1. 选择人工确认或全自动模式。
2. 启动项目任务并完成必要交互。
3. 执行概念图任务，验证失败恢复和结果采纳。
4. 发布同一冻结事实源的 HTML、PPTX、PDF。
5. 在页面中预览并下载三种成果。
6. 重启 DSH，复核项目、视觉资产、报告包和下载文件仍可恢复。

端口在线、HTTP 200、类型检查或自动化测试均不能替代这条真实业务闭环。

## 15. 发布与回滚

- v0.8 实现使用独立功能分支，不在 release 分支直接开发业务代码。
- 包版本只在工程、Golden、视觉 QA 和真实 E2E 全部通过后更新。
- 发布前核对 worktree、提交拓扑、远端分支、Release、产物哈希和下载链路。
- 远端代理不可用时，不宣称 GitHub 状态已经实时核验。
- v0.7.0 包、Golden 和验收记录是回滚基线，不删除、不覆盖。

## 16. Definition of Done

只有同时满足以下条件，v0.8 甲方成果层才算完成：

- 客户投影层与治理附件在类型、接口和测试上隔离。
- 鄂州标杆项目生成正式 HTML、PPTX、PDF，三者可打开且数据同源。
- 替换项目画像的回归测试证明渲染器没有鄂州硬编码。
- 主册无 Gate、Revision、Workflow、工作项、完成度、日志、JSON、manifest 和本地路径。
- 每页有明确结论和唯一第一视觉主角，观点型标题比例不低于 80%。
- 产品、空间、运营、投资、实施和甲方决策形成闭环。
- AI 图有“概念示意”披露，来源、时间、单位和测算假设完整。
- PPTX 32—48 页，PDF 48—72 页，HTML 响应式和键盘可达。
- 类型检查、构建、全量自动化测试和新报告合同全部通过。
- PPTX/PDF 全页渲染并完成至少一轮视觉修正闭环。
- 内容产品性不低于 85，苹果式美学不低于 88，无一票否决项。
- 真实 DSH 发布、下载和重启恢复 E2E 通过。
- 旧 Golden 完整保留，新产物目录、manifest、哈希和回滚路径可核验。
