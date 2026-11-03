/**
 * Independent Bing HTML provider. Request/card protocol inspected in
 * dsh-free-search@0.4.22 (MIT), https://github.com/DDDMUC/dsh-free-search,
 * and confirmed by one public query on this host. No plugin fallback is mounted.
 */
import { parse } from 'parse5'
import { attribute, createHtmlSearchProvider, hasClass, sourceUrl, textOf, visibleNodes } from './search-html.mjs'

export const BING_SEARCH_ENDPOINT = 'https://www.bing.com/search'

function parseSources(html) {
  const sources = [], seen = new Set()
  for (const node of visibleNodes(parse(html))) {
    if (node.tagName !== 'li' || !hasClass(node, 'b_algo')) continue
    const nodes = [...visibleNodes(node)], heading = nodes.find(child => child.tagName === 'h2')
    const anchor = heading && [...visibleNodes(heading)].find(child => child.tagName === 'a' && attribute(child, 'href'))
    const url = anchor && sourceUrl(attribute(anchor, 'href'))
    if (!url || seen.has(url)) continue
    const parsed = new URL(url)
    // A tracking URL is not the cited original. Without a verified target,
    // omit it instead of following an arbitrary Bing redirect server-side.
    if ((parsed.hostname === 'bing.com' || parsed.hostname.endsWith('.bing.com')) && /^\/(?:ck\/a|aclick)(?:\/|$)/u.test(parsed.pathname)) continue
    seen.add(url)
    const title = textOf(anchor), snippetNode = nodes.find(child => child.tagName === 'p')
    const snippet = snippetNode ? textOf(snippetNode) : ''
    sources.push({ url, ...(title ? { title } : {}), ...(snippet ? { snippet } : {}) })
  }
  return sources
}

export function createBingSearchProvider(limits, transport) {
  return createHtmlSearchProvider({ id: 'bing', label: 'Bing', endpoint: BING_SEARCH_ENDPOINT,
    queryParams: query => ({ q: query, mkt: 'zh-CN', adlt: 'off' }), parseSources,
    isChallenge: html => /\b(?:id|class)\s*=\s*["'][^"']*\b(?:b_captcha(?:_container)?|captcha|challenge-form|g-recaptcha|h-captcha)\b/iu.test(html),
  }, limits, transport)
}
