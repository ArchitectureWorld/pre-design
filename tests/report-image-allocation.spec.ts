import { expect, it } from 'vitest'
import { allocateReportImages } from '../src/presentation/report-image-allocation.ts'
import { imageBriefHash, type ImageSlotBrief } from '../src/visual/image-policy.ts'
const brief = (id: string, pageId = id): ImageSlotBrief => ({ id, pageId, version: '1', conclusion: '休闲', subjects: ['座椅'], activities: ['休息'], environment: '中国公园', scale: 'scene', allowedKinds: ['photo'], allowedSources: ['project','web','generated'], locale: 'domestic' })
function candidate(b: ImageSlotBrief, original: string, source = 'project') {
  return { usageId: b.id, source: source as 'project', material: { sourceKey: original + b.id, imageIdentity: { originalId: original, fileSha256: original }, imageQuality: { requirement: b,
    inspection: { imageSha256: original, requirementHash: imageBriefHash(b), usageId: b.id, actualImageInput: true, decision: 'approved' } } } as any }
}
it('counts source families including cover, never reuses on one physical page, and prefers project material', () => {
  const a = brief('cover'), b = brief('p:1','p'), c = brief('p:2','p'), d = brief('q')
  const result = allocateReportImages([a,b,c,d], [candidate(a,'same'),candidate(b,'same'),candidate(c,'same'),candidate(d,'same'),candidate(c,'other','web')])
  expect(result.assigned.filter(r => r.material.imageIdentity!.originalId === 'same')).toHaveLength(2)
  expect(result.assigned.filter(r => r.usageId.startsWith('p:')).map(r => r.material.imageIdentity!.originalId)).not.toEqual(['same','same'])
  expect(result.gaps).toHaveLength(1)
  const single = allocateReportImages([a], [candidate(a,'web','web'),candidate(a,'project')])
  expect(single.assigned[0]!.material.imageIdentity!.originalId).toBe('project')
})
it('excludes stale or unreviewed assets instead of using them to fill a ratio', () => {
  const b = brief('a'), invalid = candidate(b,'x')
  invalid.material.imageQuality!.inspection!.requirementHash = 'stale'
  expect(allocateReportImages([b], [invalid]).assigned).toEqual([])
})

it('reassigns earlier choices before declaring a needless image gap', () => {
  const briefs = ['a','b','c','d','e','f'].map(id => brief(id))
  const options = [['X','Y'],['X','Y'],['X','Z'],['X','Z'],['X','Z'],['Y','Z']]
  const candidates = briefs.flatMap((b,i) => options[i]!.map(original => candidate(b,original)))
  expect(allocateReportImages(briefs,candidates).gaps).toEqual([])
})
it('requires the current physical placement when allocating for a final plan', () => {
  const b = brief('a'), c = candidate(b,'x')
  c.material.imageQuality!.inspection!.placementHash = 'obsolete-crop'
  expect(allocateReportImages([b],[c],{placementHashes:{a:'new-crop'}}).assigned).toEqual([])
})
it('does not multiply original budgets through conflicting aliases for identical bytes', () => {
  const briefs = ['a','b','c'].map(id => brief(id))
  const aliases = briefs.map((b,i) => {
    const value = candidate(b, `alias-${i}`)
    value.material.imageIdentity!.fileSha256 = 'same-bytes'
    value.material.imageQuality!.inspection!.imageSha256 = 'same-bytes'
    return value
  })
  expect(allocateReportImages(briefs, aliases).assigned).toHaveLength(2)
})
