import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerPreplanningTools } from '../src/tools/register.ts'
import { WorkspaceMaterialReader } from '../src/materials/workspace-materials.ts'
import { materialPdf } from './support/material-pdf.ts'

const cleanup: string[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pre-material-tool-'))
  cleanup.push(root)
  await mkdir(join(root, '原始资料'))
  await writeFile(join(root, '原始资料', 'source.pdf'), materialPdf(['Bound workspace source']))
  const definitions: ToolDefinition[] = []
  registerPreplanningTools({ tools: { register: (tool: ToolDefinition) => definitions.push(tool) } } as never, {
    materialReader: new WorkspaceMaterialReader(),
    repository: { readContext: (id: string) => {
      if (id !== 'bound-session') throw new Error('Session is not bound')
      return { project: { projectId: 'p', name: '测试项目', currentRevision: 0, currentStage: '01-01' },
        stateObjects: [], questions: [], proposals: [], events: [] }
    } },
    governance: { readProject: () => ({ authorizations: [], gateDecisions: [], visualTasks: [], visualAssets: [], reportPackages: [] }) },
    runtime: { snapshot: () => ({ runs: [], chapters: [], blocked: [] }), nextReady: () => ({ targetObjectId: 'PS01', requiredUpstream: [] }) },
    registry: { stateSchema: () => ({ $id: 'urn:test:PS01' }), stateExample: () => ({ object_id: 'PS01' }) }, gateway: {},
  } as never)
  const exec: any = { agent: { id: 'bound-session', session: { header: { cwd: root } } }, signal: new AbortController().signal }
  return { root, definitions, exec }
}

describe('native preplanning source tool', () => {
  it('provides readable source inventory alongside the unchanged target contract', async () => {
    const { definitions, exec } = await fixture()
    const result = await definitions.find(tool => tool.name === 'preplanning_get_context')!.execute({}, exec)
    expect(result).toMatchObject({ targetSchema: { $id: 'urn:test:PS01' }, workspaceMaterials: {
      status: 'available', readTool: 'preplanning_read_material', files: [{ path: '原始资料/source.pdf', readable: true }],
    } })
  })

  it('returns actual source page text through the DSH model-facing output renderer', async () => {
    const { definitions, exec } = await fixture()
    const tool = definitions.find(tool => tool.name === 'preplanning_read_material')
    expect(tool).toBeDefined()
    const args = { path: '原始资料/source.pdf', maxPages: 1 }
    const value = await tool!.execute(args, exec)
    expect(value).toMatchObject({ status: 'ok', pages: [{ page: 1, text: 'Bound workspace source' }] })
    const rendered = tool!.output.render(args, value as never)
    expect(JSON.stringify(rendered)).toContain('Bound workspace source')
  })

  it('requires a bound session and an explicit session workspace instead of using the developer cwd', async () => {
    const { definitions, exec } = await fixture()
    const tool = definitions.find(tool => tool.name === 'preplanning_read_material')
    expect(tool).toBeDefined()
    await expect(tool!.execute({ path: 'package.json' }, { ...exec, agent: { id: 'unbound' } } as never)).rejects.toThrow(/not bound/)
    await expect(tool!.execute({ path: 'package.json' }, { ...exec, agent: { id: 'bound-session' } } as never)).rejects.toThrow(/workspace/)
  })
})
