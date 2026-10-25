import { describe, expect, it } from "vitest";
import { compute, loadEngine } from "@/lib/sheets/engine";
import type { SheetTab } from "@/lib/types";

const tab = (cells: Record<string, string>): SheetTab => ({ name: "Sheet1", cells, styles: {}, colWidths: {} });
async function calc(cells: Record<string, string>) {
  return compute(await loadEngine(), [tab(cells)])[0];
}

describe("extra spreadsheet functions", () => {
  it("CONCAT joins values and ranges, like the imported Google Sheet", async () => {
    const v = await calc({ A1: "1", A2: "2", B1: '=CONCAT("app",A1)', B2: "=CONCAT(A1:A2,\"-\",TRUE())" });
    expect(v.B1).toBe("app1");
    expect(v.B2).toBe("12-TRUE");
  });

  it("text and regex helpers", async () => {
    const v = await calc({
      A1: "maya@acme.dev",
      B1: '=TEXTBEFORE(A1,"@")',
      B2: '=TEXTAFTER(A1,"@")',
      B3: '=REGEXMATCH(A1,"@acme")',
      B4: '=REGEXEXTRACT(A1,"@(\\w+)")',
      B5: '=REGEXREPLACE(A1,"acme","example")',
      B6: '=JOIN(", ","a","b",3)',
      B7: '=TEXTBEFORE(A1,"#")',
    });
    expect([v.B1, v.B2, v.B3, v.B4, v.B5, v.B6]).toEqual(["maya", "acme.dev", true, "acme", "maya@example.dev", "a, b, 3"]);
    expect(v.B7).toMatchObject({ error: "#N/A" });
  });

  it("RANK, MODE, XMATCH and AVERAGEIFS", async () => {
    const v = await calc({
      A1: "10", A2: "30", A3: "20", A4: "30",
      B1: "east", B2: "west", B3: "east", B4: "east",
      C1: "=RANK(20,A1:A4)",
      C2: "=RANK.EQ(10,A1:A4,1)",
      C3: "=MODE(A1:A4)",
      C4: '=XMATCH("west",B1:B4)',
      C5: '=AVERAGEIFS(A1:A4,B1:B4,"east",A1:A4,">10")',
    });
    expect([v.C1, v.C2, v.C3, v.C4, v.C5]).toEqual([3, 1, 30, 2, 25]);
  });
});
