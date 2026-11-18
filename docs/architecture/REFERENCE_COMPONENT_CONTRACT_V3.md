# 局部文字组件契约（显式启用 component-bound-v3）

既有任务的阶段输入与检查点必须保持原契约版本。只有 payload 中对应 archetypeId 显式选择 `prototypeContractVersions: {"archetype-id":"component-bound-v3"}` 时使用新增角色约束；未启用的任务不宣称已经升级。

- Profile 的 `roles` 可包含 `text`，`capacity.textBlocks` 声明实际独立文字块数。Design Spec 的 content-slot 可用同名角色。
- 每个 `text` 槽必须有唯一 `binding`，绑定项目 `item.textBlocks[].key`；`purpose` 为 label/heading/subheading/body/conclusion。不得用全页 title 或 source 充当卡片标题。`binding/purpose` 不适用于其他角色，text 不允许 index/range。
- 原型 `contentFitRules` 的 `maxTextBlocks/maxTextCharacters` 应覆盖声明的局部文字容量；不能以删除正文、截断段落或绘制文字路径获得通过。实际原文由用户显式映射，未映射内容仍须保留。
- 可用受控 fontFamily（sans/serif/calligraphic-fallback）、fontSize、letterSpacing、lineHeight、emphasisColor；以本阶段实际 JSON Schema 上下限为准。字体替代是适配，不是原字体提取。表格的 tableDensity/tableGrid/tableColumnWidths 也不证明源表格合并关系已恢复。
- 本链尚未提供自动 PDF 装饰对象目录。不能凭视觉猜测 sha256、对象号或证据类型，不能生成 base64 图像冒称源对象。受控 PNG 资产能力存在但仍需独立提取、筛选和具体使用依据；未知权利默认不共享。
- 阶段 fixture 通过仅验证协议、编译与内容留存，不验证远端模型识别质量；真实视觉质量仍以原页对照及用户判断为准。

本说明不注入旧任务的共享 skill/prompt；保持既有阶段检查点输入。后续启用通用自动化版本时须显式版本化提示与迁移。

## 新上传接入（后续实现）
新建 native-v3 文档会话由服务端入队时持久记录 `referenceComponentVersion:1`，以该版本选择 component-bound-v3 并补充 Profile/Design Spec/原型提示。旧会话和失败重试继承已存版本（缺省仍是旧契约），不按当前日期推断升级；老任务的共享 skill 与阶段提示保持不变。

PDF 上传解析增加私有原生图像清单：采用 Poppler `pdfimages -list`，绑定源 SHA、页码和页内稳定序号，仅输出原生对象的尺寸和主体对象身份。mask/smask 行的对象号属于关联主体，不冒称遮罩对象号。续读以分页记录合并；目录缺失明确 unavailable。模型每个实际参考页最多接收 32 个候选元数据，并披露省略数量，默认无选中资产、无共享权限。不包含原生对象像素，不是自动装饰抽取完成。

新版本编译自动保留被 Profile 引用的受限图像观察事实（每版式最多 10 项），以来源 SHA/页码/事实 ID 显示，统一标记“未逐项核对”和“编辑能力待核对”。它不是模型视觉分数，也不将图像观察冒称原生文字、矢量或 OCR。原件业务文字不进入此清单。实际原生字体、文字坐标与对象像素提取、装饰/业务内容筛选和逐项授权仍待实现。

续轮重新分析记录 `matching-archetypes` 策略：匹配的新旧原型保留旧版本，退休 ID 只记录审计而不再约束新 Profile；未匹配的新原型采用该任务默认契约。旧已持久任务没有此策略时仍沿原严格校验。重试由内部原任务 ID 精确继承版本字段，不取最新一轮版本；这只保证版本选择，不保证重试时会话材料/历史上下文与原任务完全相同，也不承诺原检查点必然命中。公开 API 拒绝注入这些内部字段。

## 组件工作流 v2：前置一致性门禁
一轮已授权真实模型测试暴露：章页 Profile 声明 bodyPoints=2 却无 body 角色；若等最终编译才拒绝，会浪费后续设计调用。因此仅新建文档会话持久化组件版本2，在 Profile 验证之后、coverage/spec/prototype 调用之前检查正容量与角色一致性，并要求 text 角色有正 textBlocks。拒绝不自动删减容量、不改写来源、不自动重试。旧已存 v1/无组件版本任务、会话续轮及其检查点保留原路径；旧版式资源读取也不套用新门禁。

验收收执另外记录模型 SDK 返回延迟、首次活动延迟、返回/失败/取消状态和实际 HTTP 请求数。SDK 返回不等于候选通过结构或视觉检查；没有 usage/金额数据时保持未知。总时限取消明确记录 ACCEPTANCE_TIMEOUT，同时保留 TransportClosedError 等底层类型；普通传输失败不能反向推断成超时。此诊断增强未追加真实调用。

