// New selections and legacy originals share the same preparation instructions.
export const CAD_CONVERSION_MESSAGE = 'CAD 图纸请先导出为 PDF 或 PNG、JPEG、WebP 图像。'
const dwg = Object.freeze({ code: 'MATERIAL_CAD_CONVERSION_REQUIRED', label: '待补 PDF', message: 'DWG 图纸请先导出为 PDF 再上传。' })
const cad = Object.freeze({ code: 'MATERIAL_CAD_CONVERSION_REQUIRED', label: '待补 PDF 或图像', message: CAD_CONVERSION_MESSAGE })
const archive = Object.freeze({ code: 'MATERIAL_ARCHIVE_NOT_ALLOWED', label: '待解压', message: '压缩包请先解压，再上传其中的文件或文件夹。' })
const archiveExtension = /\.(?:zipx?|rar|7z|tar|tgz|gz|bz2?|tbz2?|xz|txz|lz|lzma|lz4|zst|tzst|z|cab|arj|ace|lha|lzh|alz|egg|(?:tar|zip|zipx|7z|rar)\.\d{3,}|[rz]\d{2,3})$/i

function basenames(value, relativePath) {
  const names = typeof value === 'string' ? [value] :
    [value?.name, value?.filename, value?.relativePath, value?.webkitRelativePath, value?.file?.name, value?.file?.webkitRelativePath]
  return [...names, relativePath].filter(name => typeof name === 'string')
    .map(name => name.split(/[\\/]/).at(-1).replace(/[ .]+$/u, ''))
}

export function materialUploadIssue(value, relativePath) {
  const names = basenames(value, relativePath)
  if (names.some(name => /\.dwg$/i.test(name))) return dwg
  if (names.some(name => /\.(?:dxf|dgn|dwf|dwfx|dwt)$/i.test(name))) return cad
  if (names.some(name => archiveExtension.test(name))) return archive
  return null
}

export function isCadMaterial(value) {
  const issue = materialUploadIssue(value)
  return issue === dwg || issue === cad
}

export function partitionMaterialUploads(values) {
  const accepted = [], rejected = [], messages = new Set()
  for (const value of Array.from(values ?? [])) {
    const issue = materialUploadIssue(value)
    if (issue) {
      rejected.push(value)
      messages.add(issue.message)
    } else {
      accepted.push(value)
    }
  }
  const message = rejected.length ? `已筛出 ${rejected.length} 份资料。${[...messages].join(' ')}` : ''
  return {accepted, rejected, message}
}

function refuse(issue) {
  throw Object.assign(new Error(issue.message), {statusCode: 415, code: issue.code})
}

export function assertMaterialUploadAllowed(value, relativePath) {
  const issue = materialUploadIssue(value, relativePath)
  if (issue) refuse(issue)
}

// Readable files must not smuggle a drawing or an archive through a renamed suffix.
// ZIP-based document and specialist formats (e.g. DOCX, XLSX, QGZ) have their own extensions.
export function assertMaterialHeaderAllowed(filename, bytes) {
  const name = basenames(filename)[0] ?? ''
  if (name.includes('.') && !/\.(?:pdf|txt|md|csv|json|geojson|ya?ml|xml|png|jpe?g|webp|bin)$/i.test(name)) return
  const prefix = String.fromCharCode(...bytes.subarray(0, 8))
  const starts = (...values) => values.every((byte, i) => bytes[i] === byte)
  if (/^AC10\d{2}\x00/.test(prefix)) refuse(dwg)
  if (starts(0x50,0x4b,3,4) || starts(0x50,0x4b,5,6) || starts(0x50,0x4b,7,8) ||
      starts(0x52,0x61,0x72,0x21,0x1a,7) || starts(0x37,0x7a,0xbc,0xaf,0x27,0x1c) ||
      starts(0x1f,0x8b) || starts(0xfd,0x37,0x7a,0x58,0x5a,0) || starts(0x28,0xb5,0x2f,0xfd) ||
      starts(0x04,0x22,0x4d,0x18) || /^BZh[1-9]/.test(prefix) || prefix.startsWith('MSCF') ||
      String.fromCharCode(...bytes.subarray(257,262)) === 'ustar') refuse(archive)
}
