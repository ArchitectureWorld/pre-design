# Pre Autopilot Quality Runtime Design

## Goal

把 `feat/pre-v2.0.0` 从“Schema 驱动的工作项填充器”升级为“专业方法可执行、质量可计算、异常才人工介入”的全自动前期策划 Runtime。

## Product boundary

- DSH 继续拥有 Agent、模型、Session、Workspace、Subagent 和工具调度。
- Pre-design 拥有专业 Workflow 方法、证据约束、分析结论、质量评审、章节 Gate、汇报叙事/视觉/排版策略。
- Presentation / Report Studio 继续拥有页面、素材、Layout、Renderer、Preview、机械 QA、Persistence、OpenPencil 和最终导出。
- Pre 不新增第二套 Agent Runtime，也不把智能排版逻辑下沉到 Studio。

## Automation target

稳定版默认采用 exception-only review：

1. 普通工作项自动执行、自动自检、自动返工、自动确认。
2. 低质量结果先自动返工，不直接打断用户。
3. 只有外部阻断、重大事实冲突、高风险事项、连续自动返工失败时进入人工局部审核。
4. 人工审核不是正常主链的每步审批。

用户层状态收敛为：

- `auto_pass`
- `auto_revise`
- `needs_human`
- `blocked_external`

内部仍保留 Proposal、Revision、CAS 和完整审计记录。

## Executable WorkflowSpec V2

现有 v0.6 Workflow Contract 继续作为事实源，但 Runtime 必须加载此前被丢弃的规则：

- `input_contract.evidence_policy`
- `completion_criteria`
- `reopen_triggers`
- `forbidden_actions`
- `review_policy`
- `atomic_tools`
- `risk`
- `purpose`
- `missing_data_policy`

Runtime Descriptor 必须把这些字段暴露给 Analyzer、Quality Evaluator、Gate 和 Automation Policy。

第一阶段不要求重写 57 个 Contract；先让现有 Contract 真正可执行。后续可逐工作项增补显式 `method_steps / decision_questions / quality_rubric`，Runtime 对这些字段保持向前兼容。

## Analysis contract

子 Agent 不再只返回 `{ payload }`，必须同时返回结构化质量证据：

```text
payload
qualityEvidence
  completionChecks[]
  evidenceChecks[]
  assumptions[]
  blockers[]
  confidence
```

每条 Completion Criteria 和 Evidence Policy 都必须被逐项覆盖，不能仅输出一句“已检查”。

## Deterministic quality gate

模型的自评不是最终结论。中央 Runtime 使用确定性 Quality Evaluator 计算：

- Schema validity
- Completion coverage
- Evidence-policy coverage
- Explicit blocker count
- Assumption count
- Confidence
- Risk level
- Attempt number

默认规则：

- 有外部硬阻断 -> `blocked_external`
- 完成条件或证据规则覆盖不足、置信度不足 -> `auto_revise`
- 高风险工作项或达到自动返工上限 -> `needs_human`
- 其余满足阈值 -> `auto_pass`

不得因为 JSON Schema 合法就视为专业质量合格。

## Automatic revision loop

Automatic 模式的单工作项执行顺序：

```text
analyze
→ evaluate quality
→ auto_pass ? commit+confirm
→ auto_revise ? feed quality feedback to a fresh analysis attempt
→ blocked_external ? block
→ needs_human ? pending_review
```

默认自动返工上限为 3 次（首次分析 + 最多 2 次修订）。

## Human review policy

现有 `human_review_mandatory` 在 manual 模式保持原行为；automatic 模式改为 exception-only policy：

- H 风险默认进入 `needs_human`；
- L/M 风险在质量通过后允许自动确认；
- 用户可通过自动化授权缩小 workflow/gate scope；
- 自动化授权不能跳过质量检查、证据约束、Revision/CAS、来源记录。

这是一项有意的 v2 Runtime 语义：用户对整段自动化的授权替代逐工作项重复点击，但不替代质量门和高风险例外审核。

## Gate V2

Gate 不再只统计 required objects 是否 confirmed。Gate Evaluation 必须同时检查：

- required objects 已完成；
- required workflow 最近一次 Quality Report 为 `auto_pass` 或已人工确认；
- 无 `blocked_external`；
- 无待处理 `needs_human`；
- 无相互冲突的质量原因。

Automatic Gate 只有在上述条件成立时才可依据 AutomationAuthorization 自动批准；否则进入 exception queue。

## No fake evidence

无真实 Evidence 时：

- 可以输出 Gap、Assumption、Verification Needed、方法框架；
- 不得自动制造“高/中/低”、评分、比例、排名、趋势、金额等看起来像真实研究结果的数据。

Legacy report fallback 中的示例矩阵必须退出生产主路径或显式只用于 fixture/demo。

## Presentation convergence

Pre 的生产主链统一为：

```text
Professional State
→ Report narrative / page plan / DesignIntent
→ Presentation Standard Project
→ Report Studio
→ actual preview
→ Pre preview critic
→ Studio revision loop
```

Pre 内部旧 HTML/PDF/PPTX renderer 保留兼容期，但不得继续作为 2.0 的权威最终页面链。

## Quality acceptance

开发完成后至少满足：

1. Contract completion/evidence/review rules 可在 Runtime Descriptor 中读取。
2. Analyzer 输出逐项质量证据。
3. L/M 自动任务在质量通过时自动 confirmed；质量不通过先自动返工。
4. H 风险自动进入局部人工审核而不是整流程停止。
5. Gate 依赖 Workflow Quality，而不是只计数 confirmed。
6. 无 Evidence 的 fixture 不再产生伪数据型分析结果。
7. 目标行为由测试固定，并通过完整 build/test 回归。
