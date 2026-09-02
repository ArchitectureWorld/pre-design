import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom') as {
  JSDOM: new (source: string) => { window: { document: Document } }
}

export const INSTALLED_EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(candidate => existsSync(candidate))

export interface LayoutRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export interface ElementLayout {
  readonly rect: LayoutRect
  readonly clientWidth: number
  readonly clientHeight: number
  readonly scrollWidth: number
  readonly scrollHeight: number
}

export interface FullBleedPageLayout {
  readonly index: number
  readonly pageNumber: string
  readonly layoutVariant: 'full-bleed' | 'editorial'
  readonly page: ElementLayout
  readonly media: ElementLayout
  readonly copy: ElementLayout
  readonly title: ElementLayout
  readonly body: ElementLayout | null
  readonly contract: ElementLayout
  readonly footer: ElementLayout
}

export interface HeadingLineLayout {
  readonly text: string
  readonly rect: LayoutRect
  readonly start: number
  readonly end: number
}

export interface HeadingLayout {
  readonly index: number
  readonly pageNumber: string
  readonly text: string
  readonly lines: readonly HeadingLineLayout[]
}

export interface CopyLayout {
  readonly index: number
  readonly pageNumber: string
  readonly text: string
  readonly lines: readonly HeadingLineLayout[]
}

export interface DirectedGraphLayout {
  readonly pageNumber: string
  readonly kind: string
  readonly nodes: readonly Readonly<{ id: string; rect: LayoutRect }>[]
  readonly edges: readonly Readonly<{
    from: string
    to: string
    rect: LayoutRect
    label: LayoutRect
    line: LayoutRect
  }>[]
}

export interface SitePlanAxisLabelLayout {
  readonly pageNumber: string
  readonly label: LayoutRect
  readonly axis: LayoutRect
}

export interface AnalysisMatrixLayout {
  readonly pageNumber: string
  readonly copy: LayoutRect
  readonly table: LayoutRect
}

export interface EdgePrintLayoutProbe {
  readonly devicePixelRatio: number
  readonly viewport: Readonly<{ width: number; height: number }>
  readonly pages: readonly FullBleedPageLayout[]
  readonly headings: readonly HeadingLayout[]
  readonly copyBlocks: readonly CopyLayout[]
  readonly directedGraphs: readonly DirectedGraphLayout[]
  readonly sitePlanAxisLabels: readonly SitePlanAxisLabelLayout[]
  readonly analysisMatrices: readonly AnalysisMatrixLayout[]
}

