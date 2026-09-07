/** Report strategy belongs to Pre. Studio exposes editing/rendering tools only. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

const REPORT_DESIGN_SKILL = deepFreeze({
  "schemaVersion": "pre-design.report-design-skill.v1",
  "kind": "pre-design.report-design-skill",
  "concerns": {
    "content": {
      "outline": {
        "mode": "judgment-led-analysis",
        "aggregateResults": true,
        "fieldPerPage": false,
        "summaryOnly": false
      },
      "pagePlanning": {
        "sequence": [
          "coreJudgment",
          "supportingEvidence",
          "primaryVisual",
          "readingOrder"
        ],
        "merge": {
          "sameArgumentAndModerateLoad": "may_merge",
          "independentDecisionQuestion": "split",
          "overloadedPage": "split",
          "fixedTotalPages": null,
          "fixedMergeCount": null
        }
      },
      "pageLedger": {
        "required": [
          "displayed",
          "scriptOrAppendix",
          "missing"
        ],
        "fullTextRequiredOnCanvas": false
      },
      "preserveAccessible": [
        "originalDraft",
        "scripts",
        "sources"
      ],
      "deleteOriginals": false,
      "preserveQualifiers": [
        "planning",
        "recommendation",
        "assumption",
        "target",
        "pendingConfirmation",
        "unapproved",
        "fundingBasis"
      ],
      "eraseFactsUnknownsOrGates": false
    },
    "visual": {
      "relatedVisuals": {
        "preference": "use_when_available",
        "fullBleedEveryPage": false,
        "textOrSolidPage": {
          "allowed": true,
          "rationaleRequired": true
        }
      },
      "professionalLeadTypes": [
        "map",
        "drawing",
        "dataGraphic"
      ],
      "evidencePriority": [
        "realProjectEvidence",
        "relatedGeneralVisual",
        "aiConceptVisual"
      ],
      "sourceRequirement": {
        "collection": "pageAssets",
        "requiredBeforeUse": true
      },
      "fit": {
        "diagramDefault": "contain",
        "diagramPreserve": [
          "boundary",
          "legend",
          "annotation"
        ],
        "coverChecks": [
          "subjectCrop",
          "textContrast"
        ]
      },
      "preserveOpenableOriginals": [
        "video",
        "pdf",
        "data"
      ],
      "unpreviewable": {
        "explicitGapRequired": true,
        "countsAsBackgroundCoverage": false
      },
      "disclosures": {
        "aiConceptVisual": "concept_not_site",
        "generalVisual": "not_project_site",
        "visibility": "internal",
        "requiredOnCanvas": false,
        "preserveUserCaptions": true
      },
      "neverRepresentAs": [
        "statutoryBoundary",
        "siteReality",
        "implementedResult"
      ]
    },
    "layout": {
      "referenceCanvas": {
        "width": 1600,
        "height": 900,
        "unit": "studio_unit",
        "scaling": "proportional"
      },
      "minimumFontPx": {
        "title": 36,
        "body": 24,
        "captionOrFootnote": 16
      },
      "bodyWidthPercent": {
        "min": 28,
        "max": 45,
        "typical": true
      },
      "mainTextBlocks": {
        "usualMax": 2,
        "structuredDataExceptions": [
          "dataTable",
          "evidenceMatrix"
        ]
      },
      "textOverflowActions": [
        "reduceCanvasCopy",
        "changeExpressionOrSkeleton",
        "splitPage"
      ],
      "allowUnlimitedFontShrink": false,
      "skeletonSelection": {
        "signals": [
          "imageCount",
          "aspectRatios",
          "informationHierarchy",
          "layoutArea"
        ],
        "forbiddenSelectors": [
          "semanticTopic",
          "fixedPageCount"
        ],
        "skeletons": [
          {
            "id": "judgment_text_focus",
            "selectionProfile": {
              "imageCount": {
                "min": 0,
                "max": 0
              },
              "aspectRatios": [
                "none"
              ],
              "informationHierarchy": [
                "singleJudgmentWithSupport"
              ],
              "layoutArea": [
                "textPriority"
              ]
            },
            "compatibleElementTypes": [
              "text",
              "shape",
              "group"
            ]
          },
          {
            "id": "judgment_with_primary_visual",
            "selectionProfile": {
              "imageCount": {
                "min": 1,
                "max": 1
              },
              "aspectRatios": [
                "landscape",
                "portrait",
                "square"
              ],
              "informationHierarchy": [
                "judgmentThenPrimaryVisual"
              ],
              "layoutArea": [
                "visualPriority",
                "balanced"
              ]
            },
            "compatibleElementTypes": [
              "text",
              "image",
              "shape",
              "group"
            ]
          },
          {
            "id": "comparative_evidence",
            "selectionProfile": {
              "imageCount": {
                "min": 2,
                "max": null
              },
              "aspectRatios": [
                "uniform",
                "mixed"
              ],
              "informationHierarchy": [
                "comparison",
                "sequence",
                "evidenceMatrix"
              ],
              "layoutArea": [
                "visualGrid",
                "balanced"
              ]
            },
            "compatibleElementTypes": [
              "text",
              "image",
              "shape",
              "group"
            ]
          }
        ],
        "adjacentRepeat": {
          "reviewBeyond": 2,
          "action": "check_and_explain"
        }
      }
    },
    "review": {
      "maxAutonomousPreviewRefinementRounds": 3,
      "round": [
        "candidate",
        "actualPreview",
        "refinement"
      ],
      "failureStatus": "needs_review",
      "separateRecords": [
        "automaticChecks",
        "agentObservation",
        "appliedRevision"
      ]
    }
  },
  "designLoop": [
    {
      "order": 1,
      "action": "inventory_content_and_assets"
    },
    {
      "order": 2,
      "action": "define_page_judgment_evidence_visual_and_reading_order"
    },
    {
      "order": 3,
      "action": "record_display_script_appendix_and_missing_content"
    },
    {
      "order": 4,
      "action": "select_skeleton_from_structural_signals"
    },
    {
      "order": 5,
      "action": "build_candidate"
    },
    {
      "order": 6,
      "action": "render_and_observe_actual_preview"
    },
    {
      "order": 7,
      "action": "refine_or_escalate"
    }
  ],
  "authority": {
    "visualGeneration": "host_grant_required",
    "acceptance": "user_instruction_scoped_direct_apply",
    "agentMayGrantPermission": false,
    "proposalApprovalRequired": false
  },
  "rendererLimits": {
    "staticResourceOnly": true,
    "rulesAreFinishedTemplates": false,
    "currentRendererCapabilitiesMustBeChecked": true,
    "actualRenderingRequiredForVisualAcceptance": true,
    "doesNotProveHostLoadingOrAcceptance": true
  },
  "forbiddenFallbacks": [
    "field_per_page",
    "summary_only",
    "fixed_page_count_or_merge_count",
    "erase_facts_unknowns_gates_or_qualifiers",
    "shrink_text_below_minimum",
    "use_visual_outside_page_assets",
    "claim_unpreviewable_media_as_visual_coverage",
    "represent_ai_or_general_visual_as_project_fact",
    "agent_self_authorize_generation_or_acceptance"
  ],
  "version": "1.0.2",
  "owner": "pre-design",
  "tools": "presentation-tools",
  "host": "dsh"
} as const)

export function getReportDesignSkill() {
  return REPORT_DESIGN_SKILL
}

export const REPORT_DESIGN_SYSTEM_PROMPT = [
  '报告设计是独立任务，其内容组织、叙事、视觉选择、骨架与排版策略归 Pre-design；Presentation 只提供读取、编辑、渲染、检查和保存工具。',
  '只有用户请求设计、排版、修改或补图时才进入报告设计；不受 nextWorkflow=null 的策划工作项停止规则限制。仍使用当前 DSH 主 Agent、会话和模型，不创建第二套模型路由。',
  '使用宿主返回的 runId、项目、pageId、sourceStateHash 和保护范围。用户提交本次修改要求后直接执行，不再发起 Proposal 二次确认；内部 proposal.id 只是兼容工具的操作记录句柄，不是向用户索取批准的步骤。',
  '先调用 studio_get_layout_context 读取真实来源、讲稿、素材与当前工具能力；按本 Skill 作设计判断。Context 中的 rules 仅是工具约束，不能替代 Pre 的排版策略。',
  '先确定主要判断，再组织证据、主视觉和阅读顺序，记录展示内容、讲稿/附录与资料缺口。不按字段机械分页，不设固定总页数，不为布局删除原始事实、限定条件或来源。',
  'studio_prepare_design_content 用于受控内容整理、拆合页、素材关联及页面计划。结构变化后的页面身份必须来自工具真实返回值；若宿主尚未授权新页面，报告范围缺口，不猜 runId 或扩大权限。',
  '布局执行顺序为 studio_prepare_layout_candidate → studio_render_layout_preview → 读取真实 image block → studio_submit_layout_review。有效直接修改授权下，检查通过即保存；有溢出、缺图、版本冲突或无图像能力时不得声称完成。每页最多三轮，仍失败则保留当前成果并报告原因。',
  '补图只走 studio_generate_design_visual(runId,pageId,sourceStateHash,requestId,prompt,style?)。读取真实图像和 proposal.id，在有效本次修改授权内调用 studio_adopt_design_visual({proposalId:proposal.id}) 完成挂页，不等待第二次审批。生成权限仍需用户明确授予，不能因允许修改就擅自付费补图。',
  'preplanning_generate_page_visual 仅为兼容入口；其候选须以同一 requestId、runId、sourceStateHash、prompt、style 通过 studio_generate_design_visual 登记，完整 brief 不变时复用原素材、不重复付费。不能把 Pre assetId 当作 Studio proposalId，不得更换 requestId 猜测恢复或重复付费。',
  'AI 与非现场图片来源只写内部素材、生成和引用记录，不自动添加 AI 标签、水印、强制图注或观众提示。已有用户图注不得批量删除。内部仍须区分现场证据、通用参考和概念视觉，不能把生成图当作法定红线或已实施事实。',
  '取消审批不取消版本 CAS、范围检查、真实预览、来源记录、修改历史和撤销。不得用整项目同步来挂当前页图片，也不得覆盖 Studio 已保存的人工编辑。',
  '批注按实际处理结果逐条记录；未处理、资料不足或提交后已被用户改写的批注不得标成完成。事实、数值、单位和依据的修订回到 Pre 的受控专业状态流程；汇报编辑直接执行不等于自动批准专业 Gate。',
  '批注命令通过 studio_apply_commands 提交。可附 annotationResults 数组，每项包含 annotationId、annotationVersion、status（completed/partial/unresolved）、reason、commandIds。只引用当前提交的批注版本和本次实际命令；completed 必须有覆盖此批注的 commandIds。完成一条不代表完成整轮。',
  '本轮没有可执行修改时仍调用 studio_apply_commands，传入 commands=[] 和逐条 unresolved/partial 说明；工具返回 no_changes，不产生内容 Revision，也不关闭未完成批注。不要仅在对话中回复而让任务永久挂起。',
  '工具返回 scopeInherited=true 与 newPageIds 时，新页已继承原任务中被替换页面的范围，可以继续排版，不重新索取 Proposal 批准。只使用工具返回的新页 ID；受保护或未选择的原页面仍不可修改。',
  '遇到 local_saved_conflict，保留已保存成果，说明上游变更与本地修改发生冲突，不擅自丢弃本地版本。遇到 conflict/apply_failed，读取工具当前任务状态，通过重试入口取得新的 submissionId/baseRevision 后再构造命令，不重放旧基线。',
  '图片挂接返回 link_failed 时，调用 studio_resume_design_visual({runId,pageId,sourceStateHash,requestId}) 续接原任务；四项参数必须沿用生成时的持久身份。图片已经存在，不再次生成、不更换 requestId，也不要求 Agent 记住内部 proposalId。成功结果必须包含 linkedAssetId 与内部 linkReceipt，不把仅生成的图片当作已经挂页。',
  `报告设计 Skill：${JSON.stringify(REPORT_DESIGN_SKILL)}`,
].join('\n')
