"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownAZ,
  ArrowDownZA,
  Baseline,
  Bold,
  ChevronDown,
  Columns3,
  FileUp,
  Italic,
  PaintBucket,
  Plus,
  Redo2,
  Rows3,
  Sigma,
  Snowflake,
  Strikethrough,
  Underline,
  WrapText,
  Merge,
  Grid2x2,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  Undo2,
} from "lucide-react";
import { downloadIcon, EditorHeader, useAutosave } from "@/components/editor-shell";
import { Grid, type Edit, type GridActions, type Sel } from "@/components/sheets/grid";
import { SheetTable } from "@/components/sheets/sheet-table";
import { Dropdown, PromptDialog, Spinner, useToast, type MenuEntry } from "@/components/ui";
import { downloadBlob, drive, pickFile, safeFileName } from "@/lib/client";
import { normRange, parseA1, parseRange, rangeA1, toA1, usedRange, type Range } from "@/lib/sheets/a1";
import { compute, loadEngine, removeSheet, renameSheet, structural, type Computed, type HFModule, type Structural } from "@/lib/sheets/engine";
import { plainValue, type Value } from "@/lib/sheets/format";
import { borderRange, clearRange, fill, jump, nextSheetName, parseDelimited, pasteGrid, rawGrid, setCells, sortRange, styleRange, toDelimited, toggleMerge } from "@/lib/sheets/ops";
import type { CellStyle, Item, SheetBody, SheetTab } from "@/lib/types";

const MIN_ROWS = 1000;
const MIN_COLS = 52;

/** Older or imported bodies may miss optional parts; fill them in once on load. */
function normalize(body: SheetBody): SheetTab[] {
  const tabs = (body.sheets ?? []).map((t, i) => ({
    name: t.name || `Sheet${i + 1}`,
    cells: t.cells ?? {},
    styles: t.styles ?? {},
    colWidths: t.colWidths ?? {},
    rowHeights: t.rowHeights,
    merges: t.merges,
    frozen: t.frozen,
  }));
  return tabs.length ? tabs : [{ name: "Sheet1", cells: {}, styles: {}, colWidths: {} }];
}

export default function SheetPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<Item | null>(null);
  const [body, setBody] = useState<SheetBody | null>(null);
  const [hf, setHf] = useState<HFModule | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([drive.body<SheetBody>(id), loadEngine()])
      .then(([r, mod]) => {
        setItem(r.item);
        setBody(r.body);
        setHf(() => mod);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (item) document.title = `${item.name} · Atrium Sheets`;
  }, [item]);

  if (error) return <p className="m-auto p-10 text-center text-sm text-danger">{error}</p>;
  if (!item || !body || !hf) return <Spinner label="Opening spreadsheet" />;
  return <SheetEditor item={item} setItem={setItem} initial={body} hf={hf} />;
}

