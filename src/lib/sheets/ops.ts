import type { CellStyle, SheetTab } from "../types";
import { colIndex, colName, parseA1, parseRange, rangeA1, toA1, type Range } from "./a1";
import { isError, type Value } from "./format";

// Pure edits on a sheet tab. Every function returns a new tab and leaves its input alone.

/**
 * Moves relative references in a formula by (dr, dc), as copying a cell does in Excel. `$`-anchored
 * parts stay put, quoted strings and sheet names are left alone, and a reference pushed off the
 * sheet becomes #REF!.
 */
export function shiftFormula(formula: string, dr: number, dc: number): string {
  if (!formula.startsWith("=") || (dr === 0 && dc === 0)) return formula;
  return formula
    .split(/("(?:[^"]|"")*"|'(?:[^']|'')*')/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/(^|[^A-Za-z0-9_.])(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_(!])/g, (_m, pre, cAbs, col, rAbs, row) => {
            const c = cAbs ? colIndex(col) : colIndex(col) + dc;
            const r = rAbs ? Number(row) - 1 : Number(row) - 1 + dr;
            if (c < 0 || r < 0) return `${pre}#REF!`;
            return `${pre}${cAbs}${colName(c)}${rAbs}${r + 1}`;
          }),
    )
    .join("");
}

export function setCells(tab: SheetTab, updates: Record<string, string>): SheetTab {
  const cells = { ...tab.cells };
  for (const [k, v] of Object.entries(updates)) {
    if (v === "") delete cells[k];
    else cells[k] = v;
  }
  return { ...tab, cells };
}

export function clearRange(tab: SheetTab, g: Range): SheetTab {
  const cells: Record<string, string> = {};
  for (const [k, v] of Object.entries(tab.cells)) {
    const p = parseA1(k);
    if (!p || p.r < g.r1 || p.r > g.r2 || p.c < g.c1 || p.c > g.c2) cells[k] = v;
  }
  return { ...tab, cells };
}

/** Applies a style patch to every cell in the range; `undefined` values remove that property. */
export function styleRange(tab: SheetTab, g: Range, patch: Partial<CellStyle>): SheetTab {
  const styles = { ...tab.styles };
  for (let r = g.r1; r <= g.r2; r++) {
    for (let c = g.c1; c <= g.c2; c++) {
      const k = toA1(r, c);
      const next: CellStyle = { ...styles[k], ...patch };
      for (const key of Object.keys(next) as (keyof CellStyle)[]) if (next[key] === undefined || next[key] === false) delete next[key];
      if (Object.keys(next).length) styles[k] = next;
      else delete styles[k];
    }
  }
  return { ...tab, styles };
}

// ---- Delimited text (TSV for the clipboard, CSV for files) ----

export function parseDelimited(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const src = text.replace(/\r\n?/g, "\n");
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') quoted = false;
      else field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
    i++;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function toDelimited(rows: string[][], sep: string): string {
  const quote = (s: string) => (s.includes(sep) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return rows.map((r) => r.map(quote).join(sep)).join(sep === "\t" ? "\n" : "\r\n");
}

/** Guesses the separator from the first line: tab, semicolon or comma. */
export function sniffSeparator(text: string): string {
  const line = text.slice(0, text.indexOf("\n") === -1 ? undefined : text.indexOf("\n"));
  const count = (s: string) => line.split(s).length - 1;
  if (count("\t") > 0 && count("\t") >= count(",")) return "\t";
  return count(";") > count(",") ? ";" : ",";
}

/** Raw text of a range (formulas included), for copy and fill. */
export function rawGrid(tab: SheetTab, g: Range): string[][] {
  const out: string[][] = [];
  for (let r = g.r1; r <= g.r2; r++) {
    const row: string[] = [];
    for (let c = g.c1; c <= g.c2; c++) row.push(tab.cells[toA1(r, c)] ?? "");
    out.push(row);
  }
  return out;
}

/** Writes a block of raw values at (r, c), shifting formulas by the distance from `from`. */
export function pasteGrid(tab: SheetTab, grid: string[][], at: { r: number; c: number }, from?: { r: number; c: number }): SheetTab {
  const updates: Record<string, string> = {};
  grid.forEach((row, i) =>
    row.forEach((raw, j) => {
      updates[toA1(at.r + i, at.c + j)] = from ? shiftFormula(raw, at.r - from.r, at.c - from.c) : raw;
    }),
  );
  return setCells(tab, updates);
}

/**
 * Fill handle: extends `src` into `dest` (which contains it). Numbers with a steady step continue
 * the series (1, 2 → 3, 4); everything else repeats, formulas shifting as they go.
 */
export function fill(tab: SheetTab, src: Range, dest: Range): SheetTab {
  const updates: Record<string, string> = {};
  const styles = { ...tab.styles };
  const h = src.r2 - src.r1 + 1;
  const w = src.c2 - src.c1 + 1;
  const down = dest.r2 > src.r2 || dest.r1 < src.r1;
  const series = (vals: string[]) => {
    const nums = vals.map(Number);
    if (vals.length < 2 || vals.some((v) => v.trim() === "" || v.startsWith("="))) return null;
    if (nums.some((n) => !Number.isFinite(n))) return null;
    const step = nums[1] - nums[0];
    return nums.every((n, i) => i === 0 || Math.abs(n - nums[i - 1] - step) < 1e-9) ? { start: nums[0], step } : null;
  };
  for (let r = dest.r1; r <= dest.r2; r++) {
    for (let c = dest.c1; c <= dest.c2; c++) {
      if (r >= src.r1 && r <= src.r2 && c >= src.c1 && c <= src.c2) continue;
      const sr = src.r1 + ((((r - src.r1) % h) + h) % h);
      const sc = src.c1 + ((((c - src.c1) % w) + w) % w);
      const line = down
        ? Array.from({ length: h }, (_, i) => tab.cells[toA1(src.r1 + i, c)] ?? "")
        : Array.from({ length: w }, (_, i) => tab.cells[toA1(r, src.c1 + i)] ?? "");
      const s = series(line);
      const key = toA1(r, c);
      if (s) updates[key] = String(parseFloat((s.start + s.step * (down ? r - src.r1 : c - src.c1)).toPrecision(12)));
      else updates[key] = shiftFormula(tab.cells[toA1(sr, sc)] ?? "", r - sr, c - sc);
      const st = tab.styles[toA1(sr, sc)];
      if (st) styles[key] = st;
      else delete styles[key];
    }
  }
  return { ...setCells(tab, updates), styles };
}

function compareValues(a: Value, b: Value): number {
  const rank = (v: Value) => (v === null || v === "" ? 3 : typeof v === "number" ? 0 : isError(v) ? 2 : 1);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(isError(a) ? a.error : a).localeCompare(String(isError(b) ? b.error : b), undefined, { numeric: true, sensitivity: "base" });
}

/** Sorts the rows of `g` by the computed values in column `key`. Blanks always go last. */
export function sortRange(tab: SheetTab, g: Range, key: number, values: Record<string, Value>, desc = false): SheetTab {
  const rows = [];
  for (let r = g.r1; r <= g.r2; r++) rows.push(r);
  const val = (r: number) => values[toA1(r, key)] ?? null;
  const blank = (v: Value) => v === null || v === "";
  rows.sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (blank(va) || blank(vb)) return Number(blank(va)) - Number(blank(vb));
    return desc ? compareValues(vb, va) : compareValues(va, vb);
  });
  let next = clearRange(tab, g);
  const styles = { ...tab.styles };
  const updates: Record<string, string> = {};
  rows.forEach((from, i) => {
    const to = g.r1 + i;
    for (let c = g.c1; c <= g.c2; c++) {
      const raw = tab.cells[toA1(from, c)];
      if (raw) updates[toA1(to, c)] = shiftFormula(raw, to - from, 0);
      const st = tab.styles[toA1(from, c)];
      if (st) styles[toA1(to, c)] = st;
      else delete styles[toA1(to, c)];
    }
  });
  next = setCells(next, updates);
  return { ...next, styles };
}