2026-11-17 真实测试范围仅原 PDF 第5/13/15页：观察缓存复用，5个新阶段调用、8次HTTP请求，15分钟边界后 prototype-2 取消；无完整候选、无几何/视觉验收、无生产资源写入。该结果不是成功率估计。此后新增门禁仅用确定性回归验证，尚未重新进行真实模型测试。

### 2026-11-17 bounded-run latency investigation (no new model calls)
Read-only inspection of the existing private DSH session events establishes all three primary-to-fallback switches as HTTP 504 / SERVER / provider timeout, not local Codex invocation. Primary failures took 47.577s (profile), 47.538s (coverage-map), and 49.887s (prototype-2). Profile fallback then occupied 498.791s; coverage fallback 31.526s; design-spec primary 127.396s; prototype-1 primary 23.799s. Prototype-2 was disposed when the shared 15-minute acceptance budget expired, not proved to be an independent provider timeout. This is one historical run, not provider reliability statistics.

The previous receipt reader ignored persisted `assistant/attempt.stream[].chunk.finish.reason.failure`, explaining why successful fallback executions incorrectly had `failure:null`. Receipt extraction now retains only bounded error codes/HTTP status/category and per-request elapsed intervals, never failure messages, request IDs, prompts, or partial answers. Missing end events remain unknown, not zero. Old checkpoints are not rewritten.

Next real verification must be coordinated before calls: reuse authorized PDF pages 5/13/15 and eligible checkpoints, no whole-document expansion; validate the new profile consistency gate first and stop on failure rather than silently correcting or retrying. A separate primary health probe and a full visual-quality trial are different experiments and must not be counted as one successful extraction. No model defaults, account configuration, or production runtime timeout policy changed in this diagnostic patch.

### Offline component observation/mapping preparation
`reference-components.mjs` is a validation/audit primitive, **not yet connected to new uploads or a model prompt**. Existing workflows/checkpoints and model call counts remain unchanged. A page's image-observed components carry only source SHA/page, local ID, typed role, normalized rectangle and optional group linkage/purpose. It rejects duplicate IDs, foreign pages, cycles, out-of-bounds geometry and source business text. Separate photos in one card retain separate IDs. An audit rejects mapping two components onto one slot, reports unmapped elements, and never converts structural completeness to visual approval, native editability or sharing rights. Decorations remain unmapped until a separately authorized asset mapping exists.

Versioned integration plan: keep component versions 1/2 unchanged; use a new explicitly admitted version for observations, include version in checkpoint inputs, pass component IDs into prototype mappings, show unresolved items rather than inventing fidelity. Observation geometry is a model claim requiring original-page review, not native extraction.

Next bounded real-test proposal (not executed or approved by this note):
1. Profile-only: original pages 5/13/15, reuse compatible observation cache; one profile stage with existing one fallback, maximum two requests, 180 seconds, 8192 output tokens. Stop on timeout/capacity failure, no automatic repair. Cost unknown unless reported.
2. Only after profile acceptance and separate coordination, one page-15 visual sample: one observation and one prototype stage, approved vision chain only, at most four requests, 300 seconds total, 8192 tokens/stage. No publishing or extra asset authorization. Compare four photos, three card groups, independent heading/body/conclusion, typography/spacing and explicit substitutions.
These ceilings are proposals, not authority to invoke models or alter saved settings. The observed 499-second profile response may exceed the proposed deadline; bounded failure is a valid result, not reason for unlimited retry.

### Profile-only result and page-15 next observation plan
2026-11-17 cloud57b8570/local e491ea7: approved profile-only trial completed in 78.901s overall, 69.576s model interval, one actual primary request, no fallback and no downstream calls. Observation cache reused. Capacity consistency passed (chapter bodyPoints=0); **comparison still images=3 and lacks independent text**. No package, geometry or visual acceptance was produced; usage/cost unavailable. Retain this result rather than repeating profile calls.

Read-only source-page15 inspection confirms four visible photos: two adjacent photographs over the first card, one over each remaining card. Three cards also contain separate headings, smaller right labels, bodies and conclusions; the page has its own title and subtitle. Hand inspection is not an automatic extraction result. Poppler lists source SHA54c097e5a9f706259824cd42dc8a6a76d2fe25312f2d4e3b649231de5dd4926d page15 objects647/648/649/650 as image candidates (323x295,292x297,613x296,616x297), and objects636/638/640 as large masked image candidates. Metadata plus page appearance suggests their roles, but directory ordering alone does not establish an exact object-to-visible-region mapping. Soft-mask owner IDs are not independent photos. Repeated source watermark and original business photos remain private, not approved reusable decorative assets.

Prepared `componentObservationContract` explicitly requires distinct photographs even within one card, separate card heading/label/body/conclusion, no source text transcription, no native-editability or rights claims. Still **not wired into existing/new upload prompts**: a future new component version must have separate checkpoint keys and a tested component-to-prototype map. Offline mapping now prohibits card heading/label/conclusion borrowing page-title/source slots. Unknown visual coverage and decorations remain unresolved.

