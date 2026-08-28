export interface D1ProposalExampleInput {
  readonly projectId: string
  readonly projectName: string
  readonly statement: string
  readonly createdAt: string
}

export function createD1ProposalExample(input: D1ProposalExampleInput) {
  const evidence = {
    evidence_id: `user-statement-${input.projectId}`,
    asset_id: `dsh-session-${input.projectId}`,
    version_id: 'user-message-1',
    claim_class: 'user_statement',
    locator: {},
    captured_at: input.createdAt,
    reliability: 'B',
    notes: input.statement,
  }
  const actor = {
    actor_id: 'dsh-preplanning-agent',
    name: 'DSH 前期策划智能体',
    role: 'agent',
    organization: null,
    authority_scope: ['propose'],
    contact_ref: null,
  }
  return {
    proposal_id: `prop-PS01-${input.projectId}-01-01`,
    project_id: input.projectId,
    workflow_id: 'preplan.wf.01.01',
    target_object_id: 'PS01',
    target_schema_id: 'urn:preplan:v0.6:state:PS01',
    expected_revision: 0,
    actor,
    created_at: input.createdAt,
    change_set: {
      operation: 'create',
      payload: {
        object_id: 'PS01',
        object_type: 'ProjectIdentity',
        schema_version: '0.6.0',
        project_id: input.projectId,
        chapter_id: '01',
        work_item_id: '01-01',
        status: 'pending_review',
        revision: 1,
        created_at: input.createdAt,
        updated_at: input.createdAt,
        created_by: actor,
        source_snapshot: {},
        data: {
          project_id: input.projectId,
          canonical_name: input.projectName,
          aliases: [],
          location: { name: '', admin_codes: [], geometry_refs: [] },
          object_type: '待确认',
          origin_mode: 'unknown',
          trigger_events: [],
          start_reason: input.statement,
          time_constraints: [],
          evidence_refs: [evidence],
          status: 'pending_review',
        },
        approval: {
          status: 'pending',
          required_role: 'decision_owner',
          approver: null,
          approved_at: null,
          conditions: [],
          comment: '等待 DSH 用户人工确认',
        },
      },
      semantic_paths: ['/data/canonical_name', '/data/object_type', '/data/start_reason'],
      editorial_only: false,
    },
    evidence_refs: [evidence],
    assumptions: [{
      id: `assumption-object-type-${input.projectId}`,
      name: '项目类型待确认',
      description: '用户原始陈述未给出明确类型时保留为待确认，不推断具体类型。',
      status: 'open',
      evidence_refs: [evidence],
    }],
    validation_intent: 'human_review',
    requested_state: 'pending_review',
    idempotency_key: `direct-${input.projectId}-01-01`,
  }
}

export const PREPLANNING_SYSTEM_PROMPT = `你是 DSH 前期策划智能体，执行 v0.6 的 57 个数据驱动工作流。

前期策划工作只能来自 preplanning_get_context 返回的 nextWorkflow。
每轮只提交该 workflow 的一个 ProposalEnvelope；禁止猜测其他 Schema、绕过 blocked、直接确认 Gate 或写 Project State。

受控执行规则：
1. 每轮必须先调用 preplanning_get_context，严格使用返回的 project、mode、authorization、nextWorkflow、targetSchema、upstreamSnapshot 和 blockers。
2. 只处理 nextWorkflow；nextWorkflow 为 null 或存在硬阻断时停止并如实说明，不得自行选择其他工作项。
3. 不搜索工作区、文件系统或网页来猜合同；targetSchema 是本轮唯一目标 Schema。
4. ProposalEnvelope 的 project_id、workflow_id、target_object_id、target_schema_id 和 expected_revision 必须与受控上下文一致。
5. envelope 必须作为 JSON 对象传入 preplanning_apply_commands，绝不能序列化为字符串；actor.role 固定为 agent，authority_scope 必须包含 propose。
6. 未知事实必须保留为空值、unknown、待确认或显式 assumption；不得捏造地点、日期、政策、资金、红线、现状、CAD/BIM 或委托关系。
7. manual 模式提交 pending_review 后停止，报告 proposalId 并等待自然人 decision_owner 确认；automatic 模式也只能提交 Proposal，由有效 AutomationAuthorization 经网关确认。
8. 模型不得确认 Gate、不得直接写 Project State，也不得扩大自动授权范围或替换指定模型。`
