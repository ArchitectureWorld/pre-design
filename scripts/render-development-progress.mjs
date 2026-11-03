// Render a dated development snapshot; never infer project acceptance from test counts.
export function renderDevelopmentProgress(progress, esc) {
  const date = value => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(value))
  return `<section class="development-progress" id="development-progress" aria-labelledby="development-progress-title">
  <div class="progress-heading"><div><p class="eyebrow">开发记录与真实验收进度</p><h2 id="development-progress-title">V${esc(progress.version)} · ${esc(progress.project)}</h2></div><span class="progress-status">${esc(progress.status)}</span></div>
  <p class="progress-meta">进度核对：<time datetime="${esc(progress.checkedAt)}">${date(progress.checkedAt)}（北京时间）</time> · 开发证据截至：${date(progress.developmentAsOf)} · ${esc(progress.environment)}</p>
  <p>这是有时间标记的进度快照，刷新页面不会启动模型或自动更新数据。软件测试通过不代表项目研究完成，也不代表报告已经验收。</p>
  <div class="progress-metrics">${progress.metrics.map(row => `<article><h3>${esc(row.label)}</h3><strong>${esc(row.value)}</strong><p>${esc(row.note)}</p></article>`).join('')}</div>
  <aside class="progress-blocker"><h3>${esc(progress.blocker.label ?? '当前阻塞')}：${esc(progress.blocker.title)}</h3><p>${esc(progress.blocker.detail)}</p><p>${esc(progress.blocker.probe)}</p><p>${esc(progress.blocker.route)}</p></aside>
  <h3>已经完成的开发</h3><div class="progress-milestones">${progress.milestones.map(row => `<article><h4>${esc(row.title)}</h4><span class="badge neutral">${esc(row.state)}</span><p>${esc(row.detail)}</p></article>`).join('')}</div>
  <h3>距离本轮交付还剩什么</h3><ol>${progress.remaining.map(item => `<li>${esc(item)}</li>`).join('')}</ol>
  <details class="progress-evidence"><summary>本次进度依据与维护入口</summary><p>下列路径相对于项目仓库；开发看板本身不是少潭河汇报成果。</p><ul>${progress.evidence.map(path => `<li><code>${esc(path)}</code></li>`).join('')}</ul><p>进度数据：<code>research/v2.0.1/development-progress.json</code>；重新生成：<code>pnpm build:research-audit</code>。生成时保留记录的核对时间，不把构建时间冒充实测时间。</p></details>
  </section>`
}

export const developmentProgressCss = `
.development-progress{background:#fff;border:1px solid #d8dee4;border-radius:12px;padding:24px;margin:20px 0 28px;scroll-margin-top:16px}
.progress-heading{display:flex;justify-content:space-between;gap:16px;align-items:center}.progress-heading h2{margin:4px 0 10px}.progress-status{color:#8a3400;background:#fff1e5;border:1px solid #f5c095;border-radius:24px;padding:9px 15px;font-weight:700}
.progress-meta,.development-progress p{color:#59636e;font-size:14px;line-height:1.8}.progress-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:20px 0}.progress-metrics article{padding:18px;background:#f6f8fa;border:1px solid #e3e8ef;border-radius:10px}.progress-metrics h3{font-size:14px;margin:0 0 12px;color:#59636e}.progress-metrics strong{font-size:32px;color:#172b4d}.progress-metrics p{margin-bottom:0}
.progress-blocker{background:#fff8ef;border-left:5px solid #bc5900;padding:12px 18px;border-radius:8px}.progress-blocker h3{color:#8a3400;margin:5px 0}.progress-milestones{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.progress-milestones article{border:1px solid #d8dee4;border-radius:10px;padding:16px}.progress-milestones h4{margin:0 0 10px;font-size:16px}.progress-milestones p{margin-bottom:0}.development-progress li{line-height:1.8;margin:8px 0}.progress-evidence{margin-top:20px;border-top:1px solid #d8dee4;padding-top:16px}.progress-evidence summary{cursor:pointer;color:#0969da}.progress-evidence code{overflow-wrap:anywhere}.progress-meta{overflow-wrap:anywhere}
@media(max-width:800px){.progress-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.progress-milestones{grid-template-columns:1fr}.progress-heading{align-items:flex-start;flex-direction:column}.development-progress{padding:18px}}
@media(max-width:420px){.progress-metrics{grid-template-columns:1fr}}
`
