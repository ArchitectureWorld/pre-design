import { createHash } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { registerPreplanningTools } from '../src/tools/register.ts'
import { peerRequest } from './helpers/peer-research-fixture.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'peer-tools-')); roots.push(root)
  const request = peerRequest(), source = request.captures[0]
  const { content, sha256: _hash, schemaVersion: _version, ...metadata } = source
  const document = { ...metadata, path: 'raw.json' }
  await writeFile(join(root, 'raw.json'), content)
  await writeFile(join(root, 'project.json'), JSON.stringify({ projectId: 'standard-peer' }))
  let revision = 3
  let onRead = () => {}
  const definitions: ToolDefinition[] = []
  registerPreplanningTools({ tools: { register: (tool: ToolDefinition) => definitions.push(tool) } } as never, {
    repository: { readContext: () => { onRead(); return { project: { projectId: 'project-peers', currentRevision: revision } } } },
    researchWorkspaceBinding: () => ({ root, standardProjectId: 'standard-peer' }),
    gateway: {}, governance: {}, runtime: {}, registry: {},
  } as never)
  const exec = { agent: { id: 'peer-session', session: { header: { cwd: root } } }, signal: new AbortController().signal }
  const call = async (name: string, args: unknown, context = exec): Promise<any> => {
    const tool = definitions.find(d => d.name === name)
    expect(tool, `native tool ${name} is registered`).toBeDefined()
    return tool!.execute(args as never, context as never)
  }
  const read = () => call('preplanning_read_research_source', { document })
  const runArgs = (readResult: any) => ({ contextToken: readResult.contextToken, scope: request.scope, asOf: request.asOf,
    documents: [readResult.document], peers: request.peers })
  return { root, content, document, exec, call, read, runArgs, setRevision: (value: number) => { revision = value },
    onRead: (fn: () => void) => { onRead = fn } }
}

