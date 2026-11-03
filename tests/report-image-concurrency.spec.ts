import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {expect,it} from 'vitest'
import {ReportImagePipeline} from '../src/presentation/report-image-pipeline.ts'
import type {FrozenProjectInput} from '../src/report/types.ts'

it('does not attach reuse-only export to an image run allowed to generate',async()=>{
  const root=await mkdtemp(join(tmpdir(),'image-budget-concurrency-'))
  let started!:()=>void,release!:()=>void
  const entered=new Promise<void>(r=>{started=r}),hold=new Promise<void>(r=>{release=r})
  const input:FrozenProjectInput={projectId:'p',projectName:'项目',revision:1,generatedAt:'2026-09-27',recommendation:'研究',decisionItems:[],gates:[],visualAssets:[],stateObjects:[]}
  const controller=new AbortController()
  const pipeline=new ReportImagePipeline({classes:{settings:()=>({routes:{review:{provider:'test',model:'test'}}})},inspection:{},
    candidates:async()=>{started();await hold;return[]}} as any)
  const first=pipeline.prepare(input,root,{} as any,controller.signal,()=>{},{maxGenerations:8})
  const settled=first.catch(error=>error)
  try{
    await entered
    expect(pipeline.prepare(input,root,{} as any,controller.signal,()=>{},{maxGenerations:8})).toBe(first)
    const second=pipeline.prepare(input,root,{} as any,controller.signal,()=>{},{maxGenerations:0})
    expect(second).not.toBe(first)
    await expect(second).rejects.toThrow('REPORT_IMAGE_GENERATION_OPTIONS_CONFLICT')
  }finally{controller.abort(new Error('fixture complete'));release();await settled;await rm(root,{recursive:true,force:true})}
})
