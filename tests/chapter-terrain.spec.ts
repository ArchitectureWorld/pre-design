import { expect,it } from 'vitest'
import { terrainReliefPixels } from '../src/report/chapter-terrain.ts'

it('projects east/north coordinates north-up, separates water and leaves missing data transparent',()=>{
  const grid={rows:2,columns:2,x:[0,1,0,1],y:[0,0,1,1],z:[10,20,30,40],valid:[1,0,1,1],water:[1,0,0,0]}
  const r=terrainReliefPixels(grid)
  expect(r.bounds).toEqual([0,0,1,1])
  expect([...r.pixels.subarray(8,12)]).toEqual([70,131,157,255])
  expect(r.pixels[15]).toBe(0)
  expect(r.pixels[3]).toBe(255);expect(r.pixels[7]).toBe(255)
  expect([...r.pixels.subarray(0,3)]).not.toEqual([...r.pixels.subarray(4,7)])
})