const PROBE_SCRIPT = String.raw`
<script id="edge-print-layout-runner">
(() => {
  let started = false;
  const rect = element => {
    const value = element.getBoundingClientRect();
    return {
      x: value.x, y: value.y, width: value.width, height: value.height,
      top: value.top, right: value.right, bottom: value.bottom, left: value.left,
    };
  };
  const layout = element => ({
    rect: rect(element),
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
  });
  const required = (root, selector) => {
    const element = root.querySelector(selector);
    if (element === null) throw new Error('PRINT_LAYOUT_SELECTOR_MISSING:' + selector);
    return element;
  };
  const optional = (root, selector) => {
    const element = root.querySelector(selector);
    return element === null ? null : layout(element);
  };
  const mergeRects = (left, right) => {
    const top = Math.min(left.top, right.top);
    const rightEdge = Math.max(left.right, right.right);
    const bottom = Math.max(left.bottom, right.bottom);
    const leftEdge = Math.min(left.left, right.left);
    return {
      x: leftEdge, y: top, width: rightEdge - leftEdge, height: bottom - top,
      top, right: rightEdge, bottom, left: leftEdge,
    };
  };
  const headingLines = heading => {
    const lines = [];
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    let nodeOffset = 0;
    let node = walker.nextNode();
    while (node !== null) {
      const value = node.textContent || '';
      for (let start = 0; start < value.length;) {
        const codePoint = value.codePointAt(start);
        const character = String.fromCodePoint(codePoint);
        const end = start + character.length;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        const characterRect = rect(range);
        const line = lines.find(candidate => Math.abs(candidate.rect.top - characterRect.top) <= 0.75);
        if (line === undefined) {
          lines.push({
            text: character,
            rect: characterRect,
            start: nodeOffset + start,
            end: nodeOffset + end,
          });
        }
        else {
          line.text += character;
          line.rect = mergeRects(line.rect, characterRect);
          line.start = Math.min(line.start, nodeOffset + start);
          line.end = Math.max(line.end, nodeOffset + end);
        }
        start = end;
      }
      nodeOffset += value.length;
      node = walker.nextNode();
    }
    return lines
      .sort((left, right) => left.rect.top - right.rect.top)
      .map(line => ({
        text: line.text.trim(),
        rect: line.rect,
        start: line.start,
        end: line.end,
      }))
      .filter(line => line.text !== '');
  };
  const measure = () => {
    if (started) return;
    started = true;
    const pages = [...document.querySelectorAll('.visual-evidence.layout-full-bleed, .visual-evidence.layout-editorial')].map((page, index) => ({
      index,
      pageNumber: required(page, '.page-number').textContent.trim(),
      layoutVariant: page.classList.contains('layout-editorial') ? 'editorial' : 'full-bleed',
      page: layout(page),
      media: layout(required(page, '.page-media')),
      copy: layout(required(page, '.page-copy')),
      title: layout(required(page, '.page-copy h1')),
      body: optional(page, '.page-copy .focus'),
      contract: layout(required(page, '.page-copy .visual-contract')),
      footer: layout(required(page, ':scope > footer')),
    }));
    const headings = [...document.querySelectorAll('.print-page .page-copy h1')].map((heading, index) => {
      const page = heading.closest('.print-page');
      if (page === null) throw new Error('PRINT_LAYOUT_HEADING_PAGE_MISSING');
      return {
        index,
        pageNumber: required(page, '.page-number').textContent.trim(),
        text: heading.textContent.trim(),
        lines: headingLines(heading),
      };
    });
    const copyBlocks = [...document.querySelectorAll('.print-page .focus, .print-page .visual-contract, .print-page .evidence strong, .print-page .evidence small, .print-page .evidence span')].map((copy, index) => {
      const page = copy.closest('.print-page');
      if (page === null) throw new Error('PRINT_LAYOUT_COPY_PAGE_MISSING');
      return {
        index,
        pageNumber: required(page, '.page-number').textContent.trim(),
        text: copy.textContent.trim(),
        lines: headingLines(copy),
      };
    });
    const directedGraphs = [...document.querySelectorAll('.analysis-directed-map, .analysis-convergence')].map(graph => {
      const page = graph.closest('.print-page');
      if (page === null) throw new Error('PRINT_LAYOUT_GRAPH_PAGE_MISSING');
      return {
        pageNumber: required(page, '.page-number').textContent.trim(),
        kind: graph.getAttribute('data-analysis-kind') || '',
        nodes: [...graph.querySelectorAll('[data-analysis-node]')].map(node => ({
          id: node.getAttribute('data-analysis-node') || '',
          rect: rect(node),
        })),
        edges: [...graph.querySelectorAll('[data-from][data-to]')].map(edge => ({
          from: edge.getAttribute('data-from') || '',
          to: edge.getAttribute('data-to') || '',
          rect: rect(required(edge, 'svg')),
          label: rect(required(edge, ':scope > span')),
          line: rect(required(edge, 'svg line')),
        })),
      };
    });
    const sitePlanAxisLabels = [...document.querySelectorAll('.analysis-site-plan[data-analysis-kind="spatial-system"]')].map(plan => {
      const page = plan.closest('.print-page');
      if (page === null) throw new Error('PRINT_LAYOUT_SITE_PLAN_PAGE_MISSING');
      const labels = [...plan.querySelectorAll('[data-map-layer="functional-zones"] text')];
      const label = labels.find(candidate => candidate.textContent.trim() === '生态休闲区');
      if (label === undefined) throw new Error('PRINT_LAYOUT_SITE_PLAN_LABEL_MISSING');
      return {
        pageNumber: required(page, '.page-number').textContent.trim(),
        label: rect(label),
        axis: rect(required(plan, '[data-map-layer="spatial-system"] path')),
      };
    });
    const analysisMatrices = [...document.querySelectorAll('.analysis-matrix')].map(matrix => {
      const page = matrix.closest('.print-page');
      if (page === null) throw new Error('PRINT_LAYOUT_MATRIX_PAGE_MISSING');
      return {
        pageNumber: required(page, '.page-number').textContent.trim(),
        copy: rect(required(page, '.page-copy')),
        table: rect(required(matrix, 'table')),
      };
    });
    const marker = document.createElement('script');
    marker.id = 'edge-print-layout-result';
    marker.type = 'application/json';
    marker.textContent = JSON.stringify({
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pages,
      headings,
      copyBlocks,
      directedGraphs,
      sitePlanAxisLabels,
      analysisMatrices,
    });
    document.body.append(marker);
  };
  if (document.readyState === 'complete') measure();
  else window.addEventListener('load', measure, { once: true });
})();
</script>`

