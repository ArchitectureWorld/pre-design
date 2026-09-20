import { sha256CanonicalJson } from '../presentation/canonical-json.ts'
/** Shared contracts for source identity, pixel review and physical report use. */
export const REPORT_IMAGE_POLICY_VERSION = 'report-image-quality-2026-09-19.1'
export const MAX_ORIGINAL_IMAGE_USES = 2
export const MIN_RETAINED_IMAGE_AREA = 0.8
/** A reference or an explicit rejection of international positioning grants no exception. */
export function permitsInternationalImages(project: { readonly projectName: string; readonly recommendation: string }): boolean {
  const explicit = (text: string) => text.split(/[，,；;。！？\n]/u).some(clause => /国际|全球/u.test(clause)
    && !/借鉴|参考|对标|引用|案例|综述|比较|经验/u.test(clause)
    && !/(?:不|未|非|无需|无须|避免|拒绝|排除|取消).{0,12}(?:国际|全球)|(?:国际|全球).{0,8}(?:不适用|不采用|非定位)/u.test(clause))
  return explicit(project.projectName) || explicit(project.recommendation)
}
export type ImageContentKind = 'photo' | 'render' | 'plan' | 'map' | 'section' | 'diagram' | 'composite'
export type ImageAnalysisScale = 'area' | 'line' | 'point' | 'scene'
export interface ImageBounds { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface OriginalImageIdentity {
  readonly originalId: string
  readonly fileSha256: string
  readonly pixelFingerprint?: string
  readonly derivedFromSha256?: string
  readonly verification: 'file-hash' | 'decoded-pixels' | 'declared-derivative' | 'verified-derivative'
}
export interface ImageSlotBrief {
  readonly id: string
  readonly version: string
  readonly pageId: string
  readonly nodeId?: string
  readonly conclusion: string
  readonly subjects: readonly string[]
  readonly activities: readonly string[]
  readonly environment: string
  readonly scale: ImageAnalysisScale
  readonly allowedKinds: readonly ImageContentKind[]
  readonly allowedSources: readonly ('project' | 'web' | 'generated')[]
  readonly locale: 'domestic' | 'international'
  readonly aspectRatio?: number
  /** Original cited statements for semantic review; administrative intent is not a visible subject. */
  readonly sceneGrounding?: {
    readonly nodeLabel?: string
    readonly sources: readonly { readonly path: string; readonly text: string }[]
  }
}
export interface ImageInspection {
  readonly sourceContextHash?: string
  readonly schemaVersion: 'pre-design.image-inspection.v1'
  readonly imageSha256: string
  readonly requirementHash: string
  readonly usageId: string
  readonly placementHash: string
  readonly inspectedAt: string
  readonly actualImageInput: true
  readonly actualModel: { readonly provider: string; readonly model: string }
  readonly executionId: string
  readonly contentKind: ImageContentKind
  readonly relevant: boolean
  readonly matchedSubjects: readonly string[]
  readonly mismatches: readonly string[]
  readonly domesticContext: 'supported' | 'unverified' | 'international'
  readonly textLanguages: readonly string[]
  readonly textLegible: boolean
  readonly watermark: 'none' | 'minor' | 'obstructive'
  readonly quality: 'pass' | 'fail'
  readonly essentialBounds: readonly ImageBounds[]
  readonly decision: 'approved' | 'rejected'
}
export interface ImageQualityMetadata {
  readonly contentKind?: ImageContentKind
  readonly essentialBounds?: readonly ImageBounds[]
  readonly requirement?: ImageSlotBrief
  readonly inspection?: ImageInspection
  readonly sourceLocation?: string
}
export function imageBriefHash(brief: ImageSlotBrief): string {
  return sha256CanonicalJson({ policy: REPORT_IMAGE_POLICY_VERSION, brief: JSON.parse(JSON.stringify(brief)) })
}
export function imagePlacementHash(placement: { readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }; readonly fit: 'cover' | 'contain'; readonly nodeId?: string }): string {
  return sha256CanonicalJson({ policy: REPORT_IMAGE_POLICY_VERSION, box: placement.box, fit: placement.fit, ...(placement.nodeId ? { nodeId: placement.nodeId } : {}) })
}
