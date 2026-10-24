import type { CellStyle } from "../types";

/** A computed cell value: what HyperFormula returns, with errors flattened to plain objects. */
export type Value = number | string | boolean | null | { error: string; message?: string };

export const isError = (v: Value): v is { error: string; message?: string } => typeof v === "object" && v !== null;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Spreadsheet date serial (days since 1899-12-30, as in Excel and HyperFormula) → UTC date. */
export function serialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86_400_000));
}

export function dateToSerial(d: Date): number {
  return (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

const grouped = (n: number, digits: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function formatValue(v: Value, fmt: CellStyle["fmt"] = "general"): string {
  if (v === null || v === undefined) return "";
  if (isError(v)) return v.error;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return "#NUM!";
  switch (fmt) {
    case "number":
      return grouped(v, 2);
    case "currency":
      return (v < 0 ? "-$" : "$") + grouped(Math.abs(v), 2);
    case "percent":
      return `${(v * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
    case "date": {
      const d = serialToDate(v);
      return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }
    default:
      // Like Excel's General: integers as is, otherwise up to 10 significant digits.
      return Number.isInteger(v) ? String(v) : String(parseFloat(v.toPrecision(10)));
  }
}

/** Default alignment when the cell has none: numbers right, booleans and errors centred. */
export function defaultAlign(v: Value): "left" | "right" | "center" {
  if (typeof v === "number") return "right";
  if (typeof v === "boolean" || isError(v)) return "center";
  return "left";
}

/** Plain text for CSV and clipboard export: numbers unformatted so they paste back as numbers. */
export function plainValue(v: Value): string {
  if (v === null || v === undefined) return "";
  if (isError(v)) return v.error;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}
