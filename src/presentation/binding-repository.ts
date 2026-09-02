import type { Domain, DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { preplanningPresentationDomainSpec } from './binding-domain.ts'
import {
  assertPresentationBinding,
  type PresentationDirectoryState,
  type PresentationProjectBindingRecord,
} from './types.ts'

type PresentationDomain = Domain<typeof preplanningPresentationDomainSpec>

export class PresentationBindingRepositoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`)
    this.name = 'PresentationBindingRepositoryError'
  }
}

function cloneBinding(
  record: PresentationProjectBindingRecord,
): PresentationProjectBindingRecord {
  return {
    ...record,
    lastExportedObjectHashes: { ...record.lastExportedObjectHashes },
  }
}

export class PresentationBindingRepository {
  private chain: Promise<void> = Promise.resolve()

  private constructor(private readonly domain: PresentationDomain) {}

  static async open(
    facility: DomainFacility,
  ): Promise<PresentationBindingRepository> {
    return new PresentationBindingRepository(
      await facility.open(preplanningPresentationDomainSpec),
    )
  }

  close(): Promise<void> {
    return this.domain.close()
  }

  put(
    record: PresentationProjectBindingRecord,
  ): Promise<PresentationProjectBindingRecord> {
    return this.serialize(async () => {
      assertPresentationBinding(record)
      const bindings = this.domain.table('bindings')
      const existing = bindings.get(record.preDesignProjectId)

      if (existing?.presentationProjectId !== undefined
        && record.presentationProjectId !== existing.presentationProjectId) {
        throw new PresentationBindingRepositoryError(
          'PRESENTATION_BINDING_IDENTITY_IMMUTABLE',
          `pre-design project '${record.preDesignProjectId}' is already bound to '${existing.presentationProjectId}'`,
        )
      }

      if (record.presentationProjectId !== undefined) {
        for (const [preDesignProjectId, candidate] of bindings.entries()) {
          if (preDesignProjectId !== record.preDesignProjectId
            && candidate.presentationProjectId === record.presentationProjectId) {
            throw new PresentationBindingRepositoryError(
              'PRESENTATION_PROJECT_ALREADY_BOUND',
              `Presentation project '${record.presentationProjectId}' is already bound to '${preDesignProjectId}'`,
            )
          }
        }
      }

      const stored = cloneBinding(record)
      await bindings.put(record.preDesignProjectId, stored)
      return cloneBinding(stored)
    })
  }

  read(
    preDesignProjectId: string,
  ): PresentationProjectBindingRecord | undefined {
    const record = this.domain.table('bindings').get(preDesignProjectId)
    return record === undefined ? undefined : cloneBinding(record)
  }

  listByState(
    state: PresentationDirectoryState,
  ): readonly PresentationProjectBindingRecord[] {
    return [...this.domain.table('bindings').entries()]
      .map(([, record]) => record)
      .filter(record => record.state === state)
      .map(record => cloneBinding(record))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)
        || left.preDesignProjectId.localeCompare(right.preDesignProjectId))
  }

  private serialize<T>(job: () => Promise<T>): Promise<T> {
    const result = this.chain.then(job)
    this.chain = result.then(() => undefined, () => undefined)
    return result
  }
}
