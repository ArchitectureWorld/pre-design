import type { ClientTheme, ClientThemeOverrides } from './client-types.ts'

export const DEFAULT_CLIENT_THEME: ClientTheme = Object.freeze({
  themeId: 'client-editorial-v1',
  tokens: {
    colors: {
      background: 'F5F5F7',
      surface: 'FFFFFF',
      ink: '1D1D1F',
      muted: '6E6E73',
      primary: '0D5D66',
      accent: 'B85C3A',
    },
    fonts: {
      display: 'Noto Sans CJK SC',
      body: 'Noto Sans CJK SC',
      fallbacks: ['Microsoft YaHei', 'Segoe UI'],
    },
    grid: { columns: 12 as const, safeMarginRatio: 0.06, spacingBase: 8 as const },
    typeScale: {
      pptxPt: { cover: 64, chapter: 52, title: 34, body: 18, caption: 10 },
      htmlPx: { cover: 80, chapter: 64, title: 44, body: 18, caption: 14 },
    },
    motion: { durationMs: 500, easing: 'ease-out' as const, respectsReducedMotion: true as const },
  },
})

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

export function createClientTheme(overrides: ClientThemeOverrides): ClientTheme {
  return deepFreeze({
    themeId: DEFAULT_CLIENT_THEME.themeId,
    tokens: {
      ...DEFAULT_CLIENT_THEME.tokens,
      colors: { ...DEFAULT_CLIENT_THEME.tokens.colors, ...overrides.colors },
      fonts: { ...DEFAULT_CLIENT_THEME.tokens.fonts, ...overrides.fonts },
    },
  })
}

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
:root{--background:#f5f5f7;--surface:#fff;--ink:#1d1d1f;--muted:#6e6e73;--primary:#0d5d66;--accent:#b85c3a;--font-body:"Microsoft YaHei","Segoe UI",sans-serif;--motion-duration:500ms;--motion-easing:ease-out}
*{box-sizing:border-box}html{scroll-behavior:smooth;overflow-x:hidden}body{margin:0;background:var(--background);color:var(--ink);font-family:var(--font-body);line-height:1.55;overflow-x:hidden}
a{color:inherit}.skip-link{position:fixed;left:16px;top:12px;z-index:30;padding:10px 14px;background:var(--surface);color:var(--ink);transform:translateY(-160%);transition:transform var(--motion-duration) var(--motion-easing)}.skip-link:focus{transform:none}
:focus-visible{outline:3px solid var(--accent);outline-offset:4px;border-radius:2px}
.report-nav{position:sticky;top:0;z-index:20;display:flex;gap:22px;overflow:auto;padding:14px 6vw;background:color-mix(in srgb,var(--ink) 94%,transparent);color:white;scrollbar-width:thin}.report-nav a{font-size:13px;text-decoration:none;white-space:nowrap}
main{width:100%}.report-page{position:relative;min-height:100vh;padding:8vh 6vw;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:24px;align-content:center;border-bottom:1px solid color-mix(in srgb,var(--ink) 12%,transparent)}
.report-page>div:not(.page-count){grid-column:1/-1}.page-count{position:absolute;top:24px;right:6vw;color:var(--muted);font-size:12px;letter-spacing:.14em}.eyebrow{margin:0 0 20px;color:var(--accent);font-size:13px;font-weight:700;letter-spacing:.2em}.report-page h1,.report-page h2,.report-page h3{line-height:1.08;text-wrap:balance}.report-page h2{max-width:1000px;margin:0 0 28px;font-size:clamp(38px,4.5vw,64px)}
.cover-grid{display:grid!important;grid-template-columns:repeat(12,minmax(0,1fr));gap:24px;align-items:center}.cover-copy{grid-column:1/8}.cover-copy h1{margin:0 0 20px;font-size:clamp(52px,6.4vw,88px)}.cover-project{font-size:20px;color:var(--primary)}.cover-value{max-width:780px;margin:32px 0;font-size:clamp(22px,2.2vw,34px)}.cover-copy time{display:block;margin-top:32px;color:var(--muted)}.cover-grid>.page-visual{grid-column:8/-1}
.keyword-list{display:flex;gap:10px;flex-wrap:wrap;padding:0;list-style:none}.keyword-list li{padding:7px 12px;border:1px solid color-mix(in srgb,var(--primary) 35%,transparent);border-radius:999px;font-size:14px}
.claim-stage,.chapter-stage{max-width:1050px}.claim-focus,.chapter-stage p{max-width:900px;margin:34px 0 0;font-size:clamp(24px,2.8vw,40px);color:var(--primary)}.layout-full-bleed{background:var(--ink);color:var(--surface)}.layout-full-bleed .page-count,.layout-full-bleed time{color:color-mix(in srgb,var(--surface) 68%,transparent)}.layout-full-bleed .claim-focus,.layout-full-bleed .chapter-stage p{color:color-mix(in srgb,var(--surface) 82%,var(--primary))}
.content-grid,.product-grid{display:grid!important;grid-template-columns:repeat(12,minmax(0,1fr));gap:32px;align-items:start}.content-grid>div:first-child,.product-grid>div:first-child{grid-column:1/7}.content-grid>div:last-child,.product-grid>div:last-child{grid-column:7/-1}.layout-split .content-grid>div:first-child{grid-column:1/6}.layout-split .content-grid>div:last-child{grid-column:6/-1}
.lead-copy{max-width:760px;font-size:20px}.page-visual{margin:0}.page-visual img{display:block;width:100%;max-height:66vh;object-fit:cover;background:#d8d8dc}.page-visual figcaption{display:flex;justify-content:space-between;gap:16px;margin-top:10px;color:var(--muted);font-size:14px}.asset-disclosure{color:var(--accent);white-space:nowrap}
.evidence-list{display:grid;gap:12px;margin:28px 0 0;padding:0;list-style:none}.evidence-list li{display:grid;gap:5px;padding:18px 20px;background:var(--surface);border-left:4px solid var(--primary)}.evidence-list small{color:var(--muted)}
.positioning-stage blockquote{max-width:920px;margin:48px 0;padding:28px 0;border-block:1px solid var(--primary);color:var(--primary);font-size:clamp(28px,3.2vw,48px)}.product-card{padding:30px;background:var(--surface);border-top:6px solid var(--accent)}.product-card h3{margin:8px 0 18px;font-size:32px}.product-card dl{display:grid;gap:14px}.product-card dl div{display:grid;grid-template-columns:92px 1fr;gap:16px}.product-card dt{color:var(--muted)}.product-card dd{margin:0}
.comparison{display:grid;grid-template-columns:1fr 1fr;gap:18px}.comparison article,.investment-list article{padding:24px;background:var(--surface)}.comparison span{color:var(--accent);font-weight:700}.phase-list,.decision-list{display:grid;gap:16px;max-width:980px;padding:0;counter-reset:item;list-style:none}.phase-list li,.decision-list li{position:relative;padding:24px 24px 24px 72px;background:var(--surface);font-size:20px}.phase-list li::before,.decision-list li::before{position:absolute;left:22px;top:20px;counter-increment:item;content:counter(item,decimal-leading-zero);color:var(--accent);font-weight:800}.phase-list p{margin:8px 0 0}.investment-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px}.investment-list article{display:grid;gap:10px}.investment-list span{font-size:26px;color:var(--primary)}.investment-list small{color:var(--muted)}
.footer{padding:30px 6vw 48px;color:var(--muted);font-size:13px;text-align:center}
.report-section{padding:68px 6vw;border-top:1px solid color-mix(in srgb,var(--ink) 18%,transparent);break-inside:avoid}.section-index{color:var(--accent);font-weight:700}.report-section h2{font-size:clamp(34px,4vw,56px)}.claim{font-size:23px;color:var(--primary)}.prose{max-width:880px;font-size:18px}.metric{border-top:5px solid var(--accent);padding:20px 0}.metric strong{display:block;font-size:34px}.metric small,.visual figcaption{color:var(--muted)}table{width:100%;border-collapse:collapse;background:var(--surface)}th,td{padding:14px 16px;border-bottom:1px solid #ddd;text-align:left}.visual img{display:block;width:100%;max-height:720px;object-fit:contain}.callout{padding:28px 32px;border-left:7px solid var(--primary);background:var(--surface)}
@media (prefers-reduced-motion: reduce){html{scroll-behavior:auto}*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}
@media(max-width:760px){.report-nav{display:none}.report-page{min-height:auto;padding:72px 24px;display:block}.page-count{right:24px}.cover-grid,.content-grid,.product-grid{display:block!important}.cover-copy,.cover-grid>.page-visual,.content-grid>div,.product-grid>div{grid-column:auto!important}.cover-grid>.page-visual,.content-grid>div:last-child{margin-top:32px}.cover-copy h1{font-size:44px}.report-page h2{font-size:36px}.claim-focus,.chapter-stage p{font-size:24px}.comparison{grid-template-columns:1fr}.page-visual img{max-height:none}.report-section{padding:48px 24px}}
@media print{@page{size:A4 landscape;margin:13mm}body{background:white}.report-nav,.skip-link{display:none}.report-page{min-height:175mm;page-break-after:always;padding:10mm}.report-section{page-break-before:always;padding:10mm 0;border:0}.footer{display:none}}
`
