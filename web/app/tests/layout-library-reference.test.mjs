import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import {extractPptx,importReference} from '../src/layout-library/reference.mjs'
import {validatePackage} from '../src/layout-library/contract.mjs'
test('真实PPTX结构提炼主题，原项目文字不混入资源',async()=>{
 const z=new JSZip();z.file('ppt/presentation.xml','<p:presentation><p:sldSz cx="160000" cy="90000"/></p:presentation>');z.file('ppt/theme/theme1.xml','<a:theme><a:dk1><a:srgbClr val="112233"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="234567"/></a:accent1></a:theme>');z.file('ppt/slides/slide1.xml','<p:sld><a:t>机密项目投资12345</a:t></p:sld>')
 const r=await extractPptx(await z.generateAsync({type:'nodebuffer'}),'样式参考');assert.equal(r.package.theme.accent,'#234567');validatePackage(r.package);assert(!JSON.stringify(r).includes('12345'));assert.equal(r.package.rights.shareAllowed,false)
})
test('未知格式、实体注入、宏、无效资源不能作为可用模板',async()=>{
 await assert.rejects(()=>importReference('sample.pdf',Buffer.from('pdf').toString('base64')),/PDF/)
 const z=new JSZip();z.file('ppt/presentation.xml','<!ENTITY danger SYSTEM "file:///etc/passwd">');await assert.rejects(async()=>extractPptx(await z.generateAsync({type:'nodebuffer'}),'x'))
})
