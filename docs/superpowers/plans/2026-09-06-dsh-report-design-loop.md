# DSH 汇报设计闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 DSH 当前 Agent 自行组织汇报、选图补图、提交布局、看真实预览并返修保存。

**Architecture:** 保留 Pre 状态网关和 Studio 的 Canonical/Operational、Proposal、LayoutPageStore 边界。新增设计上下文、受控不可变候选和共享画布预览，并注册 DSH 原生工具。先恢复已部署增量，再实现功能；所有验证先在隔离数据中进行。

**Tech Stack:** Node.js >=24.11.0，ESM，TypeScript，Vitest，node:test，DSH 0.1.1-rc.2，已有 Chromium/Edge；预览控制依赖显式声明到插件。

**Spec:** `docs/superpowers/specs/2026-09-06-dsh-report-design-loop-design.md`

## Global Constraints

- 永远简体中文；同时不超过 3 个子 Agent；仅在与主线程有用工作并行时委派；实现者不得再派子 Agent。
- 不新增 Git 分支，不强推，不使用强制同步；交付补丁同步回对应现有远程分支，并验证源码、包和部署的一致性。
- Reference 原件只读；不重新运行已完成的 57 项，不修改模型或认证配置，不停止 Tailscale。
- 保留全部原成果、草案全文、讲稿、素材来源、批注和审阅历史。
- 所有排版素材先进入当前草案页 pageAssets；未经明确授权不采用候选或覆盖已有布局；保护的 pageId 一律拒绝写入。
- 设计任务不扩大 Pre Gate / Proposal / AutomationAuthorization 权限；图像模型不可用不切换模型。
- 不以 Codex 制作的页面、坐标或样稿作为 DSH 能力测试；从原生图像附件进入 DSH 当前模型的真实调用才算看图。
- 文件编辑用 apply_patch；源码不在正式 node_modules 或生成 vendor 中修改。旧 worker 和 auto-apply 必须保持。

## 工作目录与顺序

- Pre：`C:/Users/2899/Documents/Codex/2026-09-03/pre-design-v2-production-build`，起点 `bb94609`。
- Studio：`C:/Users/2899/Documents/Codex/2026-09-06/presentation-tools-dsh-design`，现有 `feat/report-studio-v0.2.0-layout`，起点 `c207647d046918ffe1bc56a3f37fc4ccfcb96f46`。
- 正式包字节备份：`C:/Users/2899/Documents/Codex/2026-09-06/dsh-design-loop/backups/studio-installed-20260906/package`。
- 基线恢复 → 候选服务 → 渲染 → 主会话工具和设计操作 → Pre 路由与视觉桥 → 端到端验证／发布。
- 本次用户已明确“开始执行，并且要求自行测试”，计划落盘后持续实施，不再次询问执行方式。

### Task 1: 恢复正式 Studio 增量并建立可重建基线

**Files（Studio）：**
- Modify: `packages/studio-dsh-plugin/lib/index.js`, `lib/runtime.js`, `README.md`。
- Create: `packages/studio-dsh-plugin/lib/isolated-worker.js`。
- Modify: 备份中与同名源码不同的 `apps/studio-local/agent-bridge.mjs`, `review-task-runner.mjs`, `public/app.js`, `public/dsh-native-runtime.js`, `public/styles.css`, `packages/studio-core/index.mjs`；以实际 9+1 哈希差异清单为准，不覆盖相同文件。
- Test: `apps/studio-local/review-task-runner.test.mjs`, `packages/studio-dsh-plugin/isolated-worker.test.mjs`, 受恢复行为影响的现有测试。
- Create: `docs/implementation/2026-09-06-deployed-baseline-recovery.md`（无本机敏感信息）。

**Interfaces:**
- Consumes: 只读备份中已部署 JS/ESM，现有分支的 vendor source mapping。
- Produces: 原生 worker 和 ordinary_reversible auto-apply 的可构建同等实现；不得修改其风险边界。

