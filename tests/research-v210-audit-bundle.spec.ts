import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runRegionalOd } from '../src/research-v2/regional-od.ts'
import { regionalRequest, osrmResponse, jsonResponse } from './helpers/regional-od-fixture.ts'
const moduleUrl = new URL('../src/research-v2/regional-bundle.ts',import.meta.url)
async function api(){expect(existsSync(moduleUrl),'audit bundle implemented').toBe(true);return import(moduleUrl.href)}
const now=()=>new Date('2026-09-24T01:00:00Z')
const online=()=>runRegionalOd(regionalRequest(),{now,allowNetwork:true,fetch:async()=>jsonResponse(osrmResponse())})

describe('same-source artifact production and independent replay',()=>{
  it('produces real CSV, GeoJSON, native HTML and two distinct SVG outputs with source bindings',async()=>{
    const {buildRegionalAuditBundle,verifyRegionalAuditBundle}=await api()
    const result=await online(),bundle=buildRegionalAuditBundle(result)
    expect(bundle.files['datasets/regional-od.csv']).toContain('1700')
    expect(JSON.parse(bundle.files['datasets/regional-nodes.geojson']).features).toHaveLength(2)
    expect(bundle.files['FIG-2.03-01.svg']).toContain('无地理底图')
    expect(bundle.files['FIG-2.03-02.svg']).toContain('4.0')
    expect(bundle.files['report.html']).toContain('<table')
    expect(bundle.files['report.html']).toContain('data-claim-id="claim-OD-a-b-roadMeters"')
    expect(verifyRegionalAuditBundle(bundle).valid).toBe(true)
    expect(bundle.manifest.artifacts[0].state).toBe('produced_limited')
  })
  it('omits unsupported route-map output rather than drawing a straight line as a route',async()=>{
    const {buildRegionalAuditBundle}=await api(),bundle=buildRegionalAuditBundle(await runRegionalOd(regionalRequest(),{now}))
    expect(bundle.files['FIG-2.03-01.svg']).toBeUndefined()
    expect(bundle.manifest.artifacts.find((a:any)=>a.artifactId==='FIG-2.03-01').state).toBe('omitted')
    expect(bundle.files['FIG-2.03-02.svg']).toContain('未取得')
    expect(bundle.files['report.html']).not.toContain('>0.0 分钟<')
  })
  it('replays raw provider captures offline and checks outputs without fetching a website',async()=>{
    const {buildRegionalAuditBundle,replayRegionalAuditBundle}=await api()
    const audit=await replayRegionalAuditBundle(buildRegionalAuditBundle(await online()))
    expect(audit).toMatchObject({valid:true,replayed:true,networkRequests:0})
    expect(audit.checkedRows).toBe(1)
  })
  it('also replays no-route responses and explicit offline execution',async()=>{
    const {buildRegionalAuditBundle,replayRegionalAuditBundle}=await api()
    for (const result of [await runRegionalOd(regionalRequest(),{now}),await runRegionalOd(regionalRequest(),{now,allowNetwork:true,fetch:async()=>jsonResponse({code:'NoRoute'})})]) {
      expect((await replayRegionalAuditBundle(buildRegionalAuditBundle(result))).valid).toBe(true)
    }
  })
  it('detects changed figure bytes and unlisted files',async()=>{
    const {buildRegionalAuditBundle,verifyRegionalAuditBundle}=await api()
    const bundle=structuredClone(buildRegionalAuditBundle(await online()))
    bundle.files['FIG-2.03-02.svg']+='edited'
    expect(()=>verifyRegionalAuditBundle(bundle)).toThrow('BUNDLE_FILE_HASH_MISMATCH')
    const extra=structuredClone(buildRegionalAuditBundle(await online()));extra.files['unexpected.txt']='x'
    expect(()=>verifyRegionalAuditBundle(extra)).toThrow('BUNDLE_FILE_SET_MISMATCH')
  })
  it('does not execute labels as HTML and protects CSV consumers from formula injection',async()=>{
    const {buildRegionalAuditBundle}=await api(),input=regionalRequest()
    input.nodes[1].label='=HYPERLINK("evil")<script>alert(1)</script>'
    const bundle=buildRegionalAuditBundle(await runRegionalOd(input,{now}))
    expect(bundle.files['report.html']).not.toContain('<script>')
    expect(bundle.files['report.html']).toContain('&lt;script&gt;')
    expect(bundle.files['datasets/regional-od.csv']).toContain("'=HYPERLINK")
    expect(JSON.parse(bundle.files['datasets/regional-nodes.geojson']).features[1].properties.label).toBe(input.nodes[1].label)
  })
})

describe('adversarial rehashed audit metadata',()=>{
  it('rejects edited output ports even when every file hash is recomputed',async()=>{
    const {buildRegionalAuditBundle,replayRegionalAuditBundle}=await api()
    const {sha256CanonicalJson}=await import('../src/presentation/canonical-json.ts')
    const {sha256Bytes}=await import('../src/research-v2/regional-od.ts')
    const bundle=structuredClone(buildRegionalAuditBundle(await online())) as any
    const result=JSON.parse(bundle.files['result.json']);result.outputs.regional_od.records[0].roadMeters=99
    bundle.files['result.json']=JSON.stringify(result,null,2)+'\n'
    for(const f of bundle.manifest.files){f.sha256=sha256Bytes(bundle.files[f.path]);f.sizeBytes=Buffer.byteLength(bundle.files[f.path])}
    const {manifestHash:_,...core}=bundle.manifest;bundle.manifest.manifestHash=sha256CanonicalJson(core)
    await expect(replayRegionalAuditBundle(bundle)).rejects.toThrow('REPLAY_RESULT_MISMATCH')
  })
  it('refuses a self-declared publication upgrade in a rehashed manifest',async()=>{
    const {buildRegionalAuditBundle,verifyRegionalAuditBundle}=await api()
    const {sha256CanonicalJson}=await import('../src/presentation/canonical-json.ts')
    const bundle=structuredClone(buildRegionalAuditBundle(await online())) as any
    bundle.manifest.publicationGranted=true
    const {manifestHash:_,...core}=bundle.manifest;bundle.manifest.manifestHash=sha256CanonicalJson(core)
    expect(()=>verifyRegionalAuditBundle(bundle)).toThrow('BUNDLE_MANIFEST_INVALID')
  })
})
