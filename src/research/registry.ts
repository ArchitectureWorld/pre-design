import { readFile } from 'node:fs/promises'
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import type {
  AnalysisTrace,
  DataSourceDefinition,
  EvidenceRecord,
  ResearchAccessMode,
  ResearchValidationResult,
  WorkflowResearchSpec,
} from './types.ts'

interface DataSourceCatalogDocument {
  readonly schemaVersion: '2.0.1'
  readonly sources: readonly DataSourceDefinition[]
}

interface WorkflowResearchSpecDocument {
  readonly schemaVersion: '2.0.1'
  readonly workflows: readonly WorkflowResearchSpec[]
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map(error => `${error.instancePath || '/'} ${error.message ?? error.keyword}`)
}

async function readJson<T>(url: URL): Promise<T> {
  return JSON.parse(await readFile(url, 'utf8')) as T
}

function normalizedDomain(value: string): string {
  return value.normalize('NFC').trim().toLowerCase().replace(/^\.+|\.+$/gu, '')
}

function validDomain(value: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(value)
}

function hostAllowed(uri: string, allowedDomains: readonly string[]): boolean {
  if (allowedDomains.length === 0) return true
  let host: string
  try {
    host = new URL(uri).hostname.toLowerCase()
  } catch {
    return false
  }
  return allowedDomains.some(domain => host === domain || host.endsWith(`.${domain}`))
}

function frozenSource(source: DataSourceDefinition): DataSourceDefinition {
  return Object.freeze({
    ...source,
    allowedDomains: Object.freeze([...source.allowedDomains]),
    accessModes: Object.freeze([...source.accessModes]),
    supportedDataKinds: Object.freeze([...source.supportedDataKinds]),
    freshnessPolicy: Object.freeze({ ...source.freshnessPolicy }),
  })
}

function frozenWorkflow(workflow: WorkflowResearchSpec): WorkflowResearchSpec {
  return Object.freeze({
    ...workflow,
    requiredDataPoints: Object.freeze(workflow.requiredDataPoints.map(item => Object.freeze({ ...item }))),
    optionalDataPoints: Object.freeze(workflow.optionalDataPoints.map(item => Object.freeze({ ...item }))),
    preferredSources: Object.freeze(workflow.preferredSources.map(item => Object.freeze({ ...item }))),
    queryTemplates: Object.freeze(workflow.queryTemplates.map(item => Object.freeze({ ...item }))),
    extractionRules: Object.freeze([...workflow.extractionRules]),
    normalizationRules: Object.freeze([...workflow.normalizationRules]),
    aggregationMethod: Object.freeze({ ...workflow.aggregationMethod }),
    analysisMethod: Object.freeze({ ...workflow.analysisMethod }),
    crossCheckRules: Object.freeze([...workflow.crossCheckRules]),
    freshnessRules: Object.freeze([...workflow.freshnessRules]),
    minimumEvidence: Object.freeze({ ...workflow.minimumEvidence }),
    outputClaims: Object.freeze([...workflow.outputClaims]),
  })
}

export class ResearchRegistry {
  private constructor(
    private readonly sourceRows: readonly DataSourceDefinition[],
    private readonly workflowRows: readonly WorkflowResearchSpec[],
    private readonly sourceById: ReadonlyMap<string, DataSourceDefinition>,
    private readonly workflowById: ReadonlyMap<string, WorkflowResearchSpec>,
    private readonly evidenceValidator: ValidateFunction,
    private readonly traceValidator: ValidateFunction,
  ) {}

