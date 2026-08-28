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
}

export interface GateDescriptor {
  readonly gateId: string
  readonly chapterId: string
  readonly title: string
  readonly purpose: string
  readonly requiredObjectIds: readonly string[]
  readonly allowedDecisions: readonly string[]
}

export interface DependencyNode {
  readonly objectId: string
  readonly workflowId: string
  readonly chapterId: string
}
