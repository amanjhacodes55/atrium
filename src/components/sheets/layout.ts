import { parseA1, parseRange, toA1, type Range } from "@/lib/sheets/a1";
import { formatCell, type Value } from "@/lib/sheets/format";
import type { SheetTab } from "@/lib/types";
import { ptToPx } from "./sheet-table";

// Row geometry and merged cells for the grid. Rows are as tall as their explicit height, or, like
// Google Sheets and Excel, tall enough for any wrapped text in them.

export const ROW_H = 24;
// Cell padding plus a little slack: the browser also breaks at hyphens, which the count can miss.
const PAD_X = 14;
const LINE = 1.3;

let ctx: CanvasRenderingContext2D | null = null;
let family = "";
/** The font the grid renders in (the app's), so measurements match what is drawn. */
const baseFamily = () => (family ||= typeof document !== "undefined" ? getComputedStyle(document.body).fontFamily || "sans-serif" : "sans-serif");
function measure(text: string, font: string) {
  ctx ??= typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  if (!ctx) return text.length * 7;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** How many lines `text` takes when wrapped into `width` px, breaking at spaces like a browser. */
function lineCount(text: string, width: number, font: string) {
  let lines = 0;
  for (const para of text.split("\n")) {
    let line = "";
    lines++;
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && measure(next.trimEnd(), font) > width) {
        lines++;
        line = word.trimStart();
      } else line = next;
      // A word wider than the cell (a key, a URL) breaks anywhere, like overflow-wrap does.
      while (line.length > 1 && measure(line, font) > width) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut), font) > width) cut--;
        line = line.slice(cut);
        lines++;
      }
    }
  }
  return lines;
}

/** Heights that wrapped cells need, by row. Merged cells are left out: they span rows. */
export function autoHeights(tab: SheetTab, values: Record<string, Value>, widths: number[], covered: Set<string>, masters: Map<string, Range>) {
  const out: Record<number, number> = {};
  for (const [key, s] of Object.entries(tab.styles)) {
    if (!s.wrap || masters.has(key) || covered.has(key)) continue;
    const p = parseA1(key);
    const raw = tab.cells[key];
    if (!p || raw === undefined) continue;
    const text = formatCell(values[key] ?? raw, s);
    if (!text) continue;
    const px = s.size ? ptToPx(s.size) : 13;
    const font = `${s.i ? "italic " : ""}${s.b ? "600 " : ""}${px}px ${s.font ? `"${s.font}", ` : ""}${baseFamily()}`;
    const h = Math.ceil(lineCount(text, Math.max(10, (widths[p.c] ?? 100) - PAD_X), font) * px * LINE + 6);
    if (h > (out[p.r] ?? ROW_H)) out[p.r] = h;
  }
  // Large text that doesn't wrap still needs room for one line.
  for (const [key, s] of Object.entries(tab.styles)) {
    if (!s.size || s.size <= 11 || s.wrap) continue;
    const p = parseA1(key);
    if (!p) continue;
    const h = Math.ceil(ptToPx(s.size) * LINE + 6);
    if (h > (out[p.r] ?? ROW_H)) out[p.r] = h;
  }
  return out;
}

/** Merged ranges: each master cell's span, and every other cell a merge covers. */
export function mergeMap(tab: SheetTab) {
  const masters = new Map<string, Range>();
  const owner = new Map<string, string>();
  for (const ref of tab.merges ?? []) {
    const g = parseRange(ref);
    if (!g || (g.r1 === g.r2 && g.c1 === g.c2)) continue;
    const m = toA1(g.r1, g.c1);
    masters.set(m, g);
    for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) if (r !== g.r1 || c !== g.c1) owner.set(toA1(r, c), m);
  }
  return { masters, owner, covered: new Set(owner.keys()) };
}

/** Prefix sums: y[r] is the top of row r, y[rows] the bottom of the sheet. */
export function rowTops(rows: number, heightOf: (r: number) => number) {
  const y = new Float64Array(rows + 1);
  for (let r = 0; r < rows; r++) y[r + 1] = y[r] + heightOf(r);
  return y;
}

/** The index i with xs[i] <= v < xs[i+1], clamped to [0, n-1]. */
export function indexAt(xs: ArrayLike<number>, n: number, v: number) {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xs[mid] <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
