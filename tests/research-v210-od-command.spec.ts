import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RepositoryError } from '../src/state/repository.ts'
import { regionalRequest } from './helpers/regional-od-fixture.ts'
import { registerPreplanningCommands } from '../src/commands/register.ts'
const moduleUrl=new URL('../src/research-v2/regional-command.ts',import.meta.url)
async function api(){expect(existsSync(moduleUrl),'DSH command implemented').toBe(true);return import(moduleUrl.href)}
const roots:string[]=[]
afterEach(async()=>{for(const r of roots.splice(0))await rm(r,{recursive:true,force:true})})
async function fixture(){
  const r=await mkdtemp(join(tmpdir(),'od-command-'));roots.push(r)
  const input=regionalRequest()
  await writeFile(join(r,'request.json'),JSON.stringify(input))
  const standardProjectId='project_research_fixture'
  await writeFile(join(r,'project.json'),JSON.stringify({projectId:standardProjectId}))
  const boundProjectId=input.projectId
  const deps={readContext:()=>({project:{projectId:boundProjectId,currentRevision:2}}),
    resolveBinding:()=>({root:r,standardProjectId}),now:()=>new Date('2026-09-24T01:00:00Z')}
  const invocation={rawInput:'--input=request.json',signal:new AbortController().signal,
    agent:{id:'session-regional',session:{header:{cwd:r}}}}
  return {r,deps,invocation,input}
}

describe('real DSH regional calculation command',()=>{
  it('normalizes the real repository unbound-session error without exposing session identifiers',async()=>{
    const {createRegionalOdCommand}=await api(),f=await fixture()
    const deps={...f.deps,readContext:()=>{throw new RepositoryError('session-not-bound','private session identity')}}
    const result=await createRegionalOdCommand(deps).handler(f.invocation)
    expect(result).toMatchObject({kind:'error',text:expect.stringContaining('RESEARCH_PROJECT_REQUIRED')})
    expect(result.text).not.toContain('private session identity')
  })
  it('is registered alongside the preserved plan and legacy commands',()=>{
    const names:string[]=[]
    registerPreplanningCommands({commands:{register:(d:any)=>{names.push(d.name)}}} as never,{} as never)
    expect(names).toContain('preplan-research-od')
    expect(names).toContain('preplan-research-plan')
    expect(names).toContain('preplan-run')
  })
  it('calculates and persists from the bound workspace without changing the old executor',async()=>{
    const {createRegionalOdCommand}=await api(),f=await fixture()
    const result=await createRegionalOdCommand(f.deps).handler(f.invocation)
    expect(result.kind).toBe('success')
    expect(result.text).toContain('未改变旧57项')
    const ids=await readdir(join(f.r,'research/runs'))
    expect(ids).toHaveLength(1)
    const manifest=JSON.parse(await readFile(join(f.r,'research/runs',ids[0],'manifest.json'),'utf8'))
    expect(manifest.projectId).toBe(f.input.projectId)
  })
  it('rejects a request bound to another project before writing',async()=>{
    const {createRegionalOdCommand}=await api(),f=await fixture()
    f.input.projectId='another-project';await writeFile(join(f.r,'request.json'),JSON.stringify(f.input))
    expect(await createRegionalOdCommand(f.deps).handler(f.invocation)).toMatchObject({kind:'error',text:expect.stringContaining('RESEARCH_PROJECT_MISMATCH')})
    expect(existsSync(join(f.r,'research/runs'))).toBe(false)
  })
  it('rejects workspace identity mismatch and unknown command flags',async()=>{
    const {createRegionalOdCommand}=await api(),f=await fixture()
    await writeFile(join(f.r,'project.json'),JSON.stringify({projectId:'other'}))
    expect(await createRegionalOdCommand(f.deps).handler(f.invocation)).toMatchObject({kind:'error',text:expect.stringContaining('RESEARCH_WORKSPACE_IDENTITY_MISMATCH')})
    f.invocation.rawInput='--input=request.json --yes'
    expect(await createRegionalOdCommand(f.deps).handler(f.invocation)).toMatchObject({kind:'error',text:expect.stringContaining('RESEARCH_COMMAND_INVALID')})
  })
})

describe('command lifecycle guards',()=>{
  it('rechecks revision before publishing and leaves no partial run',async()=>{
    const {createRegionalOdCommand}=await api(),f=await fixture()
    let reads=0
    const deps={...f.deps,readContext:()=>({project:{projectId:f.input.projectId,currentRevision:++reads}})}
    expect(await createRegionalOdCommand(deps).handler(f.invocation)).toMatchObject({kind:'error',text:expect.stringContaining('RESEARCH_CONTEXT_CHANGED')})
    expect(await readdir(join(f.r,'research/runs'))).toHaveLength(0)
  })
  it('supports no-network verification through the same real command',async()=>{
    const {createRegionalOdCommand}=await api(),f=await fixture(),command=createRegionalOdCommand(f.deps)
    await command.handler(f.invocation)
    const [id]=await readdir(join(f.r,'research/runs'))
    f.invocation.rawInput=`--verify=${id}`
    expect(await command.handler(f.invocation)).toMatchObject({kind:'success',text:expect.stringContaining('"networkRequests":0')})
    expect(await readdir(join(f.r,'research/runs'))).toHaveLength(1)
  })
})
