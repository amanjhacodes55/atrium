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

const argbToHex = (argb?: string) => (argb && /^[0-9a-f]{8}$/i.test(argb) ? `#${argb.slice(2).toLowerCase()}` : argb && /^[0-9a-f]{6}$/i.test(argb) ? `#${argb.toLowerCase()}` : undefined);
const hexToArgb = (hex: string) => `FF${hex.replace("#", "").toUpperCase()}`;
const ptToPx = (pt: number) => Math.round((pt * 4) / 3);
const pxToPt = (px: number) => Math.round(px * 0.75 * 100) / 100;

// Excel's legacy 64-colour palette, for colours stored as { indexed: n }.
const INDEXED = "000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 800000 008000 000080 808000 800080 008080 C0C0C0 808080 9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF 000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF 00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 003366 339966 003300 333300 993300 993366 333399 333333".split(" ");

/** The workbook's theme colours, in the order Excel numbers them (lt1, dk1, lt2, dk2, accents…). */
function themePalette(xml: string | undefined): string[] {
  const fallback = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"];
  if (!xml) return fallback;
  const scheme = /<a:clrScheme[\s\S]*?<\/a:clrScheme>/.exec(xml)?.[0];
  if (!scheme) return fallback;
  const get = (tag: string) => {
    const m = new RegExp(`<a:${tag}>([\\s\\S]*?)</a:${tag}>`).exec(scheme)?.[1] ?? "";
    return /srgbClr val="([0-9A-Fa-f]{6})"/.exec(m)?.[1] ?? /lastClr="([0-9A-Fa-f]{6})"/.exec(m)?.[1];
  };
  const order = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  return order.map((t, i) => get(t) ?? fallback[i]);
}

/** Excel's tint: lighten (positive) or darken (negative) in HSL lightness. */
function applyTint(hex: string, tint: number) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let sat = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
  const p = 2 * l - q;
  const hue = (t: number) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  const out = sat === 0 ? [l, l, l] : [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
  return out.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

type XColor = { argb?: string; theme?: number; tint?: number; indexed?: number } | undefined;
/** Any Excel colour (RGB, theme with tint, or indexed) → "#rrggbb". */
function colorOf(c: XColor, theme: string[]): string | undefined {
  if (!c) return undefined;
  if (c.argb) return argbToHex(c.argb);
  let hex: string | undefined;
  if (typeof c.theme === "number") hex = theme[c.theme];
  else if (typeof c.indexed === "number") hex = INDEXED[c.indexed];
  if (!hex) return undefined;
  return `#${(c.tint ? applyTint(hex, c.tint) : hex).toLowerCase()}`;
}

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

// Fonts the grid already uses by default; naming them on every cell would only bloat the file.
const DEFAULT_FONTS = new Set(["arial", "calibri", "helvetica", "liberation sans", "roboto"]);

function styleFromCell(cell: Cell, date: boolean, theme: string[]): CellStyle | null {
  const s: CellStyle = {};
  const f = cell.font;
  if (f?.bold) s.b = true;
  if (f?.italic) s.i = true;
  if (f?.underline) s.u = true;
  if (f?.strike) s.s = true;
  if (f?.size && f.size !== 10 && f.size !== 11) s.size = f.size;
  if (f?.name && !DEFAULT_FONTS.has(f.name.toLowerCase())) s.font = f.name;
  const color = colorOf(f?.color as XColor, theme);
  if (color && color !== "#000000") s.color = color;
  const fill = cell.fill;
  if (fill?.type === "pattern" && fill.pattern === "solid") {
    const bg = colorOf((fill.fgColor ?? fill.bgColor) as XColor, theme);
    if (bg && bg !== "#ffffff") s.bg = bg;
  }
  const a = cell.alignment;
  const h = a?.horizontal;
  if (h === "left" || h === "center" || h === "right") s.align = h;
  else if (h === "centerContinuous") s.align = "center";
  if (a?.vertical === "top") s.valign = "top";
  else if (a?.vertical === "middle") s.valign = "middle";
  if (a?.wrapText) s.wrap = true;
  const border: NonNullable<CellStyle["border"]> = {};
  for (const [side, key] of [["top", "t"], ["right", "r"], ["bottom", "b"], ["left", "l"]] as const) {
    const b = cell.border?.[side];
    if (b?.style) border[key] = colorOf(b.color as XColor, theme) ?? "#000000";
  }
  if (Object.keys(border).length) s.border = border;
  const fmt = date ? "date" : fmtFromNumFmt(cell.numFmt);
  if (fmt) s.fmt = fmt;
  // Keep the exact code, so "#,##0.00;[Red](#,##0.00)" or "dd-mmm-yy" look as they did in Excel.
  if (cell.numFmt && cell.numFmt !== "General" && typeof cell.value !== "string") s.numFmt = cell.numFmt;
  return Object.keys(s).length ? s : null;
}

export async function importXlsx(file: Blob): Promise<SheetBody> {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();
  await wb.xlsx.load((await file.arrayBuffer()) as never);
  const theme = themePalette((wb as unknown as { _themes?: Record<string, string> })._themes?.theme1);
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
        const st = styleFromCell(cell, Boolean(date), theme);
        if (st) tab.styles[key] = st;
      });
    });
    // Heights set by hand in Excel or Sheets (rows without cells too); others fit their content.
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      if (row.height && Math.abs(row.height - 15) > 1) (tab.rowHeights ??= {})[r - 1] = ptToPx(row.height);
    });
    const merges = (ws.model as { merges?: string[] }).merges;
    if (merges?.length) tab.merges = [...merges];
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
    for (const [r, h] of Object.entries(tab.rowHeights ?? {})) ws.getRow(Number(r) + 1).height = pxToPt(h);
    for (const ref of tab.merges ?? []) {
      try {
        ws.mergeCells(ref);
      } catch {
        // Overlapping merges: keep the first.
      }
    }
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
      if (s.b || s.i || s.u || s.s || s.color || s.size || s.font)
        cell.font = { bold: s.b, italic: s.i, underline: s.u, strike: s.s, size: s.size, name: s.font, color: s.color ? { argb: hexToArgb(s.color) } : undefined };
      if (s.bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: hexToArgb(s.bg) } };
      if (s.align || s.valign || s.wrap) cell.alignment = { horizontal: s.align, vertical: s.valign, wrapText: s.wrap };
      if (s.border) {
        const side = (c?: string) => (c ? { style: "thin" as const, color: { argb: hexToArgb(c) } } : undefined);
        cell.border = { top: side(s.border.t), right: side(s.border.r), bottom: side(s.border.b), left: side(s.border.l) };
      }
      const numFmt = s.numFmt ?? (s.fmt && NUMFMT[s.fmt]);
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
