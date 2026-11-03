import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'

const config = JSON.parse(await readFile(process.env.PRE_WEB_CONFIG ?? '.local/web/config.json', 'utf8'))
const url = process.env.PRE_WEB_TEST_URL ?? `http://127.0.0.1:${config.port}`
const evidence = '.cache/web-v210-browser'; await mkdir(evidence, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.PRE_WEB_CHROME ?? '/home/zetta/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome', headless: true })
const errors = [], report = { url, browserErrors: errors, realModelsInvoked: false }
const users = config.users.filter(u => u.role !== 'admin'), admin = config.users.find(u => u.role === 'admin')
assert.ok(admin && users.length >= 2, 'requires an administrator and two ordinary candidate users')
async function login(user) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await page.locator('#accessToken').fill(user.token)
  await page.getByRole('button', { name: '进入项目空间' }).click()
  await page.locator('#accessDialog').waitFor({ state: 'detached' })
  return { context, page }
}
try {
  const { page: a } = await login(users[0])
  assert.equal(await a.getByRole('button', { name: '模型管理', exact: true }).count(), 0)
  const name = `候选验收样本（非业务数据）${randomUUID().slice(0, 8)}`
  await a.locator('#overviewCreateBtn').click()
  await a.locator('#projectName').fill(name)
  await a.locator('#projectType').selectOption({ label: '公共建筑' })
  await a.locator('#projectProvince').fill('浙江省'); await a.locator('#projectCity').fill('杭州市')
  await a.locator('#createFileInput').setInputFiles({ name: '验收任务书.txt', mimeType: 'text/plain', buffer: Buffer.from('这是候选平台的模拟验收资料，不是真实业务项目。拟建设社区阅读空间，面积尚待测绘确认。本轮仅测试上传、权限和研究范围，不发起真实模型调用。') })
  await a.locator('#createForm').getByRole('button', { name: '创建项目' }).click()
  await a.getByRole('dialog', { name: '选择研究范围' }).waitFor({ timeout: 90000 })
  await a.locator('input[data-module]').first().waitFor({ timeout: 90000 })
  assert.equal(await a.locator('input[data-module]').count(), 62)
  await a.locator('[data-service-status]').filter({hasText:'搜索服务：'}).waitFor()
  await a.locator('input[data-module="1.01"]').check()
  await a.getByRole('button', { name: '检查条件与依赖', exact: true }).click()
  await a.locator('.platform-message').filter({ hasText: /已检查/ }).waitFor()
  await a.screenshot({ path: `${evidence}/research-scope.png` })
  const headers = { authorization: `Bearer ${users[0].token}` }
  const all = await (await a.request.get(`${url}/api/projects`, { headers })).json()
  const project = all.find(p => p.name === name); assert.ok(project)
  report.projectId = project.id
  const state = await (await a.request.get(`${url}/api/projects/${project.id}/state`, { headers })).json()
  assert.equal(state.materials.length, 1); assert.equal(state.jobs.length, 0, 'project creation and upload must not silently dispatch paid work')
  const download = await a.request.get(`${url}/api/projects/${project.id}/materials/${state.materials[0].id}`, { headers })
  assert.equal(download.status(), 200); assert.match(await download.text(), /模拟验收资料/)
  assert.equal((await a.request.get(`${url}/api/admin/models`, { headers })).status(), 403)
  const override = await a.request.post(`${url}/api/projects/${project.id}/research`, { headers, data: { requestId: 'override', baseRevision: 0, moduleIds: ['1.01'], flags: {}, provider: 'openai', model: 'gpt' } })
  assert.equal(override.status(), 400)
  const policy = await (await a.request.get(`${url}/api/admin/models`, { headers: { authorization: `Bearer ${admin.token}` } })).json()
  if (policy.models.every(m => m.status === 'unverified')) {
    for (const select of await a.locator('[data-condition]').all()) await select.selectOption('false')
    await a.getByRole('button', { name: '开始所选研究' }).click()
    await a.locator('.platform-message').filter({ hasText: /模型.*验证/ }).waitFor()
    report.unverifiedModelsBlocked = true
  }
  await a.getByRole('button', { name: '关闭', exact: true }).click()
  await a.reload(); await a.getByRole('button', { name: `打开历史项目 ${name}`, exact: true }).click()
  await a.locator('#workspaceStage').waitFor({ state: 'visible', timeout: 60000 })
  report.refreshRestoresProject = true
  await a.getByRole('button', { name: '章节生产', exact: true }).click()
  const chapterDialog = a.getByRole('dialog', { name: '章节生产' })
  await chapterDialog.waitFor()
  await a.locator('[data-chapter]').selectOption('site')
  await a.locator('[data-chapter-message]').fill('这是非业务的验收样本，仅验证本项目章节要求和图片的保存。')
  const png = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#496875' } }).png().toBuffer()
  await a.locator('[data-chapter-upload]').setInputFiles({ name: '验收图片（非现场照片）.png', mimeType: 'image/png', buffer: png })
  await a.locator('[data-chapter-material]').waitFor()
  await a.locator('[data-chapter-material]').check()
  const prepared = a.waitForResponse(response => response.url().endsWith('/chapters/prepare') && response.request().method() === 'POST')
  await a.getByRole('button', { name: '保存本章要求与图片', exact: true }).click()
  assert.equal((await prepared).status(), 200)
  await a.locator('[data-chapter-readiness]').filter({ hasText: '本章要求已保存' }).waitFor()
  await a.screenshot({ path: `${evidence}/chapter-setup.png` })
  const blocked = a.waitForResponse(response => response.url().endsWith('/reports') && response.request().method() === 'POST')
  await a.getByRole('button', { name: '提交所选章节任务', exact: false }).click()
  assert.equal((await blocked).status(), 409, 'missing research must not enqueue a model task')
  await a.setViewportSize({ width: 390, height: 844 })
  const dimensions = await chapterDialog.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }))
  assert.equal(dimensions.scroll, dimensions.client, 'chapter form must fit the mobile dialog')
  await a.screenshot({ path: `${evidence}/chapter-mobile.png` })
  await a.keyboard.press('Escape')
  await a.setViewportSize({ width: 1440, height: 1000 })
  const afterPrepare = await (await a.request.get(`${url}/api/projects/${project.id}/state`, { headers })).json()
  assert.equal(afterPrepare.jobs.length, 0)
  report.chapterSetup = true; report.missingChapterInputsBlockedBeforeQueue = true
  const { page: b } = await login(users[1])
  assert.equal(await b.getByRole('button', { name: `打开历史项目 ${name}`, exact: true }).count(), 0)
  const other = { authorization: `Bearer ${users[1].token}` }
  for (const path of ['state', 'research', 'chapters', 'artifacts', `materials/${state.materials[0].id}`, 'events']) assert.equal((await b.request.get(`${url}/api/projects/${project.id}/${path}`, { headers: other })).status(), 404)
  report.crossUserIsolation = true
  const { page: m } = await login(admin)
  await m.getByRole('button', { name: '模型管理', exact: true }).click()
  await m.getByRole('dialog', { name: '模型管理' }).waitFor()
  await m.getByLabel('全局并发上限', { exact: true }).waitFor()
  const searchProvider = m.getByLabel('搜索服务', { exact: true })
  await searchProvider.waitFor()
  const selectedProvider = await searchProvider.inputValue()
  await searchProvider.selectOption('deepseek-search-api')
  await m.getByLabel('搜索服务地址', { exact: true }).waitFor()
  assert.equal(await m.getByLabel('搜索凭据引用', { exact: true }).count(), 1)
  assert.equal(await m.getByLabel('ComfyUI 服务地址', { exact: true }).count(), 1)
  assert.match(await m.getByRole('dialog').textContent(),/flux3-image-klein-bf16\.safetensors/)
  report.serviceConfigurationVisible = true
  // Reload the saved snapshot after inspecting alternate form fields.
  const policyReloaded = m.waitForResponse(response => response.url().endsWith('/api/admin/models') && response.request().method() === 'GET')
  await m.getByRole('button', { name: '重新加载配置', exact: true }).click()
  assert.equal((await policyReloaded).status(), 200)
  await m.waitForFunction(value => document.querySelector('select[aria-label="搜索服务"]')?.value === value, selectedProvider)
  assert.equal(await m.getByLabel('搜索服务', { exact: true }).inputValue(), selectedProvider)
  const baseline = await m.getByLabel('每用户每日任务上限', { exact: true }).inputValue()
  await m.getByLabel('每用户每日任务上限', { exact: true }).fill(String(Number(baseline) + 1))
  const saved = m.waitForResponse(response => response.url().endsWith('/api/admin/models') && response.request().method() === 'PUT')
  await m.getByRole('button', { name: '保存策略', exact: true }).click()
  assert.equal((await saved).status(), 200)
  await m.screenshot({ path: `${evidence}/administrator-models.png` })
  await m.reload(); await m.getByRole('button', { name: '模型管理', exact: true }).click()
  await m.getByLabel('每用户每日任务上限', { exact: true }).waitFor()
  assert.equal(await m.getByLabel('每用户每日任务上限', { exact: true }).inputValue(), String(Number(baseline) + 1))
  report.administratorSaveAndReload = true
  await m.getByLabel('每用户每日任务上限', { exact: true }).fill(baseline)
  const restored = m.waitForResponse(response => response.url().endsWith('/api/admin/models') && response.request().method() === 'PUT')
  await m.getByRole('button', { name: '保存策略', exact: true }).click()
  assert.equal((await restored).status(), 200)
  assert.deepEqual(errors, [])
  await writeFile(`${evidence}/report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally { await browser.close() }
