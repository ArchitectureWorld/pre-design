import { runRegionalOd } from '../src/research-v2/regional-od.ts'
import { existsSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { regionalRequest, osrmResponse, jsonResponse } from './helpers/regional-od-fixture.ts'
const implementation = new URL('../src/research-v2/regional-od.ts', import.meta.url)
async function api() { expect(existsSync(implementation), 'regional OD runner is implemented').toBe(true); return import(implementation.href) }
const now = () => new Date('2026-09-24T01:00:00.000Z')

describe('source-bound regional OD vertical slice', () => {
  it('defaults to offline, computes geodesic distance, and never invents road/time values', async () => {
    const { runRegionalOd } = await api(), fetch = vi.fn()
    const result = await runRegionalOd(regionalRequest(), { fetch, now })
    expect(fetch).not.toHaveBeenCalled()
    expect(result.rows[0].straightMeters).toBeGreaterThan(1400)
    expect(result.rows[0].roadMeters).toBeNull()
    expect(result.rows[0].durationSeconds).toBeNull()
    expect(result.rows[0].issues).toContain('ROUTING_NOT_AUTHORIZED')
    expect(result.publicationGranted).toBe(false)
    expect(result.outputs.regional_od.quality).toBe('limited')
  })
  it('uses the existing OSRM adapter, captures raw bytes, preserves units and assumption restrictions', async () => {
    const { runRegionalOd } = await api()
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(osrmResponse()))
    const result = await runRegionalOd(regionalRequest(), { fetch, now, allowNetwork: true })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toContain('router.project-osrm.org/route/v1/driving/')
    expect(result.rows[0]).toMatchObject({ roadMeters: 1700, durationSeconds: 240, timeBasis: 'static-network-model' })
    expect(result.receipts[0].sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.claims.every((c: any) => c.resultClass === 'calculation' && c.limitations.length > 0)).toBe(true)
    expect(result.claims.some((c: any) => c.inputClaimClasses.includes('assumption'))).toBe(true)
    expect(result.rows[0].limitations.join(' ')).toContain('入口')
  })
  it.each(['GCJ-02','BD-09','EPSG:0000'])('rejects %s before any network call', async crs => {
    const { runRegionalOd } = await api(), input = regionalRequest(), fetch = vi.fn()
    input.nodes[0].coordinate.crs = crs
    await expect(runRegionalOd(input, { fetch, allowNetwork: true })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects a coordinate that disagrees with its captured JSON selector', async () => {
    const { runRegionalOd } = await api(), input = regionalRequest()
    input.nodes[0].coordinate.longitude = 110
    await expect(runRegionalOd(input)).rejects.toThrow('COORDINATE_SOURCE_MISMATCH')
  })
  it('rejects missing evidence and duplicate identifiers instead of silently dropping nodes', async () => {
    const { runRegionalOd } = await api(), input = regionalRequest()
    input.nodes[1].evidenceIds = ['absent']
    await expect(runRegionalOd(input)).rejects.toThrow('EVIDENCE_REFERENCE_MISSING')
    const duplicate = regionalRequest(); duplicate.nodes[1].id = duplicate.nodes[0].id
    await expect(runRegionalOd(duplicate)).rejects.toThrow('DUPLICATE_ID')
  })
  it('does not reinterpret walking as driving', async () => {
    const { runRegionalOd } = await api(), input = regionalRequest(), fetch = vi.fn()
    input.queries[0].mode = 'walking'
    const result = await runRegionalOd(input, { fetch, allowNetwork: true })
    expect(fetch).not.toHaveBeenCalled()
    expect(result.rows[0].roadMeters).toBeNull()
    expect(result.rows[0].issues).toContain('MODE_UNSUPPORTED')
  })
  it('retains the missing-route response and produces a bounded fallback', async () => {
    const { runRegionalOd } = await api()
    const result = await runRegionalOd(regionalRequest(), { now, allowNetwork: true, fetch: async () => jsonResponse({code:'NoRoute'}) })
    expect(result.rows[0].roadMeters).toBeNull()
    expect(result.receipts[0].body).toContain('NoRoute')
    expect(result.rows[0].issues).toContain('ROUTE_RESPONSE_INVALID')
  })
  it('rejects excessive snap and keeps the rejected raw response for inspection', async () => {
    const { runRegionalOd } = await api(), response = osrmResponse()
    response.waypoints[0].distance = 100
    const result = await runRegionalOd(regionalRequest(), { now, allowNetwork: true, fetch: async () => jsonResponse(response) })
    expect(result.rows[0].roadMeters).toBeNull()
    expect(result.rows[0].issues).toContain('ROUTE_SNAP_EXCEEDED')
    expect(result.receipts).toHaveLength(1)
  })
  it('does not accept fabricated snap metadata or negative measurements', async () => {
    const { runRegionalOd } = await api(), response = osrmResponse()
    response.waypoints[0].location = [114.4,30.6]
    let result = await runRegionalOd(regionalRequest(), { allowNetwork: true, fetch: async () => jsonResponse(response) })
    expect(result.rows[0].issues).toContain('ROUTE_SNAP_INCONSISTENT')
    const negative = osrmResponse(); negative.routes[0].duration = -1
    result = await runRegionalOd(regionalRequest(), { allowNetwork: true, fetch: async () => jsonResponse(negative) })
    expect(result.rows[0].issues).toContain('ROUTE_MEASUREMENT_INVALID')
  })
  it('requires a reviewed project-specific snap tolerance before routing', async () => {
    const { runRegionalOd } = await api(), input: any = regionalRequest(), fetch = vi.fn()
    delete input.policy.snapTolerance
    const result = await runRegionalOd(input, { fetch, allowNetwork: true })
    expect(fetch).not.toHaveBeenCalled()
    expect(result.rows[0].issues).toContain('SNAP_TOLERANCE_REQUIRED')
  })
  it('keeps direction-specific OD queries separate and respects the network request cap', async () => {
    const { runRegionalOd } = await api(), input = regionalRequest()
    input.policy.maxRequests = 1
    input.queries.push({id:'OD-b-a',fromId:'entry-b',toId:'entry-a',mode:'driving'})
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(osrmResponse()))
    const result = await runRegionalOd(input, { fetch, now, allowNetwork:true })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.rows[1]).toMatchObject({ fromId:'entry-b',toId:'entry-a',roadMeters:null })
    expect(result.rows[1].issues).toContain('REQUEST_BUDGET_EXHAUSTED')
  })
  it('honors abort and never treats cancellation as a successful partial run', async () => {
    const { runRegionalOd } = await api(), control = new AbortController()
    control.abort(new Error('user cancelled'))
    await expect(runRegionalOd(regionalRequest(), { signal:control.signal })).rejects.toThrow('user cancelled')
  })
  it('escapes malicious labels and gives every actual number a same-snapshot claim', async () => {
    const { runRegionalOd } = await api(), input=regionalRequest()
    input.nodes[1].label='<script>alert(1)</script>'
    const result=await runRegionalOd(input,{now})
    expect(result.rows[0].claimRefs.length).toBeGreaterThan(0)
    expect(result.claims.every((c:any)=>c.snapshotId===input.snapshotId)).toBe(true)
    expect(result.inputSha256).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('bounded transport and historical scope',()=>{
  it('cancels an unresponsive response body when the invocation is aborted',async()=>{
    const controller=new AbortController()
    const request=regionalRequest()
    const execution=runRegionalOd(request,{allowNetwork:true,signal:controller.signal,fetch:async()=>{
      setTimeout(()=>controller.abort(new Error('BODY_CANCELLED')),10)
      return new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}})
    }})
    const outcome=await Promise.race([execution.then(()=> 'unexpected success',e=>e.message),new Promise<string>(r=>setTimeout(()=>r('hung'),200))])
    expect(outcome).toBe('BODY_CANCELLED')
  })
  it('does not present a current route response as historical asOf travel data',async()=>{
    const input=regionalRequest();input.asOf='2020-01-01'
    const result=await runRegionalOd(input,{allowNetwork:true,now:()=>new Date('2026-09-24T01:00:00Z'),fetch:async()=>jsonResponse(osrmResponse())})
    expect(result.rows[0].limitations.join(' ')).toContain('研究日期')
    expect(result.rows[0].limitations.join(' ')).toContain('抓取')
  })
})

it('records injected transport separately instead of claiming an online observation',async()=>{
  const result=await runRegionalOd(regionalRequest(),{allowNetwork:true,now,fetch:async()=>jsonResponse(osrmResponse())})
  expect((result as any).transportMode).toBe('injected')
})
