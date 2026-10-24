import type { CellStyle, SheetBody, SheetTab } from "../types";
import { parseA1, toA1, usedRange } from "../sheets/a1";
import { compute, loadEngine } from "../sheets/engine";
import { dateToSerial, isError, plainValue, type Value } from "../sheets/format";
import { parseDelimited, sniffSeparator, toDelimited } from "../sheets/ops";

// Excel (.xlsx) and CSV import/export. ExcelJS is loaded only when a user imports or downloads.
// Formulas are written together with their computed results, so Excel shows numbers straight away
// and other readers that do not recalculate still see values.

type ExcelJS = typeof import("exceljs");
type Cell = import("exceljs").Cell;

const loadExcel = async (): Promise<ExcelJS> => {
  const m = (await import("exceljs")) as ExcelJS & { default?: ExcelJS };
  return m.default ?? m;
};

/** Pixels ↔ Excel column width (in characters of the default font). */
const pxToChars = (px: number) => Math.max(1, Math.round(((px - 5) / 7) * 100) / 100);
const charsToPx = (w: number) => Math.round(w * 7 + 5);

const argbToHex = (argb?: string) => (argb && /^[0-9a-f]{8}$/i.test(argb) ? `#${argb.slice(2).toLowerCase()}` : undefined);
const hexToArgb = (hex: string) => `FF${hex.replace("#", "").toUpperCase()}`;

function fmtFromNumFmt(numFmt?: string): CellStyle["fmt"] | undefined {
  if (!numFmt || numFmt === "General") return undefined;
  if (numFmt.includes("%")) return "percent";
  if (/[$€£¥₹]/.test(numFmt)) return "currency";
  if (/(^|[^"])[dmy]{1,4}/i.test(numFmt.replace(/"[^"]*"/g, "")) && !/0/.test(numFmt)) return "date";
  if (/[0#]/.test(numFmt)) return "number";
  return undefined;
}

const NUMFMT: Record<NonNullable<CellStyle["fmt"]>, string | undefined> = {
  general: undefined,
  number: "#,##0.00",
  currency: '"$"#,##0.00',
  percent: "0.0%",
  date: "d mmm yyyy",
};

function rawFromCell(cell: Cell): { raw: string; date?: boolean } {
  const v = cell.value;
  if (cell.formula) return { raw: `=${cell.formula}` };
  if (v === null || v === undefined) return { raw: "" };
  if (v instanceof Date) return { raw: String(dateToSerial(v)), date: true };
  if (typeof v === "number") return { raw: String(v) };
  if (typeof v === "boolean") return { raw: v ? "TRUE" : "FALSE" };
  if (typeof v === "string") return { raw: /^[=+-]|^\d/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v };
  if (typeof v === "object") {
    if ("richText" in v) return { raw: v.richText.map((t) => t.text).join("") };
    if ("text" in v && typeof v.text === "string") return { raw: v.text };
    if ("error" in v) return { raw: String(v.error) };
    if ("result" in v && v.result !== undefined) return { raw: String(v.result) };
  }
  return { raw: String(cell.text ?? "") };
}

function styleFromCell(cell: Cell, date: boolean): CellStyle | null {
  const s: CellStyle = {};
  const f = cell.font;
  if (f?.bold) s.b = true;
  if (f?.italic) s.i = true;
  if (f?.underline) s.u = true;
  const color = argbToHex(f?.color?.argb);
  if (color && color !== "#000000") s.color = color;
  const fill = cell.fill;
  if (fill?.type === "pattern" && fill.pattern === "solid") {
    const bg = argbToHex(fill.fgColor?.argb);
    if (bg && bg !== "#ffffff") s.bg = bg;
  }
  const h = cell.alignment?.horizontal;
  if (h === "left" || h === "center" || h === "right") s.align = h;
  const fmt = date ? "date" : fmtFromNumFmt(cell.numFmt);
  if (fmt) s.fmt = fmt;
  return Object.keys(s).length ? s : null;
}

export async function importXlsx(file: Blob): Promise<SheetBody> {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();
  await wb.xlsx.load((await file.arrayBuffer()) as never);
  const sheets: SheetTab[] = [];
  const names = new Set<string>();
  wb.eachSheet((ws) => {
    let name = ws.name.trim() || `Sheet${sheets.length + 1}`;
    while (names.has(name)) name += " (2)";
    names.add(name);
    const tab: SheetTab = { name, cells: {}, styles: {}, colWidths: {} };
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        // Merged cells: only the top-left one carries the value.
        if (cell.isMerged && cell.master !== cell) return;
        const key = toA1(r - 1, c - 1);
        const { raw, date } = rawFromCell(cell);
        if (raw !== "") tab.cells[key] = raw;
        const st = styleFromCell(cell, Boolean(date));
        if (st) tab.styles[key] = st;
      });
    });
    ws.columns?.forEach((col, i) => {
      if (col.width && Math.abs(col.width - 8.43) > 0.5) tab.colWidths[i] = charsToPx(col.width);
    });
    const view = ws.views?.[0] as { state?: string; ySplit?: number; xSplit?: number } | undefined;
    if (view?.state === "frozen" && (view.ySplit || view.xSplit)) tab.frozen = { rows: view.ySplit ?? 0, cols: view.xSplit ?? 0 };
    sheets.push(tab);
  });
  if (!sheets.length) sheets.push({ name: "Sheet1", cells: {}, styles: {}, colWidths: {} });
  return { type: "sheet", sheets };
}

