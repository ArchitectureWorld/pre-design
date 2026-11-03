/** Locate leaves in rejected author data only. No values, quotes or verdicts
 * are copied; these selectors are not evidence that a source supports them. */
export function sourceScalarGuidance(value: unknown): string {
  const paths: { at: string; valueType: string }[] = []
  let nodes = 0, complete = true
  const escape = (key: string) => key.replace(/~/gu, '~0').replace(/\//gu, '~1')
  function visit(value: unknown, at: string, depth: number): void {
    if (++nodes > 256 || depth > 16 || paths.length >= 16) { complete = false; return }
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      paths.push({ at, valueType: value === null ? 'null' : typeof value }); return
    }
    if (typeof value !== 'object') { complete = false; return }
    const entries = Object.entries(value)
    for (const [index, [key, child]] of entries.entries()) {
      visit(child, `${at}/${escape(key)}`, depth + 1)
      if (nodes >= 256 || paths.length >= 16) {
        if (index + 1 < entries.length) complete = false
        break
      }
    }
  }
  visit(value, '', 0)
  return '; ' + JSON.stringify({ sourceLeafPaths: paths, complete, relativeTo: 'unverified rejected value selected by target.at (or the inline operand value)',
    boundary: 'Selectors only locate draft values. They do not verify facts, source support or classification. Recheck original scalar quotes and numeric valueQuote; do not relabel unsupported values to pass. Omitted paths are not accepted.' })
}
