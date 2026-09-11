export interface WorkflowReviewPolicy {
  readonly humanReviewMandatory: boolean
  readonly provisionalAutoCommitAllowed: boolean
  readonly gateStillHuman: boolean
}

export interface WorkflowDescriptor {
  readonly workflowId: string
  readonly chapterId: string
  readonly workItemId: string
  readonly title: string
  readonly purpose: string
  readonly targetObjectId: string
  readonly targetSchemaId: string
  readonly gateId: string
  readonly requiredUpstream: readonly string[]
  readonly atomicToolIds: readonly string[]
  readonly automationLevel: string
  readonly risk: string
  readonly humanReviewMandatory: boolean
  readonly missingDataPolicy: string
  readonly evidencePolicy: readonly string[]
  readonly completionCriteria: readonly string[]
  readonly reopenTriggers: readonly string[]
  readonly forbiddenActions: readonly string[]
  readonly reviewPolicy: WorkflowReviewPolicy
}

export interface GatePrecheckPolicy {
  readonly schemaAndVersion: string
  readonly hardBlockers: string
  readonly conditionalRule: string
}

export interface GateApprovalPolicy {
  readonly role: string
  readonly assignmentRequired: boolean
  readonly agentAllowed: boolean
  readonly systemServiceAllowed: boolean
  readonly artifactAllowed: boolean
}

export interface GateReturnPolicy {
  readonly minimumTargets: string
  readonly preserveConfirmedHistory: boolean
  readonly recheckAfterRevision: boolean
}

export interface GateDescriptor {
  readonly gateId: string
  readonly chapterId: string
  readonly title: string
  readonly purpose: string
  readonly requiredObjectIds: readonly string[]
  readonly allowedDecisions: readonly string[]
  readonly precheck: GatePrecheckPolicy
  readonly approvalPolicy: GateApprovalPolicy
  readonly returnPolicy: GateReturnPolicy
}

export interface DependencyNode {
  readonly objectId: string
  readonly workflowId: string
  readonly chapterId: string
}