describe('native peer research tools', () => {
  it('reads exact source bytes and creates a replayable run from native arguments without a request file', async () => {
    const f = await fixture(), source = await f.read()
    expect(source).toMatchObject({ projectId: 'project-peers', revision: 3, content: f.content,
      document: { path: 'raw.json', expectedSha256: createHash('sha256').update(f.content).digest('hex') } })
    expect(existsSync(join(f.root, 'research'))).toBe(false)
    const result = await f.call('preplanning_research_peers', f.runArgs(source))
    expect(result).toMatchObject({ projectId: 'project-peers', snapshotId: 'revision-3', publicationGranted: false,
      networkRequests: 0, summary: { total: 3, operatingSupply: 0, references: 1 } })
    const request = JSON.parse(await readFile(join(f.root, result.relativePath, 'request.json'), 'utf8'))
    expect(request.captures[0]).toMatchObject({ content: f.content, intake: { relativePath: 'raw.json' } })
    expect(request.peers[0].claims[0].selector).toEqual({ type: 'json-pointer', pointer: '/rows/0/name' })
    expect(await readFile(join(f.root, result.reportPath), 'utf8')).toContain('合成邻里运动馆')
    await writeFile(join(f.root, 'raw.json'), 'source changed after archival')
    expect(await f.call('preplanning_verify_peer_research', { runId: result.runId })).toMatchObject({ valid: true,
      replayed: true, checkedPeers: 3, networkRequests: 0, publicationGranted: false })
  })

  it('rejects a stale source read even when the changed bytes are unrelated to selected fields', async () => {
    const f = await fixture(), source = await f.read()
    await writeFile(join(f.root, 'raw.json'), f.content + '\n')
    await expect(f.call('preplanning_research_peers', f.runArgs(source))).rejects.toThrow('RESEARCH_SOURCE_CHANGED')
    expect(existsSync(join(f.root, 'research/runs'))).toBe(false)
  })

  it('rejects a stale project revision before writing', async () => {
    const f = await fixture(), source = await f.read(); f.setRevision(4)
    await expect(f.call('preplanning_research_peers', f.runArgs(source))).rejects.toThrow('RESEARCH_CONTEXT_CHANGED')
    expect(existsSync(join(f.root, 'research/runs'))).toBe(false)
  })

  it.each(['revision', 'source'])('rejects %s changes at commit and cleans the pending run', async kind => {
    const f = await fixture(), source = await f.read(); let reads = 0
    f.onRead(() => { if (++reads === 2) {
      if (kind === 'revision') f.setRevision(4)
      else writeFileSync(join(f.root, 'raw.json'), f.content + '\n')
    } })
    await expect(f.call('preplanning_research_peers', f.runArgs(source))).rejects.toThrow(
      kind === 'revision' ? 'RESEARCH_CONTEXT_CHANGED' : 'RESEARCH_SOURCE_CHANGED')
    expect(await readdir(join(f.root, 'research/runs'))).toEqual([])
  })

  it('rejects a workspace identity mismatch and does not read its requested source', async () => {
    const f = await fixture()
    await writeFile(join(f.root, 'project.json'), JSON.stringify({ projectId: 'another-project' }))
    await expect(f.call('preplanning_read_research_source', { document: { ...f.document, path: 'missing.json' } }))
      .rejects.toThrow('RESEARCH_WORKSPACE_IDENTITY_MISMATCH')
  })

  it('rejects path escapes and aborted calls without publishing anything', async () => {
    const f = await fixture()
    await expect(f.call('preplanning_read_research_source', { document: { ...f.document, path: '../private.json' } }))
      .rejects.toThrow('RESEARCH_PATH_INVALID')
    const source = await f.read()
    await expect(f.call('preplanning_research_peers', f.runArgs(source), { ...f.exec, signal: AbortSignal.abort() }))
      .rejects.toThrow()
    expect(existsSync(join(f.root, 'research/runs'))).toBe(false)
  })

  it('returns parsed HTML text while retaining the raw snapshot as untrusted evidence', async () => {
    const f = await fixture(), content = '<h1>现场记录</h1><script>throw new Error("UNTRUSTED_SCRIPT")</script>'
    await writeFile(join(f.root, 'source.html'), content)
    const source = await f.call('preplanning_read_research_source', { document: { ...f.document, path: 'source.html', mediaType: 'text/html' } })
    expect(source.content).toBe(content)
    expect(source.text).toContain('现场记录')
    expect(source.text).not.toContain('UNTRUSTED_SCRIPT')
    expect(source.independentlyVerified).toBe(false)
  })

  it('rejects model-supplied captures and malformed claims without leaking source values', async () => {
    const f = await fixture(), source = await f.read(), args = f.runArgs(source)
    await expect(f.call('preplanning_research_peers', { ...args, captures: [{ content: 'FAKE' }] }))
      .rejects.toThrow('PEER_TOOL_INPUT_INVALID')
    args.peers[0].claims[0].value = 'PRIVATE_FABRICATED_NAME'
    await expect(f.call('preplanning_research_peers', args)).rejects.toThrow('SOURCE_VALUE_MISMATCH')
    expect(existsSync(join(f.root, 'research/runs'))).toBe(false)
  })

  it('rejects duplicated documents and missing snapshot hashes before writing', async () => {
    const f = await fixture(), source = await f.read(), args = f.runArgs(source)
    await expect(f.call('preplanning_research_peers', { ...args, documents: [source.document, source.document] }))
      .rejects.toThrow('SOURCE_ID_DUPLICATE')
    const { expectedSha256: _hash, ...withoutHash } = source.document
    await expect(f.call('preplanning_research_peers', { ...args, documents: [withoutHash] }))
      .rejects.toThrow('documents[0].expectedSha256')
    expect(existsSync(join(f.root, 'research/runs'))).toBe(false)
  })

  it('rejects changed archived results through the native verifier', async () => {
    const f = await fixture(), source = await f.read()
    const result = await f.call('preplanning_research_peers', f.runArgs(source))
    await writeFile(join(f.root, result.relativePath, 'report.html'), 'altered report')
    await expect(f.call('preplanning_verify_peer_research', { runId: result.runId })).rejects.toThrow('BUNDLE_FILE_HASH_MISMATCH')
  })
})
