// Shared by browser selection and the upload endpoint. No storage/read policy:
// existing CAD originals remain available for download.
export const CAD_CONVERSION_MESSAGE = '现阶段暂不支持直接解析 CAD 图纸，请先导出为 PDF 或 PNG、JPEG、WebP 图像后上传。'

function hasCadExtension(path) {
  if (typeof path !== 'string') return false
  const basename = path.trim().split(/[\\/]/).at(-1)
  return /\.(dwg|dxf|dgn|dwf|dwfx|dwt)$/i.test(basename)
}

/** Recognize filenames, File objects, folder entries and upload metadata. */
export function isCadMaterial(value) {
  if (typeof value === 'string') return hasCadExtension(value)
  if (!value || typeof value !== 'object') return false
  return [value.name, value.filename, value.relativePath, value.webkitRelativePath,
    value.file?.name, value.file?.webkitRelativePath].some(hasCadExtension)
}

/** Partition new selections without cloning File objects or rewriting paths. */
export function partitionMaterialUploads(values) {
  const accepted = [], rejected = []
  for (const value of Array.from(values ?? [])) {
    ;(isCadMaterial(value) ? rejected : accepted).push(value)
  }
  return {accepted, rejected, message: rejected.length
    ? `已筛出 ${rejected.length} 份 CAD 文件。${CAD_CONVERSION_MESSAGE}` : ''}
}

/** Call only when creating an upload, never when listing or reading originals. */
export function assertMaterialUploadAllowed(value, relativePath) {
  if (isCadMaterial(value) || isCadMaterial(relativePath)) {
    throw Object.assign(new Error(CAD_CONVERSION_MESSAGE), {
      statusCode: 415,
      code: 'MATERIAL_CAD_CONVERSION_REQUIRED',
    })
  }
}
