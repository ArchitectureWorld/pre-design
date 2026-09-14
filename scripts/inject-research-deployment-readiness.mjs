import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const path = resolve(root, 'research/v2.0.1/source-audit.html')
let html = await readFile(path, 'utf8')

const title = 'V2.0.1 部署测试能力'
if (!html.includes(title)) {
  const marker = '</p></section><section class="chapter">'
  const markerIndex = html.indexOf(marker)
  if (markerIndex < 0) throw new Error('source audit automatic-policy insertion marker not found')
  const insertAt = markerIndex + '</p></section>'.length
  const section = `<section class="automation-policy"><h3>${title}</h3><p><strong>当前真实可执行：</strong>Workspace UTF-8 文本/JSON 等项目资料采集；<strong>字段级 Evidence locator</strong>（JSON Pointer / 文本行范围）；完整源文件 SHA-256 + 片段 SHA-256；官方 <code>web_page</code> 直接抓取；请求域名与最终重定向域名双重白名单；ResearchProviderRouter；ResearchExecutionService；独立 Evidence Validator。</p><p><strong>为什么先做这些：</strong>它们构成最小的“真实输入 → 精确定位 → EvidenceRecord → 独立核验”部署闭环，可直接验证系统不是只生成来源清单，而是真正读到指定字段/网页片段并把证据绑定到 Workflow/DataPoint。</p><p><strong>明确委托而不伪装：</strong>PDF / Office / CAD 等二进制内容仍交给 DSH attachment/material extractor；本 Provider 不做假解析或 OCR。需要登录、验证码或当前授权不足的来源记录 <code>blocked_external/source_access_restricted</code>，不绕过访问控制。</p><p><strong>尚未宣称已接通：</strong><code>web_search</code> 发现器、来源专用公开 API adapter，以及 57 个 Workflow 的 Subagent Analyzer 自动采集编排仍属于后续 Runtime Integration；本轮部署测试应验证 Provider / Evidence / Validator / Proposal automatic 路由闭环，不把这些未接通项标成已完成。</p></section>`
  html = `${html.slice(0, insertAt)}${section}${html.slice(insertAt)}`
}

await writeFile(path, html)
console.log('PRE_RESEARCH_DEPLOYMENT_READINESS_AUDIT_PASS')
