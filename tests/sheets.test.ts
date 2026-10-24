import * as hf from "hyperformula";
import { describe, expect, it } from "vitest";
import { exportCsv, exportXlsx, importCsv, importXlsx } from "@/lib/convert/xlsx";
import { colIndex, colName, parseA1, parseRange, rangeA1, toA1, usedRange } from "@/lib/sheets/a1";
import { compute, evaluate, structural } from "@/lib/sheets/engine";
import { formatValue } from "@/lib/sheets/format";
import { fill, jump, parseDelimited, shiftFormula, sortRange, toDelimited } from "@/lib/sheets/ops";
import { templates } from "@/lib/templates/sheet";
import type { SheetTab } from "@/lib/types";

const tab = (name: string, cells: Record<string, string>): SheetTab => ({ name, cells, styles: {}, colWidths: {} });

describe("A1 helpers", () => {
  it("converts column names both ways", () => {
    for (const [i, n] of [[0, "A"], [25, "Z"], [26, "AA"], [51, "AZ"], [701, "ZZ"], [702, "AAA"]] as const) {
      expect(colName(i)).toBe(n);
      expect(colIndex(n)).toBe(i);
    }
  });
  it("parses cells and ranges", () => {
    expect(parseA1("B12")).toEqual({ r: 11, c: 1 });
    expect(parseA1("$C$3")).toEqual({ r: 2, c: 2 });
    expect(parseA1("A0")).toBeNull();
    expect(parseRange("D5:B2")).toEqual({ r1: 1, c1: 1, r2: 4, c2: 3 });
    expect(rangeA1({ r1: 0, c1: 0, r2: 0, c2: 0 })).toBe("A1");
    expect(toA1(9, 27)).toBe("AB10");
    expect(usedRange({ B2: "1", D7: "x" })).toEqual({ r1: 1, c1: 1, r2: 6, c2: 3 });
  });
});

describe("formatting", () => {
  it("formats numbers per cell format", () => {
    expect(formatValue(1234.5, "currency")).toBe("$1,234.50");
    expect(formatValue(-3, "currency")).toBe("-$3.00");
    expect(formatValue(0.1234, "percent")).toBe("12.3%");
    expect(formatValue(1234.5, "number")).toBe("1,234.50");
    expect(formatValue(0.1 + 0.2)).toBe("0.3");
    expect(formatValue(46000, "date")).toBe("9 Dec 2025");
    expect(formatValue(true)).toBe("TRUE");
    expect(formatValue({ error: "#DIV/0!" })).toBe("#DIV/0!");
  });
});

describe("engine", () => {
  it("evaluates formulas, errors and cross-sheet references", () => {
    const sheets = [tab("Data", { A1: "10", A2: "32", A3: "=SUM(A1:A2)", B1: "=A1/0", C1: "=Totals!A1*2" }), tab("Totals", { A1: "=Data!A3+1" })];
    const [data, totals] = compute(hf, sheets);
    expect(data.A3).toBe(42);
    expect(data.B1).toMatchObject({ error: "#DIV/0!" });
    expect(totals.A1).toBe(43);
    expect(data.C1).toBe(86);
    expect(evaluate(hf, sheets, 0, "=AVERAGE(A1:A2)")).toBe(21);
  });

  it("rewrites references when rows and columns move", () => {
    const sheets = [tab("S", { A1: "1", A2: "2", A3: "=SUM(A1:A2)", B3: "=A3*2" }), tab("T", { A1: "=S!A3" })];
    const [s, t] = structural(hf, sheets, 0, { op: "addRows", at: 0, count: 1 });
    expect(s.cells).toEqual({ A2: "1", A3: "2", A4: "=SUM(A2:A3)", B4: "=A4*2" });
    expect(t.cells.A1).toBe("=S!A4");
    const [s2] = structural(hf, sheets, 0, { op: "removeColumns", at: 0, count: 1 });
    expect(s2.cells.A3).toBe("=#REF!*2");
  });

  it("computes every template without errors", () => {
    for (const t of templates) {
      if (t.body.type !== "sheet") throw new Error("not a sheet");
      for (const values of compute(hf, t.body.sheets)) {
        for (const v of Object.values(values)) expect(typeof v === "object" && v !== null ? v.error : "ok").toBe("ok");
      }
    }
  });
});