- [ ] **Step 1: 固定差异与基线。** 对比备份中的 `vendor/X` 与源码 `X`、`lib/X` 与 `packages/studio-dsh-plugin/lib/X`，逐项记录 hash；执行 `npm test` 与聚焦布局测试。原有完整测试失败必须先解释原因，不得删除测试蒙混通过。
- [ ] **Step 2: 写出缺失行为回归并观察 RED。** 扩展现有真实 Repository / ReviewTaskRunner 测试。普通可逆 rename 在配置自动应用时实际更新标题、Proposal accepted、ReviewRun closed；高风险候选仍待确认。测试隔离 worker 工具白名单、同一 Session 模型继承、取消与输出 envelope 校验。示例断言：

```js
await runner.start({ sessionId: 'parent-1', submissionId: submission.id, reviewRunId: reviewRun.reviewRunId })
await runner.wait(reviewRun.taskId)
assert.equal(repository.getState().outline[0].title, '第一章：目标')
assert.equal(repository.getState().proposals[0].status, 'accepted')
```

- [ ] **Step 3: 用 apply_patch 恢复已部署源码增量。** 这是找回现有用户实现，不改写或删除其能力；vendor 的相对 import 保持源码路径，打包后由原 vendor 脚本复制。
- [ ] **Step 4: GREEN 与打包等价。** 运行新增聚焦测试、`npm test`；在新安全输出目录执行 `npm pack`，比较打包的生产文件与备份，测试文件／恢复说明不进入包。解释任何差异，未知生产差异阻止后续工作。
- [ ] **Step 5: 独立提交。** `git add` 仅恢复的原始模块、对应测试和说明，提交 `fix: restore deployed review worker and reversible auto apply`，保留差异清单供复审。

### Task 2: 受控设计范围、不可变布局候选与版本保存

**Files（Studio）：**
- Create: `apps/studio-local/design-service.mjs`, `design-service.test.mjs`。
- Create: `packages/studio-layout-core/design-validation.mjs`, `design-validation.test.mjs`。
- Modify: `apps/studio-local/layout-service.mjs`, `packages/studio-contracts/index.mjs`, `apps/studio-local/repository.mjs`, `packages/studio-core/index.mjs`。
- Modify tests: 相邻 layout-service / repository / core gateway 测试。

**Interfaces:**

```js
createDesignService({ repository, layoutService, now })
// Host-only grant; not an Agent tool and not accepted from an Agent payload:
service.start({ sessionId, pageIds, protectedPageIds, allowApply: false, allowVisualGeneration: false, expiresAt })
service.context({ sessionId, pageId })
service.prepare({ sessionId, runId, pageId, baseProjectRevision, baseLayoutRevision,
  baseLayoutSha, sourceStateHash, layout, designIntent, sourceMapping, idempotencyKey })
// -> { candidateId, candidateSha, validation, diff, status }
service.previewInput({ sessionId, candidateId, candidateSha })
// -> immutable { layout, renderPlan, pageAssets, fingerprintInputs }
service.recordPreview({ sessionId, candidateId, candidateSha, preview }) // host renderer only
service.submitReview({ sessionId, candidateId, candidateSha, previewFingerprint, observations })
// -> a pending layout Proposal, or applied only for a valid host grant
service.accept({ sessionId, proposalId }) // user/host-only; exact candidate CAS
service.progress({ sessionId, runId })
```

Operational 持久化的 `designRuns` / `layoutCandidates` 是有限 JSON 元数据；候选内容使用 Repository 不可变 ObjectStore 引用，不将 PNG/base64 存入 Canonical。旧字段缺省为空，旧项目无迁移写入。沿现有 Proposal 结构扩展 layout 类型和 UI 可展示字段；不得假借 draft scope 放入任意布局。

- [ ] **Step 1: RED。** 用真实临时 Repository、正式 fixture 和 LayoutPageStore 测试只读 context 不创建布局；prepare 不改项目 Revision；受保护／跨 Session／跨项目／过期 grant／错误基线被拒绝。示例：

```js
const before = repository.getState().project.currentRevision
const candidate = await service.prepare(validCandidateInput)
assert.equal(repository.getState().project.currentRevision, before)
assert.equal(candidate.status, 'candidate')
await assert.rejects(service.prepare({ ...validCandidateInput, sessionId: 'another-session' }), { code: 'design_scope_denied' })
```

