import test from 'node:test'
import assert from 'node:assert/strict'
import {nativePackageFixture} from './fixtures/native-design-v3-fixture.mjs'
import {reuseGuideHtml} from '../src/layout-library/reuse-guide-ui.js'
test('reusable asset guide shows verified roles, capacities and structural evidence without original sources',async()=>{
 const pkg=await nativePackageFixture(),html=reuseGuideHtml(pkg)
 for(const text of ['复用说明','可编辑','标题','正文','字符','证据','原件'])assert.ok(html.includes(text),text)
 assert.ok(html.includes(String(pkg.layouts[0].contentFitRules.maxBodyCharacters)))
 assert.doesNotMatch(html,/<iframe|<img|\/uploads\//)
 pkg.layouts[0].label='<script>alert(1)</script>'
 assert.doesNotMatch(reuseGuideHtml(pkg),/<script>/)
 assert.equal(reuseGuideHtml({layouts:[]}), '')
})
