# 前期策划 DSH 插件技术合同 v0.6

## 1. 目标与范围

本合同把已经稳定的前期策划专业母架构转换为 DSH 插件可直接消费的业务接口：57 个 Project State 对象、47 个原子工具、57 个 Workflow、8 个人工 Gate，以及统一的 Proposal、权限、Revision 和审计机制。

本版**不绑定某一版 DSH SDK 的具体类名或传输协议**。DSH Adapter 可以采用本地插件、MCP、HTTP、事件总线或内嵌运行时，但不得反向修改本合同的业务语义。

## 2. 不可破坏的全局约束

1. `Project State` 是唯一业务事实源；HTML、PPTX、PDF、聊天记录均不是事实源。
2. Agent、LLM、Tool 和成果渲染器均不得直接写 Project State。
3. 所有业务变更必须先形成 `ProposalEnvelope`，经 Schema、规则、权限和版本校验后，才生成新 revision。
4. Agent 与 system service 无章节 Gate 业务批准权；Gate 只能由项目中被指派的自然人 `decision_owner` 决定。
5. 硬约束豁免只能由授权范围匹配的 `constraint_authority` 执行，并必须记录依据、期限和受影响快照。
6. 所有写入使用 `expected_revision` 乐观并发；冲突统一返回 `VERSION_CONFLICT`。
7. Revision 不覆盖旧版本。语义变更只重开源对象及依赖图中的传递后继，保留无关确认与全部历史。
8. 专业引擎负责 GIS、BIM、统计、优化、造价和财务等确定性计算；LLM 负责理解、组织、候选与解释，不得伪造计算结果。

## 3. 合同包目录

```text
前期策划_DSH技术合同包_v0.6/
├─ README_START_HERE.md
├─ manifest.json
├─ common/                  # 公共 Schema：类型、Proposal、Snapshot、Revision
├─ state/                   # 57 个状态对象 Schema + bundle
├─ tools/                   # 47 个 Tool Contract + bundle
├─ workflows/               # 57 个 Workflow Contract + bundle
├─ gates/                   # G1—G8 Gate Contract + bundle
├─ governance/              # 权限、命令、依赖图、Revision、运行时接口
├─ tests/
│  ├─ fixtures/valid/       # 57 个合法对象 Fixture
│  ├─ fixtures/invalid/     # 57 个缺必填字段反例
│  ├─ fixtures/GC01—GC08    # 8 个跨项目类型黄金案例
│  ├─ golden-cases.json
│  └─ test_contracts.py
├─ qa/                      # 测试结果与 QA 摘要
├─ docs/                    # HTML 母架构、自检报告、技术合同
└─ source/                  # v0.6 汇总结构化源数据
```

## 4. Project State 对象合同

每个对象均包含统一元数据：

```text
object_id / object_type / schema_version / project_id
chapter_id / work_item_id / status / revision
created_at / updated_at / created_by / source_snapshot
data / approval
```

对象的业务字段全部位于 `data`。Schema 通过 `x-preplan` 扩展记录章节、Workflow、Gate、上游对象、自动化等级、专业风险、语义规则、禁止写入者和标准写入路径。

### 状态对象族

- `PS01—PS07`：项目任务
- `BL01—BL08`：现状事实底板
- `DG01—DG06`：问题与机会
- `OB01—OB06`：目标与方向
- `OP01—OP07`：方案选择
- `PG01—PG07`：功能与规模
- `SP01—SP08`：空间与技术
- `IM01—IM08`：投资与实施

## 5. Proposal 写入链

```text
Agent / Tool Result
→ T41 ProposalEnvelope
→ T42 Schema + Rule + Permission + Revision 校验
→ ValidationReport
→ ProjectStateRepository.commit()
→ 新 StateRevision
→ Workflow 进入 provisional / pending review / confirmed
```

`ProposalEnvelope` 必须包含目标对象、目标 Workflow、`expected_revision`、payload、来源、假设、行为人和不可变 proposal hash。任何未经 T42 校验的内容不得进入 Project State。

## 6. Workflow 状态机

标准主路径：

```text
NOT_STARTED → READY → RUNNING → PROPOSAL_READY → VALIDATION_FAILED / PENDING_REVIEW → COMMITTED_PROVISIONAL → CONFIRMED
```

