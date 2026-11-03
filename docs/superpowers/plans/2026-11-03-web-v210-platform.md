# 基于 Pre 2.1.0 的 Linux Web 平台实施计划

> For agentic workers: 按本计划逐项执行，使用 TDD 和完成前验证；相互独立的 Core 兼容与平台策略任务可按 dispatching-parallel-agents 分工，禁止改动其他任务的文件。

**Goal:** 在现有 Web 交互基础上接入 v2.1.0 真实研究核心，交付管理员统一模型、多用户按模块研究、查看及下载成果的候选 Web 平台。

**Architecture:** V0.9 页面与 Fastify API 保留，PostgreSQL 保存身份、项目、模型配置、任务快照和额度；独立 DSH SDK Worker 执行 v2.1.0 的受控研究命令。平台只允许交接清单的 14 项模型，不从旧会话继承 GPT/Gemini。

**Tech Stack:** Node >=24.11.0、DSH 0.2.1-rc.5、既有 TypeScript Core、Fastify、PostgreSQL、原型 HTML/JS、Vitest、Node test、Playwright。

**Spec:** 用户提供的 Linux 交接文档（2026-11-03）及本会话“根据 v2.1.0 进行 Web 版开发”；既有 web/DSH_INTEGRATION_ROUTE_RFC_v0.1.md 的界面与持久化约束继续适用，旧 PS01 范围由本次模块研究扩展。

## Global Constraints

- 业务源码基线 origin/v2.1.0，已核对提交 72de3d2aa0b6665f1e81f88dd81608d03e783f22；已有 Web 改动保存为 d60663e。
- 候选代码目录位于 Development/pre-design-web-v210，分支 codex/web-v210。原 pre-design-web 和正在运行的 4318、3080 服务保持独立；不复制真实项目、会话或凭据。
- 保留原 V0.9 页面布局；模块选择、任务、下载和管理员窗口作为现有业务入口的增量功能。
- 固定 DSH 0.2.1-rc.5，Node >=24.11.0；不得用旧 DSH 服务模拟新版兼容。
- 模型身份为 provider + model，14 项保持各自预算和兼容参数；管理员目录以外的模型不可执行。未验证模型显示待验证。
- 普通用户执行参数由服务端决定，严格拒绝 provider/model/fallbacks/reasoningEffort 等覆盖项。
- 用户归属覆盖项目、资料、任务、下载、事件和模型工具；通用文件/命令工具不得获得跨项目访问。
- 选定模块按原有研究依赖校验，缺口明确显示，不能静默转成全量；局部重做保留其余成果。
- 新任务保存不可变配置与主备链；重启时未知结果不自动重跑；取消、并发和额度由后端控制。
- 不声称未实测模型、图像后端或模块已通过；真实调用仅使用保留范围中已有可用凭据。

## Review Focus

1. 合并新版研究核心丢失 SDK 适配、工具限制或新版事件读取：任务 1 的类型检查和相关集成测试。
2. 普通用户伪造模型参数、管理员身份或跨用户 ID：任务 2/3 的 API 集成测试。
3. 修改配置、并发提交、重试、取消和重启造成快照漂移或重复执行：任务 3 的事务与恢复测试。
4. 选择单模块却执行全量，重做覆盖其他成果，依赖缺失被掩盖：任务 4 的实际桥接与选择测试。
5. 模型工具、路径和下载绕过项目边界，敏感配置泄漏：任务 4/5 的受限工具、文件和响应检查。

## 设计决策

- 用户已要求按 v2.1.0 开发；直接沿用交接架构并继续实施，设计上的可逆细节由开发侧决定。
- 选择独立候选 checkout，原因是原目录正在提供服务；候选放在用户要求的 Development 路径，避免修改运行目录的动态 Worker 代码。
- 复用现有 Fastify/PostgreSQL/界面，暂不做 React 全面重写，以保留已实现的交互。
- 本地用户令牌继续作为认证方式，角色与账号状态落库；不信任请求提供的角色。
- 生图适配器与凭据若未交接，保留登记和明确未就绪状态，不生成假成果或启用被排除通道。

## 任务 1：合并业务核心与 DSH 兼容

