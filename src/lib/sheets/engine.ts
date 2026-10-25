import type { HyperFormula } from "hyperformula";
import type { SheetTab } from "../types";
import { parseA1, parseRange, rangeA1, toA1 } from "./a1";
import type { Value } from "./format";

// HyperFormula computes everything: ~400 Excel functions, cross-sheet references and dependency
// tracking. All tabs load into one instance so `Sheet2!A1` works. It is used under its GPLv3
// licence, which is compatible with Atrium's AGPL-3.0.
//
// The engine is rebuilt from the body on each change rather than kept in sync incrementally: the
// body stays the single source of truth, and a rebuild of a typical sheet takes a few ms.

export type HFModule = typeof import("hyperformula");
export type Computed = Record<string, Value>[];

let mod: Promise<HFModule> | null = null;
export function loadEngine(): Promise<HFModule> {
  // The extra functions (CONCAT, TEXTBEFORE, REGEXMATCH…) register once, with the module.
  mod ??= Promise.all([import("hyperformula"), import("./functions")]).then(([hf, f]) => {
    f.registerFunctions(hf);
    return hf;
  });
  return mod;
}

export const CONFIG = {
  licenseKey: "gpl-v3",
  dateFormats: ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"],
  // Up to 1,000,000 rows like Excel; the grid only renders what is visible.
  maxRows: 1_048_576,
  maxColumns: 16_384,
};

/** Sparse cells → the dense 2-D array HyperFormula takes. */
export function toDense(tab: SheetTab): string[][] {
  const rows: string[][] = [];
  for (const [key, raw] of Object.entries(tab.cells)) {
    const p = parseA1(key);
    if (!p || raw === "") continue;
    (rows[p.r] ??= [])[p.c] = raw;
  }
  for (let r = 0; r < rows.length; r++) {
    rows[r] ??= [];
    for (let c = 0; c < rows[r].length; c++) rows[r][c] ??= "";
  }
  return rows;
}

export function build(hf: HFModule, sheets: SheetTab[]): HyperFormula {
  const data: Record<string, string[][]> = {};
  for (const tab of sheets) data[tab.name] = toDense(tab);
  return hf.HyperFormula.buildFromSheets(data, CONFIG);
}

function flatten(hf: HFModule, v: unknown): Value {
  if (v instanceof hf.DetailedCellError) return { error: v.value, message: v.message };
  if (v === undefined) return null;
  return v as Value;
}

/** Computed value of every non-empty cell, per tab. */
export function compute(hf: HFModule, sheets: SheetTab[]): Computed {
  const engine = build(hf, sheets);
  try {
    return sheets.map((tab) => {
      const id = engine.getSheetId(tab.name)!;
      const out: Record<string, Value> = {};
      for (const key of Object.keys(tab.cells)) {
        const p = parseA1(key);
        if (p) out[key] = flatten(hf, engine.getCellValue({ sheet: id, row: p.r, col: p.c }));
      }
      return out;
    });
  } finally {
    engine.destroy();
  }
}

/** Evaluates one formula against the sheets without storing it (for the status bar and tests). */
export function evaluate(hf: HFModule, sheets: SheetTab[], sheet: number, formula: string): Value {
  const engine = build(hf, sheets);
  try {
    return flatten(hf, engine.calculateFormula(formula, engine.getSheetId(sheets[sheet].name)!));
  } finally {
    engine.destroy();
  }
}

export type Structural = { op: "addRows" | "removeRows" | "addColumns" | "removeColumns"; at: number; count: number };

/**
 * Inserts or deletes rows/columns on one tab. HyperFormula rewrites every formula that points at
 * the moved cells (on any tab); plain values, styles and widths are shifted here.
 */
