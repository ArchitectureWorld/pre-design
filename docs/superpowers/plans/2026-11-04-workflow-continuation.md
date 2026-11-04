# Workflow Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 把已确认章节的阶段初稿生成、预览、修订、审阅与下载串通，并运行真实五章项目。

**Architecture:** 新增只读 workflow 任务和独立版本化阶段稿存储，复用任务队列、真实活动、原型预览和资料读取。逐节内容对应既有 outline-章节-序号 ID，不改变专业 Core 或其门槛。

**Tech Stack:** Node 24 / Fastify / PostgreSQL / DSH SDK / 原生 JS / Playwright。

**Spec:** docs/superpowers/specs/2026-11-04-workflow-continuation.md

## Global Constraints

- 固定 Web 4320 / DSH 3080，生产任务空闲才重启。
- 保留 V6 已确认顺序 01、03、04、02、11 和用户跳过的四项资料缺口。
- 独立不可变阶段稿，read_only=true，禁止伪造依据、专业批准或 Core revision。
- UI 保持原型、短文案；按需显示来源和限制，不加长篇操作说明。

## Review Focus

- 请求重试、旧稿修订和资料变化不能覆盖新版或复用旧审阅。
- 跨项目/用户读写导出、路径/HTML注入、任意章节/引用编号都必须拒绝。
- 模型只返回部分任务、未知引用或错误结构时明确失败，不保存伪完整稿。
- 修订只替换指定块，其他内容保持；跳过与限制由服务端继承。
- 刷新后的稿件/任务/下载一致；真实调用与模型替身验证明确区分。

## Task 1: 阶段稿契约与存储（主代理）

- [x] 新增 workflow-store.mjs，表 workflow_drafts/workflow_reviews。
- [x] createWorkflowStore(db) 返回 current(p), prepare(p,outline,body), prompt(p,outline,job), save(p,outline,job,response), review(p,outline,body,userId), listArtifacts(p), readArtifact(p,artifactId)。
- [x] POST body: requestId,baseRevision,outlineVersion,baseDraftId?:uuid,blockId?:string,text?:string。首轮无baseDraftId，修订需baseDraftId+blockId+text。
- [x] /state.workflow={current:document|null,history:metadata[]}。document={id,version,outlineVersion,inputHash,jobId,createdAt,flow,blocks:[{id,chapterId,taskIndex,title,body,internalNotes,evidenceIndexes,limitations}],evidence,limitations,reviewedBlockIds,stale}。
- [x] blocks ID 沿用 outline-01-1，taskIndex从0开始；title来自已确认任务而非模型。模型返回 {blocks:[{id,body,internalNotes:[],evidenceIndexes}]}，修订只返回指定块。body为汇报正文，internalNotes为独立疑问/待核备注。
- [x] 服务端固定保存来源/条件/跳过限制；导出HTML/Markdown。

## Task 2: API 与任务执行（分工代理）

- [x] server.mjs 新增 POST workflow/draft、POST workflow/review，GET state追加workflow；任务kind workflow；复用队列/策略/进度，worker只读，存储前重核outline与输入hash。
- [x] 现有artifacts GET追加阶段稿，readArtifact前识别 workflow-UUID-(html|md)，跨项目始终校验。
- [x] 适配真实job policy / public errors / cancellation；不改变专业研究就绪检查。
- [x] 独立PG+mock模型验证完整保存、修订、审阅、旧版本保护、取消、权限、导出。

## Task 3: 原型入口与内容（分工代理）

- [x] pipelineBtn “生成本轮初稿”/“查看本轮初稿”；state.workflow.current映射原任务脚本，不伪装Core提案。
- [x] 现有预览显示真实正文、依据、限制、草稿/已审阅；scriptApproveBtn只调用workflow/review。
- [x] 引用阶段稿提交修改走workflow/draft（baseDraftId,blockId,text），不跳回章节编排。
- [x] 平台任务成果接入workflow任务标签及下载；保持已确认流程、原型布局和真实进度。
- [x] 按API contract写定向测试，不自行发布。

### 成果关系图追加要求（独立图模块代理）

- [x] workflow-graph.js/css：按真实章/节数自动布局，消除两节固定offset；同级同宽、标题全显不溢出；折线路径仅M/L/H/V，转角用短斜线。
- [x] 原型接线提供左键平移，拖动阈值防误选/误批注，保留右键；图块按层级自动对齐。
- [x] 生成前无scriptnode/visual占位；生成后仅真实文字脚本，可视化节点默认仍为零。
- [x] 验证五章十五节、长标题、每层同宽、无NaN/重叠/裁字、拖动画布与点击区分。

## Task 4: 整合与真实运行（主代理）

- [x] 隔离浏览器生成→预览→修改→审阅→下载→刷新。
- [x] 对照原资料与任务版本，发布到固定4320，调用当前真实模型生成五章阶段稿。
- [x] 核验正文/来源/缺口、真实浏览器打开与下载；不替用户审阅确认。记录后续语言专项。

Ruling: 用户明确让先走通流程，沿用当前已授权工作目录与现有队列，阶段稿为可审阅产物；不以跳过资料为放开专业结论的理由。无需重复设计审批，不提交或推送仓库。

## 验收结果

348/348 Web 测试及两条完整浏览器链通过。真实 V6 五章十五节生成 V1，首节真实修订生成 V2，其余十四节不变；下载和刷新恢复通过，未代用户审阅。原件四项 SHA-256、确认目录、跳过决定、Core revision 0 保持。详见 `web/app/VERIFICATION.md`，记录了修订任务独立调用收执未记录这一限制。
