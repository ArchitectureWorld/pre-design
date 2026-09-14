export type ResearchSelector =
  | { readonly type: 'json_pointer'; readonly pointer: string }
  | { readonly type: 'text_lines'; readonly startLine: number; readonly endLine: number }

export interface ResearchSelection {
  readonly rawValue: unknown
  readonly normalizedValue: unknown
  readonly locator: Readonly<Record<string, unknown>>
}

function decodePointerToken(token: string): string {
  if (/~(?:[^01]|$)/u.test(token)) throw new Error(`invalid JSON Pointer escape in token '${token}'`)
  return token.replace(/~1/gu, '/').replace(/~0/gu, '~')
}

function valueAtPointer(root: unknown, pointer: string): unknown {
  if (pointer === '') return root
  if (!pointer.startsWith('/')) throw new Error(`JSON Pointer must be empty or start with '/': ${pointer}`)

  let current: unknown = root
  for (const encoded of pointer.slice(1).split('/')) {
    const token = decodePointerToken(encoded)
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/u.test(token)) throw new Error(`JSON Pointer array token '${token}' is not a valid index`)
      const index = Number(token)
      if (!Number.isSafeInteger(index) || index >= current.length) throw new Error(`JSON Pointer '${pointer}' not found`)
      current = current[index]
      continue
    }
    if (current === null || typeof current !== 'object') throw new Error(`JSON Pointer '${pointer}' not found`)
    const record = current as Readonly<Record<string, unknown>>
    if (!Object.prototype.hasOwnProperty.call(record, token)) throw new Error(`JSON Pointer '${pointer}' not found`)
    current = record[token]
  }
  return current
}

function selectLines(text: string, startLine: number, endLine: number): ResearchSelection {
  if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine <= 0 || endLine <= 0) {
    throw new Error('text line selectors require positive integers')
  }
  if (endLine < startLine) throw new Error('text line selector endLine must be greater than or equal to startLine')
  const lines = text.split('\n')
  if (startLine > lines.length || endLine > lines.length) {
    throw new Error(`text line selector ${startLine}-${endLine} is outside available text lines 1-${lines.length}`)
  }
  const value = lines.slice(startLine - 1, endLine).join('\n')
  return Object.freeze({
    rawValue: value,
    normalizedValue: value,
    locator: Object.freeze({ selectorType: 'text_lines', startLine, endLine }),
  })
}

export function applyResearchSelector(
  text: string,
  parsedValue: unknown,
  selector?: ResearchSelector,
): ResearchSelection {
  if (selector === undefined) {
    return Object.freeze({ rawValue: text, normalizedValue: parsedValue, locator: Object.freeze({}) })
  }
  if (selector.type === 'text_lines') return selectLines(text, selector.startLine, selector.endLine)

  const pointer = selector.pointer.normalize('NFC')
  const value = valueAtPointer(parsedValue, pointer)
  return Object.freeze({
    rawValue: structuredClone(value),
    normalizedValue: structuredClone(value),
    locator: Object.freeze({ selectorType: 'json_pointer', jsonPointer: pointer }),
  })
}
