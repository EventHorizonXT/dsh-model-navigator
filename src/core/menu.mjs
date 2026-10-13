/** Keep a cascading shortcut menu inside the viewport, preferring the right. */
export function shortcutMenuPosition(anchor, measured, viewport) {
  const margin = 8;
  const gap = 6;
  const width = Math.min(measured.width, Math.max(1, viewport.width - margin * 2));
  const maxHeight = Math.min(measured.height, 360, Math.max(1, viewport.height - margin * 2));
  const fitsRight = anchor.right + gap + width <= viewport.width - margin;
  const side = fitsRight ? "right" : "left";
  const proposedLeft = fitsRight ? anchor.right + gap : anchor.left - width - gap;
  const left = Math.max(margin, Math.min(proposedLeft, viewport.width - width - margin));
  const top = Math.max(margin, Math.min(anchor.top, viewport.height - maxHeight - margin));
  return { left, top, width, maxHeight, side };
}
