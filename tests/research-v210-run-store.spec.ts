import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runRegionalOd } from '../src/research-v2/regional-od.ts'
import { buildRegionalAuditBundle } from '../src/research-v2/regional-bundle.ts'
import { regionalRequest } from './helpers/regional-od-fixture.ts'
const moduleUrl=new URL('../src/research-v2/run-store.ts',import.meta.url)
async function api(){expect(existsSync(moduleUrl),'append-only store implemented').toBe(true);return import(moduleUrl.href)}
const roots:string[]=[]
async function root(){const path=await mkdtemp(join(tmpdir(),'research-m2-'));roots.push(path);return path}
afterEach(async()=>{for(const r of roots.splice(0))await rm(r,{recursive:true,force:true})})
async function bundle(){return buildRegionalAuditBundle(await runRegionalOd(regionalRequest()))}

describe('isolated immutable research run store',()=>{
  it('writes two separate snapshots and reloads a byte-verified audit bundle',async()=>{
    const {saveRegionalAuditBundle,readRegionalAuditBundle}=await api(),r=await root(),b=await bundle()
    const one=await saveRegionalAuditBundle(r,b),two=await saveRegionalAuditBundle(r,b)
    expect(one.runId).not.toBe(two.runId)
    expect(one.relativePath).toMatch(/^research\/runs\/RUN-/)
    const loaded=await readRegionalAuditBundle(r,one.runId)
    expect(loaded.manifest.manifestHash).toBe(b.manifest.manifestHash)
    expect(await readFile(join(r,one.relativePath,'report.html'),'utf8')).toContain('重要区域')
  })
  it('rejects path traversal and symlink input components',async()=>{
    const {readRegionalRequestFile}=await api(),r=await root(),outside=await root()
    await writeFile(join(outside,'input.json'),JSON.stringify(regionalRequest()))
    await expect(readRegionalRequestFile(r,'../input.json')).rejects.toThrow('RESEARCH_PATH_INVALID')
    await symlink(outside,join(r,'alias'),'dir')
    await expect(readRegionalRequestFile(r,'alias/input.json')).rejects.toThrow('RESEARCH_SYMLINK_FORBIDDEN')
  })
  it('does not follow a pre-existing research directory symlink when writing',async()=>{
    const {saveRegionalAuditBundle}=await api(),r=await root(),outside=await root()
    await symlink(outside,join(r,'research'),'dir')
    await expect(saveRegionalAuditBundle(r,await bundle())).rejects.toThrow('RESEARCH_SYMLINK_FORBIDDEN')
    expect(await readdir(outside)).toHaveLength(0)
  })
  it('aborts without publishing a partially written run, including a changed-context precommit',async()=>{
    const {saveRegionalAuditBundle}=await api(),r=await root()
    await expect(saveRegionalAuditBundle(r,await bundle(),{beforeCommit:()=>{throw new Error('CONTEXT_CHANGED')}})).rejects.toThrow('CONTEXT_CHANGED')
    expect(await readdir(join(r,'research/runs'))).toHaveLength(0)
    const c=new AbortController();c.abort(new Error('cancelled'))
    await expect(saveRegionalAuditBundle(r,await bundle(),{signal:c.signal})).rejects.toThrow('cancelled')
  })
  it('detects an altered stored file and never returns a false verified receipt',async()=>{
    const {saveRegionalAuditBundle,readRegionalAuditBundle}=await api(),r=await root()
    const saved=await saveRegionalAuditBundle(r,await bundle())
    await writeFile(join(r,saved.relativePath,'claims.json'),'[]')
    await expect(readRegionalAuditBundle(r,saved.runId)).rejects.toThrow('BUNDLE_FILE_HASH_MISMATCH')
  })
  it('reads UTF-8 filenames safely and blocks a request over its size limit',async()=>{
    const {readRegionalRequestFile}=await api(),r=await root()
    await mkdir(join(r,'资料'))
    await writeFile(join(r,'资料/地域.json'),JSON.stringify(regionalRequest()))
    expect((await readRegionalRequestFile(r,'资料/地域.json')).request.snapshotId).toBe('snapshot-regional-001')
    await writeFile(join(r,'large.json'),' '.repeat(2*1024*1024+1))
    await expect(readRegionalRequestFile(r,'large.json')).rejects.toThrow('RESEARCH_INPUT_TOO_LARGE')
  })
})
