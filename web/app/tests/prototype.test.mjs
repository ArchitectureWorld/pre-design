import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const dist = resolve(process.env.PRE_WEB_BUILD_DIR || resolve(root,'dist'))
test('production uses the accepted prototype CSS byte-for-byte and retains its stages and controls', async () => {
 const original = await readFile(resolve(root,'../index.html'),'utf8'), built = await readFile(resolve(dist,'index.html'),'utf8')
 assert.equal(await readFile(resolve(dist,'prototype.css'),'utf8'), original.match(/<style>([\s\S]*?)<\/style>/)[1])
 const ids = html => [...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1])
 assert.deepEqual(ids(built).filter(id=>!['chooseFolderBtn','createFolderInput','outlineFileInput'].includes(id)), ids(original.split('<script>')[0].replace(/<style>[\s\S]*?<\/style>/, '')))
 assert.match(built,/id="createFolderInput"[^>]+webkitdirectory/);assert.match(built,/id="chooseFolderBtn"/);
 for (const stage of ['overviewStage','entryStage','consultStage','workspaceStage','previewOverlay','annotationDrawer']) assert.ok(built.includes(`id="${stage}"`))
})
test('production bundle contains no prototype project records or predetermined project examples', async () => {
 const script = await readFile(resolve(dist, 'prototype.js'), 'utf8')
 assert.doesNotMatch(script, /seededProjects|seed-wuhan|seed-xiangyang|seed-xiamen|武汉站综合枢纽策划|襄阳东站前期策划|厦门三康完整社区/)
})
