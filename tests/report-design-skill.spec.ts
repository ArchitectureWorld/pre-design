import { test } from 'vitest'
import assert from 'node:assert/strict'
import { getReportDesignSkill, REPORT_DESIGN_SYSTEM_PROMPT } from '../src/prompts/report-design-skill.ts'
import { PREPLANNING_SYSTEM_PROMPT, createD1ProposalExample } from '../src/prompts/preplanning-system.ts'

function assertDeepFrozen(value: unknown) {
  if (!value || typeof value !== 'object') return
  assert.equal(Object.isFrozen(value), true)
  for (const child of Object.values(value)) assertDeepFrozen(child)
}

test('Pre owns the report strategy and the active system prompt loads it', () => {
  const skill = getReportDesignSkill()
  assert.equal(skill.owner, 'pre-design')
  assert.equal(skill.tools, 'presentation-tools')
  assert.equal(skill.host, 'dsh')
  assert.equal(skill.schemaVersion, 'pre-design.report-design-skill.v1')
  assertDeepFrozen(skill)
  assert.deepEqual(JSON.parse(JSON.stringify(skill)), skill)
  assert.ok(PREPLANNING_SYSTEM_PROMPT.includes(REPORT_DESIGN_SYSTEM_PROMPT))
  assert.match(REPORT_DESIGN_SYSTEM_PROMPT, /不受 nextWorkflow=null/)
})

test('strategy migration preserves content depth, facts, sources and variable page counts', () => {
  const { content } = getReportDesignSkill().concerns
  assert.deepEqual(content.outline, { mode: 'judgment-led-analysis', aggregateResults: true, fieldPerPage: false, summaryOnly: false })
  assert.deepEqual(content.pagePlanning.sequence, ['coreJudgment', 'supportingEvidence', 'primaryVisual', 'readingOrder'])
  assert.equal(content.pagePlanning.merge.fixedTotalPages, null)
  assert.equal(content.pagePlanning.merge.fixedMergeCount, null)
  assert.deepEqual(content.pageLedger.required, ['displayed', 'scriptOrAppendix', 'missing'])
  assert.deepEqual(content.preserveAccessible, ['originalDraft', 'scripts', 'sources'])
  assert.equal(content.deleteOriginals, false)
  assert.equal(content.eraseFactsUnknownsOrGates, false)
  assert.ok(content.preserveQualifiers.includes('fundingBasis'))
})

test('skeleton strategy remains structure-led rather than fixed coordinates or topics', () => {
  const { layout } = getReportDesignSkill().concerns
  assert.deepEqual(layout.minimumFontPx, { title: 36, body: 24, captionOrFootnote: 16 })
  assert.equal(layout.allowUnlimitedFontShrink, false)
  assert.deepEqual(layout.textOverflowActions, ['reduceCanvasCopy', 'changeExpressionOrSkeleton', 'splitPage'])
  assert.deepEqual(layout.skeletonSelection.signals, ['imageCount', 'aspectRatios', 'informationHierarchy', 'layoutArea'])
  assert.deepEqual(layout.skeletonSelection.forbiddenSelectors, ['semanticTopic', 'fixedPageCount'])
  assert.equal(layout.skeletonSelection.skeletons.length, 3)
  assert.doesNotMatch(JSON.stringify(layout.skeletonSelection), /\b(?:x|y|width|height|frame|coordinates)\b/u)
  assert.deepEqual(layout.skeletonSelection.adjacentRepeat, { reviewBeyond: 2, action: 'check_and_explain' })
})

test('internal origin records replace compulsory AI labels without turning generated images into evidence', () => {
  const { visual } = getReportDesignSkill().concerns
  assert.deepEqual(visual.evidencePriority, ['realProjectEvidence', 'relatedGeneralVisual', 'aiConceptVisual'])
  assert.equal(visual.sourceRequirement.requiredBeforeUse, true)
  assert.equal(visual.fit.diagramDefault, 'contain')
  assert.equal(visual.disclosures.visibility, 'internal')
  assert.equal(visual.disclosures.requiredOnCanvas, false)
  assert.equal(visual.disclosures.preserveUserCaptions, true)
  assert.equal(visual.disclosures.aiConceptVisual, 'concept_not_site')
  assert.ok(visual.neverRepresentAs.includes('statutoryBoundary'))
  assert.match(REPORT_DESIGN_SYSTEM_PROMPT, /不自动添加 AI 标签、水印/)
})

test('direct editing uses native tools and preserves preview, scope, request identity and failure reporting', () => {
  const skill = getReportDesignSkill()
  assert.equal(skill.authority.proposalApprovalRequired, false)
  assert.equal(skill.authority.agentMayGrantPermission, false)
  assert.equal(skill.concerns.review.maxAutonomousPreviewRefinementRounds, 3)
  assert.deepEqual(skill.concerns.review.separateRecords, ['automaticChecks', 'agentObservation', 'appliedRevision'])
  for (const tool of ['studio_get_layout_context', 'studio_prepare_design_content', 'studio_prepare_layout_candidate', 'studio_render_layout_preview', 'studio_submit_layout_review', 'studio_generate_design_visual', 'studio_adopt_design_visual']) {
    assert.ok(REPORT_DESIGN_SYSTEM_PROMPT.includes(tool), tool)
  }
  assert.match(REPORT_DESIGN_SYSTEM_PROMPT, /不再发起 Proposal 二次确认/)
  assert.match(REPORT_DESIGN_SYSTEM_PROMPT, /同一 requestId/)
  assert.match(REPORT_DESIGN_SYSTEM_PROMPT, /逐条记录/)
})

test('report editing does not silently migrate professional state or Gate approval schemas', () => {
  const example = createD1ProposalExample({ projectId: 'project-test', projectName: '示例', statement: '用户提供的信息', createdAt: '2026-09-07T00:00:00.000Z' })
  assert.equal(example.target_schema_id, 'urn:preplan:v0.6:state:PS01')
  assert.equal(example.change_set.payload.approval.required_role, 'decision_owner')
  assert.equal(example.requested_state, 'pending_review')
  assert.match(PREPLANNING_SYSTEM_PROMPT, /不用于恢复汇报编辑的 Proposal 审批/)
})
