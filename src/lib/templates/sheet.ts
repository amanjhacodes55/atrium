import type { CellStyle, SheetTab } from "../types";
import type { Template } from "./index";

// Starting spreadsheets. Every total is a live formula, so editing a number updates the sheet.

const header = (bg: string): CellStyle => ({ b: true, bg, color: "#ffffff" });

function budget(): SheetTab {
  const t: SheetTab = { name: "Budget", cells: {}, styles: {}, colWidths: { 0: 180, 1: 120, 2: 120, 3: 120 }, frozen: { rows: 1, cols: 0 } };
  const rows: [string, number, number][] = [
    ["Rent", 1500, 1500],
    ["Groceries", 450, 512.4],
    ["Utilities", 180, 164.25],
    ["Transport", 120, 98],
    ["Insurance", 210, 210],
    ["Eating out", 200, 265.8],
    ["Savings", 600, 600],
  ];
  Object.assign(t.cells, { A1: "Category", B1: "Planned", C1: "Actual", D1: "Difference" });
  for (const k of ["A1", "B1", "C1", "D1"]) t.styles[k] = header("#16a34a");
  rows.forEach(([name, plan, actual], i) => {
    const r = i + 2;
    t.cells[`A${r}`] = name;
    t.cells[`B${r}`] = String(plan);
    t.cells[`C${r}`] = String(actual);
    t.cells[`D${r}`] = `=B${r}-C${r}`;
    for (const c of "BCD") t.styles[`${c}${r}`] = { fmt: "currency" };
  });
  const end = rows.length + 1;
  const tot = end + 2;
  t.cells[`A${tot}`] = "Total";
  for (const c of "BCD") {
    t.cells[`${c}${tot}`] = `=SUM(${c}2:${c}${end})`;
    t.styles[`${c}${tot}`] = { b: true, fmt: "currency", bg: "#dcfce7" };
  }
  t.styles[`A${tot}`] = { b: true, bg: "#dcfce7" };
  t.cells[`A${tot + 1}`] = "Spent of plan";
  t.cells[`C${tot + 1}`] = `=C${tot}/B${tot}`;
  t.styles[`C${tot + 1}`] = { fmt: "percent", b: true };
  t.cells[`A${tot + 2}`] = "Status";
  t.cells[`C${tot + 2}`] = `=IF(D${tot}>=0,"Under budget","Over budget")`;
  return t;
}

function invoice(): SheetTab {
  const t: SheetTab = { name: "Invoice", cells: {}, styles: {}, colWidths: { 0: 260, 1: 80, 2: 110, 3: 120 } };
  Object.assign(t.cells, {
    A1: "INVOICE",
    A2: "Your Company Ltd · 1 Main Street · hello@example.com",
    A4: "Bill to:",
    A5: "Client name",
    C4: "Invoice #",
    D4: "INV-0001",
    C5: "Date",
    D5: "=TODAY()",
    C6: "Due",
    D6: "=D5+30",
    A8: "Description",
    B8: "Qty",
    C8: "Unit price",
    D8: "Amount",
    A9: "Website design",
    B9: "1",
    C9: "1200",
    A10: "Hosting (12 months)",
    B10: "12",
    C10: "15",
    A11: "Support hours",
    B11: "6",
    C11: "60",
    C14: "Subtotal",
    D14: "=SUM(D9:D13)",
    C15: "Tax rate",
    D15: "0.18",
    C16: "Tax",
    D16: "=ROUND(D14*D15,2)",
    C17: "Total due",
    D17: "=D14+D16",
    A19: "Thank you for your business!",
  });
  t.styles.A1 = { b: true, color: "#2563eb" };
  t.styles.A4 = { b: true };
  for (const k of ["D5", "D6"]) t.styles[k] = { fmt: "date", align: "right" };
  for (const k of ["A8", "B8", "C8", "D8"]) t.styles[k] = header("#2563eb");
  for (let r = 9; r <= 13; r++) {
    t.cells[`D${r}`] = `=IF(B${r}="","",B${r}*C${r})`;
    t.styles[`C${r}`] = { fmt: "currency" };
    t.styles[`D${r}`] = { fmt: "currency" };
  }
  for (const k of ["D14", "D16"]) t.styles[k] = { fmt: "currency" };
  t.styles.D15 = { fmt: "percent" };
  t.styles.C17 = { b: true };
  t.styles.D17 = { b: true, fmt: "currency", bg: "#dbeafe" };
  t.styles.A19 = { i: true, color: "#6b7280" };
  return t;
}

function tracker(): SheetTab {
  const t: SheetTab = { name: "Tasks", cells: {}, styles: {}, colWidths: { 0: 220, 1: 120, 2: 110, 3: 110, 4: 90 }, frozen: { rows: 1, cols: 0 } };
  Object.assign(t.cells, { A1: "Task", B1: "Owner", C1: "Status", D1: "Due", E1: "Done %" });
  for (const k of ["A1", "B1", "C1", "D1", "E1"]) t.styles[k] = header("#7c3aed");
  const tasks: [string, string, string, string, number][] = [
    ["Write project brief", "Priya", "Done", "2026-11-03", 1],
    ["Design mock-ups", "Marcus", "In progress", "2026-11-10", 0.6],
    ["Build prototype", "Lena", "In progress", "2026-11-21", 0.3],
    ["User testing", "Tom", "Not started", "2026-12-01", 0],
    ["Launch", "Everyone", "Not started", "2026-12-15", 0],
  ];
  tasks.forEach(([task, owner, status, due, done], i) => {
    const r = i + 2;
    Object.assign(t.cells, { [`A${r}`]: task, [`B${r}`]: owner, [`C${r}`]: status, [`D${r}`]: due, [`E${r}`]: String(done) });
    t.styles[`D${r}`] = { fmt: "date" };
    t.styles[`E${r}`] = { fmt: "percent" };
  });
  const s = tasks.length + 3;
  Object.assign(t.cells, {
    [`A${s}`]: "Tasks done",
    [`B${s}`]: `=COUNTIF(C2:C${s - 2},"Done")&" of "&COUNTA(A2:A${s - 2})`,
    [`A${s + 1}`]: "Overall progress",
    [`B${s + 1}`]: `=AVERAGE(E2:E${s - 2})`,
    [`A${s + 2}`]: "Next deadline",
    [`B${s + 2}`]: `=MINIFS(D2:D${s - 2},C2:C${s - 2},"<>Done")`,
  });
  t.styles[`B${s + 1}`] = { fmt: "percent", b: true };
  t.styles[`B${s + 2}`] = { fmt: "date" };
  for (const r of [s, s + 1, s + 2]) t.styles[`A${r}`] = { b: true };
  return t;
}

export const templates: Template[] = [
  { name: "Monthly budget", description: "Planned vs actual spending with totals", body: { type: "sheet", sheets: [budget()] } },
  { name: "Invoice", description: "Line items, tax and total due", body: { type: "sheet", sheets: [invoice()] } },
  { name: "Project tracker", description: "Tasks, owners, deadlines and progress", body: { type: "sheet", sheets: [tracker()] } },
];
