# Structured Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 实现章→节→多条→对应页面、双栏简明审阅及整稿确认后的统一整套排版。

**Architecture:** 扩展既有不可变 workflow 稿件及服务端确认；新纯函数内容模块共享安全结构渲染。新增统一 HTML 页集存储，首轮只允许全部条目，后续固定源稿下按选定页改变版式。

**Tech Stack:** Node 24 / Fastify / PG / 原生 JS / Playwright / 现有真实 DSH 模型。

**Spec:** docs/superpowers/specs/2026-11-04-structured-script.md

## Global Constraints

- 正式 checkout pre-design-web-v210；保留既有变更；不 commit/push。
- 固定 Web4320/DSH3080，生产无 active job 才发布重启。
- 旧稿只读兼容；新稿 formatVersion=2。保留 outline flow、缺口、资料哈希、Core revision。
- 不代用户确认真实稿或生成真实可视化，真实只生成结构化稿。

## Review Focus

- 旧稿/旧条引用不可修改新版；单条修订不可覆盖邻条。
- 缺条、跨节条ID、错误引用、空正文不可保存伪完整稿。
- 未整稿确认、过期稿、首次只选部分页、跨项目可视化都拒绝。
- 备注摘要不删除原始限制；正文/备注独立滚动且不溢出。
- 页序完整且一条一页，局部版式更新不改其他页/主题或源稿。

## Interfaces

- 新模型 JSON blocks:[{id,items:[{id?: canonicalItemId,title,paragraphs:string[],points:string[],evidenceIndexes:number[]}],internalNotes:string[]}]; requireStructured=true时拒绝只有body。单条修订只返回指定block的指定item，ID必须匹配。
- 新模块 workflow-content.mjs：workflowBlockItems(block)（旧body只读归为一条，legacy=true），workflowBodyMarkdown(items)，workflowItemText(item)，renderWorkflowItem(item)（安全HTML），compactWorkflowNotes(record) -> [{kind,title,summary,details:string[]}]。
- parseWorkflowResponse(response,outline,blockId,options={requireStructured:false,itemId:undefined}) 返回 canonical blocks，包含items及派生body；workflowPrompt从job.payload.itemId限制目标。
- /state.workflow.current 增加formatVersion、approval:null|{draftId,approvedAt,approvedBy}、reviewedItemIds；workflow.visuals={current:null|deck,history:meta[]}。
- draft POST增加itemId?；review POST增加itemId?；approve POST {requestId,baseRevision,draftId}；visuals POST {requestId,baseRevision,draftId,baseVisualId?,pageIds?,layout?:'points'|'columns'|'focus'}。首轮只允许全稿；局部更新必须baseVisualId+pageIds+layout，源稿相同。
- deck={id,version,draftId,theme:{id:'pre-design-report-v1',...},pages:[{id:'visual-page-'+item.id,itemId,blockId,number,chapterTitle,sectionTitle,item,layout}],stale,...}。artifact ID workflow-visual-UUID-html。
- UI graphData section新增scripts:[{id:item.id,title,number,record,visual?:page}]；section.script保留旧兼容。图为chapter→section→所有script条→实际visual；无visual不占位。
- workflowRecord(project,block,item?)创建条记录，带blockId、itemId、workflowDraftId、item。预览entry number='章.节.条'，script.id=item.id；所有修改/审阅引用带itemId。

## Tasks

### 1 内容契约与正式汇报（contract agent）
- [x] 新增内容纯模块、结构化JSON严格解析、提示词、条级导出；旧稿兼容。
- [x] 备注聚合/原文保留；单条ID/引用/完整性/转义回归；更新旧API测试模型fixture为新格式。

### 2 预览和操作（UI agent）
- [x] workflow-ui.js/css 与 prototype-api.js：双50%独立滚动、条目预览/引用/修订/审阅、整稿确认、统一生成与页选择版式更新。
- [x] 按接口连接新内容模块与图模块，构建复制新模块；平台下载显示实际页集。只构建staging。
- [x] 旧引用、双栏、未生成无页、整体确认前禁用、条级API请求回归。

### 3 图关系布局（graph agent）
- [x] 节可对应多条，累计占位居中对齐，同级等宽、标题全显；一条一页，仅真实页生成后画出。
- [x] 保留左拖/直线倒角/触控；双击条及页回调，数量/顺序/无占位/字体溢出回归。

### 4 持久化、门槛与页集（root）
- [x] workflow-store、server：formatVersion/itemId合并、条级审阅、整体确认API和幂等所有权。
- [x] workflow-visual-store.mjs、workflow-visual-view.mjs：统一主题整套HTML，部分页稳定修订，下载及陈旧判定。
- [x] 新API回归及浏览器双栏滚动→条级修订→整稿确认→整套生成→单/多页版式→刷新下载。

### 5 发布验证
- [x] 独立review、完整测试、staging构建/浏览器通过后发布固定入口。
- [x] 真实项目生成结构化新稿并检查正文/精简备注/图/刷新下载；V4为15节16条36项要点，保持未确认、无可视化。

Ruling: 用户已给出四项具体迭代要求，沿用授权目录和现有原型直接实现，不重复设计审批；HTML版式页集是本轮可验证的可视化载体，不自动调用图像模型。后续图像内容另按明确请求接入。
