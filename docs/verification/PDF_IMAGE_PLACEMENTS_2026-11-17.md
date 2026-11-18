# PDF 图像逐次摆放证据

## 目的与边界

参考提取最终沉淀本人或经授权他人可复用的同一版式库，不止临时对照。当前增量只增加私有、可追溯的 PDF 图像绘制证据，不直接生成/选择/分享素材，不代表源素材已获授权，也不代表视觉完整性或可编辑性验收。

- 复用现有 pdfjs-dist 6.3.289；无新依赖。
- 解码对象引用与绘制次数分开。同一对象可能多次摆放，包围盒不等于裁剪后的可见像素。
- 源指纹、显式 1–6 页范围、变换/页旋转、save/restore、Form；clip、合成状态保持未知；透明组/mask/未知注释变换拒绝。
- 线程隔离、30 秒终止、100 MiB 输入、单图 16M 像素、输出/操作数量限制、单并发不排队。256 MiB 仅 V8 堆限制，不是 RSS/ArrayBuffer 总内存硬上限；操作数量在列表构建后检查。不能宣传完全内存隔离。

## 版本化集成

仅新建显式逐组件任务获得 referenceImagePlacementVersion=1；普通上传和旧任务不升级。已授权上传 download 仍核 owner、原件 SHA。只解析明确选中的 PDF 页。非 PDF 标记 not-pdf，暂忙/不支持/超时明确 unavailable，不捏造空的完整证据。

证据单独置于任务 payload / analysis.nativeImagePlacements，不改变参考文件、模型 prompt/input 或原始响应检查点，不收入可复用包。无额外模型调用。

## 实际核验

合成 PDF 覆盖重复对象、页面与图像旋转、Form 变换、裁剪保存恢复、透明组拒绝、退化变换、源指纹/限额/取消。

原授权业务 PDF 仅第 5、13、15 页，本地约 1.1 秒完成。三页分别记录 2 / 3 / 8 次绘制；以现有原页 PNG 生成 Chrome 边界叠图并逐张查看。第 13 页表格区域与一个图像对象范围吻合，不能称原生表格数据已提取；地图同样为图像区域。第 15 页对应背景、三列卡片范围和四张照片。未从边界推断图片内部文字、遮挡、透明像素、来源权利或全部页面覆盖。

私有本地证据目录：pdf-placements-qa（real-evidence.json、overlay-5/13/15.png）。没有发布素材、修改业务候选或调用模型。

截至集成回归：26 focused 通过；完整 web suite 935 项，863 通过、56 失败、16 跳过。失败仍含 PG socket EPERM、Chromium socket、PDF 第 1/31 页取消、聊天首次滚动、research model-tools 检查等既有失败。不能称全量通过。尚待最终集成复审及本地路由验收后部署。

## 部署收执

最终独立复审 015e6d4 通过，复跑 26 focused 全绿。CSADI-Linux 临时测试 schema 的真实 PostgreSQL + Fastify 上传选页回归通过（受控模型，不是真实模型调用）。部署目标本地 b2bdb592562a3668d423e2da9c575a859033dad9 对应云端 015e6d4。

既有 4320 服务已完成备份、代码与预构建 dist 更新。部署前/停止前/启动后快照对照一致，项目、草案、资料、全部版式版本和模型配置不变。实际 index.html / ui.js / content-adaptation-ui.js 字节 hash 与构建一致。Chrome 实际打开版式库中私有候选 V3 的内容适配预览，待确认且保存禁用，无页面错误；没有保存几何、发布素材或模型调用。

当前新摆放证据仅在私有任务 analysis，尚未有完整独立证据界面。后续继续来源展示、图像形式表格与可编辑重建的区别，不将本阶段当视觉还原总目标完成。

### 来源摘要与表格边界界面部署

云 b84ffea → 本地 9000dbed70127ffec043c6ced822881288ce9efe；真实 PostgreSQL 16 项通过，含 35 个其它选页新任务不挤出目标证据、owner/SHA/page、后端实际摘要→UI 契约。主线程独立复核后部署，配置和数据快照一致。实际 index/review-ui hash 与构建一致，Chrome 真实第13页对照截图确认旧任务显示“未采集”、模板表格明确“重建结构/合成数据，非原稿单元格提取”。未接受视觉审阅、未改候选、未调用模型。全量 948：876 通过、56 失败、16 跳过。

