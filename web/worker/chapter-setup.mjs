import { mkdir, writeFile, rename } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import sharp from 'sharp'
import { REPORT_CHAPTERS, researchError, validateReportSelection } from '../app/src/research-contract.mjs'
import { safeProjectPath } from './project-boundary.mjs'
import { readBoundFile } from './research-artifacts.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')
const requestPath = id => `.pre-design/chapter-production-requests/${id}.json`
const assetsPath = id => `.pre-design/chapter-production-assets/${id}.json`
const briefPath = id => `.pre-design/report-chapter-plans/${id}.json`
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0')
const optionalText = value => typeof value === 'string' && value.length <= 8000 && !value.includes('\0')
const identity = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/u.test(value)
async function json(workspace, path) {
  try { return JSON.parse((await readBoundFile(workspace, path)).toString('utf8')) }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
}
async function save(workspace, path, value) {
  const parts = path.split('/'), filename = parts.pop()
  let folder = ''
  for (const part of parts) {
    folder = folder ? `${folder}/${part}` : part
    try { await mkdir(join(workspace, folder), { mode:0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
    safeProjectPath(workspace, folder)
  }
  const parent = safeProjectPath(workspace, folder), temp = join(parent, `${filename}.${randomUUID()}.tmp`)
  await writeFile(temp, JSON.stringify(value,null,2), { flag:'wx', mode:0o600 })
  if (safeProjectPath(workspace, folder) !== parent) throw researchError('CHAPTER_SCOPE_CHANGED')
  await rename(temp, join(parent, filename))
}
async function checkedAssets(workspace, input) {
  if (!Array.isArray(input) || !input.length || input.length > 32 || new Set(input.map(row => row?.id)).size !== input.length) throw researchError('CHAPTER_PRODUCTION_ASSETS_REQUIRED')
  const result=[]
  for (const row of input) {
    if (!row || Object.keys(row).some(key => !['id','path','sha256','width','height','label','sourceNote'].includes(key)) || !identity(row.id)
      || !text(row.path,4096) || !/^[a-f0-9]{64}$/u.test(row.sha256) || !Number.isSafeInteger(row.width) || !Number.isSafeInteger(row.height)
      || row.width < 1 || row.height < 1 || !text(row.label,200) || !text(row.sourceNote,1000)) throw researchError('CHAPTER_ASSET_INVALID')
    const path = isAbsolute(row.path) ? relative(workspace,row.path) : row.path
    if (!/^(?:原始资料|source-materials)\//u.test(path)) throw researchError('CHAPTER_ASSET_SCOPE_INVALID')
    const absolute = safeProjectPath(workspace,path), bytes = await readBoundFile(workspace,path)
    if (digest(bytes) !== row.sha256) throw researchError('CHAPTER_ASSET_CHANGED')
    const info = await sharp(bytes, { limitInputPixels:40_000_000 }).metadata()
    if (!['png','jpeg','webp'].includes(info.format) || info.pages > 1 || info.width !== row.width || info.height !== row.height) throw researchError('CHAPTER_ASSET_CHANGED')
    result.push({...row,path:absolute})
  }
  return result
}
function validRequest(request, id) {
  return request?.origin === 'user-message' && request.scope === 'chapter' && request.chapterId === id
    && text(request.message,8000) && optionalText(request.feedback) && Number.isFinite(Date.parse(request.requestedAt))
}
export async function prepareChapter(workspace, input, context = {}) {
  if (!input || Object.keys(input).some(key => !['chapterId','message','feedback','assets'].includes(key))
    || !REPORT_CHAPTERS.includes(input.chapterId) || !text(input.message,8000) || !optionalText(input.feedback)) throw researchError('CHAPTER_SETUP_INVALID')
  const { chapterId, message, feedback } = input, assets = await checkedAssets(workspace,input.assets)
  const previous = await json(workspace,requestPath(chapterId)), previousAssets = await json(workspace,assetsPath(chapterId))
  const same = validRequest(previous,chapterId) && previous.message === message && previous.feedback === feedback && Array.isArray(previousAssets) && isDeepStrictEqual(previousAssets,assets)
  if (!same) {
    if (await json(workspace,briefPath(chapterId))) throw researchError('CHAPTER_SETUP_CONFLICT','CHAPTER_SETUP_CONFLICT: 已有原生页表，请保留原委托并使用章节修订流程。',409)
    if (previous) await save(workspace,`.pre-design/web-chapter-history/${chapterId}-${randomUUID()}.json`,{request:previous,assets:previousAssets ?? []})
    const request = {origin:'user-message',message,feedback,requestedAt:new Date().toISOString(),scope:'chapter',chapterId,
      ...(identity(context.callerUserId) ? {callerUserId:context.callerUserId} : {}), ...(identity(context.jobId) ? {jobId:context.jobId} : {})}
    await save(workspace,assetsPath(chapterId),assets)
    await save(workspace,requestPath(chapterId),request)
  }
  return {status:'configured',chapterId,assets:assets.map(({id,label,width,height})=>({id,label,width,height}))}
}
export async function chapterPreflight(workspace, input, delivery, {verifyAssets = true,productionDirectory} = {}) {
  const selection = validateReportSelection(input), blockers=[]
  if (selection.mode === 'research-summary') return {ready:true,blockers}
  const {chapterId,stage}=selection
  const block=(code,message)=>blockers.push({code,message})
  if (delivery?.status !== 'ready') block(delivery?.status === 'not_requested' ? 'REPORT_MODULES_REQUIRED' : 'REPORT_MODULES_INCOMPLETE','需先完成并核验完整适用范围的研究；不会自动补研究。')
  const production = stage.startsWith('production-'), request = await json(workspace,requestPath(chapterId)), base=await json(workspace,briefPath(chapterId))
  if (production && !validRequest(request,chapterId)) block('CHAPTER_PRODUCTION_REQUEST_REQUIRED','请先填写章节委托及编写要求。')
  if (stage !== 'production-plan' && base?.plan?.chapterId !== chapterId) block('CHAPTER_PLAN_REQUIRED','请先执行原生章节页表编排。')
  if (production) {
    const assets=await json(workspace,assetsPath(chapterId))
    if (!assets?.length) block('CHAPTER_PRODUCTION_ASSETS_REQUIRED','请先选择真实上传图片。')
    else if (verifyAssets) { try { await checkedAssets(workspace,assets) } catch { block('CHAPTER_ASSET_CHANGED','章节图片缺失、发生变化或不属于本项目，请重新准备。') } }
    if (stage === 'production-visuals') block('IMAGE_BACKEND_UNAVAILABLE','图像生成后端尚未装配。')
    if (validRequest(request,chapterId) && !['production-plan','production-research'].includes(stage)) {
      if (typeof productionDirectory !== 'function') {
        block('CHAPTER_PRODUCTION_DIRECTORY_UNAVAILABLE','章节生产目录服务尚未装配。')
        return {ready:false,blockers,chapterId,stage}
      }
      // Core owns cache identity/versioning. This adapter only rechecks its
      // result against the current project file boundary before reading it.
      const root=relative(workspace,productionDirectory(chapterId,request))
      const state=await json(workspace,`${root}/state.json`)
      if (!await json(workspace,`${root}/brief.json`)) block('CHAPTER_PRODUCTION_RESEARCH_FIRST','请先执行章节研究接入。')
      if (stage !== 'production-write' && (!await json(workspace,`${root}/draft.json`) || !state?.reviewPath || !state?.manuscriptHash)) block('CHAPTER_PRODUCTION_WRITING_FIRST','请先完成章节正文及内容审查。')
      if (['production-export','production-review'].includes(stage) && (!state?.layoutHash || !await json(workspace,`${root}/layouts.json`))) block('CHAPTER_PRODUCTION_LAYOUT_FIRST','请先完成章节版式编排。')
      if (stage === 'production-review' && !state?.htmlPath) block('CHAPTER_VISUAL_REVIEW_EXPORT_FIRST','请先导出章节页面。')
    }
  }
  return {ready:blockers.length === 0,blockers,chapterId,stage}
}
export async function chapterReadiness(workspace,delivery,options = {}) {
  return Promise.all(REPORT_CHAPTERS.map(async chapterId => {
    const request=await json(workspace,requestPath(chapterId)),brief=await json(workspace,briefPath(chapterId))
    const nextStage=brief?.plan?.chapterId === chapterId ? 'production-research' : 'production-plan'
    return {chapterId,prepared:validRequest(request,chapterId),briefReady:brief?.plan?.chapterId === chapterId,
      readiness:{...await chapterPreflight(workspace,{chapterId,stage:nextStage},delivery,{...options,verifyAssets:false}),nextStage}}
  }))
}