/** Next free name like "Sheet3". */
export function nextSheetName(names: string[]): string {
  for (let i = names.length + 1; ; i++) if (!names.includes(`Sheet${i}`)) return `Sheet${i}`;
}

/** Ctrl+arrow: jump to the edge of the current block of data, like Excel. */
export function jump(cells: Record<string, string>, from: { r: number; c: number }, dr: number, dc: number, maxR: number, maxC: number) {
  const filled = (r: number, c: number) => Boolean(cells[toA1(r, c)]);
  let { r, c } = from;
  const inside = (r: number, c: number) => r >= 0 && c >= 0 && r <= maxR && c <= maxC;
  if (!inside(r + dr, c + dc)) return { r, c };
  if (filled(r, c) && filled(r + dr, c + dc)) {
    while (inside(r + dr, c + dc) && filled(r + dr, c + dc)) {
      r += dr;
      c += dc;
    }
    return { r, c };
  }
  r += dr;
  c += dc;
  while (inside(r, c) && !filled(r, c) && inside(r + dr, c + dc)) {
    r += dr;
    c += dc;
  }
  return { r, c };
}

/** Borders on a range: every cell edge, only the outline, or none. */
export function borderRange(tab: SheetTab, g: Range, mode: "all" | "outer" | "none", color = "#111827"): SheetTab {
  const styles = { ...tab.styles };
  for (let r = g.r1; r <= g.r2; r++) {
    for (let c = g.c1; c <= g.c2; c++) {
      const k = toA1(r, c);
      const next: CellStyle = { ...styles[k] };
      if (mode === "none") delete next.border;
      else if (mode === "all") next.border = { t: color, r: color, b: color, l: color };
      else {
        const b = { ...next.border };
        if (r === g.r1) b.t = color;
        if (r === g.r2) b.b = color;
        if (c === g.c1) b.l = color;
        if (c === g.c2) b.r = color;
        next.border = b;
      }
      if (Object.keys(next).length) styles[k] = next;
      else delete styles[k];
    }
  }
  return { ...tab, styles };
}

/**
 * Merges a range, or unmerges any merge it touches. Like Excel, merging keeps only the top-left
 * value; the rest of the range is cleared.
 */
export function toggleMerge(tab: SheetTab, g: Range): SheetTab {
  const overlaps = (tab.merges ?? []).filter((ref) => {
    const m = parseRange(ref);
    return m && m.r1 <= g.r2 && m.r2 >= g.r1 && m.c1 <= g.c2 && m.c2 >= g.c1;
  });
  if (overlaps.length) return { ...tab, merges: (tab.merges ?? []).filter((m) => !overlaps.includes(m)) };
  if (g.r1 === g.r2 && g.c1 === g.c2) return tab;
  const cells = { ...tab.cells };
  for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) if (r !== g.r1 || c !== g.c1) delete cells[toA1(r, c)];
  return { ...tab, cells, merges: [...(tab.merges ?? []), rangeA1(g)] };
}
