import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ResearchRegistry } from '../src/research/registry.ts'
import { WorkspaceResearchProvider } from '../src/research/workspace-provider.ts'

const researchRoot = new URL('../research/v2.0.1/', import.meta.url)
const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'pre-v201-workspace-'))
  cleanup.push(root)
  return root
}

describe('Pre 2.0.1 workspace research provider', () => {
  it('creates a traceable EvidenceRecord from a JSON project file', async () => {
    const root = await workspace()
    await mkdir(join(root, 'inputs'))
    await writeFile(join(root, 'inputs', 'project.json'), '{"projectName":"武汉站改造"}\n', 'utf8')

    const registry = await ResearchRegistry.open(researchRoot)
    const source = registry.source('workspace-project-files')
    const provider = new WorkspaceResearchProvider({
      rootDir: root,
      allowedFiles: ['inputs/project.json'],
      clock: () => new Date('2026-09-14T03:00:00.000Z'),
    })

    const result = await provider.fetch(source, {
      mode: 'workspace_file',
      locator: 'inputs/project.json',
      workflowId: 'preplan.wf.01.01',
      dataPointId: 'canonical-name',
    })

    expect(result.records).toHaveLength(1)
    const record = result.records[0]
    expect(record).toMatchObject({
      workflowId: 'preplan.wf.01.01',
      dataPointId: 'canonical-name',
      sourceId: 'workspace-project-files',
      sourceType: 'workspace_file',
      sourceTitle: 'project.json',
      publisher: source.publisher,
      capturedAt: '2026-09-14T03:00:00.000Z',
      reliability: 'A',
      claimClass: 'source_conclusion',
      normalizedValue: { projectName: '武汉站改造' },
    })
    expect(record.sourceUri).toMatch(/^file:\/\//u)
    expect(record.contentHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(record.locator).toMatchObject({ relativePath: 'inputs/project.json' })
    expect(registry.validateEvidenceRecord(record)).toEqual({ valid: true, errors: [] })
  })

  it('binds a DataPoint to an exact JSON Pointer fragment while retaining the source snapshot hash', async () => {
    const root = await workspace()
    await mkdir(join(root, 'inputs'))
    await writeFile(join(root, 'inputs', 'project.json'), JSON.stringify({ project: { name: '武汉站改造', location: '武汉市' } }), 'utf8')

    const registry = await ResearchRegistry.open(researchRoot)
    const provider = new WorkspaceResearchProvider({ rootDir: root, allowedFiles: ['inputs/project.json'] })
    const result = await provider.fetch(registry.source('workspace-project-files'), {
      mode: 'workspace_file',
      locator: 'inputs/project.json',
      workflowId: 'preplan.wf.01.01',
      dataPointId: 'canonical-name',
      selector: { type: 'json_pointer', pointer: '/project/name' },
    })

    const record = result.records[0]
    expect(record.rawValue).toBe('武汉站改造')
    expect(record.normalizedValue).toBe('武汉站改造')
    expect(record.contentHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(record.locator).toMatchObject({
      relativePath: 'inputs/project.json',
      selectorType: 'json_pointer',
      jsonPointer: '/project/name',
    })
    expect(record.locator.fragmentHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(registry.validateEvidenceRecord(record)).toEqual({ valid: true, errors: [] })
  })

  it('fails closed when a locator escapes the configured workspace root', async () => {
    const parent = await workspace()
    const root = join(parent, 'workspace')
    await mkdir(root)
    await writeFile(join(parent, 'outside.txt'), 'outside', 'utf8')

    const registry = await ResearchRegistry.open(researchRoot)
    const provider = new WorkspaceResearchProvider({ rootDir: root })

    await expect(provider.fetch(registry.source('workspace-project-files'), {
      mode: 'workspace_file',
      locator: '../outside.txt',
      workflowId: 'preplan.wf.01.01',
      dataPointId: 'canonical-name',
    })).rejects.toThrow(/outside workspace root/u)
  })

  it.each(['notes.json', 'inputs/project.json', 'research/runs/RUN-old/result.json'])('rejects an unapproved source locator: %s', async (path) => {
    const root = await workspace()
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), JSON.stringify({ canonical_name: '未经核验的内容' }))
    const registry = await ResearchRegistry.open(researchRoot)
    const provider = new WorkspaceResearchProvider({ rootDir: root })
    await expect(provider.fetch(registry.source('workspace-project-files'), {
      mode: 'workspace_file', locator: path, workflowId: 'preplan.wf.01.01', dataPointId: 'canonical-name',
    })).rejects.toThrow(/approved source|generated/u)
  })

  it.each(['research/runs/RUN-old/result.json', '原始资料/output/project.json', 'source-materials/manifest.json'])('cannot allowlist generated output as an original source: %s', async (path) => {
    const root = await workspace()
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), JSON.stringify({ canonical_name: '历史生成结果' }))
    const registry = await ResearchRegistry.open(researchRoot)
    const provider = new WorkspaceResearchProvider({ rootDir: root, allowedFiles: [path] })
    await expect(provider.fetch(registry.source('workspace-project-files'), {
      mode: 'workspace_file', locator: path, workflowId: 'preplan.wf.01.01', dataPointId: 'canonical-name',
    })).rejects.toThrow(/generated/u)
  })

  it.each(['原始资料/project.json', 'source-materials/project.json'])('keeps a directly selected original %s as an unverified source conclusion', async (path) => {
    const root = await workspace()
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), JSON.stringify({ canonical_name: '原件项目名称' }))
    const registry = await ResearchRegistry.open(researchRoot)
    const provider = new WorkspaceResearchProvider({ rootDir: root })
    const result = await provider.fetch(registry.source('workspace-project-files'), {
      mode: 'workspace_file', locator: path, workflowId: 'preplan.wf.01.01', dataPointId: 'canonical-name',
      selector: { type: 'json_pointer', pointer: '/canonical_name' },
    })
    expect(result.records[0]).toMatchObject({ normalizedValue: '原件项目名称', claimClass: 'source_conclusion' })
  })

  it('rejects binary/unsupported files instead of pretending they satisfy a data point', async () => {
    const root = await workspace()
    await writeFile(join(root, 'drawing.pdf'), Buffer.from('%PDF-1.7\n', 'utf8'))

    const registry = await ResearchRegistry.open(researchRoot)
    const provider = new WorkspaceResearchProvider({ rootDir: root })

    await expect(provider.fetch(registry.source('workspace-project-files'), {
      mode: 'workspace_file',
      locator: 'drawing.pdf',
      workflowId: 'preplan.wf.01.01',
      dataPointId: 'canonical-name',
    })).rejects.toThrow(/unsupported workspace file extension/u)
  })
})