- [ ] **Step 2: 最小实现。** 服务端取得 actor、projectId、pageId、源 hash；明确 null 布局基线与 store 的 -1 初版值映射。持久化幂等键对应请求 hash，同 key 异内容冲突。sourceMapping 覆盖每个 detached 编辑文本且只引用实际当前源；所有 image 只用当页 asset 引用。校验可用 style、frame、父子关系和禁止任意 URL/HTML。正文／脚注字号告警与图件 contain 规则从实际渲染能力返回。
- [ ] **Step 3: 预览／批准绑定 RED→GREEN。** 旧候选 SHA、旧 source hash、未成功渲染、自动检查存在 blocker、越权的 allowApply 均不能发布。观察文本不是权限凭证；actor 从宿主生成。最多三轮自动修订，达到上限进入 needs_review，不删除候选。
- [ ] **Step 4: 原有持久化通路扩展。** 将完整布局候选发布作为 layout-service 的受控方法，复用 preparePage / transactContent / publishPrepared。不要复制整套存储；项目 layoutRef 保持权威，fault 注入覆盖事务发布与索引发布之间的恢复，冲突保留旧页面。设计 Proposal 接受路径不影响原 review worker 的 ordinary_reversible 规则。
- [ ] **Step 5: 测试与提交。** `node --test apps/studio-local/design-service.test.mjs apps/studio-local/layout-service.test.mjs apps/studio-local/repository.test.mjs packages/studio-layout-core/design-validation.test.mjs packages/studio-core/*.test.mjs`；记录 RED/GREEN，提交 `feat: add guarded report layout candidates and review lifecycle`。

### Task 3: 与编辑器共用的真实 PNG 预览

**Files（Studio）：**
- Create: `apps/studio-local/public/layout-renderer.js`, `apps/studio-local/layout-preview.mjs`, `layout-preview.test.mjs`。
- Modify: `apps/studio-local/public/layout-ui.js`, `scripts/dsh-plugin-vendor-manifest.mjs`, `packages/studio-dsh-plugin/package.json`，依赖锁文件。
- Test: 现有 layout UI 行为测试与新 preview 测试。

**Interfaces:**

```js
// Shared by editor and frozen preview; escapes all user text.
renderLayoutElements(renderPlan, { assetUrl, selectedId: null, editable: false })
createLayoutPreviewRenderer({ browserExecutable, timeoutMs: 30000 })
renderer.render({ layout, renderPlan, pageAssets, readAsset, candidateSha, signal })
// -> { png: Buffer, sha256, candidateSha, fingerprint, rendererVersion,
//      canvas, checks: { blockers: [], warnings: [] } }
```

- [ ] **Step 1: RED。** 页面已有 image 和文本时实际 PNG 有正尺寸；错误图片产生 blocker；小文本框的长正文产生 overflow；任意外部素材 URL 被拒绝；相同候选的 editor 与 preview 使用同一渲染输出。几何 fixture 仅限单元测试，不拿它作少潭河 DSH 样稿。
- [ ] **Step 2: 提取真实 renderer。** 移动而非复制 elementHtml 的纯渲染部分，保留 UI 选框、拖拽事件；使用同一 layout.css/fonts/canvas。只支持原有渲染属性；不添加虚假的 fontFamily/lineHeight/crop 能力。
- [ ] **Step 3: 实际浏览器截图。** 显式声明 `playwright-core`（不自动下载浏览器），选择已存在 Edge/Chromium。临时隔离 loopback HTTP 仅提供固定页面和已校验 objectRef 素材；阻止外部网络。等待 document.fonts.ready 与 image.decode，读取 DOM bounds/scrollWidth/scrollHeight，截图画布。退出关闭自己创建的 browser/server，不碰正式 DSH 端口或用户 Chrome。
- [ ] **Step 4: 异常验证。** 取消/超时/缺浏览器返回明确错误且回收自有资源；同源安全、对象 hash、资源加载失败测试；渲染指纹包含字体/画布/renderer 与 candidate/material hash。
- [ ] **Step 5: GREEN 与提交。** `node --test apps/studio-local/layout-preview.test.mjs apps/studio-local/layout-background-ui.test.mjs apps/studio-local/layout-api.test.mjs`，重跑 vendor 包载入 smoke，提交 `feat: render verified layout previews with the editor renderer`。

### Task 4: DSH 主会话工具、设计入口与内容／素材操作

