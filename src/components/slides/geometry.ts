// Box maths for the slide editor: resizing from a handle and snapping while dragging.

export type Box = { x: number; y: number; w: number; h: number };
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const MIN = 12;

/** New box after dragging `handle` by (dx, dy). Corners keep the aspect ratio when `keepAspect`. */
export function resizeBox(orig: Box, handle: Handle, dx: number, dy: number, keepAspect = false): Box {
  let { x, y, w, h } = orig;
  if (handle.includes("e")) w = orig.w + dx;
  if (handle.includes("s")) h = orig.h + dy;
  if (handle.includes("w")) w = orig.w - dx;
  if (handle.includes("n")) h = orig.h - dy;
  if (keepAspect && handle.length === 2 && orig.w > 0 && orig.h > 0) {
    const ratio = orig.w / orig.h;
    // Follow whichever side moved more, relative to its size.
    if (Math.abs(w / orig.w) > Math.abs(h / orig.h)) h = w / ratio;
    else w = h * ratio;
  }
  w = Math.max(MIN, w);
  h = Math.max(MIN, h);
  if (handle.includes("w")) x = orig.x + orig.w - w;
  if (handle.includes("n")) y = orig.y + orig.h - h;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

export type Guides = { x: number | null; y: number | null };

/**
 * Snaps a moving box's left/centre/right (and top/middle/bottom) to the canvas edges and centre
 * and to other elements, within `threshold` px. Returns the snapped position and the guide lines.
 */
export function snapMove(box: Box, others: Box[], canvas: { w: number; h: number }, threshold = 6): { x: number; y: number; guides: Guides } {
  const xs = [0, canvas.w / 2, canvas.w, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
  const ys = [0, canvas.h / 2, canvas.h, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
  const best = (pos: number, size: number, lines: number[]) => {
    let hit: { delta: number; line: number } | null = null;
    for (const anchor of [0, size / 2, size]) {
      for (const line of lines) {
        const delta = line - (pos + anchor);
        if (Math.abs(delta) <= threshold && (!hit || Math.abs(delta) < Math.abs(hit.delta))) hit = { delta, line };
      }
    }
    return hit;
  };
  const sx = best(box.x, box.w, xs);
  const sy = best(box.y, box.h, ys);
  return {
    x: Math.round(box.x + (sx?.delta ?? 0)),
    y: Math.round(box.y + (sy?.delta ?? 0)),
    guides: { x: sx?.line ?? null, y: sy?.line ?? null },
  };
}

/** Fits a w x h image inside max bounds, centred on the canvas. */
export function fitCentered(w: number, h: number, maxW: number, maxH: number, canvas: { w: number; h: number }): Box {
  const s = Math.min(1, maxW / w, maxH / h);
  const bw = Math.round(w * s);
  const bh = Math.round(h * s);
  return { x: Math.round((canvas.w - bw) / 2), y: Math.round((canvas.h - bh) / 2), w: bw, h: bh };
}
