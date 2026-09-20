# 对外汇报文案与规整版式修订验收

## 实现范围

开发目录为 `E:\前期策划开发`，分支 `feat/pre-v2.0.1`，原 HEAD `6d77306a6229c44419cf3bcb5d8a7a976e24711b`。保留既有未提交修改；本轮未提交或推送。

旧 r103 成果包含生成规则与一次性人工审读。本轮将用户提出的五项要求落实到可复用代码，不依赖再次人工改成品：

- `manuscript/client-copy.ts`、writer/editor prompts 和 validation 共用对外文案要求。新稿拒绝材料解释性说明；旧缓存仅迁移呈现副本，原图注存入独立资料依据。具体实施条件保留，不将方案写成已建成事实。
- `regular/layout.ts`、`regular/plan.ts` 生成统一 16:9 物理页。HTML、PDF、PPTX共用页序、内容分片、图片框与表格。支持满背景、左右/上下半幅、横排/竖排多图；续页不重复铺图。A3 尚未实现。
- `regular/render-html.ts` 提供单页、页码、章节跳转、键盘及全屏浏览。PPTX保留可编辑文本与表格，照片按原比例裁切，图解与地图保持完整。
- `presentation/manuscript-diagrams.ts` 使用 SVG 自动布局、连线避让、紧裁画布和统一字体。节点/边及证据身份保留，无可见制图说明。
- `report/case-studies` 独立保存真实项目证据与照片、匹配规则及指纹。每轮要求 3–5 个已建成或运营案例，每案至少两个有依据的共同点；证据不足明确报错。当前内置库覆盖茶旅、水岸、慢行、旧房活化，不是通用联网检索引擎。此次采用安吉观景平台及茶室、松阳大木山茶室、天湖小舍、日月潭向山段自行车道。
- formal 与 conditional 导出均接入同一新布局。正式边界、专业图、证据和身份检查保留；新布局不沿用旧固定页数与纯文字页限制。
- 旧章节及编辑检查点在内存迁移并保留原指纹。损坏缓存返回明确错误，不因图注规则变化重复派发模型。

## 部署前验收

- `pnpm test`：165 个测试文件、1184 项测试通过，含版本/契约检查、完整构建及 built-package 检查。
- `pnpm typecheck`：通过。专项回归107项通过；旧版式测试更新后的7项通过。首次全量检查的3条失败均为已被新要求替代的旧版式/图注断言，保留日志 `work/regular-full-first.log`。
- `work/regular-report-preview`：HTML/PDF/PPTX均125页、16:9；43项资产全部呈现，含封面复用共44次。
- 跨格式检查：19处照片正确裁切，25处图解为contain；660个文本框、459个表格单元格与页计划逐项一致；可见禁语、遗漏和PDF越界均为0。
- PowerPoint 16 实际打开并渲染125页；文字框及459个表格单元格未检出溢出。
- 四案例位于第42–45页，每案图文与两个共同点同页。长表格、长正文仍保留全部内容并按可读字号续页。
- 原稿 SHA-256：`8dab750be4caaad992bdd45bd5eaae06ca7e2720de237b59dbeffee24ed7750c`。部署前revision为103，57项专业工作流均confirmed，无活动子任务。

主要回执：`work/regular-cross-format-audit.json`、`work/regular-report-preview/pdf-qa-final/inspection.json`、`work/regular-report-preview/office-qa-final-tables/office-inspection.json`、`work/regular-full.log`。

## 原生部署与交付

候选包：`work/release/regular-20260918-32c1e7302b6b/architectureworld-dsh-preplanning-agent-2.0.1.tgz`。

包 SHA-256：`32c1e7302b6bc84cd0506c6500f8a164377c870f6bea30c8a22fa8be33b120ed`。

备份：`C:\Users\2899\.dsh\backups\regular-deploy-20260918-124318`。安装后176项代码文件哈希相符，7项配置/资料保护检查均未改变。DSH原生进程已重启。

实际执行 `/preplan-export` 成功生成 `conditional-269f54ba-1f03-4ef6-bff4-2bc4a7eff2a8`，composition 为 `planning-manuscript-2026-09-18.5`。原始资料仍保留其法定边界/证据状态，本轮没有将其改成通过正式边界审核的材料。

- 原生三格式均125页。正式下载的PDF逐页可见文字与审阅预览相同；禁语匹配、正文遗漏、越界为0。实际PPTX再次由PowerPoint渲染，125页及459表格单元格无溢出；44图片引用及19处非零裁切均符合计划。
- 浏览器实测：一次仅显示一页、44张图片引用全部加载；前后翻页、方向键、Home/End、实际键盘输入页码、章节选择、刷新后的hash定位、原生全屏进入和退出均通过。未留下全屏状态，控制台错误0。
- HTML、PDF、PPTX、文案Markdown、独立资料依据的HTTP下载均200，5份内容哈希与原生包一致；本地交付副本哈希一致。
- 导出前后子任务执行记录数均273，ID集合一致，本轮新增模型调用0；revision仍为103，57项已完成专业工作流没有重跑，原稿SHA未变。
- 旧成果文件保留。新交付：`D:\shaotanhe\成果汇报\2026-09-18-r103-v2`。

原生回执：`work/regular-deployment-receipt.json`、`work/regular-live-delivery.json`、`work/regular-live-artifact-verification.json`、`work/regular-live-office-qa/office-inspection.json`。