**Files（Studio）：**
- Create: `packages/studio-dsh-plugin/lib/design-tools.js`, `packages/studio-dsh-plugin/design-tools.test.mjs`。
- Create: `apps/studio-local/design-api.mjs`, `design-api.test.mjs`, `public/design-ui.js`, `design-ui.test.mjs`。
- Create: `apps/studio-local/design-rules.mjs`, `design-content.mjs`, `design-content.test.mjs`。
- Modify: `packages/studio-dsh-plugin/lib/index.js`, `lib/runtime.js`, `apps/studio-local/agent-context.mjs`, `public/app.js`, `public/index.html`, `scripts/dsh-plugin-vendor-manifest.mjs`。

**Interfaces:**

```js
registerDesignTools(ctx, { runtime, renderer })
runtime.designFor(sessionId) // resolves same Session workspace repository
// Native tools: studio_get_layout_context, studio_prepare_layout_candidate,
// studio_render_layout_preview, studio_submit_layout_review.
// studio_get_context accepts scope=design without requiring a ReviewSubmission.
// Existing submissionId path and studio_apply_commands schema remain compatible.
// Host HTTP: /report-studio/api/design/start, /context, /progress, /accept.
// start creates the grant from a user-selected page scope and protection list;
// Agent tools cannot call start/accept or supply allowApply themselves.
```

- [ ] **Step 1: RED。** 真实插件注册定义可调用，缺失 agent/session 报错；跨 Session grant 被拒绝；设计 context 不隐式 ensure；不支持 image 的当前模型明确拒绝视觉验收；支持图像时 output.render 返回真实 image attachment 而不是 JSON base64。断言：

```js
const blocks = previewTool.output.render(args, output)
assert.equal(blocks.find(block => block.type === 'image').attachment.id, storedImage.id)
assert.equal(blocks.some(block => block.type === 'text'), true)
```

- [ ] **Step 2: 工具与主模型连接。** 使用 `attachments.saveImage` 与 DSH 当前 agent.session 的模型解析，复用原生 read_image 的模态检查；所有项目路径只来自 runtime.repositoryFor/session header，不让模型传路径。工具暴露足够的 layout schema 与真实 source payload，不能只返回标签。
- [ ] **Step 3: 入口与批准 UI。** 最小设计面板选择页范围、保护页、是否自动应用／允许补图；提交按钮走 host start，随后复用现有 DSH prompt bridge 提交设计请求，不改用户旧输入。预览候选、待确认/失败和保存结果可见，human accept 通过权限+CAS；编辑器 opening 不启动任务。
- [ ] **Step 4: 内容整理与素材。** 沿现有 Proposal 命令新增保留来源的页面合并／拆分与素材关联，不要求批注才能启动明确授权设计任务。新语义页使用新 ID，保存原页来源和讲稿，批注历史不删除。已登记项目素材精确挂当页；导入已采用视觉候选使用 object store 和 manifest 事务，不调用强制 Pre 同步。设计规则通过实际工具上下文返回，讲稿/未上版内容覆盖清单与进度聚合由持久记录得到。
- [ ] **Step 5: 测试与提交。** 真实临时仓库做命令、rev 冲突、手工保护、媒体引用、standard export 合同检查；执行插件 host/runtime 测试、design-* 测试和 `npm test`，提交 `feat: connect report design tools to native DSH sessions`。

### Task 5: Pre 汇报任务路由与现有视觉服务桥

**Files（Pre）：**
- Modify: `src/prompts/preplanning-system.ts`, `src/tools/register.ts`, `src/index.ts`, `src/presentation/page-visual-fill.ts`。
- Create: `src/presentation/design-visual-bridge.ts`, `tests/design-visual-bridge.spec.ts`, `tests/report-design-runtime.spec.ts`。
- Modify: `tests/host-apply.spec.ts`, `tests/built-package.spec.ts`（只调整真实工具注册契约）；`docs/presentation-material-registry.md`。

**Interfaces:**

```ts
// Host-to-host service; page context is read and verified by Studio, not a raw file path.
interface DesignVisualBrief {
  projectId: string; studioProjectId: string; pageId: string; sourceStateHash: string;
  sourceObjectIds: readonly string[]; title: string; keyMessage: string;
  prompt: string; style?: string; requestId: string;
}
// ctx.preplanning.designVisualBridge is capability-versioned and reused by Studio.
// generate(parentAgent, validatedBrief, signal) -> candidate identity + image bytes ref
// adopt(validatedCandidate, hostAuthorization) -> adopted identity + provenance
```

