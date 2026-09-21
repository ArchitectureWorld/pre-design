export const AGENT_CLASSES = [
  { id: 'image', title: '生成图像', description: '生成 AI 概念表现图，沿用视觉质量与采用流程。' },
  { id: 'web', title: '网络查询', description: '通过 DSH 网页工具查询资料，结果待证据校验。' },
  { id: 'review', title: '素材审图', description: '读取实际图片，核验图文匹配、图类、中文环境与构图。' },
  { id: 'text', title: '文本生成', description: '完成工作流分析和结构化文本候选。' },
] as const
export type AgentClassId = typeof AGENT_CLASSES[number]['id']
export interface LlmRoute { readonly provider: string; readonly model: string }
export interface ModelRoute extends LlmRoute {
  /** Required for a tool-backed image route; never inherited from another class. */
  readonly llm?: LlmRoute
}
export type ClassRoutes = Record<Exclude<AgentClassId, 'review'>, ModelRoute | null> & { readonly review?: ModelRoute | null }
export const MAX_CLASS_FALLBACKS = 16
export type ClassFallbacks = Partial<Record<AgentClassId, readonly ModelRoute[]>>
export type AvailabilityFailure = 'catalog' | 'provider' | 'transport' | 'rate-limit' | 'server'
export interface ClassSettings {
  readonly revision: number
  readonly routes: ClassRoutes
  /** Missing in legacy settings. No backup is inferred from another class or the parent. */
  readonly fallbacks?: ClassFallbacks
}
export interface CatalogProvider {
  readonly provider: string
  readonly name: string
  readonly available: boolean
  readonly error?: string
  readonly models: readonly { readonly id: string; readonly name: string; readonly imageTool?: string }[]
}
export type ExecutionStatus = 'starting' | 'running' | 'completed' | 'failed' | 'cancelled' | 'recovery_required'
export interface ClassExecution {
  readonly id: string
  readonly projectId: string
  readonly classId: AgentClassId
  readonly task: string
  readonly parentId: string
  readonly configurationRevision: number
  /** Durable reservation for the one-shot model turn; failures do not refund it. */
  readonly automationAuthorizationId?: string
  readonly selected: ModelRoute
  readonly chainId?: string
  readonly routeChain?: readonly ModelRoute[]
  readonly routeIndex?: number
  readonly fallbackFromExecutionId?: string
  /** Derived only from a failed catalog validation or the native terminal envelope. */
  readonly availabilityFailure?: AvailabilityFailure
  readonly actual?: ModelRoute
  readonly childId?: string
  readonly status: ExecutionStatus
  /** Live child activity is separate from result validation and persisted task status. */
  readonly activity?: 'running' | 'idle' | 'unknown'
  readonly childStopReason?: string
  readonly error?: string
  readonly startedAt: string
  readonly updatedAt: string
}
export interface AgentClassView {
  readonly settings: ClassSettings
  readonly projectId?: string
  readonly catalog: readonly CatalogProvider[]
  readonly executions: readonly ClassExecution[]
}
