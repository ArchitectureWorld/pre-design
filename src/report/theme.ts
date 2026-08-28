export const REPORT_THEME = Object.freeze({
  colors: {
    ink: '132A2E',
    paper: 'F4F0E8',
    accent: 'E25C3D',
    river: '2B7180',
    moss: '71836B',
    muted: '6D7775',
    white: 'FFFFFF',
  },
  fonts: {
    display: 'Microsoft YaHei',
    body: 'Microsoft YaHei',
  },
})

export const CLIENT_REPORT_CSS = `
:root{--ink:#132a2e;--paper:#f4f0e8;--accent:#e25c3d;--river:#2b7180;--moss:#71836b;--muted:#6d7775;--white:#fff}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:"Microsoft YaHei","PingFang SC",sans-serif;line-height:1.65}
.cover{min-height:100vh;padding:9vw;display:flex;flex-direction:column;justify-content:space-between;background:linear-gradient(145deg,var(--ink) 0 68%,var(--river) 68% 86%,var(--accent) 86%);color:var(--white)}
.eyebrow{font-size:14px;letter-spacing:.24em;text-transform:uppercase;opacity:.75}.cover h1{font-size:clamp(44px,6vw,82px);line-height:1.08;max-width:1000px;margin:24px 0}.cover p{max-width:760px;font-size:22px}.revision{font-size:14px;letter-spacing:.08em}
.report-nav{position:sticky;top:0;z-index:10;display:flex;gap:18px;overflow:auto;padding:14px 4vw;background:rgba(19,42,46,.96);color:white}.report-nav a{color:white;text-decoration:none;white-space:nowrap;font-size:13px}
main{max-width:1280px;margin:auto;padding:72px 5vw}.report-section{padding:68px 0;border-top:1px solid rgba(19,42,46,.2);break-inside:avoid}.section-index{color:var(--accent);font-weight:700;letter-spacing:.15em}.report-section h2{font-size:clamp(34px,4vw,56px);line-height:1.15;margin:12px 0 14px}.claim{font-size:23px;color:var(--river);max-width:900px;margin:0 0 40px}
.prose{max-width:880px;font-size:18px}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;margin:30px 0}.metric{border-top:5px solid var(--accent);padding:20px 0}.metric strong{display:block;font-size:34px;line-height:1.2}.metric small{color:var(--muted)}
table{width:100%;border-collapse:collapse;margin:28px 0;background:rgba(255,255,255,.35)}th,td{text-align:left;padding:14px 16px;border-bottom:1px solid rgba(19,42,46,.16)}th{background:var(--ink);color:white;font-weight:600}
.visual{margin:34px 0}.visual img{display:block;width:100%;max-height:720px;object-fit:contain;background:#ddd}.visual figcaption{margin-top:10px;color:var(--muted);font-size:14px}.chart img{background:white;padding:18px}
.callout{margin:30px 0;padding:28px 32px;border-left:7px solid var(--river);background:white}.callout.decision{border-color:var(--accent)}.callout.warning{border-color:#b77a24}.callout h3{font-size:24px;margin:0 0 12px}.callout ul{margin:0;padding-left:1.2em}
.footer{padding:32px 5vw 60px;color:var(--muted);font-size:13px;text-align:center}
@media(max-width:700px){.cover{padding:48px 26px}.cover h1{font-size:42px}main{padding:36px 24px}.report-section{padding:48px 0}.report-section h2{font-size:34px}.claim{font-size:19px}.report-nav{display:none}}
@media print{@page{size:A4 landscape;margin:13mm}body{background:white}.cover{min-height:175mm;page-break-after:always;-webkit-print-color-adjust:exact;print-color-adjust:exact}.report-nav{display:none}main{max-width:none;padding:0}.report-section{page-break-before:always;padding:10mm 0;border:0}.report-section h2{font-size:28pt}.claim{font-size:15pt}.visual img{max-height:135mm}.footer{display:none}}
`
