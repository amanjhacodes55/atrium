import type { CSSProperties } from "react";
import { colName, toA1, usedRange } from "@/lib/sheets/a1";
import { defaultAlign, formatValue, isError, type Value } from "@/lib/sheets/format";
import type { CellStyle, SheetTab } from "@/lib/types";

export const DEFAULT_COL = 100;

export function cellCss(v: Value, s: CellStyle | undefined): CSSProperties {
  return {
    fontWeight: s?.b ? 600 : undefined,
    fontStyle: s?.i ? "italic" : undefined,
    textDecoration: s?.u ? "underline" : undefined,
    color: s?.color ?? (isError(v) ? "#b91c1c" : undefined),
    background: s?.bg,
    textAlign: s?.align ?? defaultAlign(v),
  };
}

/** Plain table of a tab's used range: the share-link viewer and the printed copy of the editor. */
export function SheetTable({ tab, values, maxRows = 2000 }: { tab: SheetTab; values: Record<string, Value>; maxRows?: number }) {
  const g = usedRange(tab.cells);
  if (!g) return <p className="p-6 text-sm text-muted">This sheet is empty.</p>;
  const rows = Math.min(g.r2 + 1, maxRows);
  const cols = g.c2 + 1;
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
              const v = values[key] ?? null;
              const s = tab.styles[key];
              return (
                <td key={c} className="overflow-hidden whitespace-nowrap border border-[#e5e7eb] px-1.5 py-0.5" style={cellCss(v, s)}>
                  {formatValue(v, s?.fmt)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
