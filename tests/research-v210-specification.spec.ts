import { existsSync, readFileSync } from 'node:fs'
import { brotliDecompressSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { loadPlanningCatalog } from '../src/research-v2/catalog.ts'
import { createResearchPlanCommand } from '../src/research-v2/command.ts'

const implementation = new URL('../src/research-v2/specification.ts', import.meta.url)
const source = new URL('../research/planning-v1.2/unified-data.json.br', import.meta.url)
async function api() {
  expect(existsSync(implementation), 'full spec loader is implemented').toBe(true)
  return import(implementation.href)
}

describe('complete approved v1.2 specification', () => {
  it('packages the exact approved source, not another reduced field dictionary', async () => {
    const { loadResearchSpecification } = await api()
    const spec = loadResearchSpecification()
    const bytes = brotliDecompressSync(readFileSync(source))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(loadPlanningCatalog().sourceSha256)
    const original = JSON.parse(bytes.toString('utf8'))
    expect(spec.items).toEqual(original.items)
    expect(spec.sources).toEqual(original.sources)
    expect(spec.items).toHaveLength(62)
    expect(spec.items.reduce((n: number, i: any) => n + i.queries.length, 0)).toBe(134)
    expect(spec.items.reduce((n: number, i: any) => n + i.steps.length, 0)).toBe(248)
  })
  it('checks every identity, port and edge against the previously locked routing index', async () => {
    const { loadResearchSpecification, getResearchModuleSpec } = await api()
    const spec = loadResearchSpecification(), catalog = loadPlanningCatalog()
    for (const mod of catalog.modules) {
      const item = getResearchModuleSpec(mod.id)
      expect(item.title).toBe(mod.title)
      expect(item.outputPorts).toEqual(mod.ports)
      expect(item.figures.map((f: any) => f.artifactId)).toEqual(mod.figures.map(f => f.artifactId))
      expect(item.requires.map((e: any) => e.edgeId).sort()).toEqual(catalog.edges.filter(e => e.target === mod.id).map(e => e.edgeId).sort())
      expect(item.fields).not.toBe('')
    }
    expect(Object.isFrozen(spec.items[0].queries)).toBe(true)
    expect(() => getResearchModuleSpec('02.03')).toThrow()
  })
  it('rejects corrupted or unapproved source bytes before parsing a catalogue', async () => {
    const { decodeResearchSpecification } = await api()
    expect(() => decodeResearchSpecification(Buffer.from('{}'))).toThrow('SPEC_SOURCE_HASH_MISMATCH')
  })
  it('serves full item research and expression requirements through the real command', async () => {
    const result = await createResearchPlanCommand().handler({ rawInput: '--item=2.03 --json' } as never)
    expect(result.kind).toBe('success')
    const detail = JSON.parse((result as {text: string}).text)
    expect(detail.researchSpec?.steps).toHaveLength(4)
    expect(detail.researchSpec?.fields).toContain('OD_ID')
    expect(detail.researchSpec?.figures[0].binding.dataset).toBe('regional-od.csv')
    expect(detail.fieldSchemaStatus).toBe('regional_slice_only')
  })
})
