import { readFile, readdir } from 'node:fs/promises'
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { effectiveWorkflowAutomationPolicy } from './automation-policy.ts'
import type { DependencyNode, GateDescriptor, WorkflowDescriptor } from './types.ts'

export interface ValidationResult {
  readonly valid: boolean
  readonly errors: readonly string[]
}

interface WorkflowContract {
  readonly workflow_id: string
  readonly chapter_id: string
  readonly work_item_id: string
  readonly title: string
  readonly purpose: string
  readonly writes: string
  readonly atomic_tools: readonly string[]
  readonly automation_level: string
  readonly risk: string
  readonly gate_id: string
  readonly input_contract: {
    readonly required_upstream: readonly string[]
    readonly missing_data_policy: string
    readonly evidence_policy?: readonly string[]
  }
  readonly completion_criteria?: readonly string[]
  readonly reopen_triggers?: readonly string[]
  readonly forbidden_actions?: readonly string[]
  readonly review_policy: {
    readonly human_review_mandatory: boolean
    readonly provisional_auto_commit_allowed?: boolean
    readonly gate_still_human?: boolean
  }
}

interface ModelToolContract {
  readonly tool_name: string
}

interface AtomicToolContract {
  readonly tool_id: string
}

interface GateContract {
  readonly gate_id: string
  readonly chapter_id: string
  readonly title: string
  readonly purpose: string
  readonly required_objects: readonly string[]
  readonly allowed_decisions: readonly string[]
  readonly precheck?: {
    readonly schema_and_version?: string
    readonly hard_blockers?: string
    readonly conditional_rule?: string
  }
  readonly approval?: {
    readonly role?: string
    readonly assignment_required?: boolean
    readonly agent_allowed?: boolean
    readonly system_service_allowed?: boolean
    readonly artifact_allowed?: boolean
  }
  readonly return_policy?: {
    readonly minimum_targets?: string
    readonly preserve_confirmed_history?: boolean
    readonly recheck_after_revision?: boolean
  }
}

interface DependencyGraphContract {
  readonly nodes: readonly {
    readonly object_id: string
    readonly workflow_id: string
    readonly chapter_id: string
  }[]
  readonly transitive_descendants: Readonly<Record<string, readonly string[]>>
}

async function readJson<T>(url: URL): Promise<T> {
  return JSON.parse(await readFile(url, 'utf8')) as T
}

async function matchingFiles(root: URL, suffix: string): Promise<string[]> {
  return (await readdir(root))
    .filter(name => name.endsWith(suffix))
    .sort()
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const location = error.instancePath === '' ? '/' : error.instancePath
    return `${location} ${error.message ?? error.keyword}`
  })
}

function frozenStrings(values: readonly string[] | undefined): readonly string[] {
  return Object.freeze([...(values ?? [])])
}

export class ContractRegistry {
  private constructor(
    private readonly stateValidators: ReadonlyMap<string, ValidateFunction>,
    private readonly stateSchemas: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
    private readonly stateExamples: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
    private readonly workflowDescriptors: readonly WorkflowDescriptor[],
    private readonly workflowById: ReadonlyMap<string, WorkflowDescriptor>,
    private readonly gateDescriptors: readonly GateDescriptor[],
    private readonly gateById: ReadonlyMap<string, GateDescriptor>,
    private readonly atomicTools: readonly string[],
    private readonly dependencyNodes: ReadonlyMap<string, DependencyNode>,
    private readonly dependencyClosure: ReadonlyMap<string, readonly string[]>,
    private readonly modelTools: readonly string[],
    private readonly proposalValidator: ValidateFunction,
  ) {}

