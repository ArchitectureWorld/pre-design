import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,stat} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {dirname,resolve,join} from 'node:path'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const vendor=join(root,'src/layout-library/vendor/ppt_master/upstream/skills/ppt-master')
const blobHash=bytes=>createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex')

test('PPT Master is vendored as a complete pinned internal engine, not a standalone Skill',async()=>{
 const manifest=JSON.parse(await readFile(join(root,'src/layout-library/vendor/ppt_master/UPSTREAM.json'),'utf8'))
 assert.equal(manifest.repository,'https://github.com/hugohe3/ppt-master')
 assert.equal(manifest.revision,'3af3e8ef774c4d67ee57e1306d9256d08c9ee1bf')
 assert.equal(manifest.license,'MIT')
 assert.ok(manifest.files.length>=235,'the complete upstream scripts tree must be present')
 for(const item of manifest.files){
  const path=join(vendor,item.path)
  const bytes=await readFile(path)
  assert.equal(bytes.length,item.bytes,item.path+' byte count')
  assert.equal(blobHash(bytes),item.gitBlobSha,item.path+' upstream Git blob')
 }
 for(const path of ['SKILL.md','LICENSE','SPONSORS.md','SPONSORS_CN.md','scripts/attribution_guard.py','scripts/pptx_template_import.py','scripts/pptx_to_svg/converter.py','scripts/template_import/manifest.py','scripts/svg_authoring_view.py','scripts/svg_quality_checker.py','scripts/template_preview_pptx.py','workflows/create-template.md','references/template-designer.md','templates/schemas/design_spec.schema.json']){
  await stat(join(vendor,path))
 }
 assert.equal(manifest.integration.userFacingEntryPoint,'Pre-design V14')
 assert.equal(manifest.integration.independentSkillRegistration,false)
 assert.ok(manifest.excludedDependencies.includes('PyMuPDF (AGPL-3.0)'))
})

test('upstream attribution guard remains intact and executable',()=>{
 const script=join(vendor,'scripts/attribution_guard.py')
 const result=spawnSync(process.env.PRE_LAYOUT_PYTHON_BINARY||'python3',[script],{encoding:'utf8',timeout:10000})
 assert.equal(result.status,0,(result.stderr||result.stdout||'attribution guard failed').slice(0,1200))
})
