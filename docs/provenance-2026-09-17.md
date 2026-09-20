# 候选来源完整性校验（第七轮）

## 已复现的问题

中央提交只验证候选 Schema；嵌套 evidence_refs 的来源版本、指针、哈希及显式推断分类未做程序核对。Project State provider 将上游所有字段标为 source_conclusion / A，继承的假设可以被计为权威证据。

本轮实际 PG03@70 有五处数组 ID 被当作 JSON Pointer 索引。PG06@72 有七处同类错误，另有字段标签代替指针、引用 missing 来源却标 source_conclusion；新校验只读审计共发现 PG03 五处、PG06 十六处。证据：work/cycle7-live-provenance-audit.json。旧版当前仍能接收这些结构符合 Schema 的候选。

## 代码范围

- 新增 src/research/project-state-provenance.ts，遍历候选嵌套 evidence_refs，识别 Project State 引用，校验同项目现存对象、精确当前 revision、RFC6901 指针、提供的内容/片段哈希及选中范围和祖先的显式 missing/assumption/agent_inference 分类。外部文档 edition@1 不误判为内部对象。
- AutomationWorkflowCommitter 在预检和最终提交均执行校验；未解决 workflowRun 和 pending 修订 journal 的对象不可作为来源。提交时重新读取当前对象，保留原质量、Schema、授权、Revision/CAS 路径。
- 复用可信 Research evidenceId 时同时约束来源对象、版本、内容哈希、selector，防止更换来源而保留原证据 ID。
- ProjectStateResearchProvider 默认选择根 JSON Pointer，统一整对象片段哈希；选中字段及其祖先显式标明的假设/推断不会被提升为来源结论或 A 级证据。未选中的兄弟字段不污染分类。
- 独立 Research 质量计算不把假设/推断计作高权威或 A 级来源；对旧 EvidenceRef 契约将 inference reliability 映射为 unknown。
- 来源错误进入现有最多两次结构纠正通道，反馈精确路径。子 Agent 提示包含数字数组索引、版本与推断分类约束。不会静默把数组 ID 换成猜测索引，也不自动删除引用或补造哈希。

## 回归与审查

首轮三个测试文件15失败6通过，覆盖旧行为确实放过非法引用及提升推断。第一次修复后30项关联测试通过。Astra low发现证据ID改绑、整对象哈希、pending修订窗口三处问题，新增5条回归先失败再修复。另有外部版本误分类回归先失败再修复。最终关联及全量测试、部署、真实运行记录追加于下方及监督日志；不把测试通过称为正式模型验收。

## 明确边界和剩余问题

本校验能证明结构定位和版本/哈希一致，不能证明引用在语义上支持结论、单位/计算正确、文件具备法律效力。分类继承依据显式字段与选中范围，不宣称已经验证全部跨对象传承或识别只写在自然语言中的假设。外部原件的语义及来源登记仍需相应来源校验与审查；未提供的 quote_hash 不伪造。

本轮独立监督发现 PG03@70 的500人次/日×20L/人次·日×0.001应为10m³/日，结果却写0.8–2.5，PG06又继承该数值；“干湿分离”没有可复算数值折减。公式变量名不一致；20L定额标official_standard却引用DG01定性严重性字段。停车30位虽在文字中是设计假设，关联引用未形成agent_inference证据链。它们须通过正式内容修订重开来源与下游，并再次验收；此次路径校验不宣称自动发现或解决这些算术、语义问题。

正式报告的人签认边界残留尚未修复。WORKFLOW_REVISION_INCOMPLETE发布保护保持。没有真实HTML/PPTX/PDF验收前，不宣称报告交付。

## 首次部署与实际验证

15:16:02安装1eb202e71820a3916ac404ae656a4e44144b1ebe5d5b2114f523f81c415959b8，146文件957项通过；打包后Host6项通过。备份和部署回执见work/supervision-cycle7-provenance-deployment-receipt.json，配置/凭据/业务存储七项哈希均不变，新宿主61192。通过正式/preplan-revise --source PG03,PG06重开21项，保留旧版本及120次授权历史；13项旧完成回退，未修改正式JSON。恢复原session后PG03子会话880c298a-2be6-47e8-8e6b-d632946623c9实际Gemini，15:21:24首轮通过并提交revision83，实际提示包含本轮审查意见。通过路径校验不等于算术或来源语义已验收。

## 同轮补充修正

旧部署08.01子会话于15:09:28因max-tokens结束，193.759秒，非超时，无structured输出或传输错误。其IM01分析提示481,120字符，上游8个对象部分436,485字符；完整保留字段仅去缩进后274,122字符，减少37.20%。新补丁将上游JSON改为紧凑序列化，并对max-tokens保留明确拒绝，附输入/上游字符统计；不提高用户模型限额、不采纳截断内容、不自动盲重试。字符减少不能证明token同比减少或保证不再达到输出限额。

复核同时发现显式missing若作为EvidenceRecord返回，会被旧独立验证器当成完整性错误，从而阻断条件研究。新补丁对此返回空证据集，让该数据点保留为coverage gap；不将未知伪装成已支持证据。新增missing gap、完整字段保留/体积、输出截断拒绝三项回归均先失败后修正，33项关联测试和类型检查通过。最终r2部署与全量结果以监督日志和回执为准。
