"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { colName, normRange, rangeA1, toA1, type Pos, type Range } from "@/lib/sheets/a1";
import { formatCell, type Value } from "@/lib/sheets/format";
import type { SheetTab } from "@/lib/types";
import { autoHeights, indexAt, mergeMap, ROW_H, rowTops } from "./layout";
import { cellCss, DEFAULT_COL } from "./sheet-table";

// A virtualized spreadsheet grid: only the cells in view are rendered, so 1,000+ rows by 52+
// columns scroll smoothly. Rows can differ in height (explicit, or grown to fit wrapped text), cells
// can be merged, and the top rows and left columns can be frozen. Four panes do that: the frozen
// corner, the frozen rows (scroll sideways), the frozen columns (scroll up and down) and the body.

export { ROW_H };
const HEAD_W = 46;
const HEAD_H = 24;

export type Sel = { anchor: Pos; head: Pos };
/** An edit in progress at the anchor cell. `quick` = started by typing, so arrows commit it. */
export type Edit = { text: string; quick: boolean; source: "cell" | "bar" };

export type GridActions = {
  startEdit(text: string, quick: boolean): void;
  setEditText(text: string): void;
  commit(text: string, move: [number, number]): void;
  cancelEdit(): void;
  clear(g: Range): void;
  fill(src: Range, dest: Range): void;
  resizeCol(c: number, width: number): void;
  copy(g: Range, cut: boolean): string;
  paste(text: string): void;
  undo(): void;
  redo(): void;
  toggle(style: "b" | "i" | "u"): void;
  jump(from: Pos, dr: number, dc: number): Pos;
  lastCol(r: number): number;
};

type Drag =
  | { mode: "cells" | "cols" | "rows" }
  | { mode: "fill"; src: Range }
  | { mode: "ref"; base: string; start: Pos }
  | { mode: "resize"; col: number; x: number; w: number };

