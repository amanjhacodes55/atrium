import type { HyperFormula } from "hyperformula";
import type { SheetTab } from "../types";
import { parseA1, toA1 } from "./a1";
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
  mod ??= import("hyperformula");
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
      if (!rows) {
        colWidths = {};
        for (const [c, w] of Object.entries(tab.colWidths)) {
          const n = move(Number(c));
          if (n !== null) colWidths[n] = w;
        }
      }
      return { ...tab, cells, styles, colWidths };
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
