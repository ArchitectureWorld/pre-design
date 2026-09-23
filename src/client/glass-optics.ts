import { isStrongGlass, type GlassAppearance } from './glass-appearance.ts'

/** Convex rim field from the approved prototype; center and all foreground text stay flat. */
export function sampleLens(x: number, y: number, width: number, height: number, radius: number, band: number): [number, number] {
  const r = Math.max(1, Math.min(radius, width / 2, height / 2))
  const px = x - width / 2, py = y - height / 2
  const qx = Math.abs(px) - (width / 2 - r), qy = Math.abs(py) - (height / 2 - r)
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), dist = Math.hypot(ox, oy)
  const signed = dist + Math.min(Math.max(qx, qy), 0) - r
  const t = Math.max(0, 1 - Math.max(0, -signed) / Math.max(1, band))
  if (!t || signed > 1) return [0, 0]
  let nx = 0, ny = 0
  if (dist > 1e-7) { nx = ox / dist * Math.sign(px); ny = oy / dist * Math.sign(py) }
  else if (qx > qy) nx = Math.sign(px)
  else ny = Math.sign(py)
  const magnitude = t * t * (3 - 2 * t) * .96
  return [-nx * magnitude, -ny * magnitude]
}
export function installGlassOptics(host: HTMLElement, id: string, initial: GlassAppearance) {
  let appearance = initial, frame = 0, serial = 0, stopped = false
  const enabled = typeof CSS !== 'undefined' && CSS.supports('backdrop-filter', 'url("#pre-glass-probe")') && typeof ResizeObserver !== 'undefined'
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;'
  const defs = document.createElementNS(ns, 'defs')
  svg.append(defs)
  type Surface = { filter: SVGFilterElement; image: SVGFEImageElement; blur: SVGFEGaussianBlurElement; displacement: SVGFEDisplacementMapElement; key: string; original: string; originalWebkit: string }
  const records = new Map<HTMLElement, Surface>()
  function schedule() { if (enabled && !stopped && !frame) frame = requestAnimationFrame(paint) }
  const resize = enabled ? new ResizeObserver(schedule) : null
  function restore() {
    for (const [el, record] of records) { el.style.backdropFilter = record.original; el.style.setProperty('-webkit-backdrop-filter', record.originalWebkit); record.filter.remove() }
    records.clear()
    resize?.disconnect()
  }
  function paint() {
    frame = 0
    if (!enabled || stopped) return
    try {
      for (const [el, record] of records) if (!host.contains(el)) { resize?.unobserve(el); record.filter.remove(); records.delete(el) }
      for (const el of host.querySelectorAll<HTMLElement>('.workspace,.project-card,.role-card')) {
        const w = el.offsetWidth, h = el.offsetHeight
        if (w < 2 || h < 2) continue
        let record = records.get(el)
        if (!record) {
          const filter = document.createElementNS(ns, 'filter'), image = document.createElementNS(ns, 'feImage'), blur = document.createElementNS(ns, 'feGaussianBlur'), displacement = document.createElementNS(ns, 'feDisplacementMap')
          filter.id = `${id}-lens-${++serial}`
          filter.setAttribute('filterUnits', 'userSpaceOnUse'); filter.setAttribute('color-interpolation-filters', 'sRGB'); filter.setAttribute('x', '0'); filter.setAttribute('y', '0')
          image.setAttribute('result', 'map'); image.setAttribute('preserveAspectRatio', 'none')
          blur.setAttribute('in', 'SourceGraphic'); blur.setAttribute('result', 'frosted')
          displacement.setAttribute('in', 'frosted'); displacement.setAttribute('in2', 'map'); displacement.setAttribute('xChannelSelector', 'R'); displacement.setAttribute('yChannelSelector', 'G')
          filter.append(image, blur, displacement); defs.append(filter)
          record = { filter, image, blur, displacement, key: '', original: el.style.backdropFilter, originalWebkit: el.style.getPropertyValue('-webkit-backdrop-filter') }
          records.set(el, record); resize?.observe(el)
        }
        const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 22
        const band = Math.min(radius * .95, isStrongGlass(appearance.theme) ? 22 : 13)
        const key = [w, h, radius, band].join(':')
        if (record.key !== key) {
          const ratio = Math.min(1, 640 / Math.max(w, h)), cw = Math.max(2, Math.round(w * ratio)), ch = Math.max(2, Math.round(h * ratio))
          const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Canvas unavailable')
          const pixels = context.createImageData(cw, ch)
          for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
            const [dx, dy] = sampleLens((x + .5) / cw * w, (y + .5) / ch * h, w, h, radius, band), offset = (y * cw + x) * 4
            pixels.data[offset] = Math.round(127.5 + dx * 127.5); pixels.data[offset + 1] = Math.round(127.5 + dy * 127.5); pixels.data[offset + 2] = 128; pixels.data[offset + 3] = 255
          }
          context.putImageData(pixels, 0, 0)
          for (const node of [record.filter, record.image]) { node.setAttribute('width', String(w)); node.setAttribute('height', String(h)) }
          record.image.setAttribute('href', canvas.toDataURL('image/png')); record.key = key
        }
        record.blur.setAttribute('stdDeviation', String(appearance.blur * .28))
        record.displacement.setAttribute('scale', String(appearance.refraction * .58))
        const value = appearance.refraction > 0 ? `url("#${record.filter.id}") saturate(1.14)` : `blur(${appearance.blur * .28}px) saturate(1.14)`
        el.style.backdropFilter = value; el.style.setProperty('-webkit-backdrop-filter', value)
      }
      host.dataset.refractionEngine = 'svg'
    } catch { restore(); stopped = true; host.dataset.refractionEngine = 'depth-only' }
  }
  const mutation = enabled ? new MutationObserver(changes => { if (changes.some(change => !svg.contains(change.target))) schedule() }) : null
  host.dataset.refractionEngine = enabled ? 'svg' : 'depth-only'
  if (enabled) { host.prepend(svg); mutation?.observe(host, { childList: true, subtree: true }); schedule() }
  return {
    sync(next: GlassAppearance) { appearance = next; schedule() },
    destroy() { stopped = true; if (frame) cancelAnimationFrame(frame); mutation?.disconnect(); restore(); svg.remove(); delete host.dataset.refractionEngine },
  }
}
