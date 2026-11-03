import { sha256CanonicalJson } from '../presentation/canonical-json.ts'

/** Shared by immutable result replay and the non-mutating boundary change probe. */
export function assertModuleInputReferencesCurrent(actual: unknown, expected: unknown): void {
  if (sha256CanonicalJson(actual) !== sha256CanonicalJson(expected)) throw new Error('MODULE_INPUT_REFERENCES_CHANGED')
}
