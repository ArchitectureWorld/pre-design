import { MIN_RETAINED_IMAGE_AREA } from '../visual/image-policy.ts'
import { freeze } from './graph.ts'

/** Selected approved v1.2 numeric rules. These are project quality defaults, not legal standards. */
export const DISPLAY_PROFILES = freeze({
  screen169:{canvas:{width:1280,height:720,unit:'px'},bodyMinPt:15,tableMinPt:12,captionMinPt:10,photoMinDensity:1,lineMinDensity:1},
  a3:{canvas:{width:420,height:297,unit:'mm'},bodyMinPt:10,tableMinPt:9,captionMinPt:8,photoMinDensity:200,lineMinDensity:300},
})
export interface RasterPlacementInput {
  readonly profile:keyof typeof DISPLAY_PROFILES
  readonly widthPx:number;readonly heightPx:number;readonly boxWidth:number;readonly boxHeight:number
  readonly content:'photo'|'analysis';readonly fit:'contain'|'cover'
}
/** Pure geometry/density preflight. It cannot certify actual image bytes, relevance, evidence or publication. */
export function assessRasterPlacement(input:RasterPlacementInput) {
  if (!Object.hasOwn(DISPLAY_PROFILES,input.profile) || !['photo','analysis'].includes(input.content) || !['contain','cover'].includes(input.fit)
    || ![input.widthPx,input.heightPx,input.boxWidth,input.boxHeight].every(n=>Number.isFinite(n)&&n>0)
    || !Number.isSafeInteger(input.widthPx)||!Number.isSafeInteger(input.heightPx)) throw new Error('PLACEMENT_INVALID')
  const profile=DISPLAY_PROFILES[input.profile]
  if (input.boxWidth>profile.canvas.width || input.boxHeight>profile.canvas.height) throw new Error('PLACEMENT_INVALID: box exceeds canvas')
  const scale=input.fit==='contain'?Math.min(input.boxWidth/input.widthPx,input.boxHeight/input.heightPx):Math.max(input.boxWidth/input.widthPx,input.boxHeight/input.heightPx)
  const renderedWidth=input.widthPx*scale,renderedHeight=input.heightPx*scale
  const retainedArea=input.fit==='contain'?1:(input.boxWidth*input.boxHeight)/(renderedWidth*renderedHeight)
  const density=(input.profile==='a3'?25.4:1)/scale
  const minimumDensity=input.content==='analysis'?profile.lineMinDensity:profile.photoMinDensity
  const issues:string[]=[]
  if (density+1e-6<minimumDensity) issues.push('DENSITY_LOW')
  if (input.content==='analysis'&&retainedArea<1-1e-6) issues.push('ANALYTICAL_CROP')
  if (input.content==='photo'&&retainedArea+1e-6<MIN_RETAINED_IMAGE_AREA) issues.push('PHOTO_RETAINED_AREA_LOW')
  return freeze({profile:input.profile,measurementOnly:true,publicationGranted:false,passed:!issues.length,issues,density,
    densityUnit:input.profile==='a3'?'ppi':'source-pixels-per-css-pixel',minimumDensity,retainedArea,
    visibleSize:{width:Math.min(input.boxWidth,renderedWidth),height:Math.min(input.boxHeight,renderedHeight)},
    remainingChecks:['actual_bytes_and_dimensions','source_and_claim_binding','subject_retention','placement_specific_inspection','text_legibility','rights_and_disclosure']})
}
