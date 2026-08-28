import type { Domain, DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { preplanningGovernanceDomainSpec } from './domain.ts'
import type {
  AutomationAuthorizationRecord,
  GateDecisionRecord,
  GovernanceProjectContext,
  ProjectPolicyRecord,
  ReportPackageRecord,
  VisualAssetRecord,
  VisualGenerationPolicyRecord,
  VisualTaskRecord,
  WorkflowRunRecord,
} from './types.ts'

type GovernanceDomain = Domain<typeof preplanningGovernanceDomainSpec>

export class GovernanceRepository {
  private chain: Promise<void> = Promise.resolve()

  private constructor(private readonly domain: GovernanceDomain) {}

  static async open(facility: DomainFacility): Promise<GovernanceRepository> {
    return new GovernanceRepository(await facility.open(preplanningGovernanceDomainSpec))
  }

  close(): Promise<void> {
    return this.domain.close()
  }

  createPolicy(record: ProjectPolicyRecord): Promise<ProjectPolicyRecord> {
    return this.serialize(async () => {
      const table = this.domain.table('project_policies')
      if (table.get(record.projectId) !== undefined) {
        throw new Error(`project policy '${record.projectId}' already exists`)
      }
      await table.put(record.projectId, record)
      return record
    })
  }

  putPolicy(record: ProjectPolicyRecord): Promise<ProjectPolicyRecord> {
    return this.put(this.domain.table('project_policies'), record.projectId, record)
  }

  putAuthorization(record: AutomationAuthorizationRecord): Promise<AutomationAuthorizationRecord> {
    return this.put(this.domain.table('authorizations'), record.authorizationId, record)
  }

  putWorkflowRun(record: WorkflowRunRecord): Promise<WorkflowRunRecord> {
    return this.put(this.domain.table('workflow_runs'), record.runId, record)
  }

  putGateDecision(record: GateDecisionRecord): Promise<GateDecisionRecord> {
    return this.put(this.domain.table('gate_decisions'), record.decisionId, record)
  }

  putVisualPolicy(record: VisualGenerationPolicyRecord): Promise<VisualGenerationPolicyRecord> {
    return this.put(this.domain.table('visual_policies'), record.policyId, record)
  }

  putVisualTask(record: VisualTaskRecord): Promise<VisualTaskRecord> {
    return this.put(this.domain.table('visual_tasks'), record.taskId, record)
  }

  putVisualAsset(record: VisualAssetRecord): Promise<VisualAssetRecord> {
    return this.put(this.domain.table('visual_assets'), record.assetId, record)
  }

  putReportPackage(record: ReportPackageRecord): Promise<ReportPackageRecord> {
    return this.put(this.domain.table('report_packages'), record.packageId, record)
  }

  readProject(projectId: string): GovernanceProjectContext {
    return {
      projectId,
      policy: this.domain.table('project_policies').get(projectId),
      authorizations: this.forProject(this.domain.table('authorizations').entries(), projectId, 'grantedAt'),
      workflowRuns: this.forProject(this.domain.table('workflow_runs').entries(), projectId, 'workflowId'),
      gateDecisions: this.forProject(this.domain.table('gate_decisions').entries(), projectId, 'decisionId'),
      visualPolicies: this.forProject(this.domain.table('visual_policies').entries(), projectId, 'policyId'),
      visualTasks: this.forProject(this.domain.table('visual_tasks').entries(), projectId, 'taskId'),
      visualAssets: this.forProject(this.domain.table('visual_assets').entries(), projectId, 'assetId'),
      reportPackages: this.forProject(this.domain.table('report_packages').entries(), projectId, 'packageId'),
    }
  }

  private put<R>(
    table: KvTable<string, R>,
    key: string,
    record: R,
  ): Promise<R> {
    return this.serialize(async () => {
      await table.put(key, record)
      return record
    })
  }

  private forProject<R extends { readonly projectId: string }, K extends keyof R>(
    entries: IterableIterator<[string, R]>,
    projectId: string,
    sortKey: K,
  ): R[] {
    const records = [...entries].map(([, record]) => record)
    return records
      .filter(record => record.projectId === projectId)
      .sort((left, right) => String(left[sortKey]).localeCompare(String(right[sortKey])))
  }

  private serialize<T>(job: () => Promise<T>): Promise<T> {
    const result = this.chain.then(job)
    this.chain = result.then(() => undefined, () => undefined)
    return result
  }
}
