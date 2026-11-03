import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const url = process.env.PRE_WEB_TEST_URL
if (!url) throw new Error('Set PRE_WEB_TEST_URL to the LAN HTTP address')
const config = JSON.parse(await readFile('.local/web/config.json', 'utf8'))
const browser = await chromium.launch({ executablePath: '/home/zetta/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome', headless: true, args: ['--no-proxy-server'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
 assert.equal((await page.request.get(`${url}/api/projects`)).status(), 401)
 // Test-only access to module-scoped state; the served production file is unchanged.
 await page.route('**/prototype.js', async route => {
  const response = await route.fetch()
  await route.fulfill({ response, body: (await response.text()) + '\nglobalThis.__lanTest={requestId,server};' })
 })
 await page.goto(url)
 assert.equal(await page.evaluate(() => isSecureContext), false)
 assert.equal(await page.evaluate(() => typeof crypto.randomUUID), 'undefined')
 const ids = await page.evaluate(() => [__lanTest.requestId(), __lanTest.requestId()])
 for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
 assert.notEqual(ids[0], ids[1])
 await page.locator('#accessToken').fill(config.users[0].token)
 await page.getByRole('button', { name: '进入项目空间' }).click()
 await page.locator('#accessDialog').waitFor({ state: 'detached' })
 await page.locator('#overviewCreateBtn').click()
 await page.locator('#entryStage').waitFor({ state: 'visible' })
 await page.locator('#createBackOverview').click()
 await page.getByRole('button', { name: '打开历史项目 Web 实机验证 · 社区服务中心', exact: true }).click()
 await page.locator('#workspaceStage').waitFor({ state: 'visible', timeout: 60000 })
 await page.locator('.morph-ghost').waitFor({ state: 'detached' })
 await page.screenshot({ path: '.cache/web-e2e/lan-workspace.png' })
 const revision = await page.evaluate(() => __lanTest.server.current.revision)
 assert.ok(revision >= 2)
 assert.deepEqual(errors, [])
 console.log(JSON.stringify({ url, authenticated: true, revision, insecureContextUUID: 'passed', browserErrors: errors }))
} finally {
 await browser.close()
}
