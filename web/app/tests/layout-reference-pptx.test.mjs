import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import JSZip from 'jszip'
import sharp from 'sharp'
import { extractReferenceDocument } from '../src/layout-library/reference-document.mjs'
import { referenceByteLimit, MAX_REFERENCE_BYTES } from '../src/layout-library/reference-limits.mjs'

const PptxGenJS = createRequire(import.meta.url)('pptxgenjs')

const parse = bytes => extractReferenceDocument({ bytes, filename: 'synthetic-reference.pptx' })
async function deck({ count = 2, mutate } = {}) {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Synthetic parser test'
  pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial', lang: 'en-US' }
  const png = await sharp({ create: { width: 24, height: 12, channels: 3, background: '#25876a' } }).png().toBuffer()
  for (let page = 1; page <= count; page++) {
    const slide = pptx.addSlide()
    slide.background = { color: page === count ? '228844' : 'FFFFFF' }
    slide.addText(`Synthetic page ${page}`, { x: 1, y: 0.5, w: 8, h: 0.6, fontFace: 'Arial', fontSize: 24, color: '172A3A', bold: true })
    slide.addShape(pptx.ShapeType.rect, { x: 1, y: 1.5, w: 2, h: 1, fill: { color: '257A65' }, line: { color: '257A65' } })
    slide.addImage({ data: `image/png;base64,${png.toString('base64')}`, x: 7, y: 2, w: 2, h: 1 })
  }
  const bytes = await pptx.write({ outputType: 'nodebuffer' })
  if (!mutate) return bytes
  const zip = await JSZip.loadAsync(bytes)
  await mutate(zip)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
const rejects = (statusCode, pattern) => error => {
  assert.equal(error.statusCode, statusCode, error.message)
  assert.match(error.message, pattern)
  return true
}

// Exercise the real archive validator without ever invoking an office renderer
// for adversarial resource URLs. This test cannot make a resource request.
async function validationResult(bytes) {
  const directory = await mkdtemp(join(tmpdir(), 'pptx-validation-test-'))
  try {
    const source = join(directory, 'input.pptx')
    await writeFile(source, bytes)
    const module = fileURLToPath(new URL('../src/layout-library/reference-pptx.py', import.meta.url))
    const code = `import importlib.util,json,sys\nfrom pathlib import Path\ns=importlib.util.spec_from_file_location('reference_pptx',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ntry:\n m.validate_package(Path(sys.argv[2]));print(json.dumps({'valid':True}))\nexcept m.Reject as e:\n print(json.dumps({'error':str(e),'statusCode':e.status},ensure_ascii=False))`
    const { stdout } = await promisify(execFile)('/usr/bin/python3', ['-c', code, module, source], { timeout: 30_000 })
    return JSON.parse(stdout)
  } finally { await rm(directory, { recursive: true, force: true }) }
}

test('PPTX 原生结构保留真实页序、元素几何、主题与源文件证据，并生成真实预览', { timeout: 90_000 }, async () => {
  const bytes = await deck({ mutate: async zip => {
    const xml = await zip.file('ppt/presentation.xml').async('string')
    const ids = xml.match(/<p:sldId\b[^>]*\/>/g)
    zip.file('ppt/presentation.xml', xml.replace(/(<p:sldIdLst>)[\s\S]*?(<\/p:sldIdLst>)/, `$1${ids.reverse().join('')}$2`))
  } })
  const result = await parse(bytes)
  assert.equal(result.kind, 'pptx')
  assert.equal(result.pageCount, 2)
  assert.deepEqual(result.readPages, [1, 2])
  assert.equal(result.images.length, 2)
  assert.equal(result.structure.schema, 'pre-design.pptx-structure.v1')
  assert.equal(result.structure.provenance.sourceSha256, createHash('sha256').update(bytes).digest('hex'))
  assert.equal(result.structure.provenance.upstream.license, 'MIT')
  assert.equal(result.structure.slides[0].part, 'ppt/slides/slide2.xml')
  assert.match(result.structure.slides[0].text, /Synthetic page 2/)
  assert.match(result.structure.slides[1].text, /Synthetic page 1/)
  assert.equal(result.structure.canvas.width, 1280)
  assert.equal(result.structure.canvas.height, 720)
  assert(result.structure.themes.length >= 1)
  assert(result.structure.masters.length >= 1)
  assert(result.structure.layouts.length >= 1)
  const title = result.structure.slides[0].shapes.find(shape => shape.text?.includes('Synthetic page 2'))
  assert.equal(title.x, 96)
  assert.equal(title.y, 48)
  assert.equal(title.width, 768)
  assert(title.runs.some(run => run.fontSize === 24 && run.fontFace === 'Arial'))
  const picture = result.structure.slides[0].shapes.find(shape => shape.kind === 'pic')
  assert.equal(picture.x, 672)
  assert.equal(picture.image.sha256.length, 64)
  assert.equal(result.pages[0].page, 1)
  assert.equal(result.pages[0].preview, true)
  for (const image of result.images) {
    const metadata = await sharp(image.data).metadata()
    assert.equal(metadata.format, 'jpeg')
    assert.equal(metadata.width, image.width)
    assert.equal(metadata.height, image.height)
  }
  const pixels = await sharp(result.images[0].data).raw().toBuffer({ resolveWithObject: true })
  const i = (Math.floor(pixels.info.height * .9) * pixels.info.width + Math.floor(pixels.info.width * .9)) * pixels.info.channels
  assert(pixels.data[i + 1] > pixels.data[i] + 50, '第 1 张真实预览必须对应换序后的绿色末页')
})

test('PPTX 预览从全篇抽样而非只读前 30 页，结构页序完整', { timeout: 120_000 }, async () => {
  const result = await parse(await deck({ count: 41 }))
  assert.equal(result.pageCount, 41)
  assert.equal(result.images.length, 30)
  assert.equal(result.readPages[0], 1)
  assert.equal(result.readPages.at(-1), 41)
  assert.equal(new Set(result.readPages).size, 30)
  assert.equal(result.structure.slides.length, 41)
  assert.equal(result.structure.pptMaster.slides.length,41)
  assert(result.privateArtifacts.some(a=>a.path==='svg-flat/slide_41.svg'),'初始原件导入必须保留未逐页预览的全篇SVG身份')
  assert.equal(result.pages.length, 41)
  assert.match(result.limitations.join(' '), /抽样/)
  assert.match(result.structure.slides.at(-1).text, /Synthetic page 41/)
  assert(Buffer.byteLength(JSON.stringify({ structure: result.structure, pages: result.pages })) <= 4 * 1024 * 1024)
})

test('PPTX 文件额度容纳大参考稿且不扩大其他格式额度', () => {
  assert(referenceByteLimit('large.pptx') >= 515_207_915)
  assert(MAX_REFERENCE_BYTES >= referenceByteLimit('large.pptx'))
  assert.equal(referenceByteLimit('normal.docx'), 24 * 1024 * 1024)
})

test('PPTX 拒绝伪装、路径穿越、实体、宏、失效继承和 CRC 损坏', { timeout: 60_000 }, async () => {
  await assert.rejects(() => parse(Buffer.from('fake pptx')), rejects(415, /PPTX/))
  await assert.rejects(() => parse(Buffer.from('PK\x03\x04broken')), rejects(400, /PPTX|压缩包/))
  const mutations = [
    [zip => zip.file('../outside.txt', 'bad', { createFolders: false }), /路径/],
    [zip => zip.file('ppt/vbaProject.bin', 'macro'), /宏|活动/],
    [async zip => zip.file('ppt/slides/slide1.xml', `<!DOCTYPE s [<!ENTITY x SYSTEM "file:///etc/passwd">]>${await zip.file('ppt/slides/slide1.xml').async('string')}`), /DOCTYPE|ENTITY|实体/],
    [async zip => zip.file('ppt/slides/_rels/slide1.xml.rels', (await zip.file('ppt/slides/_rels/slide1.xml.rels').async('string')).replace(/Target="[^\"]*slideLayout1.xml"/, 'Target="../slideLayouts/missing.xml"')), /关系|版式|结构/],
  ]
  for (const [mutate, pattern] of mutations) await assert.rejects(() => deck({ mutate }).then(parse), rejects(400, pattern))
  const damaged = await deck()
  const zip = await JSZip.loadAsync(damaged)
  const stored = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
  const textAt = stored.indexOf(Buffer.from('Synthetic page 1'))
  assert(textAt > 0)
  stored[textAt] = 88
  await assert.rejects(() => parse(stored), rejects(400, /CRC|校验|损坏/))
})

test('PPTX 外部关系不下载，预览移除外链并明确记录限制', { timeout: 90_000 }, async () => {
  const bytes = await deck({ mutate: async zip => {
    const path = 'ppt/slides/_rels/slide1.xml.rels'
    zip.file(path, (await zip.file(path).async('string')).replace('</Relationships>', '<Relationship Id="rIdExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://127.0.0.1:9/private-image.png" TargetMode="External"/></Relationships>'))
  } })
  const result = await parse(bytes)
  assert.equal(result.images.length, 2)
  assert.match(result.limitations.join(' '), /外部|外链/)
  assert.equal(result.structure.provenance.externalRelationships, 1)
})

test('PPTX 解析尊重预先取消，保留取消原因', async () => {
  const controller = new AbortController(), reason = new Error('cancel synthetic parse')
  controller.abort(reason)
  await assert.rejects(() => extractReferenceDocument({ bytes: Buffer.from('anything'), filename: 'x.pptx', signal: controller.signal }), error => error === reason)
})

test('PPTX 分组按子坐标比例展开，旋转分组后代明确标为近似', { timeout: 90_000 }, async () => {
  const bytes = await deck({ count: 1, mutate: async zip => {
    const path = 'ppt/slides/slide1.xml'
    const group = (id, rotation) => `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="Synthetic group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm rot="${rotation}"><a:off x="914400" y="914400"/><a:ext cx="1828800" cy="914400"/><a:chOff x="0" y="0"/><a:chExt cx="914400" cy="914400"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="${id + 1}" name="Child"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp></p:grpSp>`
    zip.file(path, (await zip.file(path).async('string')).replace('</p:spTree>', `${group(700, 0)}${group(710, 5400000)}</p:spTree>`))
  } })
  const result = await parse(bytes)
  const shapes = result.structure.slides[0].shapes
  const child = shapes.find(shape => shape.id === '701')
  assert.deepEqual([child.x, child.y, child.width, child.height], [96, 96, 96, 48])
  assert.equal(child.groupId, '700')
  assert.equal(child.geometryStatus, 'native-frame')
  assert.equal(shapes.find(shape => shape.id === '711').geometryStatus, 'approximate')
  assert(result.structure.warnings.some(warning => warning.code === 'group-transform'))
})

for(const pptxStartPage of [undefined,31])test(`PPTX ${pptxStartPage??'初次'}批次运行中取消会清理该解析的私有临时目录`, { timeout: 90_000 }, async () => {
  const bytes = await deck({ count: 41 })
  const before = new Set((await readdir(tmpdir())).filter(name => name.startsWith('layout-reference-pptx-')))
  const controller = new AbortController(), reason = new Error('cancel running native parse')
  const pending = extractReferenceDocument({ bytes, filename: 'synthetic.pptx', signal: controller.signal, pptxStartPage })
  const timer = setTimeout(() => controller.abort(reason), 100)
  try { await assert.rejects(() => pending, error => error === reason) }
  finally { clearTimeout(timer) }
  const after = (await readdir(tmpdir())).filter(name => name.startsWith('layout-reference-pptx-') && !before.has(name))
  assert.deepEqual(after, [])
})

test('PPTX 缺少真实渲染运行时时明确报错，不以空预览假装完成', { timeout: 90_000 }, async () => {
  const previous = process.env.PRE_LAYOUT_OFFICE_BINARY
  process.env.PRE_LAYOUT_OFFICE_BINARY = '/does-not-exist/pre-design-soffice'
  try { await assert.rejects(() => deck({ count: 1 }).then(parse), rejects(503, /LibreOffice/)) }
  finally {
    if (previous === undefined) delete process.env.PRE_LAYOUT_OFFICE_BINARY
    else process.env.PRE_LAYOUT_OFFICE_BINARY = previous
  }
})

test('PPTX 对 VML 直接资源地址、嵌套 SVG 和 UTF-16 实体同样执行安全检查', { timeout: 90_000 }, async () => {
  const unsafe = [
    ['ppt/media/unsafe.vml', '<xml xmlns:v="urn:schemas-microsoft-com:vml"><v:shape><v:imagedata src="https://127.0.0.1:9/image.png"/></v:shape></xml>'],
    ['ppt/media/nested.svg', `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}"/></svg>`],
    ['ppt/custom.xml', Buffer.concat([Buffer.from([255, 254]), Buffer.from('<!DOCTYPE data [<!ENTITY unsafe "x">]><data>&unsafe;</data>', 'utf16le')])],
  ]
  for (const [name, value] of unsafe) {
    await assert.rejects(() => deck({ count: 1, mutate: zip => zip.file(name, value) }).then(parse), rejects(400, /外部|SVG|ENTITY|实体/))
  }
})

test('PPTX 对声明过大的单项及过深 XML 在渲染前拒绝', async () => {
  const bytes = await deck({ count: 1 })
  const zip = await JSZip.loadAsync(bytes)
  zip.file('ppt/media/large.bin', 'x')
  const damaged = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
  for (let offset = 0; offset + 46 <= damaged.length; offset++) {
    if (damaged.readUInt32LE(offset) === 0x02014b50) {
      const length = damaged.readUInt16LE(offset + 28)
      if (damaged.subarray(offset + 46, offset + 46 + length).toString() === 'ppt/media/large.bin') damaged.writeUInt32LE(97 * 1024 * 1024, offset + 24)
    }
  }
  await assert.rejects(() => parse(damaged), rejects(413, /上限/))
  await assert.rejects(() => deck({ count: 1, mutate: archive => archive.file('ppt/deep.xml', '<x>'.repeat(140) + '</x>'.repeat(140)) }).then(parse), rejects(413, /嵌套|上限/))
})

test('PPTX 验证根据 OPC 媒体类型检查隐藏 SVG，并检查实体解码后的 CSS 资源', async () => {
  const mutations = [
    async zip => {
      zip.file('ppt/media/vector.blob', '<!--comment--><svg xmlns="http://www.w3.org/2000/svg"><image href="https://127.0.0.1:9/image.png"/></svg>')
      const types = await zip.file('[Content_Types].xml').async('string')
      zip.file('[Content_Types].xml', types.replace('</Types>', '<Override PartName="/ppt/media/vector.blob" ContentType="image/svg+xml"/></Types>'))
    },
    zip => zip.file('ppt/media/style.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:u&#114;l(https://127.0.0.1:9/image.svg)"/></svg>'),
    zip => zip.file('ppt/media/fill.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="u&#114;l(https://127.0.0.1:9/image.svg)"/></svg>'),
    zip => zip.file('ppt/media/css.svg', '<svg xmlns="http://www.w3.org/2000/svg"><style>@im&#112;ort "https://127.0.0.1:9/style.css";</style></svg>'),
  ]
  for (const mutate of mutations) {
    const result = await validationResult(await deck({ count: 1, mutate }))
    assert.equal(result.statusCode, 400, JSON.stringify(result))
    assert.match(result.error, /外部|样式|SVG/)
  }
})

async function rangeDeck(){
 return deck({count:87,mutate:async zip=>{
  for(const [from,to] of [['ppt/slideMasters/slideMaster1.xml','ppt/slideMasters/slideMaster2.xml'],['ppt/slideMasters/_rels/slideMaster1.xml.rels','ppt/slideMasters/_rels/slideMaster2.xml.rels'],['ppt/slideLayouts/slideLayout1.xml','ppt/slideLayouts/slideLayout2.xml'],['ppt/slideLayouts/_rels/slideLayout1.xml.rels','ppt/slideLayouts/_rels/slideLayout2.xml.rels']]){
   let xml=await zip.file(from).async('string')
   if(to.endsWith('.rels'))xml=xml.replaceAll('slideLayout1.xml','slideLayout2.xml').replaceAll('slideMaster1.xml','slideMaster2.xml')
   zip.file(to,xml)
  }
  const presentation=await zip.file('ppt/presentation.xml').async('string')
  zip.file('ppt/presentation.xml',presentation.replace('</p:sldMasterIdLst>','<p:sldMasterId id="2147483649" r:id="rIdRangeMaster"/></p:sldMasterIdLst>'))
  const rels=await zip.file('ppt/_rels/presentation.xml.rels').async('string')
  zip.file('ppt/_rels/presentation.xml.rels',rels.replace('</Relationships>','<Relationship Id="rIdRangeMaster" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster2.xml"/></Relationships>'))
  const types=await zip.file('[Content_Types].xml').async('string')
  zip.file('[Content_Types].xml',types.replace('</Types>','<Override PartName="/ppt/slideMasters/slideMaster2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/></Types>'))
  for(const page of [61,87]){
   const path='ppt/slides/_rels/slide'+page+'.xml.rels'
   zip.file(path,(await zip.file(path).async('string')).replaceAll('slideLayout1.xml','slideLayout2.xml'))
  }
  const path='ppt/slides/slide31.xml'
  zip.file(path,(await zip.file(path).async('string')).replace('<p:sld ','<p:sld show="0" '))
 }})
}
async function pythonRange(bytes,start){
 const directory=await mkdtemp(join(tmpdir(),'pptx-range-test-'))
 try{
  const source=join(directory,'source.pptx'),preview=join(directory,'preview.pptx')
  await writeFile(source,bytes)
  const adapter=fileURLToPath(new URL('../src/layout-library/reference-pptx.py',import.meta.url))
  const {stdout}=await promisify(execFile)('/usr/bin/python3',[adapter,source,preview,...(start===undefined?[]:['--start-page',String(start)])],{timeout:60_000,maxBuffer:8*1024*1024})
  const result=JSON.parse(stdout),{readFile}=await import('node:fs/promises'),archive=await JSZip.loadAsync(await readFile(preview))
  return {result,archive}
 }finally{await rm(directory,{recursive:true,force:true})}
}
test('PPTX 87页范围续读保留原Slide/Master/Layout身份及隐藏页，默认仍全篇抽样', {timeout:120_000},async()=>{
 const bytes=await rangeDeck(),initial=(await pythonRange(bytes)).result
 assert.equal(initial.structure.slides.length,87);assert.equal(initial.readPages.length,30);assert.equal(initial.readPages.at(-1),87)
 assert(initial.structure.masters.length>=2);assert(initial.structure.layouts.length>=2)
 for(const start of [31,61,87]){
  const {result,archive}=await pythonRange(bytes,start),expected=Array.from({length:Math.min(30,88-start)},(_,i)=>i+start)
  assert.equal(result.pageCount,87);assert.deepEqual(result.readPages,expected)
  for(const page of expected){
   const a=initial.structure.slides[page-1],b=result.structure.slides[page-1]
   for(const key of ['page','slideId','part','layoutId','masterId','hidden'])assert.equal(b[key],a[key],key)
   assert.match(b.text,new RegExp('Synthetic page '+page+'(?:$|\\s)'))
  }
  const xml=await archive.file('ppt/presentation.xml').async('string')
  assert.equal((xml.match(/<p:sldId\b/g)??[]).length,expected.length)
  if(start===31){assert.equal(result.structure.slides[30].hidden,true);assert.match(await archive.file('ppt/slides/slide31.xml').async('string'),/show="1"/)}
 }
})
test('PPTX 续读参数非法/格式冲突/越界明确拒绝并保留预先取消',async()=>{
 const bytes=await deck()
 for(const pptxStartPage of [null,0,-1,1.5,'1',NaN,Infinity,Number.MAX_SAFE_INTEGER+1,3])await assert.rejects(extractReferenceDocument({bytes,filename:'range.pptx',pptxStartPage}),rejects(400,/页/))
 await assert.rejects(extractReferenceDocument({bytes:Buffer.from('text'),filename:'x.txt',pptxStartPage:1}),rejects(400,/PPTX/))
 await assert.rejects(extractReferenceDocument({bytes,filename:'range.pptx',pptxStartPage:1,pdfStartPage:2}),rejects(400,/PDF|页/))
 const controller=new AbortController(),reason=Error('stop continuation');controller.abort(reason)
 await assert.rejects(extractReferenceDocument({bytes,filename:'range.pptx',pptxStartPage:2,signal:controller.signal}),e=>e===reason)
})
test('PPTX 续读只追加真实原页预览，不运行完整importer或返回替换graph/artifacts',{timeout:120_000},async()=>{
 const bytes=await rangeDeck(),root=await mkdtemp(join(tmpdir(),'pptx-range-guard-')),previous=process.env.PRE_LAYOUT_PYTHON_BINARY
 const {chmod}=await import('node:fs/promises'),wrapper=join(root,'python-guard')
 await writeFile(wrapper,'#!/bin/sh\ncase "$1" in *pptx_template_import.py|*attribution_guard.py) echo "full importer forbidden in preview continuation" >&2; exit 97;; esac\nexec /usr/bin/python3 "$@"\n')
 await chmod(wrapper,0o700);process.env.PRE_LAYOUT_PYTHON_BINARY=wrapper
 try{
  for(const start of [31,61,87]){
   const result=await extractReferenceDocument({bytes,filename:'range.pptx',pptxStartPage:start}),expected=Array.from({length:Math.min(30,88-start)},(_,i)=>start+i)
   assert.equal(result.previewOnly,true);assert.equal(result.sourceSha256,createHash('sha256').update(bytes).digest('hex'))
   assert.equal(result.structure,undefined);assert.equal(result.privateArtifacts,undefined)
   assert.equal(result.pageCount,87);assert.deepEqual(result.readPages,expected)
   assert.deepEqual(result.images.map(image=>image.page),expected);assert.deepEqual(result.pages.map(page=>page.page),expected)
   for(const page of result.pages){assert.match(page.text,new RegExp('Synthetic page '+page.page+'(?:$|\\s)'));assert(page.masterId&&page.layoutId&&page.slideId&&page.part)}
   assert.match(result.summary,/本批/);assert.doesNotMatch(result.summary,/全篇.*已读|抽样/)
   assert(result.images.every(image=>image.data.length>0))
   if(start===31)assert.equal(result.pages[0].hidden,true)
   if(start===87){const {data,info}=await sharp(result.images[0].data).raw().toBuffer({resolveWithObject:true});const i=(Math.floor(info.height*.9)*info.width+Math.floor(info.width*.9))*info.channels;assert(data[i+1]>data[i]+50,'原第87页应为绿色末页而非错误重编号的第1页')}
  }
 }finally{if(previous===undefined)delete process.env.PRE_LAYOUT_PYTHON_BINARY;else process.env.PRE_LAYOUT_PYTHON_BINARY=previous;await rm(root,{recursive:true,force:true})}
})