- [ ] **Step 1: RED。** 固定请求 dedupe、来源/项目不匹配拒绝、旧页 hash 不生成、cancel 不采用、生成失败不重写页，canonical finding 旧命令行为不变。外部真实模型仅在宿主 E2E 调用，单元测试 mock 最低层付费生成，不 mock 页面验证和持久幂等。
- [ ] **Step 2: 桥接实现。** 复用 PageVisualFillService/VisualAgent 的模型、存储、去重、恢复和视觉治理；提供 current Studio page brief 模式，沿真实来源取得工作项归属，无法映射则明确缺口。主 Agent 只能请求候选；采用走宿主核验授权的 Studio Proposal。跨插件失败保留 adopted_unlinked 重试，不重复生图。
- [ ] **Step 3: 任务指令。** Pre 工作项只能 nextWorkflow、nextWorkflow=null停止的规则限定到工作项；明确报告设计任务走 Studio context/tools，未请求不自启。事实/Gate/模型/unknown 约束原样保留。规则随最终 bundle 加载。指令效果由 Task 6 的 DSH 行为测试验收，不以 grep 文本冒充效果测试。
- [ ] **Step 4: GREEN。** `pnpm exec vitest run tests/design-visual-bridge.spec.ts tests/report-design-runtime.spec.ts tests/presentation-page-visual-fill.spec.ts tests/host-apply.spec.ts --maxWorkers=1`；`pnpm typecheck`；`pnpm test`；`pnpm test:built`。
- [ ] **Step 5: 提交。** `feat: route report design and visual requests through DSH capabilities`；不修改原57项成果或生产模型配置。

### Task 6: 自行进行隔离宿主测试、复审与正式交付

**Files:**
- Create（Studio）：`scripts/verify-dsh-design-loop.mjs`、相邻 test，`docs/implementation/2026-09-06-design-loop-acceptance.md`。
- Create（本机证据）：`C:/Users/2899/Documents/Codex/2026-09-06/dsh-design-loop/acceptance/` 下运行记录、摘要、hash；不提交秘密、用户私有原资料或未经脱敏的完整聊天。

**Interfaces:**
- Consumes: 两个最终构建 tgz、原配置模型、隔离 workspace/session/project。
- Produces: 自动化结果、真实 Agent 工具链记录、真实预览与保存 hash、正式包/源码/远端对照。

- [ ] **Step 1: 构建验证。** 两仓全量测试、合同、包导入、diff --check；检查 tarball 含共享 renderer、规则、工具与 worker。验证包 source commit/hash，不升级无关依赖。
- [ ] **Step 2: 隔离 E2E。** 复制少潭河冻结成果到独立目录并映射 projectId；保留当前源文案及来源，删除仅测试副本中需重新设计的现有 layouts 也必须通过受控 API，不能删正式页。新建独立 DSH Session，继承原模型设置，授予明确页范围，使用自然语言而非预制坐标运行。
- [ ] **Step 3: 验证真实行为。** 查看实际 tools/attachments，完成读成果、合并/保留理由、选图或 DSH 生图、挂当前素材库、布局候选、预览图片、至少一次返修和保存；刷新后 hash/版本吻合。保护页 bytes/hash不变；source/讲稿与审阅历史仍可回读。视觉模型不可用如实记失败，不代做页面。
- [ ] **Step 4: 独立代码复审。** 对本轮完整 diff 作最终审阅；解决阻断缺陷并重跑对应 tests。任何未通过的必要 E2E 阻止“功能完成/正式部署”结论。
- [ ] **Step 5: 备份并部署。** 正式配置和数据快照完成后安装验证过的包，仅重启确认的 DSH Node。先验证正式工具注册和已授权的小范围，不自动替换所有既有页面；不发送旧聊天草稿。
- [ ] **Step 6: 远端一致性。** 分别推至既有 `feat/pre-v2.0.0` 和 `feat/report-studio-v0.2.0-layout`，有新远端更新先保留并正常整合，禁止 force。核对 ls-remote 与 HEAD、tarball hash、安装文件清单，写最终结果；标明每个未完成环节。