export function structural(hf: HFModule, sheets: SheetTab[], index: number, change: Structural): SheetTab[] {
  const engine = build(hf, sheets);
  try {
    const id = engine.getSheetId(sheets[index].name)!;
    engine[change.op](id, [change.at, change.count]);
    const rows = change.op === "addRows" || change.op === "removeRows";
    const remove = change.op.startsWith("remove");
    const move = (n: number): number | null => {
      if (n < change.at) return n;
      if (!remove) return n + change.count;
      return n < change.at + change.count ? null : n - change.count;
    };
    const shiftKey = (key: string): string | null => {
      const p = parseA1(key);
      if (!p) return null;
      const n = move(rows ? p.r : p.c);
      return n === null ? null : rows ? toA1(n, p.c) : toA1(p.r, n);
    };

    return sheets.map((tab, i) => {
      const cells: Record<string, string> = {};
      for (const [key, raw] of Object.entries(tab.cells)) {
        if (raw.startsWith("=")) continue;
        const k = i === index ? shiftKey(key) : key;
        if (k) cells[k] = raw;
      }
      // Formulas come back from the engine, already rewritten.
      const serialized = engine.getSheetSerialized(engine.getSheetId(tab.name)!);
      serialized.forEach((row, r) =>
        row.forEach((v, c) => {
          if (typeof v === "string" && v.startsWith("=")) cells[toA1(r, c)] = v;
        }),
      );
      if (i !== index) return { ...tab, cells };
      const styles: SheetTab["styles"] = {};
      for (const [key, s] of Object.entries(tab.styles)) {
        const k = shiftKey(key);
        if (k) styles[k] = s;
      }
      let colWidths = tab.colWidths;
      let rowHeights = tab.rowHeights;
      const shiftSizes = (sizes: Record<number, number>) => {
        const out: Record<number, number> = {};
        for (const [k, v] of Object.entries(sizes)) {
          const n = move(Number(k));
          if (n !== null) out[n] = v;
        }
        return out;
      };
      if (!rows) colWidths = shiftSizes(tab.colWidths);
      else if (tab.rowHeights) rowHeights = shiftSizes(tab.rowHeights);
      // A merge moves with its rows or columns, grows when lines are inserted inside it, and
      // shrinks (or goes, when only one cell is left) when they are deleted.
      const merges = tab.merges?.flatMap((ref) => {
        const g = parseRange(ref);
        if (!g) return [];
        const [a, b] = rows ? [g.r1, g.r2] : [g.c1, g.c2];
        let na = a;
        let nb = b;
        const clamp = (v: number) => Math.max(0, Math.min(change.count, v));
        if (remove) {
          // Each end moves up by the deleted lines before it (a deleted start lands on the gap).
          na = a - clamp(a - change.at);
          nb = b - clamp(b - change.at + 1);
          if (nb < na) return [];
        } else {
          if (a >= change.at) na = a + change.count;
          if (b >= change.at) nb = b + change.count;
        }
        const n = rows ? { ...g, r1: na, r2: nb } : { ...g, c1: na, c2: nb };
        return n.r1 === n.r2 && n.c1 === n.c2 ? [] : [rangeA1(n)];
      });
      return { ...tab, cells, styles, colWidths, rowHeights, merges };
    });
  } finally {
    engine.destroy();
  }
}

/** Formulas of every tab as the engine now has them, merged over the tabs' plain values. */
function readBack(engine: HyperFormula, sheets: SheetTab[]): SheetTab[] {
  return sheets.map((tab) => {
    const id = engine.getSheetId(tab.name);
    if (id === undefined) return tab;
    const cells: Record<string, string> = {};
    for (const [key, raw] of Object.entries(tab.cells)) if (!raw.startsWith("=")) cells[key] = raw;
    engine.getSheetSerialized(id).forEach((row, r) =>
      row.forEach((v, c) => {
        if (typeof v === "string" && v.startsWith("=")) cells[toA1(r, c)] = v;
      }),
    );
    return { ...tab, cells };
  });
}

/** Renames a tab and every formula that refers to it. */
export function renameSheet(hf: HFModule, sheets: SheetTab[], index: number, name: string): SheetTab[] {
  const engine = build(hf, sheets);
  try {
    engine.renameSheet(engine.getSheetId(sheets[index].name)!, name);
    const renamed = sheets.map((t, i) => (i === index ? { ...t, name } : t));
    return readBack(engine, renamed);
  } finally {
    engine.destroy();
  }
}

/** Deletes a tab; formulas elsewhere that pointed at it become #REF!. */
export function removeSheet(hf: HFModule, sheets: SheetTab[], index: number): SheetTab[] {
  const engine = build(hf, sheets);
  try {
    engine.removeSheet(engine.getSheetId(sheets[index].name)!);
    return readBack(
      engine,
      sheets.filter((_, i) => i !== index),
    );
  } finally {
    engine.destroy();
  }
}
