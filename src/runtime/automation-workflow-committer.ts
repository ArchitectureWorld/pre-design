import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContractRegistry } from '../contracts/registry.ts'
import type { WorkflowDescriptor } from '../contracts/types.ts'
import type { GovernanceRepository } from '../governance/repository.ts'
import type { EvidenceRecord } from '../research/types.ts'
import { researchAllowsAnalysis } from '../research/execution-service.ts'
import { validateCandidateStateProvenance } from '../research/project-state-provenance.ts'
import type { ProposalGateway } from '../proposals/gateway.ts'
import type { ProjectRepository } from '../state/repository.ts'
import type { JSONType } from 'zod'
import type { WorkflowAnalysisCandidate } from './subagent-workflow-analyzer.ts'
import type { WorkflowQualityReport } from './workflow-quality.ts'

interface AutomationWorkflowCommitterDependencies {
  readonly repository: Pick<ProjectRepository, 'readContext' | 'putAuditEvent'>
  readonly governance: Pick<GovernanceRepository, 'readProject'>
  readonly registry: Pick<ContractRegistry, 'validateStateObject' | 'stateExample'>
  readonly gateway: Pick<ProposalGateway, 'submitProposal' | 'commitProposal'>
  readonly now?: () => string
  readonly createId?: () => string
}

export interface AutomationWorkflowCommitResult {
  readonly proposalId: string
  readonly revision: number
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? structuredClone(value as Record<string, unknown>)
    : {}
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

function stringArray(value: unknown, fallback: readonly string[] = []): string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
    ? [...value]
    : [...fallback]
}

function jsonValue(value: unknown): JSONType {
  return JSON.parse(JSON.stringify(value)) as JSONType
}

function evidenceRef(record: EvidenceRecord): Readonly<Record<string, unknown>> {
  // Research locators carry provider-specific fields. The v0.6 contract is
  // closed: use its section field for a source locator and retain the complete
  // EvidenceRecord in the research audit event, not as undeclared properties.
  const pointer = record.locator.jsonPointer ?? record.locator.selector
  const detail = typeof pointer === 'string'
    ? `JSON Pointer ${pointer}`
    : typeof record.locator.startLine === 'number' && typeof record.locator.endLine === 'number'
      ? `lines ${record.locator.startLine}-${record.locator.endLine}`
      : undefined
  return Object.freeze({
    evidence_id: record.evidenceId,
    asset_id: `research:${record.sourceId}`,
    version_id: record.contentHash,
    claim_class: record.claimClass,
    locator: { section: [record.sourceUri, detail].filter(value => value !== undefined).join(' | ') },
    quote_hash: stringValue(record.locator.fragmentHash, record.contentHash),
    captured_at: record.capturedAt,
    reliability: record.reliability === 'inference' ? 'unknown' : record.reliability,
    notes: `${record.sourceTitle} — ${record.publisher}`,
  })
}

function requireTrustedQuality(
  descriptor: WorkflowDescriptor,
  quality: WorkflowQualityReport | undefined,
): WorkflowQualityReport {
  if (quality === undefined) throw new Error('trusted workflow quality is required for automatic commit')
  if (quality.workflowId !== descriptor.workflowId || quality.targetObjectId !== descriptor.targetObjectId) {
    throw new Error('trusted workflow quality identity does not match automatic commit target')
  }
  if (quality.disposition !== 'auto_pass') {
    throw new Error(`automatic commit requires auto_pass quality, got '${quality.disposition}'`)
  }
  if (descriptor.automationPolicy?.automaticCommitAllowed === false) {
    throw new Error(`automatic commit is disabled for workflow '${descriptor.workflowId}'`)
  }
  return quality
}

export class AutomationWorkflowCommitter {
  private readonly now: () => string
  private readonly createId: () => string