并行异常路径包括：`BLOCKED`、`REJECTED`、`STALE`、`CANCELLED`。每个命令都明确允许角色、From／To、Guard 和状态效应。

### 核心权限边界

- Agent 可以：读取状态、提交证据、运行工具、创建并提交 Proposal。
- Agent 不可以：校验 Proposal、提交 provisional revision、确认工作项、批准 Gate、批准 Revision、豁免硬约束。
- system service 可以执行确定性校验、合法 provisional commit 和 Revision 应用，但不具备业务批准权。
- 高风险专业对象必须由 `discipline_reviewer` 或指定专业签核人确认。

## 7. Tool Contract

每项工具合同至少包含：

```text
contract_version / tool_id / kind / owner / purpose
execution.mode / determinism / idempotent / timeout / retry
risk / permissions
input_schema / output_schema
preconditions / postconditions
error_contract / observability / state_effect / examples
```

47 项工具全部满足：

```text
direct_project_state_write = false
approve_gate ∈ forbidden
```

## 8. DSH Adapter 运行时接口

### `ContractRegistry.load`

```text
load(contract_id: str, version: str = "0.6.0") -> Contract
```



### `ToolRuntime.invoke`

```text
invoke(tool_id: str, input: dict, context: ExecutionContext) -> ToolResult
```

保证：input/output schema validation；audit log；no direct state write。

### `WorkflowRuntime.command`

```text
command(workflow_id: str, command: str, payload: dict, actor: ActorContext) -> WorkflowEvent
```

保证：state transition guard；role permission；optimistic concurrency。

### `ProposalService.submit`

```text
submit(envelope: ProposalEnvelope) -> ValidationReport
```

保证：T42 validation；immutable proposal hash。

### `ProjectStateRepository.commit`

```text
commit(validated_proposal_id: str, actor: ActorContext) -> StateRevision
```

限制：Only system_service after T42 pass or authorized human confirmation.

### `GateService.decide`

```text
decide(gate_id: str, snapshot_id: str, decision: GateDecision, actor: ActorContext) -> DecisionSnapshot
```

限制：Assigned human decision_owner only.

### `RevisionService.plan`

```text
plan(request: RevisionRequest) -> ImpactPlan
```

保证：dependency graph traversal；minimal reopen；history preserved。

### `ReportRenderer.render`

```text
render(report_package_id: str, formats: list[str]) -> ArtifactManifest
```

限制：Artifacts are projections, never source of truth.


## 9. 命令规则

### `create_proposal`

- 状态效应：`proposal_only`
- 允许角色：由调用接口与权限矩阵共同决定
- Guard：actor_authorized；target_workflow_active

### `validate_proposal`

- 状态效应：`validation_report_only`
- 允许角色：由调用接口与权限矩阵共同决定
- Guard：schema_available；rule_set_versioned；permission_context_available；expected_revision_matches

### `commit_provisional`

- 状态效应：`new_project_state_revision`
- 允许角色：system_service
- Guard：T42_pass；workflow_allows_A3_provisional_commit；no_high_risk_blocker

### `confirm_work_item`

- 状态效应：`confirmed_state_revision`
- 允许角色：chapter_reviewer、discipline_reviewer、decision_owner
- Guard：assigned_reviewer；T42_pass；professional_signoffs_complete；expected_revision_matches

### `approve_gate`

- 状态效应：`immutable_decision_snapshot`
- 允许角色：decision_owner
- Guard：assigned_gate_approver；no_hard_blocker；snapshot_frozen

### `approve_gate_with_conditions`

- 状态效应：`immutable_decision_snapshot_and_tasks`
- 允许角色：decision_owner
- Guard：assigned_gate_approver；only_non_blocking_gaps；each_condition_has_owner_due_date_and_downstream_task

### `return_gate`

- 状态效应：`return_record_and_minimal_reopen`
- 允许角色：decision_owner、chapter_reviewer
- Guard：return_reason；minimal_workflow_targets

### `waive_hard_constraint`

- 状态效应：`waiver_record`
- 允许角色：constraint_authority
- Guard：authority_scope_matches；legal_or_organizational_basis；expiry_or_review_date；affected_snapshots_invalidated

### `apply_revision`