function injectProbe(html: string, injectedCss?: string): string {
  const style = injectedCss === undefined || injectedCss.trim() === ''
    ? ''
    : `<style id="edge-print-layout-mutation">${injectedCss}</style>`
  if (!html.includes('</head>') || !html.includes('</body>')) {
    throw new Error('print HTML is missing head or body closing tags')
  }
  return html
    .replace('</head>', `${style}</head>`)
    .replace('</body>', `${PROBE_SCRIPT}</body>`)
}

function runEdge(executable: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Edge layout probe timed out after 20 seconds'))
    }, 20_000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.once('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', code => {
      clearTimeout(timeout)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`Edge layout probe exited with code ${String(code)}: ${stderr.trim()}`))
    })
  })
}

export async function probePrintLayoutWithEdge(
  htmlPath: string,
  edgeExecutable: string,
  options: { readonly injectedCss?: string } = {},
): Promise<EdgePrintLayoutProbe> {
  const profileRoot = await mkdtemp(join(tmpdir(), 'preplan-edge-layout-profile-'))
  const probePath = join(dirname(htmlPath), `.edge-layout-${randomUUID()}.html`)
  try {
    const source = await readFile(htmlPath, 'utf8')
    await writeFile(probePath, injectProbe(source, options.injectedCss), 'utf8')
    const result = await runEdge(edgeExecutable, [
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--no-first-run',
      '--no-default-browser-check',
      '--allow-file-access-from-files',
      '--hide-scrollbars',
      '--window-size=1400,1000',
      '--force-device-scale-factor=1',
      '--run-all-compositor-stages-before-draw',
      '--dump-dom',
      '--virtual-time-budget=3000',
      `--user-data-dir=${profileRoot}`,
      pathToFileURL(probePath).href,
    ])
    const document = new JSDOM(result.stdout).window.document
    const marker = document.querySelector('#edge-print-layout-result')
    if (marker?.textContent === null || marker?.textContent === undefined || marker.textContent.trim() === '') {
      throw new Error([
        'Edge layout probe produced no result marker',
        `stderr: ${result.stderr.trim()}`,
        `dump tail: ${result.stdout.slice(-2_000)}`,
      ].join('\n'))
    }
    return JSON.parse(marker.textContent) as EdgePrintLayoutProbe
  } finally {
    await Promise.allSettled([
      unlink(probePath),
      rm(profileRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
    ])
  }
}

function intersects(left: LayoutRect, right: LayoutRect, tolerance = 0.75): boolean {
  return left.right > right.left + tolerance
    && right.right > left.left + tolerance
    && left.bottom > right.top + tolerance
    && right.bottom > left.top + tolerance
}

function outside(inner: LayoutRect, outer: LayoutRect, tolerance = 0.75): boolean {
  return inner.left < outer.left - tolerance
    || inner.right > outer.right + tolerance
    || inner.top < outer.top - tolerance
    || inner.bottom > outer.bottom + tolerance
}

function elementOverflows(element: ElementLayout, tolerance = 1): boolean {
  return element.scrollWidth > element.clientWidth + tolerance
    || element.scrollHeight > element.clientHeight + tolerance
}

export function fullBleedLayoutViolations(probe: EdgePrintLayoutProbe): string[] {
  return probe.pages.flatMap(page => {
    const prefix = page.pageNumber === '' ? `full-bleed-${page.index + 1}` : page.pageNumber
    const violations: string[] = []
    const disjoint: Array<readonly [string, ElementLayout, string, ElementLayout]> = [
      ['media', page.media, 'copy', page.copy],
      ['media', page.media, 'contract', page.contract],
      ['media', page.media, 'footer', page.footer],
      ['copy', page.copy, 'footer', page.footer],
      ['contract', page.contract, 'footer', page.footer],
      ['title', page.title, 'contract', page.contract],
      ...(page.body === null ? [] : [
        ['title', page.title, 'body', page.body] as const,
        ['body', page.body, 'contract', page.contract] as const,
      ]),
    ]
    for (const [leftName, left, rightName, right] of disjoint) {
      if (intersects(left.rect, right.rect)) violations.push(`${prefix}:${leftName}-${rightName}-overlap`)
    }
    const contained: Array<readonly [string, ElementLayout, ElementLayout]> = [
      ['media', page.media, page.page],
      ['copy', page.copy, page.page],
      ['footer', page.footer, page.page],
      ['title', page.title, page.copy],
      ['contract', page.contract, page.copy],
      ...(page.body === null ? [] : [['body', page.body, page.copy] as const]),
    ]
    for (const [name, element, container] of contained) {
      if (outside(element.rect, container.rect)) violations.push(`${prefix}:${name}-outside-region`)
    }
    for (const [name, element] of [
      ['title', page.title],
      ['contract', page.contract],
      ...(page.body === null ? [] : [['body', page.body] as const]),
    ] as const) {
      const overflowTolerance = name === 'title' && page.layoutVariant === 'editorial' ? 4 : 1
      if (elementOverflows(element, overflowTolerance)) violations.push(`${prefix}:${name}-content-overflow`)
    }
    return violations
  })
}

export function directedGraphLayoutViolations(probe: EdgePrintLayoutProbe, tolerance = 1): string[] {
  return probe.directedGraphs.flatMap(graph => {
    const nodes = new Map(graph.nodes.map(node => [node.id, node.rect]))
    return graph.edges.flatMap(edge => {
      const prefix = `${graph.pageNumber}:${graph.kind}:${edge.from}->${edge.to}`
      const source = nodes.get(edge.from)
      const target = nodes.get(edge.to)
      const violations: string[] = []
      if (source === undefined) violations.push(`${prefix}:missing-source`)
      if (target === undefined) violations.push(`${prefix}:missing-target`)
      if (edge.rect.height <= edge.rect.width + tolerance) violations.push(`${prefix}:not-vertical`)
      if (intersects(edge.label, edge.line, tolerance)) violations.push(`${prefix}:label-line-overlap`)
      if (source !== undefined && intersects(source, edge.line, tolerance)) violations.push(`${prefix}:source-line-overlap`)
      if (target !== undefined && intersects(target, edge.line, tolerance)) violations.push(`${prefix}:target-line-overlap`)
      const centerX = edge.rect.left + edge.rect.width / 2
      if (source !== undefined && (centerX < source.left - tolerance || centerX > source.right + tolerance)) {
        violations.push(`${prefix}:outside-source`)
      }
      if (target !== undefined && (centerX < target.left - tolerance || centerX > target.right + tolerance)) {
        violations.push(`${prefix}:outside-target`)
      }
      return violations
    })
  })
}

export function sitePlanAxisLabelViolations(probe: EdgePrintLayoutProbe, tolerance = 2): string[] {
  return probe.sitePlanAxisLabels.flatMap(item => {
    const expandedAxis = {
      ...item.axis,
      top: item.axis.top - tolerance,
      right: item.axis.right + tolerance,
      bottom: item.axis.bottom + tolerance,
      left: item.axis.left - tolerance,
    }
    return intersects(item.label, expandedAxis, 0) ? [`${item.pageNumber}:spatial-system:axis-label-overlap`] : []
  })
}

export function headingTailViolations(probe: EdgePrintLayoutProbe): string[] {
  return probe.headings.flatMap(heading => {
    if (heading.lines.length < 2) return []
    const tail = heading.lines.at(-1)!
    const meaningfulCharacters = [...tail.text].filter(character => /[\p{L}\p{N}]/u.test(character))
    const isShortHanTail = meaningfulCharacters.length > 0
      && meaningfulCharacters.length <= 2
      && meaningfulCharacters.every(character => /\p{Script=Han}/u.test(character))
    const precedingWidth = Math.max(...heading.lines.slice(0, -1).map(line => line.rect.width))
    const tailWidthRatio = precedingWidth === 0 ? 1 : tail.rect.width / precedingWidth
    if (!isShortHanTail && tailWidthRatio >= 0.4) return []
    const prefix = heading.pageNumber === '' ? `heading-${heading.index + 1}` : heading.pageNumber
    return [`${prefix}:short-heading-tail:${tail.text}:${tailWidthRatio.toFixed(3)}`]
  })
}

export function headingWordBreakViolations(
  probe: EdgePrintLayoutProbe,
  protectedTerms: readonly string[],
): string[] {
  const terms = [...new Set(protectedTerms.filter(term => [...term].length > 1))]
  return probe.headings.flatMap(heading => {
    if (heading.lines.length < 2) return []
    const prefix = heading.pageNumber === '' ? `heading-${heading.index + 1}` : heading.pageNumber
    const lineBreaks = heading.lines.slice(0, -1).map((line, lineIndex) => ({
      offset: line.end,
      line,
      nextLine: heading.lines[lineIndex + 1]!,
    }))
    return terms.flatMap(term => {
      const violations: string[] = []
      let start = heading.text.indexOf(term)
      while (start >= 0) {
        const split = lineBreaks.find(lineBreak => (
          lineBreak.offset > start && lineBreak.offset < start + term.length
        ))
        if (split !== undefined) {
          violations.push(`${prefix}:heading-word-break:${term}:${split.line.text}|${split.nextLine.text}`)
        }
        start = heading.text.indexOf(term, start + term.length)
      }
      return violations
    })
  })
}

export function copyWordBreakViolations(
  probe: EdgePrintLayoutProbe,
  protectedTerms: readonly string[],
): string[] {
  const terms = [...new Set(protectedTerms.filter(term => [...term].length > 1))]
  return probe.copyBlocks.flatMap(copy => {
    if (copy.lines.length < 2) return []
    const prefix = copy.pageNumber === '' ? `copy-${copy.index + 1}` : copy.pageNumber
    const lineBreaks = copy.lines.slice(0, -1).map((line, lineIndex) => ({
      offset: line.end,
      line,
      nextLine: copy.lines[lineIndex + 1]!,
    }))
    return terms.flatMap(term => {
      const violations: string[] = []
      let start = copy.text.indexOf(term)
      while (start >= 0) {
        const split = lineBreaks.find(lineBreak => lineBreak.offset > start && lineBreak.offset < start + term.length)
        if (split !== undefined) violations.push(`${prefix}:copy-word-break:${term}:${split.line.text}|${split.nextLine.text}`)
        start = copy.text.indexOf(term, start + term.length)
      }
      return violations
    })
  })
}
