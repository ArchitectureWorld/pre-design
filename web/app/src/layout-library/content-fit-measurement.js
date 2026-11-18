/** Internal measurement only: canvas-space outer boxes, never a fit/visual approval. */
export function measureContentFitSlots(page, {canvas, policies}) {
  const fail = () => { throw new Error('CONTENT_FIT_MEASUREMENT_INVALID'); };
  const doc = page?.ownerDocument, win = doc?.defaultView;
  if (!win || !page.isConnected || doc.fonts?.status !== 'loaded' || !page.clientWidth || !page.clientHeight || !Number.isFinite(canvas?.width) || !Number.isFinite(canvas?.height) || canvas.width <= 0 || canvas.height <= 0 || !Array.isArray(policies) || !policies.length) fail();
  const sx = canvas.width / page.clientWidth, sy = canvas.height / page.clientHeight;
  const px = value => { const n = Number.parseFloat(value); if (!Number.isFinite(n)) fail(); return n; };
  const seen = new Set();
  const slots = policies.map(({slotId, direction}) => {
    if (typeof slotId !== 'string' || seen.has(slotId) || !['left','up','down'].includes(direction)) fail();
    seen.add(slotId);
    const matches = [...page.querySelectorAll('[data-layout-slot-id]')].filter(e => e.dataset.layoutSlotId === slotId);
    if (matches.length !== 1) fail();
    const element = matches[0], style = win.getComputedStyle(element);
    if (style.display === 'none' || style.visibility !== 'visible' || style.transform !== 'none' || style.writingMode !== 'horizontal-tb') fail();
    const assertUntransformed = node => {
      const css = win.getComputedStyle(node);
      if (css.transform !== 'none' || (css.scale && css.scale !== 'none') || (css.rotate && css.rotate !== 'none') || (css.translate && css.translate !== 'none') || css.writingMode !== 'horizontal-tb' || (css.zoom && Number(css.zoom) !== 1)) fail();
    };
    assertUntransformed(element);
    for (const node of element.querySelectorAll('*')) assertUntransformed(node);
    for (let node = element.parentElement; node && node !== page; node = node.parentElement) assertUntransformed(node);
    const bx = px(style.borderLeftWidth) + px(style.borderRightWidth), by = px(style.borderTopWidth) + px(style.borderBottomWidth);
    const paddingX = px(style.paddingLeft) + px(style.paddingRight), paddingY = px(style.paddingTop) + px(style.paddingBottom);
    const outerWidth = px(style.width) + (style.boxSizing === 'border-box' ? 0 : paddingX + bx);
    const outerHeight = px(style.height) + (style.boxSizing === 'border-box' ? 0 : paddingY + by);
    const overflowingHeight = element.scrollHeight > element.clientHeight + 1;
    let width = (element.scrollWidth > element.clientWidth + 1 ? Math.max(outerWidth, element.scrollWidth + bx) : outerWidth), height = overflowingHeight ? element.scrollHeight + by : outerHeight;
    if (direction === 'left') {
      const clone = element.cloneNode(true);
      clone.removeAttribute('id'); clone.removeAttribute('data-layout-slot-id');
      for (const node of clone.querySelectorAll('[id],[data-layout-slot-id]')) { node.removeAttribute('id'); node.removeAttribute('data-layout-slot-id'); }
      Object.assign(clone.style, {position:'absolute',visibility:'hidden',pointerEvents:'none',width:'max-content',height:'auto',minWidth:'0',maxWidth:'none',minHeight:'0',maxHeight:'none',whiteSpace:'nowrap',transform:'none'});
      try {
        element.parentElement.append(clone);
        const measured = win.getComputedStyle(clone);
        width = px(measured.width) + (measured.boxSizing === 'border-box' ? 0 : paddingX + bx);
        height = px(measured.height) + (measured.boxSizing === 'border-box' ? 0 : paddingY + by);
      } finally { clone.remove(); }
    }
    return {slotId, requiredWidth: width * sx + (direction === 'left' ? 2 : 0), requiredHeight: height * sy + (direction === 'left' || overflowingHeight ? 2 : 0)};
  });
  return {units:'canvas-pixels', status:'measured-requires-rerender', slots};
}