剩余实质问题：三页的照片/地图仍为合成占位；第13页原表格为图像区域，重建表格不等于原单元格数据/合并结构；第15页真实文字仍依赖人工转录，强调样式与原生字体证据不足。下一步优先零模型核对原生文字定位，不能把来源说明当质量目标完成。

## 复制限制纠正与门禁

后续原生文字诊断遗漏权限预检。`pdfinfo` 确认业务原件加密且 copy:no；PDF.js 仍能返回数据，不代表允许提取。该次私有诊断输出已隔离标注 DO-NOT-USE，脚本停用，未进入模型、模板、项目正文或 QA 修正。后续仅允许的页面图像复核；此前原生绘制诊断不作为可复用资产或权限证明。

2a45c25 / b598da7 / 120dda1 增加前置 COPY 权限门禁：任何 getPage/operator 前核验，permissions=null 仅在元数据明确未加密时允许；加密+未知/畸形拒绝。成功结果带 copyPermission=verified，历史缺此证明的证据不可回显为 available。未知权限反例经独立审查修复，真实加密合成PDF、PG历史记录、来源权限等 23 项本地测试通过。

部署本地 06a242e05b6b9fb5cdb1cf9f7634016feee5bc32，对应云120dda1。备份与前后数据快照一致；已部署代码实测原件返回 COPY_RESTRICTED、历史原件证据 not-collected，无原生输出。Chrome 4320 原页对照仍正常，构建hash一致，未勾选视觉接受。零真实模型调用。原件受到复制限制，不能沿原生文字路线纠正试排内容；改用已允许的原页图像核对或由用户提供可提取原件。


## Image-only private reuse QA (2026-11-17, after permission correction)

No PDF or old native-text diagnostic was read. The existing authorized page-15 PNG was inspected, including a 2x crop for quantities, units, and superscript. Image SHA256: `6e3406fbc4b2bfed3123ed89ab11541475ae1e1beba45e159baa8aef8fe58d28`. Fresh manual reading remains unconfirmed, with names/punctuation uncertainty; it is not business fact validation or automated OCR. No model calls.

A private test used the existing content-derived package (file SHA256 `0112a5b1f4978fc75d70bf4f530b0a865113aa616d1ad3bd9c59bad95144e16b`), without changing any production package, project, or service. Actual Chrome results:

- Fresh manually image-read text: 468 text-block characters, no measured overflow/missing assets. Title separate.
- Short synthetic body + image-read labels: 247 characters, no measured overflow.
- Near-boundary synthetic body + labels: 472 characters, no measured overflow.
- Synthetic 517 / 715 characters: existing 480-character gate rejects. No truncation, silent limit inflation, or publishing.

Visual review of the generated screenshots still shows structural differences: the original chapter number/slash and accent-line decoration are missing; ordinary fallback title font is not the brush title; synthetic image captions introduce space absent in the original; conclusions wrap to two lines where original uses a compact single line; orange inline emphasis and bullet markers are absent in this plain-text test. These are not failures of overflow checking, but are failures of strict original-page fidelity. Photos, paper texture, and watermark are not reproduced or authorized for redistribution.

The labels/body fixture is private and separate from reusable packages. No claim that 480 characters guarantees fit for arbitrary distribution: the per-slot browser test remains necessary. The single-page manual result does not validate general extraction. Suggested next substantive step: versioned, source-evidenced rich-text emphasis/list markers and caption policy, followed by short/medium/long substitution with image-only comparisons. Do not shrink or remove content merely to mimic the original.

Local evidence: `/home/zetta/.cache/predesign-resume-300611f/image-only-reuse-qa/` (receipt + three successful screenshots/HTML). The initial receipt-level `bodyStatus` string predates the additional fresh manual case; **per-case `source` is authoritative**, distinguishing the manual image case from synthetic cases. Cloud QA script metadata corrected accordingly; no production change.
