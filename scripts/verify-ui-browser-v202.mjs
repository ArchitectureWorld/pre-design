/** Real Chromium/Chrome interaction regressions; no browser-test dependencies or DSH access. */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('../', import.meta.url))
const out = path.join(root, 'work/ui-review-r4/browser')
await mkdir(out, { recursive: true })
const html = await readFile(path.join(root, 'work/ui-review-r4/pre-V2.0.2-R4-preview.html'), 'utf8')
const offline = process.argv.includes('--offline-render')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const profile = await mkdtemp(path.join(tmpdir(), 'pre-v202-ui-'))
const report = { mode: offline ? 'offline-render (opaque origin)' : 'real-browser HTTP origin', passed: [], errors: [], persistence: 'not-run' }
let browser, socket, server
try {
  let executable
  for (const candidate of [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean)) {
    try { await access(candidate); executable = candidate; break } catch { /* Try the next installed browser. */ }
  }
  if (!executable) throw new Error('Chrome/Chromium is required. Set CHROME_BIN to an installed executable.')
  browser = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''; browser.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000) })
  let port
  for (let i = 0; i < 100; i++) { try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await sleep(100) } }
  if (!port) throw new Error(`Browser did not start: ${stderr}`)
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target = targets.find(item => item.type === 'page')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  const pending = new Map(); let serial = 0
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data)
    if (data.method === 'Runtime.exceptionThrown') report.errors.push(data.params.exceptionDetails.text)
    const job = pending.get(data.id)
    if (job) { pending.delete(data.id); clearTimeout(job.timer); data.error ? job.reject(new Error(JSON.stringify(data.error))) : job.resolve(data.result) }
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
    return response.result.value
  }
  const until = async (expression, timeout = 8000) => {
    for (const start = Date.now(); Date.now() - start < timeout;) { if (await evaluate(expression)) return; await sleep(80) }
    throw new Error(`Condition timed out: ${expression}`)
  }
  const click = label => evaluate(`document.querySelector('[aria-label=${JSON.stringify(label)}]').click()`)
  const key = async value => { await send('Input.dispatchKeyEvent', { type:'keyDown', key:value, code:value, windowsVirtualKeyCode:value==='Escape'?27:9, nativeVirtualKeyCode:value==='Escape'?27:9 }); await send('Input.dispatchKeyEvent', { type:'keyUp', key:value, code:value, windowsVirtualKeyCode:value==='Escape'?27:9, nativeVirtualKeyCode:value==='Escape'?27:9 }) }
  const check = name => { report.passed.push(name); console.log(`PASS ${name}`) }
  const screenshot = async name => {
    const image = await send('Page.captureScreenshot', { format:'png' })
    await writeFile(path.join(out, `${name}.png`), Buffer.from(image.data, 'base64'))
  }
  await send('Runtime.enable'); await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width:1440, height:1100, deviceScaleFactor:1, mobile:false })
  if (offline) {
    const { frameTree } = await send('Page.getFrameTree')
    await send('Page.setDocumentContent', { frameId:frameTree.frame.id, html })
  } else {
    server = createServer((req, res) => { if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html) } else { res.statusCode=404;res.end() } })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    await send('Page.navigate', { url:`http://127.0.0.1:${server.address().port}/` })
  }
  await until(`!!document.querySelector('[aria-label="生成图像配套 LLM"]')`)
  const geometry = `(()=>{const a=document.querySelector('[aria-label="生成图像模型"]').getBoundingClientRect(),b=document.querySelector('[aria-label="生成图像配套 LLM"]').getBoundingClientRect();return {y:Math.abs(a.y-b.y),height:Math.abs(a.height-b.height)}})()`
  let pairs = await evaluate(geometry); assert.ok(pairs.y < 1 && pairs.height < 1); check('Klein and companion occupy one row')
  const before = await evaluate(`document.querySelector('.role-card').getBoundingClientRect().y`)
  await send('Input.dispatchMouseEvent', {type:'mouseMoved', x:300, y:460}); await sleep(400)
  assert.equal(await evaluate(`document.querySelector('.role-card').getBoundingClientRect().y`), before); check('glass card does not move on hover')
  for (const [theme,label] of [['a','A · 浅色克制'],['b','B · 浅色强液态'],['c','C · 深色克制'],['d','D · 深色强液态']]) { await click(label); await sleep(150); pairs=await evaluate(geometry);assert.ok(pairs.y<1); await screenshot(theme.toUpperCase()) }
  check('A/B/C/D retain paired control layout')
  await click('C · 深色克制')
  await evaluate(`window.picker=document.querySelector('[aria-label="生成图像模型"]');window.mutations=[];new MutationObserver(xs=>xs.forEach(x=>mutations.push({name:x.attributeName,disabled:picker.disabled}))).observe(picker,{attributes:true,attributeFilter:['disabled']});preReview.readDelay=600`)
  const rect = await evaluate(`(()=>{const r=picker.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await send('Input.dispatchMouseEvent', {type:'mousePressed', button:'left', clickCount:1,...rect});await send('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,...rect})
  assert.equal(await evaluate(`picker.matches(':open')`),true)
  await evaluate(`preReview.addCatalogModel();window.dispatchEvent(new Event('focus'))`)
  await sleep(11200)
  assert.equal(await evaluate(`picker.matches(':open') && !picker.disabled && document.activeElement===picker && ![...picker.options].some(o=>o.textContent==='新增目录模型') && !mutations.some(m=>m.disabled)`),true)
  check('native model dropdown survives two polling intervals and refocus without disabling or replacing options')
  await key('Escape');await evaluate(`picker.blur()`)
  await until(`[...picker.options].some(o=>o.textContent==='新增目录模型')`);check('deferred catalog applies after leaving the picker')
  await evaluate(`document.querySelector('.preview-label summary').click();[...document.querySelectorAll('.preview-label button')].find(b=>b.textContent==='执行记录').click()`)
  await until(`document.querySelector('.history-count')?.textContent==='45'`)
  const pageHeight=await evaluate(`document.querySelector('.workspace').getBoundingClientRect().height`)
  await evaluate(`document.querySelector('.history-trigger').click()`)
  await until(`!!document.querySelector('dialog:modal')`)
  assert.equal(await evaluate(`document.querySelectorAll('.execution-row').length`),45)
  assert.ok((await evaluate(`document.querySelector('.execution-row strong').textContent`)).endsWith('45'))
  assert.equal(await evaluate(`document.querySelector('.workspace').getBoundingClientRect().height`),pageHeight)
  const bounds=await evaluate(`(()=>{let d=document.querySelector('dialog'),s=document.querySelector('.execution-scroll');return {height:d.getBoundingClientRect().height,overflow:s.scrollHeight>s.clientHeight}})()`)
  assert.ok(bounds.height<=700&&bounds.overflow)
  await evaluate(`document.querySelector('.execution-row summary').click();document.querySelector('.execution-scroll').scrollTop=300`)
  assert.equal(await evaluate(`document.querySelector('dialog').getBoundingClientRect().height`),bounds.height)
  assert.ok(await evaluate(`document.querySelector('.execution-scroll').scrollTop>0`))
  check('history is a bounded modal with its own scrollbar and all 45 records newest first')
  await screenshot('history');await key('Escape');await until(`!document.querySelector('dialog')`)
  assert.equal(await evaluate(`document.activeElement?.className`),'history-trigger');check('Escape closes history and restores trigger focus')
  await click('外观')
  // A small valid PNG; the application decodes, normalizes and persists it via the same input handler.
  const png='iVBORw0KGgoAAAANSUhEUgAAABAAAAAICAIAAAB/FOjAAAAAFklEQVR4nGO0KtjMQApgIkn1qAYiAQAhGwFt/ZCxGgAAAABJRU5ErkJggg=='
  await evaluate(`(()=>{const d=new DataTransfer();d.items.add(new File([Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0))],'qa-background.png',{type:'image/png'}));const input=document.querySelector('input[type=file]');input.files=d.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await until(`document.querySelector('.pre-glass').dataset.background==='custom'`)
  const url = await evaluate(`document.querySelector('.pre-background').src`)
  await click('A · 浅色克制');assert.equal(await evaluate(`document.querySelector('.pre-background').src`),url);check('local image loads, stays behind glass and survives theme switches')
  if (!offline) {
    const stored = `new Promise((resolve,reject)=>{const r=indexedDB.open('pre-design:glass-background:v1',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,q=db.transaction('images').objectStore('images').get('current');q.onsuccess=()=>{resolve(q.result?.name??null);db.close()}}})`
    await until(`(${stored}).then(name=>name==='qa-background.png')`)
    await send('Page.reload');await until(`document.querySelector('.pre-glass')?.dataset.background==='custom'`)
    await click('外观');await click('恢复默认背景');await until(`(${stored}).then(name=>name===null)`)
    await send('Page.reload');await until(`!!document.querySelector('[aria-label="生成图像模型"]')`);await sleep(400)
    assert.equal(await evaluate(`document.querySelector('.pre-glass').dataset.background`),'default')
    report.persistence='native IndexedDB upload/reload/reset/reload passed';check('background persists and reset removes it across actual browser reloads')
  } else { await click('恢复默认背景');report.persistence='not-run: opaque origin; denied-storage feedback verified';check('temporary background and reset work when persistence is unavailable') }
  await evaluate(`document.querySelector('[aria-label="关闭外观设置"]')?.click()`)
  await click('C · 深色克制')
  assert.equal(await evaluate(`preReview.saves`), 0);check('appearance and background actions never save model settings')
  // Compact viewport: two model fields remain side by side; the action buttons may move below.
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false})
  await sleep(300);pairs=await evaluate(geometry);assert.ok(pairs.y<1)
  assert.equal(await evaluate(`document.querySelector('.pre-glass').scrollWidth<=document.querySelector('.pre-glass').clientWidth+1`),true)
  await screenshot('mobile-390');check('390px viewport has a single model pair row and no horizontal overflow')
  assert.deepEqual(report.errors,[]);check('no uncaught browser exceptions')
  await writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
} catch (cause) {
  report.failure=cause.stack;await writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));throw cause
} finally {
  socket?.close();if(browser){browser.kill('SIGTERM');await sleep(400)}server?.close();await rm(profile,{recursive:true,force:true,maxRetries:3}).catch(()=>{})
}
