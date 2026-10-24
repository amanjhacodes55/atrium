// A1-style addressing. Rows and columns are zero-based internally; "A1" is { r: 0, c: 0 }.

export type Pos = { r: number; c: number };
export type Range = { r1: number; c1: number; r2: number; c2: number };

export function colName(c: number): string {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function colIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export const toA1 = (r: number, c: number) => `${colName(c)}${r + 1}`;

export function parseA1(ref: string): Pos | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(ref.trim());
  if (!m) return null;
  const r = Number(m[2]) - 1;
  return r < 0 ? null : { r, c: colIndex(m[1]) };
}

/** "B2:D5" or a single "B2" → normalized range. */
export function parseRange(ref: string): Range | null {
  const [a, b] = ref.split(":");
  const p = parseA1(a ?? "");
  const q = b === undefined ? p : parseA1(b);
  return p && q ? normRange(p, q) : null;
}

export function normRange(a: Pos, b: Pos): Range {
  return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
}

export function rangeA1(g: Range): string {
  const a = toA1(g.r1, g.c1);
  return g.r1 === g.r2 && g.c1 === g.c2 ? a : `${a}:${toA1(g.r2, g.c2)}`;
}

export const inRange = (g: Range, r: number, c: number) => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2;

/** Bounds of every non-empty cell, or null for an empty sheet. */
export function usedRange(cells: Record<string, string>): Range | null {
  let g: Range | null = null;
  for (const key of Object.keys(cells)) {
    const p = parseA1(key);
    if (!p) continue;
    if (!g) g = { r1: p.r, c1: p.c, r2: p.r, c2: p.c };
    else g = { r1: Math.min(g.r1, p.r), c1: Math.min(g.c1, p.c), r2: Math.max(g.r2, p.r), c2: Math.max(g.c2, p.c) };
  }
  return g;
}
