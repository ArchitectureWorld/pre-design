# 当前 Web 版式成果与旧冻结导出链

2026-11-18只读核对，旧PR#1/0a0ccbec 与当前代码。历史验收不作为当前真实项目可用证据。

- 旧 `FrozenProjectInput(projectId,revision) → ReportDocument → HTML/PPTX/PDF` 冻结项目事实、章节和采用素材，不冻结今天的 Native layout package / binding revision / renderedHtml。旧验收 Golden PPTX42页、PDF64页，本身不能证明相同页面布局。
- 当前 `src/report/package-service.ts` 有 deliveryContract 时走HTML-only；`complete-planning-html.v3` 合同不能擅自放宽。传统三格式分支仍存在，不等于当前Web选版三格式已打通。
- `workflow-visual-store.mjs` 冻结批准稿、Native页面、binding revision、resolved assets、renderedHtml与hash，当前仅提供HTML下载。不能为了复用旧ReportDocument而将已选槽位重排。
- 已有 `src/report/chapter-production-export.ts` 先在Chrome检查HTML，再用`Page.printToPDF`打印相同页面，核页数并记录HTML/PDF哈希和QA。后续应复用打印/验收基础设施，以冻结Web HTML为唯一页面输入，不重读最新资源。
- 可编辑PPTX需要Native槽位、安全SVG及图片映射的支持合同；旧renderPptx不是现成V3导出器，不承诺未经验证的可编辑或同版效果。

命名保持区分：正文报告PDF、章节报告HTML/PDF、版式库视觉成果HTML。新增选版PDF前必须保存visual ID、binding revision、HTML/PDF哈希、页数与真实视觉证据。
