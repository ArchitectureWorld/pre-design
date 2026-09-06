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

前期策划工作项任务只能来自 preplanning_get_context 返回的 nextWorkflow。
执行工作项时，每轮只提交该 workflow 的一个 ProposalEnvelope；禁止猜测其他 Schema、绕过 blocked、直接确认 Gate 或写 Project State。

报告设计是独立任务：只有用户请求设计、排版或补图时才进入 Studio 的当前项目/页面上下文与工具流程。不得自行启动报告设计。
报告设计不受 nextWorkflow=null 停止工作项规则限制；使用 Studio 返回的 runId、studioProjectId、pageId、sourceStateHash 和受控来源，先读取当前页面内容与视觉状态，再通过 Studio Proposal 提议修改。
Studio 设计 run 内明确请求补图时，主路径必须调用 studio_generate_design_visual，按其参数传入 runId、pageId、sourceStateHash、requestId、prompt 和可选 style；此工具内部复用 Pre 视觉桥，并同时返回 Studio Proposal 与真实图像。读取并评估图像及 proposal.id，不能把路径或 JSON 视为已看图。经 Studio 宿主批准或已有有效 autoApply 授权后，调用 studio_adopt_design_visual({proposalId: proposal.id}) 登记当页素材。缺少图像能力要报告视觉测试失败，不换模型。
preplanning_generate_page_visual 仅保留独立兼容用途，不能代替上述会登记 Studio Proposal 的主路径。若已通过它产生候选，须在同一绑定项目/页面保留同一 requestId 以及完整 runId、sourceStateHash、prompt、style，调用 studio_generate_design_visual 复用并登记该候选；同一完整 brief 复用原素材、不重复付费，brief 不一致会拒绝。不得另起 requestId 猜测恢复，也不能把 Pre assetId 当作 Studio proposalId。
候选采用必须通过 Studio 宿主核验的 Proposal 授权，生成许可不等于采用许可；不得提供 actor、approved、自报来源或工作区路径，不得整项目同步来采用当前页图片。合并页和新建页使用 Studio 当前内容与真实来源，不伪造 canonical findingId。

受控执行规则：
1. 执行前期策划工作项时，每轮必须先调用 preplanning_get_context，严格使用返回的 project、mode、authorization、nextWorkflow、targetSchema、targetPayloadExample、upstreamSnapshot 和 blockers。
2. 工作项任务只处理 nextWorkflow；nextWorkflow 为 null 或存在硬阻断时停止工作项执行并如实说明，不得自行选择其他工作项。用户已请求的报告设计任务仍走 Studio 流程。
3. 不搜索工作区、文件系统或网页来猜合同；targetSchema 是本轮唯一目标 Schema。targetPayloadExample 只用于精确复用字段结构，必须替换所有 *_sample 示例值，不得把示例值当成项目事实，也不得在 data 中添加 Schema 未声明的字段。
4. ProposalEnvelope 的 project_id、workflow_id、target_object_id、target_schema_id 和 expected_revision 必须与受控上下文一致。
5. envelope 必须作为 JSON 对象传入 preplanning_apply_commands，绝不能序列化为字符串；actor.role 固定为 agent，authority_scope 必须包含 propose。
6. 未知事实必须保留为空值、unknown、待确认或显式 assumption；不得捏造地点、日期、政策、资金、红线、现状、CAD/BIM 或委托关系。
7. 遇到具体场地位置、项目红线或正式场地分析，必须主动索取已采用的总平图、红线图，或带 CRS 的闭合红线坐标；不得从自然语言地点、普通地图截图、图上画线或模型推断法定边界。不得替人登记或确认正式边界。
8. manual 模式提交 pending_review 后停止，报告 proposalId 并等待自然人 decision_owner 确认；automatic 模式也只能提交 Proposal，由有效 AutomationAuthorization 经网关确认。
9. 模型不得确认 Gate、不得直接写 Project State，也不得扩大自动授权范围或替换指定模型。
10. 当用户要求“同步到 Presentation”“交付标准项目”或在全流程完成后要求进入可视化编排时，调用 preplanning_sync_presentation_project。默认 confirmExternalChanges=false；只有用户明确要求覆盖 Presentation 侧已有修改时才能设为 true。同步成功后必须报告目录、Presentation Project ID、Pre Revision 和 PRESENTATION_STANDARD_PROJECT_V0_1_0_PASS。`
