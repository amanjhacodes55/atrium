import type { CSSProperties } from "react";
import { colName, parseRange, toA1, usedRange } from "@/lib/sheets/a1";
import { defaultAlign, formatCell, isError, type Value } from "@/lib/sheets/format";
import type { CellStyle, SheetTab } from "@/lib/types";

export const DEFAULT_COL = 100;

/** Points → CSS pixels; 10 pt (the default) is about the grid's 13px. */
export const ptToPx = (pt: number) => Math.round(pt * (4 / 3) * 10) / 10;

/** Generic fallbacks for the fonts spreadsheets name, so imported files look close everywhere. */
function fontStack(name: string) {
  const n = name.toLowerCase();
  const generic = /mono|courier|consolas/.test(n) ? "monospace" : /times|georgia|garamond|cambria|serif$|book/.test(n) && !/sans/.test(n) ? "serif" : "sans-serif";
  const alias: Record<string, string> = { calibri: "Calibri, Carlito", cambria: "Cambria, Caladea", arial: "Arial, Liberation Sans, Arimo", "times new roman": "Times New Roman, Liberation Serif, Tinos" };
  return `${alias[n] ?? `"${name.replace(/"/g, "")}"`}, ${generic}`;
}

export function cellCss(v: Value, s: CellStyle | undefined): CSSProperties {
  const deco = [s?.u && "underline", s?.s && "line-through"].filter(Boolean).join(" ");
  const line = (c?: string) => (c ? `1px solid ${c}` : undefined);
  return {
    fontWeight: s?.b ? 600 : undefined,
    fontStyle: s?.i ? "italic" : undefined,
    textDecoration: deco || undefined,
    color: s?.color ?? (isError(v) ? "#b91c1c" : undefined),
    background: s?.bg,
    textAlign: s?.align ?? defaultAlign(v),
    fontSize: s?.size ? ptToPx(s.size) : undefined,
    fontFamily: s?.font ? fontStack(s.font) : undefined,
    borderTop: line(s?.border?.t),
    borderLeft: line(s?.border?.l),
    ...(s?.border?.r ? { borderRightColor: s.border.r } : {}),
    ...(s?.border?.b ? { borderBottomColor: s.border.b } : {}),
  };
}

/** Plain table of a tab's used range: the share-link viewer and the printed copy of the editor. */
export function SheetTable({ tab, values, maxRows = 2000 }: { tab: SheetTab; values: Record<string, Value>; maxRows?: number }) {
  const g = usedRange(tab.cells);
  if (!g) return <p className="p-6 text-sm text-muted">This sheet is empty.</p>;
  const rows = Math.min(g.r2 + 1, maxRows);
  const cols = g.c2 + 1;
  // Merged cells: the top-left one spans the range; the others are not drawn.
  const spans = new Map<string, { rowSpan: number; colSpan: number }>();
  const hidden = new Set<string>();
  for (const ref of tab.merges ?? []) {
    const m = parseRange(ref);
    if (!m) continue;
    spans.set(toA1(m.r1, m.c1), { rowSpan: m.r2 - m.r1 + 1, colSpan: m.c2 - m.c1 + 1 });
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) hidden.add(toA1(r, c));
  }
  return (
    <table className="border-collapse bg-white text-[13px] text-[#111827]" style={{ tableLayout: "fixed" }}>
      <colgroup>
        <col style={{ width: 44 }} />
        {Array.from({ length: cols }, (_, c) => (
          <col key={c} style={{ width: tab.colWidths[c] ?? DEFAULT_COL }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th className="border border-[#e5e7eb] bg-[#f3f4f6]" />
          {Array.from({ length: cols }, (_, c) => (
            <th key={c} className="border border-[#e5e7eb] bg-[#f3f4f6] px-1 py-0.5 text-center text-xs font-medium text-[#6b7280]">
              {colName(c)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r}>
            <th className="border border-[#e5e7eb] bg-[#f3f4f6] px-1 text-center text-xs font-medium text-[#6b7280]">{r + 1}</th>
            {Array.from({ length: cols }, (_, c) => {
              const key = toA1(r, c);
              if (hidden.has(key)) return null;
              const v = values[key] ?? null;
              const s = tab.styles[key];
              return (
                <td
                  key={c}
                  {...spans.get(key)}
                  className={`overflow-hidden border border-[#e5e7eb] px-1.5 py-0.5 ${s?.wrap ? "whitespace-pre-wrap break-words" : "whitespace-nowrap"}`}
                  style={{ ...cellCss(v, s), verticalAlign: s?.valign === "top" ? "top" : s?.valign === "middle" ? "middle" : "bottom", height: tab.rowHeights?.[r] }}
                >
                  {formatCell(v, s)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
