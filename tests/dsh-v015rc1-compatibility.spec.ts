import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const DSH_VERSION = '0.1.5-rc.1'

async function json(path: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(resolve(root, path), 'utf8')) as Record<string, any>
}

describe('DSH 0.1.5-rc.1 deployment baseline', () => {
  it('pins every direct DSH package to one rc.1 baseline and removes the retired client runtime', async () => {
    const manifest = await json('package.json')
    const declared = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
    } as Record<string, string>

    expect(declared['@deepseek-ai/dsh-client-runtime']).toBeUndefined()
    expect(declared['@deepseek-ai/dsh-api-remotes']).toBe(DSH_VERSION)
    expect(declared['@deepseek-ai/dsh-api-session-controller']).toBe(DSH_VERSION)
    expect(declared['@deepseek-ai/dsh-api-workspace-controller']).toBe(DSH_VERSION)
    expect(declared['@deepseek-ai/dsh-client-ui-layout']).toBe(DSH_VERSION)
    expect(declared['@deepseek-ai/dsh-client-ui-sidebar']).toBe(DSH_VERSION)
    expect(declared['@deepseek-ai/dsh-client-ui-workspace']).toBe(DSH_VERSION)

    for (const [name, version] of Object.entries(declared)) {
      if (name.startsWith('@deepseek-ai/dsh-')) expect(version, name).toBe(DSH_VERSION)
    }
  })

  it('records rc.1 as the deployable compatibility baseline', async () => {
    const baseline = await json('compatibility/dsh-baseline.json')
    expect(baseline.dsh?.version).toBe(DSH_VERSION)
    expect(baseline.official_source?.tag).toBe('dsh-v0.1.5-rc.1')
    expect(baseline.compatibility?.supported_dsh_versions).toEqual([DSH_VERSION])
  })

  it('uses the rc.1 owner packages instead of the pre-0.1.5 client runtime facade', async () => {
    const source = await readFile(resolve(root, 'src/client/index.tsx'), 'utf8')
    expect(source).not.toContain('@deepseek-ai/dsh-client-runtime/client')
    expect(source).toContain('@deepseek-ai/dsh-api-remotes/client')
    expect(source).toContain('@deepseek-ai/dsh-api-session-controller/client')
    expect(source).toContain('@deepseek-ai/dsh-api-workspace-controller/client')
    expect(source).toContain('@deepseek-ai/dsh-client-ui-layout/client')
    expect(source).toContain('@deepseek-ai/dsh-client-ui-sidebar/client')
    expect(source).toContain('@deepseek-ai/dsh-client-ui-workspace/client')
  })
})
