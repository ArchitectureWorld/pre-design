// Creates a clearly named upload verification project; does not run a model.
import {isCadMaterial} from '../src/material-policy.mjs'
import {chromium} from '@playwright/test'
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {resolve,join,relative,basename} from 'node:path'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const folder=process.env.PRE_WEB_TEST_FOLDER
if(!folder)throw Error('Set PRE_WEB_TEST_FOLDER to the accessible local source folder')
const root=resolve(folder),url='http://192.168.6.45:4320',evidence=resolve('.cache/folder-upload-browser')
await mkdir(evidence,{recursive:true})
const expected=new Map()
async function digest(stream){const h=createHash('sha256');for await(const part of stream)h.update(part);return h.digest('hex')}
async function visit(dir){for(const e of await readdir(dir,{withFileTypes:true})){const file=join(dir,e.name);if(e.isDirectory())await visit(file);else if(e.isFile()&&!isCadMaterial(e.name))expected.set(`${basename(root)}/${relative(root,file).split('\\').join('/')}`,await digest(createReadStream(file)))}}
await visit(root);assert.ok(expected.size)
const config=JSON.parse(await readFile('.local/web/config.json'));const user=config.users.find(u=>u.role==='admin')||config.users[0];const headers={authorization:`Bearer ${user.token}`}
const browser=await chromium.launch({executablePath:'/home/zetta/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',headless:true,args:['--no-proxy-server']})
const page=await browser.newPage({viewport:{width:954,height:1052}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/projects/*/outline/draft',route=>route.fulfill({status:503,json:{error:'上传专项验收：不启动章节模型任务'}}))
try{
 await page.goto(url);await page.locator('#accessToken').fill(user.token);await page.getByRole('button',{name:'进入项目空间'}).click();await page.locator('#accessDialog').waitFor({state:'detached'})
 await page.locator('#overviewCreateBtn').click();await page.locator('#projectName').fill(`文件夹上传验收 · ${basename(root)} · ${Date.now()}`)
 const chooser=page.waitForEvent('filechooser');await page.locator('#chooseFolderBtn').click();const folderChooser=await chooser;assert.equal(await folderChooser.element().getAttribute('id'),'createFolderInput');assert.equal(await folderChooser.element().evaluate(el=>el.webkitdirectory),true);await folderChooser.setFiles(root)
 assert.equal(await page.locator('#fileList .filechip').count(),expected.size)
 await page.screenshot({path:join(evidence,'selected-folder.png')})
 const created=page.waitForResponse(r=>r.url()===`${url}/api/projects`&&r.request().method()==='POST',{timeout:90000})
 await page.locator('#createForm button[type="submit"]').click();const cr=await created;assert.ok(cr.ok());const project=await cr.json();await writeFile(join(evidence,'project.json'),JSON.stringify(project,null,2))
 await page.locator('#consultStage').waitFor({state:'visible',timeout:180000})
 const response=await page.request.get(`${url}/api/projects/${project.id}/state`,{headers});assert.ok(response.ok());const state=await response.json();assert.equal(state.materials.length,expected.size);assert.equal(state.jobs.length,0)
 for(const file of state.materials){assert.equal(file.sha256,expected.get(file.relativePath));const download=await fetch(`${url}/api/projects/${project.id}/materials/${file.id}`,{headers});assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment/);assert.equal(await digest(download.body),expected.get(file.relativePath))}
 await page.screenshot({path:join(evidence,'uploaded-folder.png')});assert.deepEqual(errors,[])
 const report={sourceFolder:root,projectId:project.id,fileCount:expected.size,hashesAndDownloadsVerified:true,modelJobs:state.jobs.length,materials:state.materials.map(f=>({path:f.relativePath,bytes:f.bytes,processing:f.processing})),browserErrors:errors};await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}catch(error){await page.screenshot({path:join(evidence,'failure.png')});throw error}finally{await browser.close()}
