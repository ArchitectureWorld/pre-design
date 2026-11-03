import { validateSnapshot } from './model-policy.mjs'

export const RESEARCH_CONDITIONS = Object.freeze(['industryPlanning', 'existingBuildings', 'externalPartners', 'marketing'])
export const REPORT_CHAPTERS = Object.freeze(['opportunity', 'site', 'positioning', 'products', 'spatial', 'launch', 'operation'])
export function researchError(code, message = code, statusCode = 400, details) {
  return Object.assign(new Error(message), { code, statusCode, ...(details ? { details } : {}) })
}
function object(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) throw researchError('RESEARCH_INPUT_INVALID')
}
function moduleIds(input, allowEmpty = false) {
  if (!Array.isArray(input) || (!allowEmpty && !input.length) || input.length > 62 || new Set(input).size !== input.length || input.some(id => typeof id !== 'string' || !/^[1-8]\.0[1-9]$/u.test(id))) throw researchError('MODULE_SELECTION_REQUIRED')
  return [...input]
}
export function validateResearchSelection(input, { planning = false } = {}) {
  object(input, ['moduleIds', 'flags', 'redo'])
  object(input.flags ?? {}, RESEARCH_CONDITIONS)
  if (input.redo !== undefined && typeof input.redo !== 'boolean') throw researchError('RESEARCH_INPUT_INVALID')
  const flags = {}
  for (const key of RESEARCH_CONDITIONS) {
    const value = input.flags?.[key]
    if (typeof value === 'boolean' || (planning && value === 'unknown')) flags[key] = value
    else if (planning && value === undefined) flags[key] = 'unknown'
    else throw researchError('MODULE_CONDITIONS_REQUIRED', '请明确四项研究条件；条件选择不代表已核实现场事实。')
  }
  return { moduleIds: moduleIds(input.moduleIds ?? (planning ? [] : undefined), planning), flags, redo: input.redo ?? false }
}
export function validateReportSelection(input) {
  if (input?.mode === 'research-summary') {
    object(input, ['mode', 'moduleIds'])
    return { mode: 'research-summary', moduleIds: moduleIds(input.moduleIds) }
  }
  object(input, ['chapterId', 'stage'])
  const stages = ['write', 'review', 'revise', 'production-plan', 'production-research', 'production-write', 'production-visuals', 'production-layout', 'production-export', 'production-review']
  if (!REPORT_CHAPTERS.includes(input.chapterId) || !stages.includes(input.stage)) throw researchError('REPORT_SELECTION_INVALID')
  return { chapterId: input.chapterId, stage: input.stage }
}
export function reportModelRoles(input) {
  const selection=validateReportSelection(input)
  return selection.mode === 'research-summary' ? [] : ['parent','text',...(selection.stage === 'production-research' ? ['web'] : []),...(selection.stage === 'production-visuals' ? ['image','vision'] : [])]
}
export function validateReportSnapshot(snapshot,input) {
  const selection=validateReportSelection(input)
  if (selection.mode === 'research-summary') return undefined
  const policy=validateSnapshot(snapshot,reportModelRoles(selection))
  // Core chapter production attaches images to its actual text class. Checking
  // an unrelated vision route would not prove these requests can read images.
  if (['production-plan','production-visuals','production-layout','production-export','production-review'].includes(selection.stage)) {
    const route=policy.routes.text
    if ([route.primary,...route.fallbacks].some(ref=>!policy.models.find(model=>model.provider === ref.provider && model.model === ref.model)?.capabilities.vision)) {
      throw researchError('REPORT_TEXT_VISION_REQUIRED','REPORT_TEXT_VISION_REQUIRED: 当前章节步骤实际使用的文本主备模型均须支持图片输入。',503)
    }
  }
  return policy
}
const privateKey = /^(?:provider|model|runtimeProvider|credentialRef|credentialEnv|credentials|apiKey|apiKeyEnv|authorization|secret|token|settings|routes|routeChain|selected|actualModel|configurationSnapshot|snapshotPolicy|baseURL|endpoint|workspaceRoot|directoryRoot|snapshotRoot|cwd|path|absolutePath|executionAudit|attempts)$/iu
export function publicBusinessData(value, privateRoots = []) {
  if (value === undefined || value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    let text = value
    for (const root of privateRoots.filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(root).join('[项目目录]')
    return text.replace(/(?:[A-Za-z]:[\\/]|\/(?:home|media|tmp|etc|var|root|opt|usr|mnt|proc|run)\/)[^\s"'<>]*/gu, '[内部路径]')
      .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]+)/gu, '[凭据已隐藏]')
  }
  if (Array.isArray(value)) return value.map(row => publicBusinessData(row, privateRoots))
  if (typeof value !== 'object') return undefined
  return Object.fromEntries(Object.entries(value).filter(([key]) => !privateKey.test(key)).map(([key, row]) => [key, publicBusinessData(row, privateRoots)]))
}