Revised next experiment proposal: observe original page15 only, one vision-stage call with at most its one configured fallback (2 requests), 180s, 8192 output tokens; no profile/prototype/export. Validate against the source image: four separate photos, three groups, independent local text purposes and normalized bounds; record missing items rather than auto-repair. Native candidate associations require visible-region evidence before acceptance. This next call is **not yet authorized** by the completed profile-only budget.

### Single-page observation result and offline mapping (no further calls)
The separately approved page15 observation completed with one primary request, no fallback: 43.019s model/52.528s total, usage/cost not reported. Schema accepted 37 observations: 4 photos, 3 groups, 21 text elements and 9 decorations. Source-image review supports the corrected four-photo grouping and separate card labels; it does not establish precise typeface, colors, background texture, watermark treatment, native editability or general reliability. This is observation, not a generated layout.

`proposeComponentSlots` validates source/geometry then builds a **non-renderable structural proposal**, preserving normalized observed rectangles separately from explicitly scaled canvas coordinates. The actual page15 trial yields 25 slots (1 page title,20 independently bound local text slots,4 image positions),3 groups. All 9 decoration observations remain explicitly unmapped; paper texture and watermark were not exhaustively catalogued. Style is unknown, content fit not evaluated, visual review pending, sharing false. The private proposal does not replace the deployed earlier hand-assisted candidate. No additional model call, shared asset or business-text transcription is needed for this step.

### Explicit style/geometry adaptation prototype
`component-layout-adapter.mjs` turns a validated observation into native composition slots only with explicit per-purpose styles. All chosen style values are derived adaptation, not newly extracted font/color facts. Table pictures are refused until explicit table content contracts exist. The adapter retains native coverage, contrast, overlap, minimum readable font and content-capacity rejection; it does not shorten input text. Geometry overrides require a known component ID and controlled reason and record original/derived rectangles separately.

Actual page15 private first render had 20 browser overflow findings across short/typical synthetic pages: source title box too narrow for reusable titles and small-label boxes too short for substituted readable fonts. Eleven explicit width/height adaptations removed those findings; real Chrome measured six synthetic pages with zero issues. Screenshot inspected: independent photographs and 20 local text slots render, but original colored bands/card panels/paper texture are missing, photos are synthetic and typefaces substituted. **This is technical fit for those synthetic examples only, not original-page fidelity, actual business-content fit, or general extraction success.** Nine decoration observations and three group backgrounds remain flagged. Neither derived private package replaced the existing user candidate.

### Parameterized decoration and caption regression (2026-11-17)
The private page-15 adaptation now maps nine observed rectangular/diamond decoration regions with explicitly derived palette values, retaining source rectangles and eleven explained readability geometry adaptations. Four image slots remain synthetic placeholders; 20 local text slots are independently replaceable. Six synthetic browser pages had zero measured overflow; a deliberately oversized replacement retained all characters and produced detected overflow. This is not source fidelity acceptance: original photos, paper texture/watermarks and exact source typography are not reproduced. Group semantics still require review.

The proposed image-caption contrast issue was checked against actual V3 rendering, not only the adapter's title/text background loop. Existing V3 CSS gives every figure caption an opaque theme background and muted foreground. A new real-Chromium regression tests full and partial dark SVG coverage with matching dark caption ink; both remain white-backed. A transparent-background negative control is detected. Both browser tests passed in the private CSADI-Linux test directory, with no network/model requests or production changes. Do not extend this conclusion to other renderer versions or remove the opaque caption rule without equivalent contrast validation.

Cloud full suite after decoration implementation: 869 tests, 799 passed, 56 failed, 14 skipped; existing environment-associated failure groups remain, so this is not a full-suite pass.

### Explicit upload integration (work in progress)
Ordinary new uploads remain component version 2. A new conversation can explicitly select component extraction and 1–6 original page numbers from one owned PDF/PPTX/image. Admission validates pages against the stored upload. Worker parsing may fill the existing 30-page extraction cache, but only selected images, page text and file identity reach model stages; unselected document text, native structure and private artifacts are removed from the model-facing reference copy. The original upload is unchanged.

Version 3 performs general observation, per-page components, profile validation, design spec, and per-page restricted style adaptation (5–15 model stages for 1–6 pages; provider fallbacks may add requests). Profile must have one evidence-backed archetype per observed page and exact image/local-text counts. Each page currently supports one main title and at most one complete table. Tables require explicit row/column capacities, not a claim of extracted rows or merges. Unsupported multiple tables stop visibly. No model-authored SVG, permissions, source identity or acceptance receipts enter the adapter. New outputs remain private and have reusable fidelity review records; fonts/colors/geometry adaptations are derived, unrepresented decoration is counted, visual acceptance stays pending.

## Deployment and evidence boundary (2026-11-17)
Explicit V3 trial is deployed at the existing 4320 entry, default OFF; ordinary uploads retain V2. See `docs/superpowers/plans/2026-11-17-component-upload-v3.md` for tested versions, real trial failure and next gated verification. The one authorized real page-15 round stopped at profile; the offline-reviewed profile contract fix is deployed but has not been rerun against a real model. No claim of automatic full-flow or visual fidelity acceptance follows from deployment.
