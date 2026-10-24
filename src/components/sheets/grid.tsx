"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { colName, normRange, rangeA1, toA1, type Pos, type Range } from "@/lib/sheets/a1";
import { formatValue, type Value } from "@/lib/sheets/format";
import type { SheetTab } from "@/lib/types";
import { cellCss, DEFAULT_COL } from "./sheet-table";

// A virtualized spreadsheet grid: only the cells in view are rendered, so 1,000+ rows by 52+
// columns scroll smoothly. Headers and frozen rows live outside the scroller and follow its offset.

export const ROW_H = 24;
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
  const frozen = Math.min(tab.frozen?.rows ?? 0, rows);
  const frozenH = frozen * ROW_H;
  const g = normRange(sel.anchor, sel.head);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const colAt = useCallback(
    (x: number) => {
      let lo = 0;
      let hi = cols - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (colX[mid] <= x) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
    [colX, cols],
  );

  // Keep the moving end of the selection in view.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const { r, c } = sel.head;
    const x1 = colX[c];
    const x2 = colX[c + 1] ?? x1;
    if (x1 < el.scrollLeft) el.scrollLeft = x1;
    else if (x2 > el.scrollLeft + el.clientWidth) el.scrollLeft = x2 - el.clientWidth;
    if (r >= frozen) {
      const y1 = (r - frozen) * ROW_H;
      if (y1 < el.scrollTop) el.scrollTop = y1;
      else if (y1 + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = y1 + ROW_H - el.clientHeight;
    }
  }, [sel.head, colX, frozen]);

  /** Cell under a viewport point, clamped to the sheet. */
  const cellAt = useCallback(
    (clientX: number, clientY: number): Pos => {
      const root = rootRef.current!.getBoundingClientRect();
      const el = scroller.current!;
      const x = clientX - root.left - HEAD_W;
      const y = clientY - root.top - HEAD_H;
      const c = colAt(Math.max(0, x) + el.scrollLeft);
      const r = y < frozenH ? Math.max(0, Math.floor(y / ROW_H)) : frozen + Math.floor((y - frozenH + el.scrollTop) / ROW_H);
      return { r: Math.min(rows - 1, Math.max(0, r)), c: Math.min(cols - 1, c) };
    },
    [rootRef, colAt, frozen, frozenH, rows, cols],
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

  const c0 = colAt(scroll.l);
  let c1 = c0;
  while (c1 < cols - 1 && colX[c1 + 1] < scroll.l + view.w) c1++;
  const r0 = frozen + Math.floor(scroll.t / ROW_H);
  const r1 = Math.min(rows - 1, frozen + Math.ceil((scroll.t + view.h) / ROW_H));

  const cell = (r: number, c: number, top: number) => {
    const key = toA1(r, c);
    const raw = tab.cells[key];
    const v: Value = values[key] ?? (raw === undefined ? null : raw);
    const s = tab.styles[key];
    return (
      <div
        key={key}
        className="absolute overflow-hidden whitespace-nowrap border-b border-r border-[#e5e7eb] px-1 leading-[23px]"
        style={{ left: colX[c], top, width: widths[c], height: ROW_H, ...cellCss(v, s), background: s?.bg ?? "#ffffff" }}
      >
        {formatValue(v, s?.fmt)}
      </div>
    );
  };

  const cellsIn = (ra: number, rb: number, top: (r: number) => number) => {
    const out = [];
    for (let r = ra; r <= rb; r++) for (let c = c0; c <= c1; c++) out.push(cell(r, c, top(r)));
    return out;
  };

  /** Selection, active cell, fill handle and editor for one layer (frozen band or body). */
  const overlay = (layerR1: number, layerR2: number, top: (r: number) => number) => {
    const out = [];
    const ra = Math.max(g.r1, layerR1);
    const rb = Math.min(g.r2, layerR2);
    if (ra <= rb) {
      const box: CSSProperties = { left: colX[g.c1], top: top(ra), width: colX[g.c2 + 1] - colX[g.c1], height: (rb - ra + 1) * ROW_H };
      out.push(<div key="sel" className="pointer-events-none absolute z-10 border border-[#2563eb] bg-[#2563eb]/10" style={box} />);
      if (g.r2 <= layerR2 && !edit)
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
            style={{ left: colX[g.c2 + 1] - 5, top: top(g.r2) + ROW_H - 5 }}
          />,
        );
    }
    if (fillTo) {
      const fa = Math.max(fillTo.r1, layerR1);
      const fb = Math.min(fillTo.r2, layerR2);
      if (fa <= fb)
        out.push(
          <div
            key="fillto"
            className="pointer-events-none absolute z-10 border-2 border-dashed border-[#2563eb]"
            style={{ left: colX[fillTo.c1], top: top(fa), width: colX[fillTo.c2 + 1] - colX[fillTo.c1], height: (fb - fa + 1) * ROW_H }}
          />,
        );
    }
    const a = sel.anchor;
    if (a.r >= layerR1 && a.r <= layerR2) {
      const s = tab.styles[toA1(a.r, a.c)];
      const pos: CSSProperties = { left: colX[a.c] - 1, top: top(a.r) - 1, height: ROW_H + 1, minWidth: widths[a.c] + 1 };
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
            style={{ ...pos, width: Math.max(widths[a.c] + 1, edit.text.length * 7.5 + 16), fontWeight: s?.b ? 600 : undefined, fontStyle: s?.i ? "italic" : undefined }}
          />,
        );
      else if (edit)
        out.push(
          <div key="edit" className="pointer-events-none absolute z-30 overflow-hidden whitespace-nowrap border-2 border-[#2563eb] bg-white px-1 text-[13px] leading-[20px] text-[#111827]" style={pos}>
            {edit.text}
          </div>,
        );
      else out.push(<div key="active" className="pointer-events-none absolute z-20 border-2 border-[#2563eb]" style={{ ...pos, width: widths[a.c] + 1 }} />);
    }
    return out;
  };

  const headCls = (on: boolean) =>
    `absolute flex select-none items-center justify-center border-b border-r border-line text-[11px] ${on ? "bg-accent-wash font-semibold text-accent" : "bg-surface-2 text-ink-2"}`;

  const colHeaders = [];
  for (let c = c0; c <= c1; c++) {
    colHeaders.push(
      <div
        key={c}
        className={headCls(c >= g.c1 && c <= g.c2)}
        style={{ left: colX[c], top: 0, width: widths[c], height: HEAD_H }}
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

  const rowHeader = (r: number, top: number) => (
    <div
      key={r}
      className={headCls(r >= g.r1 && r <= g.r2)}
      style={{ left: 0, top, width: HEAD_W, height: ROW_H }}
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
  for (let r = r0; r <= r1; r++) bodyRows.push(rowHeader(r, (r - frozen) * ROW_H));

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
      {/* Column headers */}
      <div className="absolute top-0 z-20 overflow-hidden" style={{ left: HEAD_W, right: 0, height: HEAD_H }}>
        <div className="relative h-full" style={{ transform: `translateX(${-scroll.l}px)`, width: colX[cols] }}>
          {colHeaders}
        </div>
      </div>
      {/* Frozen rows */}
      {frozen > 0 && (
        <>
          <div className="absolute left-0 z-20 overflow-hidden" style={{ top: HEAD_H, width: HEAD_W, height: frozenH }}>
            {Array.from({ length: frozen }, (_, r) => rowHeader(r, r * ROW_H))}
          </div>
          <div
            data-cells
            className="absolute z-10 overflow-hidden border-b-2 border-[#9ca3af]"
            style={{ top: HEAD_H, left: HEAD_W, right: 0, height: frozenH + 2 }}
            onMouseDown={onCellDown}
          >
            <div className="relative h-full" style={{ transform: `translateX(${-scroll.l}px)`, width: colX[cols] }}>
              {cellsIn(0, frozen - 1, (r) => r * ROW_H)}
              {overlay(0, frozen - 1, (r) => r * ROW_H)}
            </div>
          </div>
        </>
      )}
      {/* Row headers */}
      <div className="absolute left-0 z-20 overflow-hidden" style={{ top: HEAD_H + frozenH, width: HEAD_W, bottom: 0 }}>
        <div className="relative" style={{ transform: `translateY(${-scroll.t}px)` }}>
          {bodyRows}
        </div>
      </div>
      {/* Body */}
      <div
        ref={scroller}
        data-cells
        className="absolute overflow-auto"
        style={{ top: HEAD_H + frozenH + (frozen ? 2 : 0), left: HEAD_W, right: 0, bottom: 0 }}
        onScroll={(e) => setScroll({ l: e.currentTarget.scrollLeft, t: e.currentTarget.scrollTop })}
        onMouseDown={onCellDown}
      >
        <div className="relative" style={{ width: colX[cols], height: (rows - frozen) * ROW_H }}>
          {cellsIn(r0, r1, (r) => (r - frozen) * ROW_H)}
          {overlay(frozen, rows - 1, (r) => (r - frozen) * ROW_H)}
        </div>
      </div>
    </div>
  );
}
