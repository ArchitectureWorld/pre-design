# PPT Master 技术内核化与 Pre-design 原生设计融合实施计划

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. This work updates the existing codex/web-v210 branch; do not create a development branch.

**Goal:** 将 PPT Master 成熟技术内化为 Pre-design V14 的解析/设计生产引擎，并通过 Native Design Compiler 产出 V3 原生版式资源供 V08—V13 调用。

**Architecture:** Vendor 固定上游代码与 Create Template 规则；通过内部 Adapter 进入现有 V14/DSH 工作流；V14 产出 Design Spec 与 SVG prototypes；Native Compiler 将其转换成 V3；V11 通过 SVG-backed slots 渲染，V1/V2 继续兼容。

**Tech Stack:** Node 24, Fastify, PostgreSQL, DSH Worker, Python 3.10+, PPT Master MIT pinned revision, LibreOffice/Poppler, Chromium.

**Spec:** docs/superpowers/specs/2026-11-17-ppt-master-native-integration.md

## Global Constraints

- 主分支目标固定为 codex/web-v210；不得创建新产品或用户入口。
- 上游固定 revision 3af3e8ef774c4d67ee57e1306d9256d08c9ee1bf。
- 保留上游 LICENSE、SKILL.md、SPONSORS.md、SPONSORS_CN.md 和 Attribution Guard；不禁用。
- 不引入 PyMuPDF/AGPL；PDF 继续使用平台 Poppler。
- V1/V2 资源、历史页面和项目绑定必须继续可读。
- 不在共享资源包中保存原件字节、客户内容或原始图片。
- 不改生产端口、模型策略、数据库数据或运行服务。

## Review Focus

- PPTX 关系链含多母版、多版式、隐藏页和跨页顺序时，Manifest 与 SVG roster 必须一致。
- 上游工具缺少 Python 包/LibreOffice/Poppler 时，明确报错并清理，不生成假预览。
- SVG 含 script、foreignObject、外部资源、CSS url 或事件属性时，拒绝编译。
- V3 原型含图片/表格/图表槽位且项目内容超量时，显式拒绝或回到分页规划，不丢内容。
- 资源修改、renderer/compiler 版本升级后，旧 Q05 人工确认必须失效。

---

### Task 1: 架构原则、冲突审计和上游固定基线

**Files:**
- Create: docs/architecture/REFERENCE_DESIGN_INTEGRATION.md
- Create: docs/architecture/REFERENCE_DESIGN_CONFLICT_AUDIT.md
- Create: docs/superpowers/specs/2026-11-17-ppt-master-native-integration.md
- Modify: AGENTS.md
- Modify: docs/superpowers/specs/2026-11-16-v14-reference-design-v2.md (supersession notice)
- Modify: docs/superpowers/plans/2026-11-16-v14-reference-design-v2.md (historical branch notice)
- Modify: docs/reviews/v14-reference-design-v2/README.md (historical review notice)

- [x] 已核对历史规格、计划、Claude评审入口均标注 historical/superseded；AGENTS 指向权威原则。
- [x] 通过当前仓库文件、提交历史与实现逐项对照，建立冲突审计表。
- [x] 架构原则与历史文档提示已在 7ef49ac 提交；当前实现复核追加于 43e5733。
- [x] 架构文档、AGENTS、旧规格提示和当前实现审计均已远端回读。

### Task 2: Vendor 完整上游工具链

