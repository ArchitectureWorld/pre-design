import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {compositionPackage} from './fixtures/composition.mjs'
import {samplePages,validatePublication} from '../src/layout-library/validation.mjs'

test('V2代表页填入完整多图和表格内容，以有信息的示意图检验版式',async()=>{
 const pages=samplePages(compositionPackage())
 assert.equal(pages.length,2)
 const page=pages.find(p=>p.id.endsWith('typical'))
 assert.equal(page.item.figures.length,2);assert.equal(page.item.points.length,4)
 assert.equal(page.item.table.rows.length,3)
 const image=page.nativeAssets.images[0]
 const metadata=await sharp(Buffer.from(image.dataUrl.split(',')[1],'base64')).metadata()
 assert(metadata.width>=600&&metadata.height>=300,'不能使用1像素色块冒充图文试排')
 assert.match(page.item.figures[0].caption,/合成/)
 assert(page.item.title.length>12)
})