function excelValue(v: Value): import("exceljs").CellValue {
  if (v === null) return null;
  if (isError(v)) return { error: v.error } as import("exceljs").CellErrorValue;
  return v;
}

export async function exportXlsx(body: SheetBody, name: string): Promise<Blob> {
  const [Excel, hf] = await Promise.all([loadExcel(), loadEngine()]);
  const computed = compute(hf, body.sheets);
  const wb = new Excel.Workbook();
  wb.creator = "Atrium";
  wb.title = name;
  body.sheets.forEach((tab, i) => {
    const frozen = tab.frozen && (tab.frozen.rows || tab.frozen.cols);
    const ws = wb.addWorksheet(tab.name.slice(0, 31), {
      views: frozen ? [{ state: "frozen", ySplit: tab.frozen!.rows, xSplit: tab.frozen!.cols }] : undefined,
    });
    for (const [c, w] of Object.entries(tab.colWidths)) ws.getColumn(Number(c) + 1).width = pxToChars(w);
    const keys = new Set([...Object.keys(tab.cells), ...Object.keys(tab.styles)]);
    for (const key of keys) {
      const p = parseA1(key);
      if (!p) continue;
      const cell = ws.getCell(p.r + 1, p.c + 1);
      const raw = tab.cells[key];
      if (raw !== undefined) {
        if (raw.startsWith("=")) {
          const result = excelValue(computed[i][key] ?? null);
          cell.value = { formula: raw.slice(1), result: result as never };
        } else {
          const v = computed[i][key];
          cell.value = raw.startsWith("'") ? raw.slice(1) : typeof v === "number" || typeof v === "boolean" ? v : raw;
        }
      }
      const s = tab.styles[key];
      if (!s) continue;
      if (s.b || s.i || s.u || s.color) cell.font = { bold: s.b, italic: s.i, underline: s.u, color: s.color ? { argb: hexToArgb(s.color) } : undefined };
      if (s.bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: hexToArgb(s.bg) } };
      if (s.align) cell.alignment = { horizontal: s.align };
      const numFmt = s.fmt && NUMFMT[s.fmt];
      if (numFmt) cell.numFmt = numFmt;
    }
  });
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function importCsv(text: string, name = "Sheet1"): SheetTab {
  const rows = parseDelimited(text.replace(/^﻿/, ""), sniffSeparator(text));
  const cells: Record<string, string> = {};
  rows.forEach((row, r) =>
    row.forEach((v, c) => {
      // A CSV holds values, not formulas: keep text that looks like one as text.
      if (v !== "") cells[toA1(r, c)] = v.startsWith("=") ? `'${v}` : v;
    }),
  );
  return { name, cells, styles: {}, colWidths: {} };
}

/** CSV of a tab's computed values (formulas become their results). */
export function exportCsv(tab: SheetTab, values: Record<string, Value>): string {
  const g = usedRange(tab.cells);
  if (!g) return "";
  const rows: string[][] = [];
  for (let r = 0; r <= g.r2; r++) {
    const row: string[] = [];
    for (let c = 0; c <= g.c2; c++) {
      const key = toA1(r, c);
      const raw = tab.cells[key];
      row.push(raw === undefined ? "" : raw.startsWith("'") ? raw.slice(1) : plainValue(values[key] ?? raw));
    }
    rows.push(row);
  }
  return toDelimited(rows, ",");
}