**Files:**
- Create: web/app/src/layout-library/vendor/ppt_master/upstream/skills/ppt-master/** (固定上游 Create Template 依赖闭包（215 个原样文件）、SKILL.md、License、Sponsors、Create Template workflows、Template Designer references、Design Spec schema)
- Create: web/app/src/layout-library/vendor/ppt_master/UPSTREAM.json
- Modify: web/app/src/layout-library/vendor/ppt_master/README.md
- Test: web/app/tests/ppt-master-vendor.test.mjs

- [x] layout-ppt-master-vendor.test.mjs 覆盖固定 revision、必需文件、Attribution Guard、MIT与AGPL排除。
- [x] UPSTREAM.json 逐文件 SHA/字节校验由 vendor 测试执行；CI 已通过。
- [x] 215 个必要上游文件已按原路径 vendor，保留守卫与许可证，不在 DSH 自动发现目录。
- [x] CI 运行 Attribution Guard 与逐文件哈希检查通过。

### Task 3: Pre-design 内部 PPT Master Adapter

**Files:**
- Create: web/app/src/layout-library/ppt-master-adapter.mjs
- Modify: web/app/src/layout-library/reference-pptx.mjs
- Modify: web/app/src/layout-library/reference-pptx.py (降为安全入口/兼容包装或移除重复解析)
- Test: web/app/tests/ppt-master-adapter.test.mjs
- Test: web/app/tests/layout-reference-pptx-workflow.test.mjs

- [ ] RED：验证 adapter 调用固定上游 import、--inheritance-mode both，且产出 Manifest、Native Structure、Layered/Flat SVG、authoring summary 和 diagnostics。
- [ ] GREEN：使用固定脚本路径和参数数组、私有 workspace、原件前置校验、超时、取消、输出上限和清理。
- [ ] 用真实上传的测试 PPTX（仅本地私有样本）运行导入；不把原件提交 Git。
- [ ] 对比上游文件 SHA 和导入收执；运行 PPTX 解析器全量回归。

### Task 4: Reference Bundle 与 V14 Design Spec / Template Designer 阶段

**Files:**
- Create: web/app/src/layout-library/reference-bundle.mjs
- Create: web/app/src/layout-library/design-spec.mjs
- Modify: web/app/src/layout-library/reference-workflow.mjs
- Modify: web/app/src/layout-library/reference-profile.mjs
- Modify: web/app/src/skills/layout-reference/SKILL.md
- Modify: web/app/src/layout-library/jobs.mjs
- Modify: web/app/src/layout-library/conversations.mjs
- Test: web/app/tests/layout-reference-design-spec.test.mjs
- Test: web/app/tests/layout-reference-workflow.test.mjs

- [ ] RED：验证 Brand/Style/Layout/Deck 意图、Design Spec 证据、SVG prototype、阶段级失败/取消和不同文件 Adapter 的来源映射。
- [ ] GREEN：将 PPTX upstream artifacts 与 PDF/DOCX/图像解析结果合并为统一私有 Reference Bundle。
- [ ] 增加 design-spec → prototype → upstream-validate → native-compile 阶段；每阶段复用现有 DSH worker、模型策略、队列和收执。
- [ ] 失败/取消时不得产生可发布候选；模型输出不能编造 source page/fact IDs。

### Task 5: Native Design Package V3 与 Compiler

**Files:**
- Create: web/app/src/layout-library/native-design-v3.mjs
- Create: web/app/src/layout-library/native-design-compiler.mjs
- Modify: web/app/src/layout-library/contract.mjs
- Modify: web/app/src/layout-library/reference-review.mjs
- Modify: web/app/src/layout-library/validation.mjs
- Test: web/app/tests/native-design-v3.test.mjs
- Test: web/app/tests/native-design-compiler.test.mjs

- [ ] RED：验证 V3 保留 Design Spec、Master/Layout graph、archetypes、components、slots、prototype SVG、source evidence、rights、renderer/compiler compatibility。
- [ ] RED：验证 SVG 恶意内容拒绝、原件/业务内容不进入共享 package、证据引用必须真实存在。
- [ ] GREEN：实现 V3 strict schema、SVG sanitizer、确定性编译和包哈希。
- [ ] V1/V2 schema、renderer、导出、人工确认保持兼容；V3 资源更新使旧确认失效。

### Task 6: V08—V13 原生消费与 SVG-backed Renderer

**Files:**
- Create: web/app/src/layout-library/svg-native-renderer.mjs
- Modify: web/app/src/layout-library/render.mjs
- Modify: web/app/src/layout-library/skill-bindings.json
- Modify: web/app/src/layout-library/ui.js
- Modify: web/app/src/layout-library/review-ui.js
- Test: web/app/tests/native-design-renderer.test.mjs
- Test: web/app/tests/native-design-renderer.browser.mjs

- [ ] RED：验证 V11 使用 V3 SVG prototype 和声明式槽位，而不是回退到 points/columns/focus；图/表/图表/地图内容绑定不丢失。
- [ ] GREEN：实现 SVG 背景 + 可编辑 HTML 内容槽，安全注入项目素材，支持局部覆盖与人工锁。
- [ ] V08/V09/V10/V12/V13 的输入输出契约更新到 V3。
- [ ] Q07 测真实 Chromium 页面；Q05 仍需用户确认，不能由模型或几何检查代替。

### Task 7: 上游质量工具、导出能力与兼容性

**Files:**
- Create: web/app/src/layout-library/ppt-master-quality.mjs
- Modify: web/app/src/layout-library/validation.mjs
- Modify: web/app/src/layout-library/skill-bindings.json
- Test: web/app/tests/ppt-master-quality.test.mjs
- Test: web/app/tests/native-design-export.test.mjs

- [ ] 调用上游 SVG Quality Checker，并将其结构检查结果映射到 Pre-design validation receipts。
- [ ] 运行上游 Template Preview PPTX；只有实际可打开、页数/母版/版式关系校验通过才声明 PPTX 导出能力。
- [ ] PDF 使用平台已验证 HTML 打印链；保留独立验收。
- [ ] 记录 renderer/compiler/upstream revision；升级后触发兼容性复核。

### Task 8: 集成验收、文档和远端同步

**Files:**
- Modify: .github/workflows/layout-library-verify.yml
- Modify: web/app/src/layout-library/vendor/ppt_master/README.md
- Modify: web/app/src/layout-library/skill-bindings.json
- Create: docs/reviews/ppt-master-native-integration/README.md
- Create: docs/reviews/ppt-master-native-integration/evidence/** (only reproducible receipts/screenshots; no original user files)
- Create: docs/deployment/ppt-master-native-integration/DEPLOYMENT_HANDOFF.md

- [ ] Run Python attribution/adapter checks, Node full Web suite, isolated PostgreSQL, Chromium, build.
- [ ] Use private real PPTX sample for importer validation; commit only hashes/receipts, never source.
- [ ] Run remote CI and inspect logs, not just run status.
- [ ] Review all changes for security/compatibility and correct findings with failing tests first.
- [ ] Commit to codex/web-v210, push via GitHub API, read back exact SHA and verify CI.
