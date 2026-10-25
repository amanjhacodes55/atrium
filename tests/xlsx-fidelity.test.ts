import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { exportXlsx, importXlsx } from "@/lib/convert/xlsx";
import { compute, loadEngine } from "@/lib/sheets/engine";

/** A workbook with what real files from Excel and Google Sheets carry. */
async function workbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Apps", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  ws.getCell("A1").value = "Name";
  ws.getCell("A1").font = { bold: true, size: 14, name: "Georgia", color: { argb: "FF1F4E79" } };
  ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { theme: 5, tint: 0.4 } as never };
  ws.getCell("B1").fill = { type: "pattern", pattern: "solid", fgColor: { indexed: 13 } as never };
  ws.getCell("A2").value = 1;
  ws.getCell("A3").value = 2;
  ws.getCell("B2").value = { formula: 'CONCAT("app",A2)', result: "app1" } as never;
  ws.getCell("B3").value = { sharedFormula: "B2", result: "app2" } as never;
  ws.getCell("C2").value = "A long note that needs to wrap onto several lines";
  ws.getCell("C2").alignment = { wrapText: true, vertical: "top", horizontal: "center" };
  ws.getCell("D2").value = -1234.5;
  ws.getCell("D2").numFmt = "#,##0.00;[Red](#,##0.00)";
  ws.getCell("D2").border = { bottom: { style: "thin", color: { argb: "FFFF0000" } }, top: { style: "medium" } };
  ws.getCell("E2").value = "struck";
  ws.getCell("E2").font = { strike: true };
  ws.mergeCells("A5:C6");
  ws.getCell("A5").value = "Merged";
  ws.getRow(4).height = 30;
  return new Blob([await wb.xlsx.writeBuffer()]);
}

describe("xlsx fidelity", () => {
  it("imports formats, colours, wrapping, borders, merges, heights, frozen panes and shared formulas", async () => {
    const body = await importXlsx(await workbook());
    const t = body.sheets[0];
    expect(t.frozen).toEqual({ rows: 1, cols: 2 });
    expect(t.styles.A1).toMatchObject({ b: true, size: 14, font: "Georgia", color: "#1f4e79" });
    expect(t.styles.A1.bg).toMatch(/^#[0-9a-f]{6}$/); // theme accent2 lightened
    expect(t.styles.B1.bg).toBe("#ffff00"); // indexed 13: yellow in the legacy palette
    expect(t.styles.C2).toMatchObject({ wrap: true, valign: "top", align: "center" });
    expect(t.styles.D2).toMatchObject({ numFmt: "#,##0.00;[Red](#,##0.00)", border: { b: "#ff0000", t: "#000000" } });
    expect(t.styles.E2).toMatchObject({ s: true });
    expect(t.merges).toEqual(["A5:C6"]);
    expect(t.rowHeights).toEqual({ 3: 40 });
    const v = compute(await loadEngine(), body.sheets)[0];
    expect([v.B2, v.B3]).toEqual(["app1", "app2"]);
  });

  it("exports them back", async () => {
    const first = await importXlsx(await workbook());
    const again = (await importXlsx(await exportXlsx(first, "Apps"))).sheets[0];
    const t = first.sheets[0];
    expect(again.merges).toEqual(t.merges);
    expect(again.frozen).toEqual(t.frozen);
    expect(again.rowHeights).toEqual(t.rowHeights);
    for (const k of ["A1", "C2", "D2", "E2"]) expect(again.styles[k]).toMatchObject(t.styles[k]);
  });
});

describe("merge, borders and structure", async () => {
  const { borderRange, toggleMerge } = await import("@/lib/sheets/ops");
  const { structural } = await import("@/lib/sheets/engine");
  const base = { name: "S", cells: { A1: "keep", B1: "drop", A2: "x" }, styles: {}, colWidths: {} };

  it("merges keep the top-left value, and toggle back", () => {
    const m = toggleMerge(base, { r1: 0, c1: 0, r2: 0, c2: 1 });
    expect(m.merges).toEqual(["A1:B1"]);
    expect(m.cells).toEqual({ A1: "keep", A2: "x" });
    expect(toggleMerge(m, { r1: 0, c1: 1, r2: 0, c2: 1 }).merges).toEqual([]);
  });

  it("draws all or outside borders", () => {
    const all = borderRange(base, { r1: 0, c1: 0, r2: 1, c2: 1 }, "all");
    expect(all.styles.B2.border).toEqual({ t: "#111827", r: "#111827", b: "#111827", l: "#111827" });
    const outer = borderRange(base, { r1: 0, c1: 0, r2: 1, c2: 1 }, "outer");
    expect(outer.styles.A1.border).toEqual({ t: "#111827", l: "#111827" });
    expect(borderRange(outer, { r1: 0, c1: 0, r2: 1, c2: 1 }, "none").styles).toEqual({});
  });

  it("moves merges and row heights when rows are inserted or deleted", async () => {
    const hf = await loadEngine();
    const tab = { ...base, merges: ["A3:B5"], rowHeights: { 3: 40 } };
    const added = structural(hf, [tab], 0, { op: "addRows", at: 0, count: 2 })[0];
    expect(added.merges).toEqual(["A5:B7"]);
    expect(added.rowHeights).toEqual({ 5: 40 });
    const removed = structural(hf, [tab], 0, { op: "removeRows", at: 3, count: 2 })[0];
    expect(removed.merges).toEqual(["A3:B3"]); // one row of two cells is still a merge
  });
});
