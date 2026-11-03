import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
test('production uses the accepted prototype CSS byte-for-byte and retains its stages and controls', async () => {
 const original = await readFile(resolve(root,'../index.html'),'utf8'), built = await readFile(resolve(root,'dist/index.html'),'utf8')
 assert.equal(await readFile(resolve(root,'dist/prototype.css'),'utf8'), original.match(/<style>([\s\S]*?)<\/style>/)[1])
 const ids = html => [...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1])
 assert.deepEqual(ids(built), ids(original.split('<script>')[0].replace(/<style>[\s\S]*?<\/style>/, '')))
 for (const stage of ['overviewStage','entryStage','consultStage','workspaceStage','previewOverlay','annotationDrawer']) assert.ok(built.includes(`id="${stage}"`))
})
