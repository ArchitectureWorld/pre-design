import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
      claimClass: 'fact',
      normalizedValue: { projectName: '武汉站改造' },
    })
    expect(record.sourceUri).toMatch(/^file:\/\//u)
    expect(record.contentHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(record.locator).toMatchObject({ relativePath: 'inputs/project.json' })
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