  static async open(root: URL): Promise<ContractRegistry> {
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    addFormats(ajv)

    const stateRoot = new URL('state/', root)
    const stateValidators = new Map<string, ValidateFunction>()
    const stateSchemas = new Map<string, Readonly<Record<string, unknown>>>()
    for (const file of await matchingFiles(stateRoot, '.schema.json')) {
      const objectId = file.slice(0, -'.schema.json'.length)
      const schema = Object.freeze(await readJson<Record<string, unknown>>(new URL(file, stateRoot)))
      stateSchemas.set(objectId, schema)
      stateValidators.set(objectId, ajv.compile(schema))
    }
    const stateExamples = new Map<string, Readonly<Record<string, unknown>>>()
    const exampleRoot = new URL('tests/fixtures/valid/', root)
    for (const objectId of stateSchemas.keys()) {
      stateExamples.set(objectId, Object.freeze(await readJson<Record<string, unknown>>(
        new URL(`${objectId}.json`, exampleRoot),
      )))
    }

    const workflowRoot = new URL('workflows/', root)
    const workflowDescriptors: WorkflowDescriptor[] = []
    for (const file of await matchingFiles(workflowRoot, '.contract.json')) {
      const contract = await readJson<WorkflowContract>(new URL(file, workflowRoot))
      const targetSchema = stateSchemas.get(contract.writes)
      if (targetSchema === undefined) {
        throw new Error(`workflow '${contract.workflow_id}' targets unknown state object '${contract.writes}'`)
      }
      const targetSchemaId = targetSchema.$id
      if (typeof targetSchemaId !== 'string') {
        throw new Error(`state object '${contract.writes}' has no schema id`)
      }
      const reviewPolicy = Object.freeze({
        humanReviewMandatory: contract.review_policy.human_review_mandatory,
        provisionalAutoCommitAllowed: contract.review_policy.provisional_auto_commit_allowed ?? false,
        gateStillHuman: contract.review_policy.gate_still_human ?? true,
      })
      workflowDescriptors.push(Object.freeze({
        workflowId: contract.workflow_id,
        chapterId: contract.chapter_id,
        workItemId: contract.work_item_id,
        title: contract.title,
        purpose: contract.purpose,
        targetObjectId: contract.writes,
        targetSchemaId,
        gateId: contract.gate_id,
        requiredUpstream: frozenStrings(contract.input_contract.required_upstream),
        atomicToolIds: frozenStrings(contract.atomic_tools),
        automationLevel: contract.automation_level,
        risk: contract.risk,
        humanReviewMandatory: reviewPolicy.humanReviewMandatory,
        missingDataPolicy: contract.input_contract.missing_data_policy,
        evidencePolicy: frozenStrings(contract.input_contract.evidence_policy),
        completionCriteria: frozenStrings(contract.completion_criteria),
        reopenTriggers: frozenStrings(contract.reopen_triggers),
        forbiddenActions: frozenStrings(contract.forbidden_actions),
        reviewPolicy,
        automationPolicy: effectiveWorkflowAutomationPolicy(contract.risk),
      }))
    }
    workflowDescriptors.sort((left, right) =>
      left.chapterId.localeCompare(right.chapterId)
      || left.workItemId.localeCompare(right.workItemId))
    const workflowById = new Map(workflowDescriptors.map(descriptor => [descriptor.workflowId, descriptor]))

    const gateRoot = new URL('gates/', root)
    const gateDescriptors: GateDescriptor[] = []
    for (const file of await matchingFiles(gateRoot, '.contract.json')) {
      const contract = await readJson<GateContract>(new URL(file, gateRoot))
      gateDescriptors.push(Object.freeze({
        gateId: contract.gate_id,
        chapterId: contract.chapter_id,
        title: contract.title,
        purpose: contract.purpose,
        requiredObjectIds: frozenStrings(contract.required_objects),
        allowedDecisions: frozenStrings(contract.allowed_decisions),
        precheck: Object.freeze({
          schemaAndVersion: contract.precheck?.schema_and_version ?? '',
          hardBlockers: contract.precheck?.hard_blockers ?? '',
          conditionalRule: contract.precheck?.conditional_rule ?? '',
        }),
        approvalPolicy: Object.freeze({
          role: contract.approval?.role ?? 'decision_owner',
          assignmentRequired: contract.approval?.assignment_required ?? true,
          agentAllowed: contract.approval?.agent_allowed ?? false,
          systemServiceAllowed: contract.approval?.system_service_allowed ?? false,
          artifactAllowed: contract.approval?.artifact_allowed ?? false,
        }),
        returnPolicy: Object.freeze({
          minimumTargets: contract.return_policy?.minimum_targets ?? '',
          preserveConfirmedHistory: contract.return_policy?.preserve_confirmed_history ?? true,
          recheckAfterRevision: contract.return_policy?.recheck_after_revision ?? true,
        }),
      }))
    }
    gateDescriptors.sort((left, right) => left.chapterId.localeCompare(right.chapterId))
    const gateById = new Map(gateDescriptors.map(descriptor => [descriptor.gateId, descriptor]))

    const atomicToolRoot = new URL('tools/', root)
    const atomicTools: string[] = []
    for (const file of await matchingFiles(atomicToolRoot, '.contract.json')) {
      const contract = await readJson<AtomicToolContract>(new URL(file, atomicToolRoot))
      atomicTools.push(contract.tool_id)
    }
    atomicTools.sort()

    const dependencyGraph = await readJson<DependencyGraphContract>(
      new URL('governance/dependency-graph.json', root),
    )
    const dependencyNodes = new Map(dependencyGraph.nodes.map(node => [node.object_id, Object.freeze({
      objectId: node.object_id,
      workflowId: node.workflow_id,
      chapterId: node.chapter_id,
    })]))
    const dependencyClosure = new Map(Object.entries(dependencyGraph.transitive_descendants)
      .map(([objectId, dependents]) => [objectId, Object.freeze([...dependents].sort())] as const))

    const toolRoot = new URL('model-tools/', root)
    const modelTools: string[] = []
    for (const file of await matchingFiles(toolRoot, '.contract.json')) {
      const contract = await readJson<ModelToolContract>(new URL(file, toolRoot))
      modelTools.push(contract.tool_name)
    }

    return new ContractRegistry(
      stateValidators,
      stateSchemas,
      stateExamples,
      Object.freeze(workflowDescriptors),
      workflowById,
      Object.freeze(gateDescriptors),
      gateById,
      Object.freeze(atomicTools),
      dependencyNodes,
      dependencyClosure,
      Object.freeze(modelTools.sort()),
      ajv.compile(await readJson(new URL('common/proposal-envelope.schema.json', root))),
    )
  }

