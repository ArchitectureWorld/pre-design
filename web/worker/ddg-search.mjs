/**
 * Independent, anonymous DuckDuckGo HTML adapter for the DSH web seam.
 * Protocol inspected in dsh-free-search@0.4.22 (MIT), searchDdgHtml:
 * https://github.com/DDDMUC/dsh-free-search
 * This module does not mount that plugin or its multi-engine fallback chain.
 */
import { parse } from 'parse5'
import { createHtmlSearchProvider, textOf, visibleNodes } from './search-html.mjs'

export const DDG_SEARCH_ENDPOINT = 'https://html.duckduckgo.com/html/'
function sourceUrl(href) {
  if (!href) return undefined
  try {
    let url = new URL(href, DDG_SEARCH_ENDPOINT)
    const ddgHost = ['duckduckgo.com', 'html.duckduckgo.com', 'www.duckduckgo.com'].includes(url.hostname)
    if (ddgHost && url.pathname === '/l/') {
      const target = url.searchParams.get('uddg')
      if (!target) return undefined
      url = new URL(target)
    } else if (!/^(?:https?:)?\/\//iu.test(href) || ddgHost && url.pathname === '/y.js') return undefined
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    return url.href
  } catch { return undefined }
}

function parseSources(html) {
  // parse5 is already a platform dependency. Parsing never executes scripts or
  // follows URLs; comments and inactive elements cannot supply result anchors.
  const anchors = []
  for (const node of visibleNodes(parse(html, { sourceCodeLocationInfo: true }))) {
    if (node.tagName !== 'a') continue
    const attrs = new Map(node.attrs.map(({ name, value }) => [name, value]))
    const classes = new Set((attrs.get('class') ?? '').split(/\s+/u))
    if (!classes.has('result__a') && !classes.has('result__snippet')) continue
    const text = textOf(node)
    anchors.push({ kind: classes.has('result__a') ? 'result' : 'snippet', href: attrs.get('href'), text, start: node.sourceCodeLocation.startOffset })
  }
  const sources = [], seen = new Set()
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index]
    if (anchor.kind !== 'result') continue
    const url = sourceUrl(anchor.href)
    if (!url || seen.has(url)) continue
    seen.add(url)
    const snippet = anchors[index + 1]?.kind === 'snippet' ? anchors[index + 1].text : undefined
    let nextIndex = index + 1
    while (anchors[nextIndex] && anchors[nextIndex].kind !== 'result') nextIndex += 1
    const next = anchors[nextIndex]?.start ?? html.length
    const date = /<span\b[^>]*>\s*(\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?)\s*<\/span\s*>/iu.exec(html.slice(anchor.start, next))?.[1]
    sources.push({ url, ...(anchor.text ? { title: anchor.text } : {}), ...(snippet ? { snippet } : {}),
      ...(date && Number.isFinite(Date.parse(date)) ? { publishedAt: date } : {}) })
  }
  return sources
}

export function createDdgSearchProvider(limits, transport) {
  return createHtmlSearchProvider({ id: 'ddg', label: 'DuckDuckGo', endpoint: DDG_SEARCH_ENDPOINT,
    queryParams: query => ({ q: query, adlt: '-1' }), parseSources,
    isChallenge: html => /\b(?:id|class)\s*=\s*["'][^"']*\b(?:anomaly-modal|challenge-form|g-recaptcha|h-captcha)\b/iu.test(html) ||
      /\baction\s*=\s*["'][^"']*\/anomaly\.js\b/iu.test(html),
  }, limits, transport)
}