function SheetEditor({ item, setItem, initial, hf }: { item: Item; setItem: (i: Item) => void; initial: SheetBody; hf: HFModule }) {
  const toast = useToast();
  const { state, changed } = useAutosave(item.id, setItem);
  const [sheets, setSheets] = useState<SheetTab[]>(() => normalize(initial));
  const [active, setActive] = useState(0);
  const [sel, setSel] = useState<Sel>({ anchor: { r: 0, c: 0 }, head: { r: 0, c: 0 } });
  const [edit, setEdit] = useState<Edit | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [nameBox, setNameBox] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Refs mirror state so grid callbacks always see the latest values.
  const sheetsRef = useRef(sheets);
  const activeRef = useRef(active);
  const selRef = useRef(sel);
  useEffect(() => {
    sheetsRef.current = sheets;
    activeRef.current = active;
    selRef.current = sel;
  });
  const past = useRef<SheetTab[][]>([]);
  const future = useRef<SheetTab[][]>([]);
  const clip = useRef<{ text: string; raw: string[][]; styles: (CellStyle | undefined)[][]; origin: { r: number; c: number } } | null>(null);

  const computed: Computed = useMemo(() => {
    try {
      return compute(hf, sheets);
    } catch {
      return sheets.map(() => ({}));
    }
  }, [hf, sheets]);

  const computedRef = useRef(computed);
  useEffect(() => {
    computedRef.current = computed;
  });

  const tab = sheets[active] ?? sheets[0];
  const values = useMemo(() => computed[active] ?? {}, [computed, active]);
  const used = usedRange(tab.cells);
  const rows = Math.max(MIN_ROWS, (used?.r2 ?? 0) + 100);
  const cols = Math.max(MIN_COLS, (used?.c2 ?? 0) + 10);
  const g = normRange(sel.anchor, sel.head);

  const replace = useCallback(
    (next: SheetTab[], record = true) => {
      if (record) {
        past.current.push(sheetsRef.current);
        if (past.current.length > 100) past.current.shift();
        future.current = [];
      }
      sheetsRef.current = next;
      setSheets(next);
      changed({ type: "sheet", sheets: next });
    },
    [changed],
  );

  const applyTab = useCallback(
    (fn: (t: SheetTab) => SheetTab) => replace(sheetsRef.current.map((t, i) => (i === activeRef.current ? fn(t) : t))),
    [replace],
  );

  const focusGrid = () => requestAnimationFrame(() => gridRef.current?.focus());

  const select = useCallback((r: number, c: number) => setSel({ anchor: { r, c }, head: { r, c } }), []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(sheetsRef.current);
    replace(prev, false);
    if (activeRef.current >= prev.length) setActive(prev.length - 1);
  }, [replace]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(sheetsRef.current);
    replace(next, false);
  }, [replace]);

  const commit = useCallback(
    (text: string, move: [number, number]) => {
      const { r, c } = selRef.current.anchor;
      const key = toA1(r, c);
      const current = sheetsRef.current[activeRef.current].cells[key] ?? "";
      if (text !== current) applyTab((t) => setCells(t, { [key]: text }));
      setEdit(null);
      if (move[0] || move[1]) select(Math.max(0, r + move[0]), Math.max(0, c + move[1]));
      focusGrid();
    },
    [applyTab, select],
  );

  const toggle = useCallback(
    (style: "b" | "i" | "u") => {
      const t = sheetsRef.current[activeRef.current];
      const range = normRange(selRef.current.anchor, selRef.current.head);
      const on = !t.styles[toA1(range.r1, range.c1)]?.[style];
      applyTab((x) => styleRange(x, range, { [style]: on }));
    },
    [applyTab],
  );

  const actions: GridActions = useMemo(
    () => ({
      startEdit: (text, quick) => setEdit({ text, quick, source: "cell" }),
      setEditText: (text) => setEdit((e) => (e ? { ...e, text } : { text, quick: false, source: "cell" })),
      commit,
      cancelEdit: () => {
        setEdit(null);
        focusGrid();
      },
      clear: (range) => applyTab((t) => clearRange(t, range)),
      fill: (src, dest) => applyTab((t) => fill(t, src, dest)),
      resizeCol: (c, width) => {
        // Fired on every mouse move while dragging, so widths stay out of the undo history.
        const t = sheetsRef.current[activeRef.current];
        const next = sheetsRef.current.map((x, i) => (i === activeRef.current ? { ...x, colWidths: { ...t.colWidths, [c]: width } } : x));
        replace(next, false);
      },
      copy: (range, cut) => {
        const t = sheetsRef.current[activeRef.current];
        const vals = computedRef.current[activeRef.current] ?? {};
        const shown: string[][] = [];
        const styles: (CellStyle | undefined)[][] = [];
        // Whole-column/row selections copy only the part with data.
        const u = usedRange(t.cells);
        const r2 = Math.min(range.r2, u?.r2 ?? range.r1);
        const c2 = Math.min(range.c2, u?.c2 ?? range.c1);
        const bounded: Range = { ...range, r2: Math.max(range.r1, r2), c2: Math.max(range.c1, c2) };
        for (let r = bounded.r1; r <= bounded.r2; r++) {
          const row: string[] = [];
          const srow: (CellStyle | undefined)[] = [];
          for (let c = bounded.c1; c <= bounded.c2; c++) {
            const key = toA1(r, c);
            row.push(t.cells[key] === undefined ? "" : plainValue(vals[key] ?? t.cells[key]));
            srow.push(t.styles[key]);
          }
          shown.push(row);
          styles.push(srow);
        }
        const text = toDelimited(shown, "\t");
        clip.current = { text, raw: rawGrid(t, bounded), styles, origin: { r: bounded.r1, c: bounded.c1 } };
        if (cut) applyTab((x) => clearRange(x, bounded));
        return text;
      },
      paste: (text) => {
        const at = selRef.current.anchor;
        const range = normRange(selRef.current.anchor, selRef.current.head);
        const own = clip.current && clip.current.text === text ? clip.current : null;
        let grid = own ? own.raw : parseDelimited(text, "\t");
        if (!own && grid.length > 1 && grid[grid.length - 1].every((v) => v === "")) grid = grid.slice(0, -1);
        if (!grid.length) return;
        // One value pasted over a selection fills the whole selection.
        if (grid.length === 1 && grid[0].length === 1 && (range.r2 > range.r1 || range.c2 > range.c1)) {
          const one = grid[0][0];
          grid = Array.from({ length: range.r2 - range.r1 + 1 }, () => Array(range.c2 - range.c1 + 1).fill(one));
        }
        applyTab((t) => {
          let next = pasteGrid(t, grid, at, own?.origin);
          if (own) {
            const styles = { ...next.styles };
            own.styles.forEach((row, i) =>
              row.forEach((s, j) => {
                const key = toA1(at.r + i, at.c + j);
                if (s) styles[key] = s;
                else delete styles[key];
              }),
            );
            next = { ...next, styles };
          }
          return next;
        });
        setSel({ anchor: at, head: { r: at.r + grid.length - 1, c: at.c + Math.max(...grid.map((r) => r.length)) - 1 } });
      },
      undo,
      redo,
      toggle,
      jump: (from, dr, dc) => jump(sheetsRef.current[activeRef.current].cells, from, dr, dc, rows - 1, cols - 1),
      lastCol: (r) => {
        let last = 0;
        for (const key of Object.keys(sheetsRef.current[activeRef.current].cells)) {
          const p = parseA1(key);
          if (p && p.r === r) last = Math.max(last, p.c);
        }
        return last;
      },
    }),
    [applyTab, commit, redo, replace, rows, cols, toggle, undo],
  );
  // ---- Toolbar commands ----

  const style = (patch: Partial<CellStyle>) => applyTab((t) => styleRange(t, g, patch));
  const first = tab.styles[toA1(g.r1, g.c1)] ?? {};

  const doStructural = (change: Structural) => {
    try {
      replace(structural(hf, sheetsRef.current, active, change));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const sort = (desc: boolean) => {
    let range = g;
    if (g.r1 === g.r2 && g.c1 === g.c2) {
      // One cell selected: sort the whole table around it, keeping a frozen header in place.
      if (!used) return;
      range = { r1: Math.max(used.r1, tab.frozen?.rows ?? 0), c1: used.c1, r2: used.r2, c2: used.c2 };
    }
    applyTab((t) => sortRange(t, range, sel.anchor.c, values, desc));
  };

  const autoSum = () => {
    if (g.r1 !== g.r2 || g.c1 !== g.c2) {
      // A range selected: total each column underneath it.
      const updates: Record<string, string> = {};
      for (let c = g.c1; c <= g.c2; c++) updates[toA1(g.r2 + 1, c)] = `=SUM(${rangeA1({ r1: g.r1, c1: c, r2: g.r2, c2: c })})`;
      applyTab((t) => setCells(t, updates));
      return;
    }
    // One cell: sum the run of numbers directly above it.
    let r = g.r1 - 1;
    while (r >= 0 && typeof values[toA1(r, g.c1)] === "number") r--;
    const ref = r + 1 <= g.r1 - 1 ? rangeA1({ r1: r + 1, c1: g.c1, r2: g.r1 - 1, c2: g.c1 }) : "";
    setEdit({ text: `=SUM(${ref})`, quick: false, source: "cell" });
  };

  const addTab = () => {
    const name = nextSheetName(sheets.map((s) => s.name));
    replace([...sheets, { name, cells: {}, styles: {}, colWidths: {} }]);
    setActive(sheets.length);
    select(0, 0);
  };

  const switchTab = (i: number) => {
    if (edit) commit(edit.text, [0, 0]);
    setActive(i);
    select(0, 0);
  };

  const rename = (i: number, name: string) => {
    const clean = name.trim().replace(/[[\]*?:/\\']/g, "").slice(0, 31);
    if (!clean) throw new Error("Enter a name.");
    if (sheets.some((s, j) => j !== i && s.name.toLowerCase() === clean.toLowerCase())) throw new Error("Another sheet already has that name.");
    replace(renameSheet(hf, sheets, i, clean));
  };

  const deleteTab = (i: number) => {
    if (sheets.length < 2) return;
    replace(removeSheet(hf, sheets, i));
    setActive(Math.max(0, i - 1));
  };

  // ---- Files ----

  const importFile = async () => {
    const file = await pickFile(".xlsx,.csv,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    if (!file) return;
    try {
      const { importCsv, importXlsx } = await import("@/lib/convert/xlsx");
      const taken = new Set(sheets.map((s) => s.name.toLowerCase()));
      const unique = (n: string) => {
        let name = n.slice(0, 31);
        for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${n.slice(0, 27)} (${i})`;
        taken.add(name.toLowerCase());
        return name;
      };
      const added = /\.xlsx$/i.test(file.name)
        ? (await importXlsx(file)).sheets.map((t) => ({ ...t, name: unique(t.name) }))
        : [importCsv(await file.text(), unique(file.name.replace(/\.[^.]+$/, "") || "Imported"))];
      // A brand-new, empty spreadsheet is replaced instead of keeping a blank first tab.
      const blank = sheets.length === 1 && !Object.keys(sheets[0].cells).length;
      replace(blank ? added : [...sheets, ...added]);
      setActive(blank ? 0 : sheets.length);
      select(0, 0);
      toast(`Imported ${file.name}`);
    } catch {
      toast("That file could not be read as a spreadsheet.", "error");
    }
  };

  const fileMenu: MenuEntry[] = [
    { label: "Import Excel or CSV…", icon: <FileUp size={16} />, onClick: importFile },
    "sep",
    {
      label: "Download as Excel (.xlsx)",
      icon: downloadIcon,
      onClick: async () => {
        const { exportXlsx } = await import("@/lib/convert/xlsx");
        downloadBlob(await exportXlsx({ type: "sheet", sheets }, item.name), `${safeFileName(item.name)}.xlsx`);
      },
    },
    {
      label: "Download sheet as CSV",
      icon: downloadIcon,
      onClick: async () => {
        const { exportCsv } = await import("@/lib/convert/xlsx");
        const csv = exportCsv(tab, values);
        downloadBlob(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), `${safeFileName(item.name)} - ${safeFileName(tab.name)}.csv`);
      },
    },
    { label: "Download as PDF", icon: downloadIcon, onClick: () => window.print() },
  ];

  // ---- Status bar ----

  const stats = useMemo(() => {
    let sum = 0;
    let count = 0;
    let filled = 0;
    for (const [key, v] of Object.entries(values)) {
      const p = parseA1(key);
      if (!p || p.r < g.r1 || p.r > g.r2 || p.c < g.c1 || p.c > g.c2) continue;
      if (v !== null && v !== "") filled++;
      if (typeof v === "number") {
        sum += v;
        count++;
      }
    }
    return { sum, count, filled };
  }, [values, g.r1, g.r2, g.c1, g.c2]);

  const anchorRaw = tab.cells[toA1(sel.anchor.r, sel.anchor.c)] ?? "";
  const frozenOn = Boolean(tab.frozen?.rows || tab.frozen?.cols);
  const mergedHere = (tab.merges ?? []).some((ref) => {
    const m = parseRange(ref);
    return m && m.r1 <= g.r2 && m.r2 >= g.r1 && m.c1 <= g.c2 && m.c2 >= g.c1;
  });

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <EditorHeader kind="sheet" item={item} setItem={setItem} save={state} fileMenu={fileMenu} />

      <div className="toolbar no-print">
        <Btn label="Undo (Ctrl+Z)" onClick={undo}>
          <Undo2 size={16} />
        </Btn>
        <Btn label="Redo (Ctrl+Y)" onClick={redo}>
          <Redo2 size={16} />
        </Btn>
        <span className="sep" />
        <select aria-label="Number format" value={first.numFmt ? "custom" : (first.fmt ?? "general")} onChange={(e) => style({ fmt: e.target.value as CellStyle["fmt"], numFmt: undefined })}>
          {first.numFmt && (
            <option value="custom" disabled>
              {first.numFmt.length > 18 ? `${first.numFmt.slice(0, 18)}…` : first.numFmt}
            </option>
          )}
          <option value="general">General</option>
          <option value="number">Number 1,000.00</option>
          <option value="currency">Currency $</option>
          <option value="percent">Percent %</option>
          <option value="date">Date</option>
        </select>
        <span className="sep" />
        <Btn label="Bold (Ctrl+B)" on={first.b} onClick={() => toggle("b")}>
          <Bold size={16} />
        </Btn>
        <Btn label="Italic (Ctrl+I)" on={first.i} onClick={() => toggle("i")}>
          <Italic size={16} />
        </Btn>
        <Btn label="Underline (Ctrl+U)" on={first.u} onClick={() => toggle("u")}>
          <Underline size={16} />
        </Btn>
        <Btn label="Strikethrough" on={first.s} onClick={() => style({ s: !first.s })}>
          <Strikethrough size={16} />
        </Btn>
        <select aria-label="Font size" value={first.size ?? 10} onChange={(e) => style({ size: Number(e.target.value) === 10 ? undefined : Number(e.target.value) })} id="font-size">
          {[8, 9, 10, 11, 12, 14, 16, 18, 24, 30, 36].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <ColorBtn label="Text colour" value={first.color ?? "#111827"} onChange={(color) => style({ color })}>
          <Baseline size={16} />
        </ColorBtn>
        <ColorBtn label="Fill colour" value={first.bg ?? "#ffffff"} onChange={(bg) => style({ bg: bg === "#ffffff" ? undefined : bg })}>
          <PaintBucket size={16} />
        </ColorBtn>
        <span className="sep" />
        <Btn label="Align left" on={first.align === "left"} onClick={() => style({ align: first.align === "left" ? undefined : "left" })}>
          <AlignLeft size={16} />
        </Btn>
        <Btn label="Align centre" on={first.align === "center"} onClick={() => style({ align: first.align === "center" ? undefined : "center" })}>
          <AlignCenter size={16} />
        </Btn>
        <Btn label="Align right" on={first.align === "right"} onClick={() => style({ align: first.align === "right" ? undefined : "right" })}>
          <AlignRight size={16} />
        </Btn>
        <Dropdown
          label="Vertical alignment"
          className="icon-btn !w-auto gap-0.5 px-1.5"
          trigger={
            <>
              {first.valign === "top" ? <AlignVerticalJustifyStart size={16} /> : first.valign === "middle" ? <AlignVerticalJustifyCenter size={16} /> : <AlignVerticalJustifyEnd size={16} />}
              <ChevronDown size={12} />
            </>
          }
          items={[
            { label: "Top", onClick: () => style({ valign: "top" }) },
            { label: "Middle", onClick: () => style({ valign: "middle" }) },
            { label: "Bottom", onClick: () => style({ valign: undefined }) },
          ]}
        />
        <Btn label="Wrap text" on={first.wrap} onClick={() => style({ wrap: !first.wrap })}>
          <WrapText size={16} />
        </Btn>
        <Btn label={mergedHere ? "Unmerge cells" : "Merge cells"} on={mergedHere} onClick={() => applyTab((t) => toggleMerge(t, g))}>
          <Merge size={16} />
        </Btn>
        <Dropdown
          label="Borders"
          className="icon-btn !w-auto gap-0.5 px-1.5"
          trigger={
            <>
              <Grid2x2 size={16} />
              <ChevronDown size={12} />
            </>
          }
          items={[
            { label: "All borders", onClick: () => applyTab((t) => borderRange(t, g, "all")) },
            { label: "Outside border", onClick: () => applyTab((t) => borderRange(t, g, "outer")) },
            { label: "No borders", onClick: () => applyTab((t) => borderRange(t, g, "none")) },
          ]}
        />
        <span className="sep" />
        <Dropdown
          label="Insert rows or columns"
          className="icon-btn !w-auto gap-0.5 px-1.5"
          trigger={
            <>
              <Rows3 size={16} />
              <ChevronDown size={12} />
            </>
          }
          items={[
            { label: "Insert row above", onClick: () => doStructural({ op: "addRows", at: g.r1, count: g.r2 - g.r1 + 1 }) },
            { label: "Insert row below", onClick: () => doStructural({ op: "addRows", at: g.r2 + 1, count: g.r2 - g.r1 + 1 }) },
            { label: g.r2 > g.r1 ? `Delete rows ${g.r1 + 1}–${g.r2 + 1}` : `Delete row ${g.r1 + 1}`, danger: true, onClick: () => doStructural({ op: "removeRows", at: g.r1, count: g.r2 - g.r1 + 1 }) },
          ]}
        />
        <Dropdown
          label="Insert columns"
          className="icon-btn !w-auto gap-0.5 px-1.5"
          trigger={
            <>
              <Columns3 size={16} />
              <ChevronDown size={12} />
            </>
          }
          items={[
            { label: "Insert column left", onClick: () => doStructural({ op: "addColumns", at: g.c1, count: g.c2 - g.c1 + 1 }) },
            { label: "Insert column right", onClick: () => doStructural({ op: "addColumns", at: g.c2 + 1, count: g.c2 - g.c1 + 1 }) },
            { label: "Delete column(s)", danger: true, onClick: () => doStructural({ op: "removeColumns", at: g.c1, count: g.c2 - g.c1 + 1 }) },
          ]}
        />
        <Dropdown
          label="Freeze"
          className={`icon-btn !w-auto gap-0.5 px-1.5 ${frozenOn ? "on" : ""}`}
          trigger={
            <>
              <Snowflake size={16} />
              <ChevronDown size={12} />
            </>
          }
          items={[
            { label: "Freeze top row", onClick: () => applyTab((t) => ({ ...t, frozen: { rows: 1, cols: t.frozen?.cols ?? 0 } })) },
            { label: "Freeze first column", onClick: () => applyTab((t) => ({ ...t, frozen: { rows: t.frozen?.rows ?? 0, cols: 1 } })) },
            { label: `Freeze up to ${toA1(sel.anchor.r, sel.anchor.c)}`, onClick: () => applyTab((t) => ({ ...t, frozen: { rows: sel.anchor.r, cols: sel.anchor.c } })) },
            { label: "Unfreeze", onClick: () => applyTab((t) => ({ ...t, frozen: undefined })) },
          ]}
        />
        <span className="sep" />
        <Btn label="Sort A → Z" onClick={() => sort(false)}>
          <ArrowDownAZ size={16} />
        </Btn>
        <Btn label="Sort Z → A" onClick={() => sort(true)}>
          <ArrowDownZA size={16} />
        </Btn>
        <Btn label="AutoSum" onClick={autoSum}>
          <Sigma size={16} />
        </Btn>
      </div>

      {/* Name box and formula bar */}
      <div className="no-print flex items-center gap-2 border-b border-line bg-surface px-2 py-1">
        <input
          aria-label="Cell reference"
          className="h-7 w-24 rounded-md border border-line bg-surface px-2 font-mono text-xs"
          value={nameBox ?? (edit ? toA1(sel.anchor.r, sel.anchor.c) : rangeA1(g))}
          onFocus={(e) => {
            setNameBox(e.target.value);
            e.target.select();
          }}
          onChange={(e) => setNameBox(e.target.value)}
          onBlur={() => setNameBox(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") return (e.target as HTMLInputElement).blur();
            if (e.key !== "Enter") return;
            const range = parseRange((e.target as HTMLInputElement).value.toUpperCase());
            if (range) {
              setSel({ anchor: { r: range.r1, c: range.c1 }, head: { r: range.r2, c: range.c2 } });
              setNameBox(null);
              focusGrid();
            } else toast("Type a cell like B12 or a range like A1:C10", "error");
          }}
        />
        <span className="select-none font-serif text-sm italic text-muted">fx</span>
        <input
          aria-label="Formula bar"
          className="h-7 flex-1 rounded-md border border-line bg-surface px-2 font-mono text-[13px]"
          value={edit ? edit.text : anchorRaw}
          onFocus={() => !edit && setEdit({ text: anchorRaw, quick: false, source: "bar" })}
          onChange={(e) => setEdit((x) => ({ text: e.target.value, quick: false, source: x?.source ?? "bar" }))}
          onKeyDown={(e) => {
            if (!edit) return;
            if (e.key === "Enter") commit(edit.text, [1, 0]);
            else if (e.key === "Tab") commit(edit.text, [0, e.shiftKey ? -1 : 1]);
            else if (e.key === "Escape") actions.cancelEdit();
            else return;
            e.preventDefault();
          }}
        />
      </div>

      <div className="no-print flex min-h-0 flex-1">
        <Grid tab={tab} values={values} rows={rows} cols={cols} sel={sel} setSel={setSel} edit={edit} actions={actions} rootRef={gridRef} />
      </div>

      {/* Tabs and status */}
      <div className="no-print flex h-9 items-center gap-1 border-t border-line bg-surface px-2 text-sm">
        <button type="button" className="icon-btn" aria-label="Add sheet" title="Add sheet" onClick={addTab}>
          <Plus size={16} />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {sheets.map((s, i) => (
            <div key={i} className={`flex shrink-0 items-center rounded-md ${i === active ? "bg-accent-wash font-medium text-accent" : "text-ink-2 hover:bg-hover"}`}>
              <button type="button" className="py-1 pl-3 pr-1" onClick={() => switchTab(i)} onDoubleClick={() => setRenaming(i)}>
                {s.name}
              </button>
              {i === active ? (
                <Dropdown
                  label={`${s.name} options`}
                  align="left"
                  className="mr-1 rounded p-0.5 hover:bg-hover"
                  trigger={<ChevronDown size={13} />}
                  items={[
                    { label: "Rename", onClick: () => setRenaming(i) },
                    {
                      label: "Duplicate",
                      onClick: () => {
                        const name = nextSheetName(sheets.map((x) => x.name));
                        replace([...sheets.slice(0, i + 1), { ...structuredClone(s), name }, ...sheets.slice(i + 1)]);
                        setActive(i + 1);
                      },
                    },
                    ...(sheets.length > 1 ? [{ label: "Delete", danger: true, onClick: () => deleteTab(i) } as const] : []),
                  ]}
                />
              ) : (
                <span className="w-2" />
              )}
            </div>
          ))}
        </div>
        {stats.filled > 1 && (
          <div className="flex shrink-0 gap-4 pl-3 text-xs text-ink-2" aria-live="polite">
            {stats.count > 0 && <span>Sum: {plainValue(Number(stats.sum.toPrecision(12)))}</span>}
            {stats.count > 0 && <span>Average: {plainValue(Number((stats.sum / stats.count).toPrecision(10)))}</span>}
            <span>Count: {stats.filled}</span>
          </div>
        )}
      </div>

      {/* What prints: the used range as a plain table. */}
      <div className="hidden print:block">
        <SheetTable tab={tab} values={values as Record<string, Value>} />
      </div>

      {renaming !== null && (
        <PromptDialog title="Rename sheet" initial={sheets[renaming]?.name} confirm="Rename" onSubmit={(name) => rename(renaming, name)} onClose={() => setRenaming(null)} />
      )}
    </div>
  );
}

function Btn({ label, on, onClick, children }: { label: string; on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="icon-btn" title={label} aria-label={label} data-on={Boolean(on)} onClick={onClick} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </button>
  );
}

function ColorBtn({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label className="icon-btn relative cursor-pointer flex-col !gap-0" title={label}>
      {children}
      <span className="-mt-0.5 h-[3px] w-4 rounded-sm" style={{ background: value }} />
      <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
    </label>
  );
}