describe("operations", () => {
  it("shifts relative references only", () => {
    expect(shiftFormula("=A1+$B$2+C$3+$D4", 2, 1)).toBe("=B3+$B$2+D$3+$D6");
    expect(shiftFormula('=SUM(A1:A3)&"A1"', 1, 0)).toBe('=SUM(A2:A4)&"A1"');
    expect(shiftFormula("=LOG10(A1)+'Q1 2026'!B2", 1, 0)).toBe("=LOG10(A2)+'Q1 2026'!B3");
    expect(shiftFormula("=A1", -1, 0)).toBe("=#REF!");
  });

  it("round-trips tab-separated text with quotes and newlines", () => {
    const rows = [["a", "b\tc"], ['say "hi"', "line1\nline2"]];
    expect(parseDelimited(toDelimited(rows, "\t"), "\t")).toEqual(rows);
  });

  it("fills series and shifts formulas", () => {
    const t = tab("S", { A1: "1", A2: "2", B1: "=A1*10" });
    const out = fill(t, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 4, c2: 0 });
    expect([out.cells.A3, out.cells.A4, out.cells.A5]).toEqual(["3", "4", "5"]);
    const out2 = fill(t, { r1: 0, c1: 1, r2: 0, c2: 1 }, { r1: 0, c1: 1, r2: 2, c2: 1 });
    expect(out2.cells.B3).toBe("=A3*10");
  });

  it("sorts rows by a column, blanks last, keeping row formulas pointing at their row", () => {
    const t = tab("S", { A1: "pear", B1: "3", C1: "=B1*2", A2: "apple", B2: "1", C2: "=B2*2", A3: "fig", C3: "=B3*2" });
    const values = compute(hf, [t])[0];
    const sorted = sortRange(t, { r1: 0, c1: 0, r2: 2, c2: 2 }, 1, values);
    expect([sorted.cells.A1, sorted.cells.A2, sorted.cells.A3]).toEqual(["apple", "pear", "fig"]);
    expect(sorted.cells.C1).toBe("=B1*2");
  });

  it("jumps to the edge of data", () => {
    const cells = { A1: "x", A2: "x", A3: "x", A7: "x" };
    expect(jump(cells, { r: 0, c: 0 }, 1, 0, 999, 51)).toEqual({ r: 2, c: 0 });
    expect(jump(cells, { r: 2, c: 0 }, 1, 0, 999, 51)).toEqual({ r: 6, c: 0 });
  });
});

describe("files", () => {
  it("round-trips CSV through computed values", () => {
    const t = importCsv('Name,Score\n"Lee, Ann",7\nBo,=2+2\n');
    expect(t.cells).toEqual({ A1: "Name", B1: "Score", A2: "Lee, Ann", B2: "7", A3: "Bo", B3: "'=2+2" });
    const withFormula = { ...t, cells: { ...t.cells, B4: "=SUM(B2:B2)" } };
    const csv = exportCsv(withFormula, compute(hf, [withFormula])[0]);
    expect(csv.split("\r\n")).toEqual(["Name,Score", '"Lee, Ann",7', "Bo,=2+2", ",7"]);
  });

  it("round-trips xlsx with formulas, styles and widths", async () => {
    const t: SheetTab = {
      name: "Q1",
      cells: { A1: "Item", B1: "Cost", A2: "Pens", B2: "2.5", A3: "Paper", B3: "4", B4: "=SUM(B2:B3)", C1: "=Q2!A1" },
      styles: { A1: { b: true, bg: "#e8f5e9" }, B4: { fmt: "currency", i: true }, B2: { align: "center", color: "#ff0000" } },
      colWidths: { 0: 180 },
      frozen: { rows: 1, cols: 0 },
    };
    const blob = await exportXlsx({ type: "sheet", sheets: [t, tab("Q2", { A1: "hello" })] }, "Test");
    const back = await importXlsx(blob);
    expect(back.sheets.map((s) => s.name)).toEqual(["Q1", "Q2"]);
    const q1 = back.sheets[0];
    expect(q1.cells).toMatchObject({ A1: "Item", B2: "2.5", B4: "=SUM(B2:B3)", C1: "=Q2!A1" });
    expect(q1.styles.A1).toMatchObject({ b: true, bg: "#e8f5e9" });
    expect(q1.styles.B4).toMatchObject({ i: true, fmt: "currency" });
    expect(q1.styles.B2).toMatchObject({ align: "center", color: "#ff0000" });
    expect(q1.colWidths[0]).toBe(180);
    expect(q1.frozen).toEqual({ rows: 1, cols: 0 });
    expect(compute(hf, back.sheets)[0].B4).toBe(6.5);
  });
});

describe("tabs", () => {
  it("renames and removes tabs, keeping references right", async () => {
    const { renameSheet, removeSheet } = await import("@/lib/sheets/engine");
    const sheets = [tab("Data", { A1: "5" }), tab("Sum", { A1: "=Data!A1*2" })];
    const renamed = renameSheet(hf, sheets, 0, "Raw numbers");
    expect(renamed[0].name).toBe("Raw numbers");
    expect(renamed[1].cells.A1).toBe("='Raw numbers'!A1*2");
    expect(compute(hf, renamed)[1].A1).toBe(10);
    const removed = removeSheet(hf, sheets, 0);
    expect(removed).toHaveLength(1);
    expect(compute(hf, removed)[0].A1).toMatchObject({ error: "#REF!" });
  });
});
