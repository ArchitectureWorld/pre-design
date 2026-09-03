import {
  createStableId,
  isStableId,
  type StableIdKind,
} from '@architectureworld/presentation-contracts'

const STABLE_ID_KINDS = new Set<StableIdKind>([
  'project',
  'projectRules',
  'outlineDocument',
  'outlineNode',
  'page',
  'draftDocument',
  'contentBlock',
  'listItem',
  'metric',
  'tableRow',
  'tableColumn',
  'tableCell',
  'scriptBlock',
  'pageAsset',
  'sourceMaterial',
  'asset',
])

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`)
}

function normalizeSemanticKey(value: string): string {
  const normalized = value.normalize('NFC').trim()
  if (normalized === '' || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    fail('PRESENTATION_STABLE_ID_KEY_INVALID', 'semantic identity keys must be non-empty printable strings')
  }
  return normalized
}

function storageKey(kind: StableIdKind, semanticKey: string): string {
  return `${kind}:${normalizeSemanticKey(semanticKey)}`
}

function parseStorageKey(value: string): { readonly kind: StableIdKind; readonly semanticKey: string } {
  const separator = value.indexOf(':')
  if (separator < 1) fail('PRESENTATION_STABLE_ID_KEY_INVALID', `invalid persisted identity key '${value}'`)
  const kind = value.slice(0, separator) as StableIdKind
  if (!STABLE_ID_KINDS.has(kind)) {
    fail('PRESENTATION_STABLE_ID_KEY_INVALID', `unsupported persisted identity kind '${kind}'`)
  }
  return { kind, semanticKey: normalizeSemanticKey(value.slice(separator + 1)) }
}

function mayShareIdentity(kind: StableIdKind): boolean {
  return kind === 'sourceMaterial' || kind === 'asset'
}

export class PresentationStableIdLedger {
  private readonly mappings = new Map<string, string>()

  constructor(existing: Readonly<Record<string, string>> = {}) {
    const seenByKind = new Map<StableIdKind, Map<string, string>>()
    for (const [rawKey, id] of Object.entries(existing).sort(([left], [right]) => left.localeCompare(right))) {
      const { kind, semanticKey } = parseStorageKey(rawKey)
      if (!isStableId(kind, id)) {
        fail(
          'PRESENTATION_STABLE_ID_KIND_MISMATCH',
          `persisted ID '${id}' does not match kind '${kind}'`,
        )
      }
      const key = storageKey(kind, semanticKey)
      if (this.mappings.has(key)) {
        fail('PRESENTATION_STABLE_ID_KEY_CONFLICT', `duplicate persisted key '${key}'`)
      }
      const byId = seenByKind.get(kind) ?? new Map<string, string>()
      const existingKey = byId.get(id)
      if (existingKey !== undefined && !mayShareIdentity(kind)) {
        fail(
          'PRESENTATION_STABLE_ID_DUPLICATE',
          `ID '${id}' is assigned to both '${existingKey}' and '${key}'`,
        )
      }
      byId.set(id, existingKey ?? key)
      seenByKind.set(kind, byId)
      this.mappings.set(key, id)
    }
  }

  resolve(kind: StableIdKind, semanticKey: string): string {
    if (!STABLE_ID_KINDS.has(kind)) {
      fail('PRESENTATION_STABLE_ID_KIND_INVALID', `unsupported ID kind '${kind}'`)
    }
    const key = storageKey(kind, semanticKey)
    const existing = this.mappings.get(key)
    if (existing !== undefined) return existing
    const created = createStableId(kind)
    this.mappings.set(key, created)
    return created
  }

  bind(kind: StableIdKind, semanticKey: string, id: string): string {
    if (!isStableId(kind, id)) {
      fail('PRESENTATION_STABLE_ID_KIND_MISMATCH', `ID '${id}' does not match kind '${kind}'`)
    }
    const key = storageKey(kind, semanticKey)
    const existing = this.mappings.get(key)
    if (existing !== undefined && existing !== id) {
      fail(
        'PRESENTATION_STABLE_ID_KEY_CONFLICT',
        `semantic key '${key}' is already bound to '${existing}'`,
      )
    }
    if (!mayShareIdentity(kind)) {
      for (const [candidateKey, candidateId] of this.mappings) {
        if (candidateKey !== key && candidateKey.startsWith(`${kind}:`) && candidateId === id) {
          fail(
            'PRESENTATION_STABLE_ID_DUPLICATE',
            `ID '${id}' is already bound to '${candidateKey}'`,
          )
        }
      }
    }
    this.mappings.set(key, id)
    return id
  }

  alias(kind: StableIdKind, aliasSemanticKey: string, targetSemanticKey: string): string {
    if (!mayShareIdentity(kind)) {
      fail(
        'PRESENTATION_STABLE_ID_ALIAS_KIND_INVALID',
        `kind '${kind}' cannot share one stable identity across semantic keys`,
      )
    }
    const targetKey = storageKey(kind, targetSemanticKey)
    const targetId = this.mappings.get(targetKey)
    if (targetId === undefined) {
      fail(
        'PRESENTATION_STABLE_ID_ALIAS_TARGET_MISSING',
        `target semantic key '${targetKey}' has not been resolved`,
      )
    }
    return this.bind(kind, aliasSemanticKey, targetId)
  }

  read(kind: StableIdKind, semanticKey: string): string | undefined {
    return this.mappings.get(storageKey(kind, semanticKey))
  }

  snapshot(): Readonly<Record<string, string>> {
    return Object.freeze(Object.fromEntries([...this.mappings.entries()]
      .sort(([left], [right]) => left.localeCompare(right))))
  }
}
