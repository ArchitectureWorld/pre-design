import test from 'node:test'
import assert from 'node:assert/strict'
import {isCadMaterial, partitionMaterialUploads, assertMaterialUploadAllowed} from '../src/material-policy.mjs'

test('CAD identification handles common formats, mixed case and directory paths', () => {
  for (const filename of ['场地.DWG', '规划.dXf', '目录/建筑.dgn', 'C:\\图纸\\结构.DWF', '项目/图纸.dwfx', '模板.DWT', ' 场地.DWG ']) {
    assert.equal(isCadMaterial(filename), true, filename)
  }
  for (const filename of ['dwg', '图纸.dwg.pdf', 'dwg目录/照片.JPG', '目录.dwg/报告.pdf', '图纸.rar', '模型.ifc', '说明.txt', '', undefined]) {
    assert.equal(isCadMaterial(filename), false, String(filename))
  }
})

test('CAD identification checks File, folder wrappers and server upload metadata', () => {
  const cad = new File(['drawing'], '建筑.DWG')
  assert.equal(isCadMaterial(cad), true)
  assert.equal(isCadMaterial({file: cad, relativePath: '方案/建筑.DWG'}), true)
  assert.equal(isCadMaterial({filename: '场地.pdf', relativePath: '方案/场地.dxf'}), true)
  assert.equal(isCadMaterial({file: cad, relativePath: '方案/建筑.pdf'}), true)
  assert.equal(isCadMaterial({name: '封面.jpg', webkitRelativePath: '资料/封面.jpg'}), false)
})

test('mixed batches remove CAD while retaining the same files, folder entries and order', () => {
  const pdf = new File(['pdf'], '任务书.pdf', {type: 'application/pdf'})
  const jpg = new File(['jpg'], '现场.JPG', {type: 'image/jpeg'})
  const cad = new File(['cad'], '总图.DWG')
  const rar = new File(['archive'], '补充.rar')
  const folderImage = Object.freeze({file: jpg, relativePath: '项目/现场照片/现场.JPG'})
  const folderCad = Object.freeze({file: cad, relativePath: '项目/图纸/总图.DWG'})
  const input = Object.freeze([pdf, folderCad, folderImage, rar])
  const result = partitionMaterialUploads(input)
  assert.deepEqual(result.accepted, [pdf, folderImage])
  assert.deepEqual(result.rejected, [folderCad, rar])
  assert.equal(result.accepted[0], pdf)
  assert.equal(result.accepted[1], folderImage)
  assert.equal(result.accepted[1].file, jpg)
  assert.equal(result.accepted[1].relativePath, '项目/现场照片/现场.JPG')
  assert.equal(result.rejected[0].file, cad)
  assert.match(result.message, /2/)
  assert.match(result.message, /PDF/)
  assert.match(result.message, /解压/)
  assert.doesNotMatch(result.message, /图像|PNG|JPEG|WebP/)
})

test('empty, accepted and all-CAD selections return clear batch results', () => {
  assert.deepEqual(partitionMaterialUploads(), {accepted: [], rejected: [], message: ''})
  assert.deepEqual(partitionMaterialUploads({0: '照片.webp', length: 1}), {accepted: ['照片.webp'], rejected: [], message: ''})
  const result = partitionMaterialUploads(['总图.dwg', '边界.dxf'])
  assert.deepEqual(result.accepted, [])
  assert.deepEqual(result.rejected, ['总图.dwg', '边界.dxf'])
  assert.match(result.message, /2/)
})

test('new CAD uploads fail with structured HTTP 415 and actionable conversion guidance', () => {
  for (const args of [['场地.dwg'], [{filename: '建筑.DXF'}], ['总图.pdf', '目录/总图.dgn']]) {
    assert.throws(() => assertMaterialUploadAllowed(...args), error => {
      assert.equal(error.statusCode, 415)
      assert.equal(error.code, 'MATERIAL_CAD_CONVERSION_REQUIRED')
      assert.match(error.message, /PDF/)
      if (args[0]==='场地.dwg') assert.doesNotMatch(error.message, /PNG|JPEG|WebP|图像/)
      else assert.match(error.message, /图像/)
      return true
    })
  }
})

test('PDF, images and non-CAD originals remain eligible without implying parsing success', () => {
  for (const filename of ['任务书.pdf', '现场.JPG', '照片.png', '封面.webp', '说明.txt', '设计.zip/清单.xlsx', '总图.dwg.pdf', '模型.rvt']) {
    assert.doesNotThrow(() => assertMaterialUploadAllowed(filename))
  }
})

test('压缩包、复合扩展名和分卷被筛出，解压后文件保持目录和顺序', () => {
  const archives=['资料.ZiP','图纸.RAR','底图.7z','库区.TAR.Gz','底图.tbz2','模型.zip.001','包.7Z.002','地形.r00','分卷.z01','调查.tar.zst']
  for (const name of archives) {
    assert.throws(() => assertMaterialUploadAllowed({filename:name,relativePath:'收件/'+name}), error =>
      error.statusCode===415 && error.code==='MATERIAL_ARCHIVE_NOT_ALLOWED' && /解压/.test(error.message))
  }
  const extracted={file:new File(['pdf'],'总图.pdf'),relativePath:'资料.zip/底图/总图.pdf'}
  const hiddenArchive={file:new File(['rar'],'设计.rar'),relativePath:'包/伪装.txt'}
  const result=partitionMaterialUploads([hiddenArchive,extracted,...archives])
  assert.deepEqual(result.accepted,[extracted])
  assert.equal(result.rejected.length,archives.length+1)
})