  constructor(private readonly dependencies: AutomationWorkflowCommitterDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString())
    this.createId = dependencies.createId ?? (() => randomUUID())
  }

  /** Pure preflight uses the same protected-metadata normalization as final commit. */
  validateCandidate(parent: Agent, projectId: string, descriptor: WorkflowDescriptor, candidate: WorkflowAnalysisCandidate) {
    const prepared = this.prepareCandidate(parent, projectId, descriptor, candidate)
    return this.validatePrepared(projectId, descriptor, candidate, prepared)
  }

  private validatePrepared(projectId: string, descriptor: WorkflowDescriptor, candidate: WorkflowAnalysisCandidate, prepared: ReturnType<AutomationWorkflowCommitter['prepareCandidate']>) {
    const schema = this.dependencies.registry.validateStateObject(descriptor.targetObjectId, prepared.payload)
    if (!schema.valid) return schema
    const governed = this.dependencies.governance.readProject(projectId)
    const unresolvedObjectIds = new Set((governed.workflowRuns ?? [])
      .filter(row => row.status === 'superseded' || (row.revisionRequest !== undefined && row.status !== 'confirmed'))
      .map(row => row.targetObjectId))
    for (const journal of governed.workflowRevisions ?? []) {
      if (journal.status === 'pending') journal.affectedObjectIds.forEach(objectId => unresolvedObjectIds.add(objectId))
    }
    return validateCandidateStateProvenance(prepared.payload, {
      projectId, stateObjects: prepared.stateObjects, researchEvidence: candidate.researchEvidence, unresolvedObjectIds,
    })
  }

  private prepareCandidate(
    parent: Agent,
    projectId: string,
    descriptor: WorkflowDescriptor,
    candidate: WorkflowAnalysisCandidate,
  ) {
    const sessionId = String(parent.id)
    const context = this.dependencies.repository.readContext(sessionId)
    if (context.project.projectId !== projectId) {
      throw new Error(`parent Session is bound to '${context.project.projectId}', not '${projectId}'`)
    }
    const currentRevision = context.project.currentRevision
    const timestamp = this.now()
    const sourceSnapshot = Object.fromEntries(descriptor.requiredUpstream
      .filter(objectId => objectId !== 'ProjectSeed')
      .map((objectId) => {
        const upstream = context.stateObjects.find(record => record.objectId === objectId)
        if (upstream === undefined) throw new Error(`required upstream object '${objectId}' is unavailable`)
        return [objectId, upstream.revision]
      }))
    const example = recordOf(this.dependencies.registry.stateExample(descriptor.targetObjectId))
    const exampleApproval = recordOf(example.approval)
    const supplied = recordOf(candidate.payload)
    const suppliedApproval = recordOf(supplied.approval)
    const actor = {
      actor_id: `preplanning-workflow-agent:${sessionId}`,
      name: '前期策划专业分析 Agent',
      role: 'agent',
      organization: null,
      authority_scope: ['propose'],
      contact_ref: null,
    }
    const payload: Record<string, unknown> = {
      ...supplied,
      object_id: descriptor.targetObjectId,
      object_type: stringValue(example.object_type, stringValue(supplied.object_type, descriptor.targetObjectId)),
      schema_version: stringValue(example.schema_version, '0.6.0'),
      project_id: projectId,
      chapter_id: descriptor.chapterId,
      work_item_id: descriptor.workItemId,
      status: 'provisional',
      revision: currentRevision + 1,
      created_at: timestamp,
      updated_at: timestamp,
      created_by: actor,
      source_snapshot: sourceSnapshot,
      approval: {
        ...exampleApproval,
        ...suppliedApproval,
        status: 'pending',
        required_role: stringValue(
          suppliedApproval.required_role,
          stringValue(exampleApproval.required_role, 'chapter_reviewer'),
        ),
        approver: null,
        approved_at: null,
        conditions: stringArray(suppliedApproval.conditions, stringArray(exampleApproval.conditions)),
        comment: typeof suppliedApproval.comment === 'string'
          ? suppliedApproval.comment
          : typeof exampleApproval.comment === 'string' ? exampleApproval.comment : '',
      },
    }
    const operation = context.stateObjects.some(record => record.objectId === descriptor.targetObjectId) ? 'replace' : 'create'
    return { payload, sessionId, currentRevision, timestamp, sourceSnapshot, actor, operation, stateObjects: context.stateObjects }
  }

  async commit(
    parent: Agent,
    projectId: string,
    descriptor: WorkflowDescriptor,
    candidate: WorkflowAnalysisCandidate,
    quality?: WorkflowQualityReport,
  ): Promise<AutomationWorkflowCommitResult> {
    const trustedQuality = requireTrustedQuality(descriptor, quality)
    if (candidate.researchValidation !== undefined && !researchAllowsAnalysis({
      records: candidate.researchEvidence ?? [], validation: candidate.researchValidation,
      ...(candidate.researchContinuation === undefined ? {} : { continuation: candidate.researchContinuation }),
    }, descriptor.workflowId)) {
      throw new Error(`workflow '${descriptor.workflowId}' cannot commit unvalidated Research evidence`)
    }
    const researchEvidence = candidate.researchEvidence ?? []
    if (candidate.researchValidation !== undefined) {
      const accepted = new Set(candidate.researchValidation.acceptedEvidenceIds)
      if (researchEvidence.some(record => !accepted.has(record.evidenceId))) {
        throw new Error(`workflow '${descriptor.workflowId}' Research evidence set contains records not accepted by the independent validator`)
      }
    }
    const prepared = this.prepareCandidate(parent, projectId, descriptor, candidate)
    const { payload, sessionId, currentRevision, timestamp, sourceSnapshot, actor, operation } = prepared
    const validation = this.validatePrepared(projectId, descriptor, candidate, prepared)
    if (!validation.valid) {
      throw new Error(`${descriptor.targetObjectId} validation failed: ${validation.errors.join('; ')}`)
    }

    const governed = this.dependencies.governance.readProject(projectId)
    const authorizationId = governed.policy?.mode === 'automatic'
      ? governed.policy.automationAuthorizationId
      : undefined
    if (authorizationId === undefined) {
      throw new Error(`project '${projectId}' has no active automatic authorization`)
    }
    const unique = this.createId()
    const envelope = {
      proposal_id: `proposal-${unique}`,
      project_id: projectId,
      workflow_id: descriptor.workflowId,
      target_object_id: descriptor.targetObjectId,
      target_schema_id: descriptor.targetSchemaId,
      expected_revision: currentRevision,
      actor,
      created_at: timestamp,
      change_set: {
        operation,
        payload,
        semantic_paths: [`/${descriptor.targetObjectId}`],
        editorial_only: false,
      },
      evidence_refs: researchEvidence.map(evidenceRef),
      assumptions: trustedQuality.assumptions.map((assumption, index) => ({
        id: `quality-assumption-${index + 1}`,
        name: `自动分析假设 ${index + 1}`,
        description: assumption,
        status: 'active',
      })),
      validation_intent: 'provisional_commit',
      requested_state: 'confirmed',
      dependency_versions: sourceSnapshot,
      idempotency_key: `parallel:${projectId}:${descriptor.workflowId}:r${currentRevision}:${unique}`,
    }
    const proposal = await this.dependencies.gateway.submitProposal(envelope, sessionId)
    const committed = await this.dependencies.gateway.commitProposal(proposal.proposalId, {
      source: 'automation_authorization',
      authorizationId,
      quality: trustedQuality,
      actor: {
        actorId: 'preplanning-automation',
        name: '前期策划自动化服务',
        role: 'system_service',
      },
    }, sessionId)

    if (candidate.analysisTrace !== undefined || researchEvidence.length > 0 || candidate.researchValidation !== undefined) {
      await this.dependencies.repository.putAuditEvent({
        eventId: `${committed.proposalId}:research-trace`,
        projectId,
        eventType: 'research.trace',
        revision: committed.revision,
        actor: {
          actorId: 'preplanning-research-runtime',
          name: '前期策划 Research Runtime',
          role: 'system_service',
        },
        occurredAt: timestamp,
        payload: jsonValue({
          workflowId: descriptor.workflowId,
          targetObjectId: descriptor.targetObjectId,
          evidenceIds: researchEvidence.map(record => record.evidenceId),
          evidenceRecords: researchEvidence,
          ...(candidate.researchValidation === undefined ? {} : { researchValidation: candidate.researchValidation }),
          ...(candidate.researchContinuation === undefined ? {} : { researchContinuation: candidate.researchContinuation }),
          ...(candidate.analysisTrace === undefined ? {} : { analysisTrace: candidate.analysisTrace }),
        }),
      })
    }

    return Object.freeze({
      proposalId: committed.proposalId,
      revision: committed.revision,
    })
  }
}
