import { createHash } from 'node:crypto'

type JsonPrimitive = null | boolean | number | string

function fail(code: string, detail: string): never {
  throw new Error(`${code}: ${detail}`)
}

function stringifyPrimitive(value: JsonPrimitive): string {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) {
    fail(
      'PRESENTATION_CANONICAL_JSON_UNSUPPORTED_VALUE',
      'value cannot be represented as JSON',
    )
  }
  return encoded
}

function encodePrimitive(value: JsonPrimitive): string {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    fail(
      'PRESENTATION_CANONICAL_JSON_UNSUPPORTED_NUMBER',
      'only finite JSON numbers are supported',
    )
  }
  if (typeof value === 'string') return stringifyPrimitive(value.normalize('NFC'))
  return stringifyPrimitive(value)
}

function encode(value: unknown, active: WeakSet<object>): string {
  if (value === null
    || typeof value === 'boolean'
    || typeof value === 'number'
    || typeof value === 'string') {
    return encodePrimitive(value)
  }

  if (typeof value !== 'object') {
    fail(
      'PRESENTATION_CANONICAL_JSON_UNSUPPORTED_VALUE',
      `unsupported value type '${typeof value}'`,
    )
  }

  if (active.has(value)) {
    fail('PRESENTATION_CANONICAL_JSON_CYCLE', 'cyclic values are not supported')
  }

  active.add(value)
  try {
    if (Array.isArray(value)) {
      const encoded: string[] = []
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          fail(
            'PRESENTATION_CANONICAL_JSON_UNSUPPORTED_VALUE',
            'sparse arrays are not supported',
          )
        }
        encoded.push(encode(value[index], active))
      }
      return `[${encoded.join(',')}]`
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      fail(
        'PRESENTATION_CANONICAL_JSON_UNSUPPORTED_VALUE',
        'only plain JSON objects are supported',
      )
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
      fail(
        'PRESENTATION_CANONICAL_JSON_UNSUPPORTED_VALUE',
        'symbol keys are not supported',
      )
    }

    const normalizedKeys = new Map<string, string>()
    for (const originalKey of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, originalKey)
      if (descriptor === undefined || !('value' in descriptor)) {
        fail(
          'PRESENTATION_CANONICAL_JSON_UNSUPPORTED_VALUE',
          'accessor properties are not supported',
        )
      }
      const normalizedKey = originalKey.normalize('NFC')
      const existing = normalizedKeys.get(normalizedKey)
      if (existing !== undefined && existing !== originalKey) {
        fail(
          'PRESENTATION_CANONICAL_JSON_KEY_COLLISION',
          `keys '${existing}' and '${originalKey}' normalize to the same value`,
        )
      }
      normalizedKeys.set(normalizedKey, originalKey)
    }

    const entries = [...normalizedKeys.entries()]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([normalizedKey, originalKey]) => {
        const propertyValue = (value as Record<string, unknown>)[originalKey]
        return `${stringifyPrimitive(normalizedKey)}:${encode(propertyValue, active)}`
      })

    return `{${entries.join(',')}}`
  } finally {
    active.delete(value)
  }
}

export function canonicalizeJson(value: unknown): string {
  return encode(value, new WeakSet<object>())
}

export function sha256CanonicalJson(value: unknown): string {
  return createHash('sha256')
    .update(canonicalizeJson(value), 'utf8')
    .digest('hex')
}
