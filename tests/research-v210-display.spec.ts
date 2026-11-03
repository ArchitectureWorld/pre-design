import { existsSync } from 'node:fs'
import { describe,expect,it } from 'vitest'
async function api() { expect(existsSync(new URL('../src/research-v2/display-policy.ts',import.meta.url))).toBe(true); return import('../src/research-v2/display-policy.ts') }
describe('v1.2 deliverable size contracts',()=>{
  it('keeps screen and A3 independent rather than a scaled version of one canvas',async()=>{
    const a=await api()
    expect(a.DISPLAY_PROFILES.screen169.canvas).toEqual({width:1280,height:720,unit:'px'})
    expect(a.DISPLAY_PROFILES.a3.canvas).toEqual({width:420,height:297,unit:'mm'})
    expect(a.DISPLAY_PROFILES.a3.bodyMinPt).toBe(10)
    expect(a.DISPLAY_PROFILES.screen169.bodyMinPt).toBe(15)
  })
  it('computes print density from physical placement, with different photo and line minima',async()=>{
    const a=await api(), photo=a.assessRasterPlacement({profile:'a3',widthPx:2400,heightPx:1600,boxWidth:250,boxHeight:166.666667,content:'photo',fit:'contain'})
    expect(photo.minimumDensity).toBe(200); expect(photo.density).toBeCloseTo(243.84,1); expect(photo.passed).toBe(true)
    expect(a.assessRasterPlacement({profile:'a3',widthPx:2400,heightPx:1600,boxWidth:250,boxHeight:166.666667,content:'analysis',fit:'contain'}).passed).toBe(false)
  })
  it('rejects cropped analytical figures and insufficient screen pixels',async()=>{
    const a=await api()
    expect(a.assessRasterPlacement({profile:'screen169',widthPx:2400,heightPx:1600,boxWidth:800,boxHeight:300,content:'analysis',fit:'cover'}).issues).toContain('ANALYTICAL_CROP')
    expect(a.assessRasterPlacement({profile:'screen169',widthPx:400,heightPx:300,boxWidth:800,boxHeight:600,content:'photo',fit:'contain'}).issues).toContain('DENSITY_LOW')
  })
  it('uses the actual contained image size, not the unused letterbox as displayed pixels',async()=>{
    const a=await api(), r=a.assessRasterPlacement({profile:'screen169',widthPx:800,heightPx:400,boxWidth:800,boxHeight:600,content:'analysis',fit:'contain'})
    expect(r.density).toBe(1); expect(r.visibleSize).toEqual({width:800,height:400}); expect(r.passed).toBe(true)
    expect(r.publicationGranted).toBe(false)
  })
  it('fails closed for malformed dimensions, unsupported modes and oversized page boxes',async()=>{
    const a=await api(), base={profile:'a3',widthPx:2400,heightPx:1600,boxWidth:250,boxHeight:160,content:'photo',fit:'contain'} as const
    expect(()=>a.assessRasterPlacement({...base,widthPx:NaN})).toThrow('PLACEMENT_INVALID')
    expect(()=>a.assessRasterPlacement({...base,profile:'invented'} as never)).toThrow('PLACEMENT_INVALID')
    expect(()=>a.assessRasterPlacement({...base,fit:'stretch'} as never)).toThrow('PLACEMENT_INVALID')
    expect(()=>a.assessRasterPlacement({...base,boxWidth:900})).toThrow('PLACEMENT_INVALID')
  })
})