  static async open(root: URL): Promise<ResearchRegistry> {
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    addFormats(ajv)
    const sourceSchema = await readJson<Record<string, unknown>>(new URL('schemas/data-source-catalog.schema.json', root))
    const workflowSchema = await readJson<Record<string, unknown>>(new URL('schemas/workflow-research-spec.schema.json', root))
    const evidenceSchema = await readJson<Record<string, unknown>>(new URL('schemas/evidence-record.schema.json', root))
    const traceSchema = await readJson<Record<string, unknown>>(new URL('schemas/analysis-trace.schema.json', root))
    const sourceValidator = ajv.compile(sourceSchema)
    const workflowValidator = ajv.compile(workflowSchema)
    const evidenceValidator = ajv.compile(evidenceSchema)
    const traceValidator = ajv.compile(traceSchema)

    const sourceDocument = await readJson<DataSourceCatalogDocument>(new URL('data-sources.json', root))
    const workflowDocument = await readJson<WorkflowResearchSpecDocument>(new URL('workflow-research-specs.json', root))
    if (!sourceValidator(sourceDocument)) {
      throw new Error(`research data source catalog invalid: ${formatErrors(sourceValidator.errors).join('; ')}`)
    }
    if (!workflowValidator(workflowDocument)) {
      throw new Error(`workflow research specs invalid: ${formatErrors(workflowValidator.errors).join('; ')}`)
    }

    const sourceById = new Map<string, DataSourceDefinition>()
    const sources: DataSourceDefinition[] = []
    for (const row of sourceDocument.sources) {
      const sourceId = row.sourceId.normalize('NFC').trim()
      if (sourceById.has(sourceId)) throw new Error(`duplicate research source '${sourceId}'`)
      const domains = row.allowedDomains.map(normalizedDomain)
      for (const domain of domains) {
        if (!validDomain(domain)) throw new Error(`research source '${sourceId}' has invalid allowed domain '${domain}'`)
      }
      if (row.homepage !== null && domains.length > 0 && !hostAllowed(row.homepage, domains)) {
        throw new Error(`research source '${sourceId}' homepage is outside allowed domains`)
      }
      if (row.authorityLevel === 'inference' && (row.priority !== 'P5' || row.reliabilityGrade !== 'inference')) {
        throw new Error(`inference source '${sourceId}' must use P5/inference classification`)
      }
      const normalized = frozenSource({ ...row, sourceId, allowedDomains: domains })
      sourceById.set(sourceId, normalized)
      sources.push(normalized)
    }

    const workflowById = new Map<string, WorkflowResearchSpec>()
    const workflows: WorkflowResearchSpec[] = []
    for (const row of workflowDocument.workflows) {
      const workflowId = row.workflowId.normalize('NFC').trim()
      if (workflowById.has(workflowId)) throw new Error(`duplicate workflow research spec '${workflowId}'`)
      for (const preference of row.preferredSources) {
        if (!sourceById.has(preference.sourceId)) {
          throw new Error(`workflow '${workflowId}' references unknown research source '${preference.sourceId}'`)
        }
      }
      for (const query of row.queryTemplates) {
        if (!sourceById.has(query.sourceId)) {
          throw new Error(`workflow '${workflowId}' query references unknown research source '${query.sourceId}'`)
        }
      }
      const normalized = frozenWorkflow({ ...row, workflowId })
      workflowById.set(workflowId, normalized)
      workflows.push(normalized)
    }

    return new ResearchRegistry(
      Object.freeze(sources.sort((left, right) => left.sourceId.localeCompare(right.sourceId))),
      Object.freeze(workflows.sort((left, right) => left.workflowId.localeCompare(right.workflowId))),
      sourceById,
      workflowById,
      evidenceValidator,
      traceValidator,
    )
  }

  sources(): readonly DataSourceDefinition[] {
    return this.sourceRows
  }

  workflows(): readonly WorkflowResearchSpec[] {
    return this.workflowRows
  }

  source(sourceId: string): DataSourceDefinition {
    const source = this.sourceById.get(sourceId)
    if (source === undefined) throw new Error(`unknown research source '${sourceId}'`)
    return source
  }

  workflow(workflowId: string): WorkflowResearchSpec {
    const workflow = this.workflowById.get(workflowId)
    if (workflow === undefined) throw new Error(`unknown workflow research spec '${workflowId}'`)
    return workflow
  }

  validateEvidenceRecord(value: unknown): ResearchValidationResult {
    if (!this.evidenceValidator(value)) {
      return { valid: false, errors: formatErrors(this.evidenceValidator.errors) }
    }
    const record = value as EvidenceRecord
    const source = this.sourceById.get(record.sourceId)
    if (source === undefined) return { valid: false, errors: [`unknown research source '${record.sourceId}'`] }
    if (!source.accessModes.includes(record.sourceType as ResearchAccessMode)) {
      return { valid: false, errors: [`source '${record.sourceId}' does not allow access mode '${record.sourceType}'`] }
    }
    if (['web_page', 'web_search', 'api'].includes(record.sourceType)
      && !hostAllowed(record.sourceUri, source.allowedDomains)) {
      return { valid: false, errors: [`source URI is outside allowed domains for '${record.sourceId}'`] }
    }
    if (record.reliability === 'inference' && record.claimClass === 'fact') {
      return { valid: false, errors: ['inference evidence cannot be classified as fact'] }
    }
    if (source.authorityLevel === 'inference' && record.claimClass === 'fact') {
      return { valid: false, errors: ['inference source cannot support fact claim'] }
    }
    return { valid: true, errors: [] }
  }

  validateAnalysisTrace(value: unknown): ResearchValidationResult {
    if (!this.traceValidator(value)) {
      return { valid: false, errors: formatErrors(this.traceValidator.errors) }
    }
    const trace = value as AnalysisTrace
    if (!this.workflowById.has(trace.workflowId)) {
      return { valid: false, errors: [`unknown workflow research spec '${trace.workflowId}'`] }
    }
    return { valid: true, errors: [] }
  }
}