const isRefPoint = (text: string) => text.startsWith("=") && /[=(,+\-*/:&^<>]$/.test(text);

export function Grid({
  tab,
  values,
  rows,
  cols,
  sel,
  setSel,
  edit,
  actions,
  rootRef,
}: {
  tab: SheetTab;
  values: Record<string, Value>;
  rows: number;
  cols: number;
  sel: Sel;
  setSel: (sel: Sel) => void;
  edit: Edit | null;
  actions: GridActions;
  rootRef: RefObject<HTMLDivElement | null>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ l: 0, t: 0 });
  const [view, setView] = useState({ w: 1200, h: 700 });
  const [fillTo, setFillToState] = useState<Range | null>(null);
  const fillRef = useRef<Range | null>(null);
  const setFillTo = (g: Range | null) => {
    fillRef.current = g;
    setFillToState(g);
  };
  const drag = useRef<Drag | null>(null);

  const widths = useMemo(() => Array.from({ length: cols }, (_, c) => tab.colWidths[c] ?? DEFAULT_COL), [cols, tab.colWidths]);
  const colX = useMemo(() => {
    const x = [0];
    for (const w of widths) x.push(x[x.length - 1] + w);
    return x;
  }, [widths]);
  const merges = useMemo(() => mergeMap(tab), [tab]);
  const auto = useMemo(() => autoHeights(tab, values, widths, merges.covered, merges.masters), [tab, values, widths, merges]);
  const rowY = useMemo(() => rowTops(rows, (r) => tab.rowHeights?.[r] ?? auto[r] ?? ROW_H), [rows, tab.rowHeights, auto]);
  const rowH = (r: number) => rowY[r + 1] - rowY[r];
  const frozen = Math.min(tab.frozen?.rows ?? 0, rows);
  const frozenC = Math.min(tab.frozen?.cols ?? 0, cols);
  const frozenH = rowY[frozen];
  const frozenW = colX[frozenC];
  const g = normRange(sel.anchor, sel.head);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const colAt = useCallback((x: number) => indexAt(colX, cols, x), [colX, cols]);
  const rowAt = useCallback((y: number) => indexAt(rowY, rows, y), [rowY, rows]);

  // Keep the moving end of the selection in view.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const { r, c } = sel.head;
    if (c >= frozenC) {
      const x1 = colX[c] - frozenW;
      const x2 = (colX[c + 1] ?? colX[c]) - frozenW;
      if (x1 < el.scrollLeft) el.scrollLeft = x1;
      else if (x2 > el.scrollLeft + el.clientWidth) el.scrollLeft = x2 - el.clientWidth;
    }
    if (r >= frozen) {
      const y1 = rowY[r] - frozenH;
      const y2 = rowY[r + 1] - frozenH;
      if (y1 < el.scrollTop) el.scrollTop = y1;
      else if (y2 > el.scrollTop + el.clientHeight) el.scrollTop = y2 - el.clientHeight;
    }
  }, [sel.head, colX, rowY, frozen, frozenC, frozenH, frozenW]);

  /** Cell under a viewport point, clamped to the sheet. */
  const cellAt = useCallback(
    (clientX: number, clientY: number): Pos => {
      const root = rootRef.current!.getBoundingClientRect();
      const el = scroller.current!;
      const x = Math.max(0, clientX - root.left - HEAD_W);
      const y = Math.max(0, clientY - root.top - HEAD_H);
      // The frozen panes don't scroll; the body is offset by both the scroll and the frozen size.
      const c = x < frozenW ? colAt(x) : colAt(x - (frozenC ? 2 : 0) + el.scrollLeft);
      const r = y < frozenH ? rowAt(y) : rowAt(y - (frozen ? 2 : 0) + el.scrollTop);
      return { r: Math.min(rows - 1, Math.max(0, r)), c: Math.min(cols - 1, c) };
    },
    [rootRef, colAt, rowAt, frozen, frozenC, frozenH, frozenW, rows, cols],
  );

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const el = scroller.current!;
      // Nudge the scroller when dragging past its edges.
      const rect = el.getBoundingClientRect();
      if (e.clientY > rect.bottom - 8) el.scrollTop += 24;
      else if (e.clientY < rect.top + 8 && d.mode !== "cols") el.scrollTop -= 24;
      if (e.clientX > rect.right - 8) el.scrollLeft += 40;
      else if (e.clientX < rect.left + 8 && d.mode !== "rows") el.scrollLeft -= 40;

      if (d.mode === "resize") {
        actions.resizeCol(d.col, Math.max(30, Math.round(d.w + e.clientX - d.x)));
        return;
      }
      const p = cellAt(e.clientX, e.clientY);
      if (d.mode === "cells") setSel({ anchor: sel.anchor, head: p });
      else if (d.mode === "cols") setSel({ anchor: { r: 0, c: sel.anchor.c }, head: { r: rows - 1, c: p.c } });
      else if (d.mode === "rows") setSel({ anchor: { r: sel.anchor.r, c: 0 }, head: { r: p.r, c: cols - 1 } });
      else if (d.mode === "ref") actions.setEditText(d.base + rangeA1(normRange(d.start, p)));
      else if (d.mode === "fill") {
        const s = d.src;
        const dy = p.r > s.r2 ? p.r - s.r2 : p.r < s.r1 ? p.r - s.r1 : 0;
        const dx = p.c > s.c2 ? p.c - s.c2 : p.c < s.c1 ? p.c - s.c1 : 0;
        if (!dx && !dy) setFillTo(null);
        else if (Math.abs(dy) >= Math.abs(dx)) setFillTo(dy > 0 ? { ...s, r2: p.r } : { ...s, r1: p.r });
        else setFillTo(dx > 0 ? { ...s, c2: p.c } : { ...s, c1: p.c });
      }
    };
    const up = () => {
      const d = drag.current;
      drag.current = null;
      if (d?.mode === "fill") {
        const to = fillRef.current;
        setFillTo(null);
        if (to) {
          actions.fill(d.src, to);
          setSel({ anchor: { r: to.r1, c: to.c1 }, head: { r: to.r2, c: to.c2 } });
        }
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [actions, cellAt, sel.anchor, setSel, rows, cols]);

  const onCellDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const p = cellAt(e.clientX, e.clientY);
    if (edit && isRefPoint(edit.text)) {
      // Building a formula: clicking a cell inserts its reference instead of leaving the cell.
      e.preventDefault();
      drag.current = { mode: "ref", base: edit.text, start: p };
      actions.setEditText(edit.text + toA1(p.r, p.c));
      return;
    }
    if (edit) actions.commit(edit.text, [0, 0]);
    e.preventDefault();
    rootRef.current?.focus();
    if (e.shiftKey) setSel({ anchor: sel.anchor, head: p });
    else setSel({ anchor: p, head: p });
    drag.current = { mode: "cells" };
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.target !== rootRef.current) return;
    const mod = e.ctrlKey || e.metaKey;
    const a = sel.anchor;
    const move = (dr: number, dc: number, extend: boolean) => {
      const from = extend ? sel.head : a;
      const to = mod ? actions.jump(from, dr, dc) : { r: Math.min(rows - 1, Math.max(0, from.r + dr)), c: Math.min(cols - 1, Math.max(0, from.c + dc)) };
      setSel(extend ? { anchor: a, head: to } : { anchor: to, head: to });
    };
    const k = e.key;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[k]) move(...arrows[k], e.shiftKey);
    else if (k === "Tab") move(0, e.shiftKey ? -1 : 1, false);
    else if (k === "Enter") move(e.shiftKey ? -1 : 1, 0, false);
    else if (k === "PageDown") move(20, 0, e.shiftKey);
    else if (k === "PageUp") move(-20, 0, e.shiftKey);
    else if (k === "Home") {
      const to = mod ? { r: 0, c: 0 } : { r: a.r, c: 0 };
      setSel({ anchor: to, head: to });
    } else if (k === "End") {
      const to = { r: a.r, c: actions.lastCol(a.r) };
      setSel({ anchor: to, head: to });
    } else if (k === "Delete" || k === "Backspace") actions.clear(g);
    else if (k === "F2") actions.startEdit(tab.cells[toA1(a.r, a.c)] ?? "", false);
    else if (mod && k.toLowerCase() === "z") {
      if (e.shiftKey) actions.redo();
      else actions.undo();
    }
    else if (mod && k.toLowerCase() === "y") actions.redo();
    else if (mod && ["b", "i", "u"].includes(k.toLowerCase())) actions.toggle(k.toLowerCase() as "b" | "i" | "u");
    else if (mod && k.toLowerCase() === "a") setSel({ anchor: { r: 0, c: 0 }, head: { r: rows - 1, c: cols - 1 } });
    else if (k.length === 1 && !mod && !e.altKey) actions.startEdit(k, true);
    else return;
    e.preventDefault();
  };

  const onEditKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const text = e.currentTarget.value;
    const k = e.key;
    if (k === "Enter") actions.commit(text, [e.shiftKey ? -1 : 1, 0]);
    else if (k === "Tab") actions.commit(text, [0, e.shiftKey ? -1 : 1]);
    else if (k === "Escape") actions.cancelEdit();
    else if (edit?.quick && !text.startsWith("=") && k.startsWith("Arrow")) {
      const m: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      actions.commit(text, m[k]);
    } else return;
    e.preventDefault();
  };

  // ---- Rendering ----
  // Every pane renders in sheet coordinates (colX/rowY) shifted by its own origin.

  const bodyC0 = Math.max(frozenC, colAt(frozenW + scroll.l));
  let bodyC1 = bodyC0;
  while (bodyC1 < cols - 1 && colX[bodyC1 + 1] < frozenW + scroll.l + view.w) bodyC1++;
  const bodyR0 = Math.max(frozen, rowAt(frozenH + scroll.t));
  let bodyR1 = bodyR0;
  while (bodyR1 < rows - 1 && rowY[bodyR1 + 1] < frozenH + scroll.t + view.h) bodyR1++;

  type Pane = { r1: number; r2: number; c1: number; c2: number; ox: number; oy: number };
  const panes = {
    corner: { r1: 0, r2: frozen - 1, c1: 0, c2: frozenC - 1, ox: 0, oy: 0 },
    top: { r1: 0, r2: frozen - 1, c1: bodyC0, c2: bodyC1, ox: frozenW, oy: 0 },
    left: { r1: bodyR0, r2: bodyR1, c1: 0, c2: frozenC - 1, ox: 0, oy: frozenH },
    body: { r1: bodyR0, r2: bodyR1, c1: bodyC0, c2: bodyC1, ox: frozenW, oy: frozenH },
  } satisfies Record<string, Pane>;
  const paneOf = (r: number, c: number) => (r < frozen ? (c < frozenC ? panes.corner : panes.top) : c < frozenC ? panes.left : panes.body);

  /** A cell's box in its pane, spanning the whole merge when it is a merge's top-left cell. */
  const box = (r: number, c: number, p: Pane) => {
    const span = merges.masters.get(toA1(r, c));
    const r2 = span ? span.r2 : r;
    const c2 = span ? span.c2 : c;
    return { left: colX[c] - p.ox, top: rowY[r] - p.oy, width: colX[c2 + 1] - colX[c], height: rowY[r2 + 1] - rowY[r] };
  };

  const cell = (r: number, c: number, p: Pane) => {
    const key = toA1(r, c);
    const raw = tab.cells[key];
    const v: Value = values[key] ?? (raw === undefined ? null : raw);
    const s = tab.styles[key];
    const valign = s?.valign === "top" ? "flex-start" : s?.valign === "middle" ? "center" : "flex-end";
    return (
      <div
        key={key}
        className={`absolute flex overflow-hidden border-b border-r border-[#e5e7eb] px-1 ${s?.wrap ? "" : "whitespace-nowrap"}`}
        style={{ ...box(r, c, p), ...cellCss(v, s), background: s?.bg ?? "#ffffff", alignItems: valign, lineHeight: 1.3, paddingBottom: valign === "flex-end" ? 3 : undefined }}
      >
        <span className={`min-w-0 flex-1 ${s?.wrap ? "whitespace-pre-wrap break-words" : "overflow-hidden"}`}>{formatCell(v, s)}</span>
      </div>
    );
  };

  /** The cells of a pane. A merge whose top-left cell is out of view still draws, once. */
  const cellsIn = (p: Pane) => {
    const out = [];
    const drawn = new Set<string>();
    for (let r = p.r1; r <= p.r2; r++)
      for (let c = p.c1; c <= p.c2; c++) {
        const key = toA1(r, c);
        const master = merges.owner.get(key);
        if (!master) out.push(cell(r, c, p));
        else if (!drawn.has(master)) {
          drawn.add(master);
          const m = merges.masters.get(master)!;
          if (m.r1 < p.r1 || m.c1 < p.c1) out.push(cell(m.r1, m.c1, p));
        }
        if (merges.masters.has(key)) drawn.add(key);
      }
    return out;
  };

  /** Selection, active cell, fill handle and editor for one pane. */
  const overlay = (p: Pane) => {
    const out = [];
    const ra = Math.max(g.r1, p.r1);
    const rb = Math.min(g.r2, p.r2);
    const ca = Math.max(g.c1, p.c1);
    const cb = Math.min(g.c2, p.c2);
    if (ra <= rb && ca <= cb) {
      const sbox: CSSProperties = { left: colX[ca] - p.ox, top: rowY[ra] - p.oy, width: colX[cb + 1] - colX[ca], height: rowY[rb + 1] - rowY[ra] };
      out.push(<div key="sel" className="pointer-events-none absolute z-10 border border-[#2563eb] bg-[#2563eb]/10" style={sbox} />);
      if (g.r2 <= p.r2 && g.c2 <= p.c2 && !edit)
        out.push(
          <div
            key="fill"
            title="Drag to fill"
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              drag.current = { mode: "fill", src: g };
            }}
            className="absolute z-20 h-[8px] w-[8px] cursor-crosshair border border-white bg-[#2563eb]"
            style={{ left: colX[g.c2 + 1] - p.ox - 5, top: rowY[g.r2 + 1] - p.oy - 5 }}
          />,
        );
    }
    if (fillTo) {
      const fa = Math.max(fillTo.r1, p.r1);
      const fb = Math.min(fillTo.r2, p.r2);
      const fc = Math.max(fillTo.c1, p.c1);
      const fd = Math.min(fillTo.c2, p.c2);
      if (fa <= fb && fc <= fd)
        out.push(
          <div
            key="fillto"
            className="pointer-events-none absolute z-10 border-2 border-dashed border-[#2563eb]"
            style={{ left: colX[fc] - p.ox, top: rowY[fa] - p.oy, width: colX[fd + 1] - colX[fc], height: rowY[fb + 1] - rowY[fa] }}
          />,
        );
    }
    const a = sel.anchor;
    if (paneOf(a.r, a.c) === p) {
      const s = tab.styles[toA1(a.r, a.c)];
      const b = box(a.r, a.c, p);
      const pos: CSSProperties = { left: b.left - 1, top: b.top - 1, height: Math.max(ROW_H, b.height) + 1, minWidth: b.width + 1 };
      if (edit?.source === "cell")
        out.push(
          <input
            key="edit"
            autoFocus
            aria-label="Cell value"
            value={edit.text}
            onChange={(e) => actions.setEditText(e.target.value)}
            onKeyDown={onEditKey}
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute z-30 border-2 border-[#2563eb] bg-white px-1 text-[13px] text-[#111827] outline-none"
            style={{ ...pos, width: Math.max(b.width + 1, edit.text.length * 7.5 + 16), fontWeight: s?.b ? 600 : undefined, fontStyle: s?.i ? "italic" : undefined }}
          />,
        );
      else if (edit)
        out.push(
          <div key="edit" className="pointer-events-none absolute z-30 overflow-hidden whitespace-nowrap border-2 border-[#2563eb] bg-white px-1 text-[13px] leading-[20px] text-[#111827]" style={pos}>
            {edit.text}
          </div>,
        );
      else out.push(<div key="active" className="pointer-events-none absolute z-20 border-2 border-[#2563eb]" style={{ ...pos, width: b.width + 1 }} />);
    }
    return out;
  };

  const headCls = (on: boolean) =>
    `absolute flex select-none items-center justify-center border-b border-r border-line text-[11px] ${on ? "bg-accent-wash font-semibold text-accent" : "bg-surface-2 text-ink-2"}`;

  // Column headers, in two strips: the frozen ones (fixed) and the rest (follow the scroll).
  const frozenHeaders: ReactNode[] = [];
  const colHeaders: ReactNode[] = [];
  for (let c = 0; c <= bodyC1; c++) {
    if (c >= frozenC && c < bodyC0) continue;
    const ox = c < frozenC ? 0 : frozenW;
    (c < frozenC ? frozenHeaders : colHeaders).push(
        <div
          key={c}
          className={headCls(c >= g.c1 && c <= g.c2)}
          style={{ left: colX[c] - ox, top: 0, width: widths[c], height: HEAD_H }}
          onMouseDown={(e) => {
            e.preventDefault();
            if (edit) actions.commit(edit.text, [0, 0]);
            rootRef.current?.focus();
            const anchor = e.shiftKey ? { r: 0, c: sel.anchor.c } : { r: 0, c };
            setSel({ anchor, head: { r: rows - 1, c } });
            drag.current = { mode: "cols" };
          }}
        >
          {colName(c)}
          <span
            className="absolute right-[-3px] top-0 z-10 h-full w-[6px] cursor-col-resize"
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              drag.current = { mode: "resize", col: c, x: e.clientX, w: widths[c] };
            }}
            onDoubleClick={() => actions.resizeCol(c, DEFAULT_COL)}
          />
        </div>,
    );
  }


  const rowHeader = (r: number, oy: number) => (
    <div
      key={r}
      className={headCls(r >= g.r1 && r <= g.r2)}
      style={{ left: 0, top: rowY[r] - oy, width: HEAD_W, height: rowH(r) }}
      onMouseDown={(e) => {
        e.preventDefault();
        if (edit) actions.commit(edit.text, [0, 0]);
        rootRef.current?.focus();
        const anchor = e.shiftKey ? { r: sel.anchor.r, c: 0 } : { r, c: 0 };
        setSel({ anchor, head: { r, c: cols - 1 } });
        drag.current = { mode: "rows" };
      }}
    >
      {r + 1}
    </div>
  );

  const bodyRows = [];
  for (let r = bodyR0; r <= bodyR1; r++) bodyRows.push(rowHeader(r, frozenH));
  const fz = frozenC ? 2 : 0; // the frozen columns' divider
  const fr = frozen ? 2 : 0;

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKey}
      onCopy={(e) => {
        if (e.target !== rootRef.current) return;
        e.preventDefault();
        e.clipboardData.setData("text/plain", actions.copy(g, false));
      }}
      onCut={(e) => {
        if (e.target !== rootRef.current) return;
        e.preventDefault();
        e.clipboardData.setData("text/plain", actions.copy(g, true));
      }}
      onPaste={(e) => {
        if (e.target !== rootRef.current) return;
        e.preventDefault();
        actions.paste(e.clipboardData.getData("text/plain"));
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-cells]")) actions.startEdit(tab.cells[toA1(sel.anchor.r, sel.anchor.c)] ?? "", false);
      }}
      className="relative min-h-0 flex-1 overflow-hidden bg-surface-2 text-[13px] text-[#111827] outline-none"
      aria-label="Spreadsheet grid"
      role="grid"
    >
      {/* Corner: select all */}
      <div
        className="absolute left-0 top-0 z-30 border-b border-r border-line bg-surface-2"
        style={{ width: HEAD_W, height: HEAD_H }}
        onMouseDown={(e) => {
          e.preventDefault();
          rootRef.current?.focus();
          setSel({ anchor: { r: 0, c: 0 }, head: { r: rows - 1, c: cols - 1 } });
        }}
      />
      {/* Column headers: the frozen ones stay put */}
      {frozenC > 0 && (
        <div className="absolute top-0 z-20 overflow-hidden border-r-2 border-[#9ca3af]" style={{ left: HEAD_W, width: frozenW + fz, height: HEAD_H }}>
          <div className="relative h-full">{frozenHeaders}</div>
        </div>
      )}
      <div className="absolute top-0 z-20 overflow-hidden" style={{ left: HEAD_W + frozenW + fz, right: 0, height: HEAD_H }}>
        <div className="relative h-full" style={{ transform: `translateX(${-scroll.l}px)`, width: colX[cols] - frozenW }}>
          {colHeaders}
        </div>
      </div>
      {/* Frozen rows: headers, the corner pane, and the band that scrolls sideways */}
      {frozen > 0 && (
        <>
          <div className="absolute left-0 z-20 overflow-hidden" style={{ top: HEAD_H, width: HEAD_W, height: frozenH }}>
            {Array.from({ length: frozen }, (_, r) => rowHeader(r, 0))}
          </div>
          {frozenC > 0 && (
            <div data-cells className="absolute z-20 overflow-hidden border-b-2 border-r-2 border-[#9ca3af]" style={{ top: HEAD_H, left: HEAD_W, width: frozenW + fz, height: frozenH + fr }} onMouseDown={onCellDown}>
              <div className="relative h-full">
                {cellsIn(panes.corner)}
                {overlay(panes.corner)}
              </div>
            </div>
          )}
          <div
            data-cells
            className="absolute z-10 overflow-hidden border-b-2 border-[#9ca3af]"
            style={{ top: HEAD_H, left: HEAD_W + frozenW + fz, right: 0, height: frozenH + fr }}
            onMouseDown={onCellDown}
          >
            <div className="relative h-full" style={{ transform: `translateX(${-scroll.l}px)`, width: colX[cols] - frozenW }}>
              {cellsIn(panes.top)}
              {overlay(panes.top)}
            </div>
          </div>
        </>
      )}
      {/* Row headers */}
      <div className="absolute left-0 z-20 overflow-hidden" style={{ top: HEAD_H + frozenH + fr, width: HEAD_W, bottom: 0 }}>
        <div className="relative" style={{ transform: `translateY(${-scroll.t}px)` }}>
          {bodyRows}
        </div>
      </div>
      {/* Frozen columns: scroll up and down with the body */}
      {frozenC > 0 && (
        <div data-cells className="absolute z-10 overflow-hidden border-r-2 border-[#9ca3af]" style={{ top: HEAD_H + frozenH + fr, left: HEAD_W, width: frozenW + fz, bottom: 0 }} onMouseDown={onCellDown}>
          <div className="relative" style={{ transform: `translateY(${-scroll.t}px)`, height: rowY[rows] - frozenH }}>
            {cellsIn(panes.left)}
            {overlay(panes.left)}
          </div>
        </div>
      )}
      {/* Body */}
      <div
        ref={scroller}
        data-cells
        className="absolute overflow-auto"
        style={{ top: HEAD_H + frozenH + fr, left: HEAD_W + frozenW + fz, right: 0, bottom: 0 }}
        onScroll={(e) => setScroll({ l: e.currentTarget.scrollLeft, t: e.currentTarget.scrollTop })}
        onMouseDown={onCellDown}
      >
        <div className="relative" style={{ width: colX[cols] - frozenW, height: rowY[rows] - frozenH }}>
          {cellsIn(panes.body)}
          {overlay(panes.body)}
        </div>
      </div>
    </div>
  );
}