- 状态效应：`new_state_revision_and_downstream_stale_flags`
- 允许角色：system_service
- Guard：revision_approved_or_editorial_only；impact_plan_complete；history_preserved

### `render_artifact`

- 状态效应：`artifact_only`
- 允许角色：system_service、workflow_operator
- Guard：report_package_snapshot；no_artifact_as_fact_source


## 10. 角色模型

- `agent`（non_human）：理解资料、调用允许工具、形成候选与 ProposalEnvelope；无审批权。
- `system_service`（non_human）：执行校验、确定性计算、provisional 写入、影响传播与审计；无业务批准权。
- `workflow_operator`（human_or_service）：启动、暂停、恢复和分派工作流；不能替代专业或决策批准。
- `data_steward`（human）：确认来源、版本、口径、质量和证据绑定。
- `discipline_reviewer`（human）：对规划、建筑、GIS、交通、市政、造价、财务等高风险专业结论签核。
- `chapter_reviewer`（human）：确认单个章节工作项成果可进入章节 Gate。
- `decision_owner`（human）：确认核心决策、方案选择和章节 Gate；仅对被指派项目有效。
- `project_owner`（human）：配置项目、角色、责任人和流程范围；不自动获得专业豁免权。
- `constraint_authority`（human）：仅在法定或组织授权范围内批准硬约束例外。
- `auditor`（human）：只读审计、导出历史、校验快照，不修改状态。
- `external_participant`（human）：提交资料、意见和确认反馈，不读取未授权状态，不批准 Gate。

## 11. Gate 合同

G1—G8 均采用三类结果：

```text
APPROVED
APPROVED_WITH_CONDITIONS
RETURNED_FOR_REVISION
```

“带条件通过”只允许非阻断缺口，且每项条件必须有责任人、截止时间和下游承接任务。Gate 生成不可变 `DecisionSnapshot`，后续语义变更不得覆盖原快照，只能将其标记为 stale 并重新审批。

## 12. Revision 与最小回退

支持：`evidence_update`、`boundary_change`、`policy_change`、`cost_base_change`、`decision_change`、`method_change`、`editorial_only`。

执行顺序：

1. 校验 RevisionRequest 与 actor 权限。
2. 将 semantic_paths 与对象 Schema 中的语义字段匹配；editorial_only 仍需机器确认。
3. 对语义变更，从 source_object_id 沿 dependency-graph 计算所有 descendants。
4. 创建新的 source object revision；不覆盖旧版本和 DecisionSnapshot。
5. 将受影响 descendants 标记 stale，并生成 reopen_workflows；未受影响对象保持 confirmed。
6. 重新执行的 Workflow 必须引用新 upstream revision，完成后按拓扑顺序解除 stale。
7. 任一已批准 Gate 的 snapshot 若包含旧 revision，保留原记录并标记 STALE，重新审批。

## 13. 验收测试

运行：

```bash
cd 前期策划_DSH技术合同包_v0.6
python tests/test_contracts.py
```

当前结果：

```text
total  = 797
passed = 797
failed = 0
```

测试覆盖：57 个 Schema Meta、57 个合法 Fixture、57 个非法 Fixture、47 个 Tool 结构／输入／输出／权限、57 个 Workflow ID／写入对象／工具引用／直接写入／Agent 审批／可达性、8 个人工 Gate、依赖 DAG、Revision、9 项专业语义底线和 8 个黄金案例。

## 14. DSH 实现验收标准

- [ ] Adapter 能按 `contract_id + version` 加载合同。
- [ ] ToolRuntime 对输入和输出均执行 Draft 2020-12 Schema 校验。
- [ ] ToolRuntime 不持有 Project State 写权限。
- [ ] WorkflowRuntime 只接受合同中声明的命令、角色和状态转换。
- [ ] ProposalService 生成不可变 proposal hash，并执行 T42。
- [ ] Repository 采用乐观并发且保留 append-only 历史。
- [ ] GateService 只接受 assigned human decision_owner。
- [ ] RevisionService 按 dependency DAG 计算最小影响范围。
- [ ] Renderer 只消费冻结快照，不把成果文件反写成事实。
- [ ] 现有 797 项合同测试全部通过，另补充 DSH Adapter 的集成测试与端到端测试。