  stateObjectIds(): readonly string[] {
    return Object.freeze([...this.stateValidators.keys()].sort())
  }

  workflowIds(): readonly string[] {
    return Object.freeze(this.workflowDescriptors.map(descriptor => descriptor.workflowId))
  }

  workflows(): readonly WorkflowDescriptor[] {
    return this.workflowDescriptors
  }

  workflow(workflowId: string): WorkflowDescriptor {
    const descriptor = this.workflowById.get(workflowId)
    if (descriptor === undefined) throw new Error(`unknown workflow contract: ${workflowId}`)
    return descriptor
  }

  gates(): readonly GateDescriptor[] {
    return this.gateDescriptors
  }

  gate(gateId: string): GateDescriptor {
    const descriptor = this.gateById.get(gateId)
    if (descriptor === undefined) throw new Error(`unknown gate contract: ${gateId}`)
    return descriptor
  }

  atomicToolIds(): readonly string[] {
    return this.atomicTools
  }

  dependents(objectId: string): readonly string[] {
    if (!this.dependencyNodes.has(objectId)) throw new Error(`unknown dependency object: ${objectId}`)
    return this.dependencyClosure.get(objectId) ?? Object.freeze([])
  }

  stateSchema(objectId: string): Readonly<Record<string, unknown>> {
    const schema = this.stateSchemas.get(objectId)
    if (schema === undefined) throw new Error(`unknown state object contract: ${objectId}`)
    return schema
  }

  stateExample(objectId: string): Readonly<Record<string, unknown>> {
    const example = this.stateExamples.get(objectId)
    if (example === undefined) throw new Error(`unknown state object example: ${objectId}`)
    return example
  }

  modelToolNames(): readonly string[] {
    return this.modelTools
  }

  validateProposalEnvelope(value: unknown): ValidationResult {
    const valid = this.proposalValidator(value)
    return valid
      ? { valid: true, errors: [] }
      : { valid: false, errors: formatErrors(this.proposalValidator.errors) }
  }

  validateStateObject(objectId: string, value: unknown): ValidationResult {
    const validate = this.stateValidators.get(objectId)
    if (validate === undefined) throw new Error(`unknown state object contract: ${objectId}`)
    const valid = validate(value)
    return valid
      ? { valid: true, errors: [] }
      : { valid: false, errors: formatErrors(validate.errors) }
  }
}
