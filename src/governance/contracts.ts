import { readFile } from 'node:fs/promises'
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

export interface GovernanceValidationResult {
  readonly valid: boolean
  readonly errors: readonly string[]
}

interface GovernanceManifest {
  readonly contractVersion: string
  readonly schemas: readonly {
    readonly id: string
    readonly file: string
  }[]
}

async function readJson<T>(url: URL): Promise<T> {
  return JSON.parse(await readFile(url, 'utf8')) as T
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const location = error.instancePath === '' ? '/' : error.instancePath
    return `${location} ${error.message ?? error.keyword}`
  })
}

export class GovernanceContractRegistry {
  private constructor(private readonly validators: ReadonlyMap<string, ValidateFunction>) {}

  static async open(root: URL): Promise<GovernanceContractRegistry> {
    const manifest = await readJson<GovernanceManifest>(new URL('manifest.json', root))
    if (manifest.contractVersion !== 'preplan.runtime.v0.7.0') {
      throw new Error(`unsupported governance contract version: ${manifest.contractVersion}`)
    }

    const ajv = new Ajv2020({ allErrors: true, strict: false })
    addFormats(ajv)
    const validators = new Map<string, ValidateFunction>()
    for (const entry of manifest.schemas) {
      if (validators.has(entry.id)) throw new Error(`duplicate governance contract: ${entry.id}`)
      validators.set(entry.id, ajv.compile(await readJson(new URL(entry.file, root))))
    }
    return new GovernanceContractRegistry(validators)
  }

  schemaIds(): readonly string[] {
    return Object.freeze([...this.validators.keys()].sort())
  }

  validate(schemaId: string, value: unknown): GovernanceValidationResult {
    const validator = this.validators.get(schemaId)
    if (validator === undefined) throw new Error(`unknown governance contract: ${schemaId}`)
    const valid = validator(value)
    return valid
      ? { valid: true, errors: [] }
      : { valid: false, errors: formatErrors(validator.errors) }
  }
}