**Files:** 根 package/lock/compatibility、src/**、tests/**、scripts/**；不编辑 web/**。
**Interfaces:** 保留 ctx.preplanning 既有服务；增加受控 research.catalog/plan/run/status/cancel 及现有章节报告能力的访问适配，具体桥接由任务 4 消费。
- [x] 合并 origin/v2.1.0，保留当前 SDK Subagent、事件读取、可选 Web 注册修改，解决冲突。
- [x] 对研究、报告新增旧 DSH 调用适配新版，运行 typecheck、build、专业回归。
- [x] 记录确切可调用服务、研究选择参数、进度与终态读取接口。

## 任务 2：模型策略与持久配置

**Files:** web/app/src/model-policy.mjs、web/app/src/platform-store.mjs、web/app/tests/model-policy.test.mjs、web/app/tests/platform-store.test.mjs。
**Interfaces:** MODEL_CATALOG；validatePolicy(input)；defaultPolicy()；createPlatformStore(db, users) -> getPolicy(), savePolicy(input, expectedRevision, userId), snapshotPolicy(), listUsers(), principal(id)。policy={revision, models, routes, limits}；routes 包括 parent/text/web/vision/image/imageLlm，值为 {primary:{provider,model}|null,fallbacks:[]}。
- [x] 先测 14 项身份、禁用来源、独立预算与 Kimi 参数；严格拒绝额外策略字段和无效角色能力。
- [x] 配置以 PostgreSQL 事务 + revision CAS 保存，账号角色落库，明文令牌不落库。
- [x] 保留验证状态，路由仅使用已验证相应能力条目；返回给普通用户的响应不包含模型或凭据。

## 任务 3：服务端权限、任务快照和限制

**Files:** web/app/src/server.mjs、web/app/src/main.mjs、web/app/tests/platform-api.test.mjs、既有 API/恢复测试。
**Interfaces:** /api/me；/api/admin/models GET/PUT；/api/projects/:id/research GET/POST；/api/projects/:id/jobs/:jobId/cancel；任务包含配置快照但不返回给普通用户。
- [x] 先测伪造配置字段、管理员请求和跨用户访问拒绝。
- [x] 每个模型任务事务保存策略、并发/用户额度预留；确定性操作不要求模型就绪。
- [x] 全局并发、同项目串行、取消、幂等、重启未知结果标记与事件恢复。

## 任务 4：研究与成果的真实 Worker 接线

**Files:** web/worker/runtime.mjs、web/worker/web-bridge.mjs、web/worker/build-host-probe.mjs、web/app/src/research-contract.mjs、web/app/tests/research*.test.mjs。
**Interfaces:** workers.call(project,{operation:'research-plan'|'research-status'|'research-cancel'|...})；workers.runResearch(project, selection, snapshot, onEvent)；workers.close(projectId)；workers.run(project,text,onEvent,snapshot)。
- [x] 公开业务目录/前置条件，显式选择 moduleIds 和条件 flags；调用原有命令，读取真实终态，不把“任务已启动”视为完成。
- [x] Worker 仅装配本任务允许的模型和主备，配置固定；允许范围外、能力未就绪直接失败。
- [x] 禁止 Bash/任意文件工具；资料读取和研究路径绑定到当前项目，不能访问其他项目。
- [x] 复用现有章节合成与报告生成，安全下载；无法生成的图像或报告显式说明原因。

## 任务 5：页面接通、实机验证及交付

**Files:** web/app/src/prototype-api.js、独立增量 platform-ui.js/css、build-prototype.mjs、管理员页面、README、VERIFICATION 与浏览器测试。
- [x] 模块选择、条件缺口、任务进度/取消、局部重做、成果下载；普通用户无模型设置。
- [x] 管理员 14 项目录、能力状态、角色主备、版本冲突、限制和运行记录。
- [x] 原型布局回归、两个用户+管理员 API/浏览器测试、Core typecheck/build/test、Web build/test。
- [x] 独立候选端口和数据库验证；记录真实模型/图像可达性、部署方式及回退路径。

## 执行记录

- 2026-11-03：原仓库已获取 v2.1.0，源 checkout 未修改；候选目录保留所有已跟踪及非忽略未跟踪 Web 修改，不复制 .local/ 凭据和业务数据。


## 验收收尾与边界

- 用户追加要求“不能有特定项目内容”：生产默认提示词、案例、标题和导出已通用化；数据缺口明确显示，测试样例只保留在 fixtures。
- 补充真实图片上传和章节委托入口、阶段预检、Core 共享目录解析，修复取消终态竞争和 unknown 条件消耗额度。
- 模型 text 主备链必须支持 structured_output 所需工具能力；有图的文本调用额外核验视觉能力。
- 候选平台业务代码和本地/浏览器验证完成情况以 web/app/VERIFICATION.md 的最终证据为准。
- 未完成：允许模型真实接入、独立网页搜索和图像生成适配、完整报告质量及生产切换验收。已登记和离线协议通过不代表真实能力已验证。
