"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bold,
  Eraser,
  FileDown,
  GripVertical,
  Highlighter,
  Image as ImageIcon,
  MousePointer2,
  Pencil,
  RotateCcw,
  RotateCw,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { imageToDataUrl } from "@/lib/client";
import { baseName, isPdf, openPdf, pdfBlob, readBytes, type PdfJsDoc } from "@/lib/pdf/core";
import { applyEdits, LINE, type EditPage, type Extras, type FontName, type Mark } from "@/lib/pdf/edit";
import { ACCEPT, DropZone, ErrorNote, PageCanvas, Result, ToolPage, useDriveFile, useJob, Working } from "./kit";

type Tool = "select" | "text" | "rect" | "whiteout" | "highlight" | "draw";
type Size = { w: number; h: number; rotate: number };
type Source = { file: File; bytes: Uint8Array; doc: PdfJsDoc; sizes: Size[] };
type Sel = { page: number; id: string } | null;

const CSS_FONT: Record<FontName, string> = { sans: "Arial, Helvetica, sans-serif", serif: "'Times New Roman', Times, serif", mono: "'Courier New', Courier, monospace" };
const COLORS = ["#111827", "#dc2626", "#2563eb", "#16a34a", "#ea580c", "#7c3aed", "#ffffff"];
const uid = () => Math.random().toString(36).slice(2, 10);

/** The shown size of a page with `extra` degrees of rotation added to its own. */
function shown(size: Size, extra: number) {
  const r = (size.rotate + extra) % 360;
  return { w: r % 180 ? size.h : size.w, h: r % 180 ? size.w : size.h, r };
}

/** Moves a mark so it stays at the same spot on the page when the page turns a quarter. */
function turnMark(m: Mark, view: { w: number; h: number }, cw: boolean): Mark {
  const pt = ([x, y]: [number, number]): [number, number] => (cw ? [view.h - y, x] : [y, view.w - x]);
  switch (m.kind) {
    case "ink":
      return { ...m, points: m.points.map(pt) };
    case "text": {
      const [x, y] = pt([m.x, m.y]);
      return { ...m, x: cw ? x - m.size * LINE : x, y: cw ? y : y - m.size };
    }
    default: {
      const [x, y] = cw ? pt([m.x, m.y + m.h]) : pt([m.x + m.w, m.y]);
      return { ...m, x, y, w: m.h, h: m.w };
    }
  }
}

export function EditTool() {
  const job = useJob();
  const [src, setSrc] = useState<Source | null>(null);
  // The pages with everything drawn on them, and up to 50 earlier states for Undo.
  const [state, setState] = useState<{ pages: EditPage[]; past: EditPage[][] }>({ pages: [], past: [] });
  const pages = state.pages;
  const [mode, setMode] = useState<"edit" | "pages">("edit");
  const [tool, setTool] = useState<Tool>("text");
  const [sel, setSel] = useState<Sel>(null);
  const [style, setStyle] = useState({ color: "#111827", size: 14, font: "sans" as FontName, bold: false, width: 2 });
  const [extras, setExtras] = useState<Extras>({});
  const [result, setResult] = useState<Blob | null>(null);
  // Bumped by Undo so text boxes re-read their restored text.
  const [epoch, setEpoch] = useState(0);
  const current = useRef(0);

  useEffect(() => () => void src?.doc.destroy(), [src]);

  /** Changes the pages; `record` keeps the previous state for Undo. */
  const setPages = useCallback(
    (fn: (p: EditPage[]) => EditPage[], record = true) => setState((s) => ({ pages: fn(s.pages), past: record ? [...s.past.slice(-49), s.pages] : s.past })),
    [],
  );

  const undo = useCallback(() => {
    setState((s) => (s.past.length ? { pages: s.past.at(-1)!, past: s.past.slice(0, -1) } : s));
    setSel(null);
    setEpoch((n) => n + 1);
  }, []);

  const open = (files: File[]) =>
    void job.run("Opening", async () => {
      const file = files[0];
      if (!isPdf(file)) throw new Error(`${file.name} isn't a PDF.`);
      const bytes = await readBytes(file);
      const doc = await openPdf(bytes);
      const sizes: Size[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const v = p.getViewport({ scale: 1, rotation: 0 });
        sizes.push({ w: v.width, h: v.height, rotate: p.rotate });
      }
      setSrc({ file, bytes, doc, sizes });
      setState({ pages: sizes.map((_, i) => ({ src: i, rotate: 0, marks: [] })), past: [] });
    });

  useDriveFile((f) => open([f]));

  const updateMark = useCallback(
    (page: number, id: string, patch: Partial<Mark>, record = false) =>
      setPages((ps) => ps.map((p, i) => (i === page ? { ...p, marks: p.marks.map((m) => (m.id === id ? ({ ...m, ...patch } as Mark) : m)) } : p)), record),
    [setPages],
  );
  const addMark = useCallback((page: number, m: Mark) => setPages((ps) => ps.map((p, i) => (i === page ? { ...p, marks: [...p.marks, m] } : p))), [setPages]);
  const removeMark = useCallback((page: number, id: string) => setPages((ps) => ps.map((p, i) => (i === page ? { ...p, marks: p.marks.filter((m) => m.id !== id) } : p))), [setPages]);

  // Empty text boxes disappear when you click away from them.
  const select = useCallback(
    (next: Sel) =>
      setSel((prev) => {
        if (prev && (prev.page !== next?.page || prev.id !== next?.id))
          setPages((ps) => ps.map((p, i) => (i === prev.page ? { ...p, marks: p.marks.filter((m) => m.id !== prev.id || m.kind !== "text" || m.text.trim()) } : p)), false);
        return next;
      }),
    [setPages],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).isContentEditable || /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        undo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel && !typing) {
        e.preventDefault();
        removeMark(sel.page, sel.id);
        setSel(null);
      } else if (e.key === "Escape") select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, undo, removeMark, select]);

  const selected = sel ? pages[sel.page]?.marks.find((m) => m.id === sel.id) : undefined;

  /** Style changes apply to the selected mark as well as to the next one. */
  const restyle = (patch: Partial<typeof style>) => {
    setStyle((s) => ({ ...s, ...patch }));
    if (!sel || !selected) return;
    const p: Partial<Mark> = {};
    if (patch.color && selected.kind !== "image") Object.assign(p, { color: patch.color });
    if (selected.kind === "text") Object.assign(p, { ...(patch.size ? { size: patch.size } : {}), ...(patch.font ? { font: patch.font } : {}), ...(patch.bold !== undefined ? { bold: patch.bold } : {}) });
    if (selected.kind === "ink" && patch.width) Object.assign(p, { width: patch.width });
    if (Object.keys(p).length) updateMark(sel.page, sel.id, p, true);
  };

  const addImage = async (file: File) => {
    if (!src) return;
    const dataUrl = await imageToDataUrl(file, 1400);
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const page = Math.min(current.current, pages.length - 1);
    const view = shown(src.sizes[pages[page].src], pages[page].rotate);
    const w = Math.min(180, view.w * 0.5);
    const h = (w * img.height) / img.width;
    const m: Mark = { id: uid(), kind: "image", x: (view.w - w) / 2, y: (view.h - h) / 3, w, h, src: dataUrl };
    addMark(page, m);
    setTool("select");
    setSel({ page, id: m.id });
  };

  if (result && src) return <ToolPage id="edit"><Result blob={result} name={`${baseName(src.file.name)}-edited.pdf`} onReset={() => (setResult(null), setSrc(null))} /></ToolPage>;

  if (!src)
    return (
      <ToolPage id="edit">
        {job.busy ? <Working label={job.label} progress={0} /> : <DropZone accept={ACCEPT.pdf} onFiles={open} label="Choose a PDF to edit" hint="or drop it here" />}
        <ErrorNote text={job.error} />
      </ToolPage>
    );

  const save = () =>
    void job.run("Saving your PDF", async () => {
      select(null);
      const clean = pages.map((p) => ({ ...p, marks: p.marks.filter((m) => m.kind !== "text" || m.text.trim()) }));
      setResult(pdfBlob(await applyEdits(src.bytes, clean, extras)));
    });

  const TOOLS: { id: Tool; label: string; Icon: typeof Type }[] = [
    { id: "select", label: "Select and move", Icon: MousePointer2 },
    { id: "text", label: "Add text", Icon: Type },
    { id: "rect", label: "Box", Icon: Square },
    { id: "whiteout", label: "Whiteout", Icon: Eraser },
    { id: "highlight", label: "Highlight", Icon: Highlighter },
    { id: "draw", label: "Draw or sign", Icon: Pencil },
  ];
  const showText = tool === "text" || selected?.kind === "text";

  return (
    <ToolPage id="edit" wide>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-surface p-0.5 text-sm">
          {(
            [
              ["edit", "Edit pages"],
              ["pages", "Organise pages"],
            ] as const
          ).map(([m, label]) => (
            <button key={m} type="button" onClick={() => (select(null), setMode(m))} className={`rounded-md px-3 py-1.5 font-medium ${mode === m ? "bg-accent text-white" : "text-ink-2 hover:bg-hover"}`}>
              {label}
            </button>
          ))}
        </div>
        <span className="truncate text-sm text-muted">{src.file.name}</span>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn" onClick={undo} disabled={!state.past.length} aria-label="Undo">
            <Undo2 size={16} />
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={job.busy || !pages.length}>
            <FileDown size={16} /> {job.busy ? "Saving…" : "Save PDF"}
          </button>
        </div>
      </div>
      <ErrorNote text={job.error} />

      {mode === "edit" ? (
        <>
          <div className="sticky top-14 z-30 -mx-4 mb-4 flex flex-wrap items-center gap-1 border-y border-line bg-surface/95 px-4 py-2 backdrop-blur">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.label}
                aria-label={t.label}
                aria-pressed={tool === t.id}
                onClick={() => (setTool(t.id), t.id !== "select" && select(null))}
                className={`icon-btn ${tool === t.id ? "!bg-accent !text-white" : ""}`}
              >
                <t.Icon size={18} />
              </button>
            ))}
            <label className="icon-btn cursor-pointer" title="Add an image or signature" aria-label="Add an image">
              <ImageIcon size={18} />
              <input type="file" hidden accept="image/png,image/jpeg,image/*" onChange={(e) => (e.target.files?.[0] && void addImage(e.target.files[0]), (e.target.value = ""))} />
            </label>
            <span className="mx-1 h-6 w-px bg-line" />
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                onClick={() => restyle({ color: c })}
                className={`h-6 w-6 rounded-full border ${style.color === c ? "ring-2 ring-accent ring-offset-1" : "border-line"}`}
                style={{ background: c }}
              />
            ))}
            {showText && (
              <>
                <span className="mx-1 h-6 w-px bg-line" />
                <select className="input !h-8 !w-auto !py-0 text-sm" value={style.font} onChange={(e) => restyle({ font: e.target.value as FontName })} aria-label="Font">
                  <option value="sans">Helvetica</option>
                  <option value="serif">Times</option>
                  <option value="mono">Courier</option>
                </select>
                <select className="input !h-8 !w-auto !py-0 text-sm" value={style.size} onChange={(e) => restyle({ size: Number(e.target.value) })} aria-label="Text size">
                  {[8, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button type="button" aria-label="Bold" aria-pressed={style.bold} onClick={() => restyle({ bold: !style.bold })} className={`icon-btn ${style.bold ? "!bg-accent-wash !text-accent" : ""}`}>
                  <Bold size={17} />
                </button>
              </>
            )}
            {(tool === "draw" || selected?.kind === "ink") && (
              <select className="input !h-8 !w-auto !py-0 text-sm" value={style.width} onChange={(e) => restyle({ width: Number(e.target.value) })} aria-label="Pen width">
                <option value={1}>Thin</option>
                <option value={2}>Medium</option>
                <option value={4}>Thick</option>
              </select>
            )}
            {sel && (
              <button
                type="button"
                className="btn btn-sm ml-auto"
                onClick={() => {
                  removeMark(sel.page, sel.id);
                  setSel(null);
                }}
              >
                <Trash2 size={15} /> Delete
              </button>
            )}
          </div>
          <p className="mb-3 text-center text-xs text-muted">
            {
              {
                select: "Drag things to move them. Drag a box's corner to resize it.",
                text: "Tap the page where the text should go, then type.",
                rect: "Drag on the page to draw a box.",
                whiteout: "Drag over anything you want to cover up. It hides it on the page; the text underneath can still be copied.",
                highlight: "Drag over text to highlight it.",
                draw: "Draw or sign with your finger, pen or mouse.",
              }[tool]
            }
          </p>
          <Pages
            src={src}
            pages={pages}
            tool={tool}
            style={style}
            sel={sel}
            onSelect={select}
            epoch={epoch}
            onAdd={(page, m) => {
              addMark(page, m);
              if (m.kind === "text") select({ page, id: m.id });
            }}
            onUpdate={updateMark}
            onFocusPage={(i) => (current.current = i)}
            onStartEdit={() => setPages((p) => p)}
          />
        </>
      ) : (
        <Organise src={src} pages={pages} setPages={setPages} extras={extras} setExtras={setExtras} />
      )}
    </ToolPage>
  );
}

// ---- Edit mode ----

type PagesProps = {
  src: Source;
  pages: EditPage[];
  tool: Tool;
  style: { color: string; size: number; font: FontName; bold: boolean; width: number };
  sel: Sel;
  epoch: number;
  onSelect: (s: Sel) => void;
  onAdd: (page: number, m: Mark) => void;
  onUpdate: (page: number, id: string, patch: Partial<Mark>, record?: boolean) => void;
  onFocusPage: (i: number) => void;
  onStartEdit: () => void;
};

function Pages(props: PagesProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(860, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={wrap} className="flex flex-col items-center gap-6 pb-10">
      {width > 0 &&
        props.pages.map((p, i) => (
          <div key={`${p.src}-${i}-${props.epoch}`} className="flex flex-col items-center gap-1">
            <PageEditor {...props} index={i} page={p} width={width} />
            <span className="text-xs text-muted">
              Page {i + 1} of {props.pages.length}
            </span>
          </div>
        ))}
    </div>
  );
}

function PageEditor({ src, page, index, width, tool, style, sel, onSelect, onAdd, onUpdate, onFocusPage, onStartEdit }: PagesProps & { index: number; page: EditPage; width: number }) {
  const view = shown(src.sizes[page.src], page.rotate);
  const scale = width / view.w;
  const overlay = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Mark | null>(null);
  const drag = useRef<{ kind: "new" | "move" | "resize"; id?: string; start: [number, number]; origin?: Mark } | null>(null);

  const point = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = overlay.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(view.w, (e.clientX - r.left) / scale)), Math.max(0, Math.min(view.h, (e.clientY - r.top) / scale))];
  };

  const down = (e: ReactPointerEvent) => {
    if (e.target !== overlay.current && !(e.target as Element).closest("svg[data-ink-layer]")) return;
    onFocusPage(index);
    const [x, y] = point(e);
    if (tool === "select") return onSelect(null);
    if (tool === "text") {
      e.preventDefault();
      const m: Mark = { id: uid(), kind: "text", x, y: Math.max(0, y - style.size * LINE * 0.5), text: "", size: style.size, color: style.color === "#ffffff" ? "#111827" : style.color, font: style.font, bold: style.bold };
      onAdd(index, m);
      return;
    }
    overlay.current!.setPointerCapture(e.pointerId);
    drag.current = { kind: "new", start: [x, y] };
    if (tool === "draw") setDraft({ id: uid(), kind: "ink", points: [[x, y]], color: style.color, width: style.width });
    else setDraft(boxMark(tool, style.color, x, y, 0, 0));
  };

  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = point(e);
    if (d.kind === "new") {
      setDraft((m) => {
        if (!m) return m;
        if (m.kind === "ink") return { ...m, points: [...m.points, [x, y]] };
        if (m.kind === "rect") return { ...m, x: Math.min(x, d.start[0]), y: Math.min(y, d.start[1]), w: Math.abs(x - d.start[0]), h: Math.abs(y - d.start[1]) };
        return m;
      });
      return;
    }
    const o = d.origin!;
    const dx = x - d.start[0];
    const dy = y - d.start[1];
    if (d.kind === "move") {
      if (o.kind === "ink") onUpdate(index, o.id, { points: o.points.map(([px, py]) => [px + dx, py + dy] as [number, number]) });
      else onUpdate(index, o.id, { x: o.x + dx, y: o.y + dy });
    } else if (o.kind === "rect") onUpdate(index, o.id, { w: Math.max(4, o.w + dx), h: Math.max(4, o.h + dy) });
    else if (o.kind === "image") {
      const w = Math.max(16, o.w + dx);
      onUpdate(index, o.id, { w, h: (w * o.h) / o.w });
    }
  };

  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind !== "new" || !draft) return;
    setDraft(null);
    if (draft.kind === "rect") {
      // A tap without a drag makes a box of a useful size.
      const m = draft.w < 4 || draft.h < 4 ? { ...draft, w: tool === "highlight" ? 120 : 100, h: tool === "highlight" ? style.size * 1.2 : 40 } : draft;
      onAdd(index, m);
    } else onAdd(index, draft);
  };

  /** Starts moving (or resizing) a mark from a pointer press on it. */
  const grab = (m: Mark, kind: "move" | "resize") => (e: ReactPointerEvent) => {
    if (tool !== "select" && !(m.kind === "text" && tool === "text")) return;
    e.stopPropagation();
    if (kind === "move" && m.kind === "text" && sel?.id === m.id && !(e.target as Element).closest("[data-grip]")) return; // typing in it
    e.preventDefault();
    onFocusPage(index);
    onSelect({ page: index, id: m.id });
    overlay.current!.setPointerCapture(e.pointerId);
    onStartEdit();
    drag.current = { kind, id: m.id, start: point(e), origin: m };
  };

  const marks = draft ? [...page.marks, draft] : page.marks;
  const inks = marks.filter((m): m is Extract<Mark, { kind: "ink" }> => m.kind === "ink");

  return (
    <div className="relative shadow-md" style={{ width, height: view.h * scale }}>
      <PageCanvas doc={src.doc} index={page.src} width={width} rotation={view.r} aspect={view.h / view.w} className="absolute inset-0" />
      <div
        ref={overlay}
        className="absolute inset-0"
        style={{ touchAction: tool === "select" ? "auto" : "none", cursor: tool === "text" ? "text" : tool === "select" ? "default" : "crosshair" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <svg data-ink-layer className="absolute inset-0 h-full w-full" viewBox={`0 0 ${view.w} ${view.h}`} style={{ pointerEvents: "none" }}>
          {inks.map((m) => (
            <path
              key={m.id}
              d={m.points.map(([x, y], n) => `${n ? "L" : "M"}${x} ${y}`).join(" ")}
              fill="none"
              stroke={m.color}
              strokeWidth={m.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ pointerEvents: tool === "select" ? "stroke" : "none", cursor: "move", touchAction: "none" }}
              onPointerDown={grab(m, "move")}
              className={sel?.id === m.id ? "drop-shadow-[0_0_2px_#2563eb]" : ""}
            />
          ))}
        </svg>
        {marks.map((m) =>
          m.kind === "ink" ? null : m.kind === "text" ? (
            <TextMark
              key={m.id}
              mark={m}
              scale={scale}
              active={sel?.id === m.id}
              onPointerDown={grab(m, "move")}
              onText={(text) => onUpdate(index, m.id, { text })}
            />
          ) : (
            <div
              key={m.id}
              onPointerDown={grab(m, "move")}
              className={`absolute ${sel?.id === m.id ? "outline outline-2 outline-accent" : ""}`}
              style={{
                left: m.x * scale,
                top: m.y * scale,
                width: m.w * scale,
                height: m.h * scale,
                touchAction: "none",
                cursor: tool === "select" ? "move" : undefined,
                ...(m.kind === "rect" ? { background: m.color, opacity: m.opacity, mixBlendMode: m.opacity < 1 ? "multiply" : undefined } : {}),
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a data URL the user just added */}
              {m.kind === "image" && <img src={m.src} alt="" draggable={false} className="h-full w-full select-none" />}
              {sel?.id === m.id && <span onPointerDown={grab(m, "resize")} className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white bg-accent" style={{ touchAction: "none" }} />}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function boxMark(tool: Tool, color: string, x: number, y: number, w: number, h: number): Mark {
  const id = uid();
  if (tool === "whiteout") return { id, kind: "rect", x, y, w, h, color: "#ffffff", opacity: 1 };
  if (tool === "highlight") return { id, kind: "rect", x, y, w, h, color: color === "#111827" || color === "#ffffff" ? "#facc15" : color, opacity: 0.35 };
  return { id, kind: "rect", x, y, w, h, color, opacity: 1 };
}

/** A text box you type into. Its text is set once and then left to the browser, so the caret never jumps. */
function TextMark({ mark, scale, active, onPointerDown, onText }: { mark: Extract<Mark, { kind: "text" }>; scale: number; active: boolean; onPointerDown: (e: ReactPointerEvent) => void; onText: (t: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (el.current && el.current.innerText !== mark.text) el.current.innerText = mark.text;
    // Only when the mark is first shown; Undo remounts the page to show restored text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mark.id]);
  useEffect(() => {
    if (active && el.current && document.activeElement !== el.current) {
      el.current.focus();
      const range = document.createRange();
      range.selectNodeContents(el.current);
      range.collapse(false);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    }
  }, [active]);
  return (
    <div className="absolute" style={{ left: mark.x * scale, top: mark.y * scale }} onPointerDown={onPointerDown}>
      {active && (
        <span data-grip className="absolute -left-6 top-0 flex h-6 w-5 cursor-move items-center justify-center rounded bg-accent text-white" style={{ touchAction: "none" }} aria-label="Drag to move">
          <GripVertical size={14} />
        </span>
      )}
      <div
        ref={el}
        contentEditable={active}
        suppressContentEditableWarning
        onInput={(e) => onText(e.currentTarget.innerText.replace(/\n$/, ""))}
        className={`min-w-[1ch] whitespace-pre px-0 outline-none ${active ? "outline-dashed outline-1 outline-accent" : "cursor-pointer"}`}
        style={{ fontSize: mark.size * scale, lineHeight: LINE, color: mark.color, fontFamily: CSS_FONT[mark.font], fontWeight: mark.bold ? 700 : 400, minHeight: mark.size * LINE * scale }}
        data-placeholder="Type here"
      />
    </div>
  );
}

// ---- Organise mode ----

function Organise({
  src,
  pages,
  setPages,
  extras,
  setExtras,
}: {
  src: Source;
  pages: EditPage[];
  setPages: (fn: (p: EditPage[]) => EditPage[]) => void;
  extras: Extras;
  setExtras: (e: Extras) => void;
}) {
  const rotate = (i: number, cw: boolean) =>
    setPages((ps) =>
      ps.map((p, n) => {
        if (n !== i) return p;
        const view = shown(src.sizes[p.src], p.rotate);
        return { ...p, rotate: (p.rotate + (cw ? 90 : 270)) % 360, marks: p.marks.map((m) => turnMark(m, view, cw)) };
      }),
    );
  const move = (i: number, by: number) =>
    setPages((ps) => {
      const next = [...ps];
      const [p] = next.splice(i, 1);
      next.splice(i + by, 0, p);
      return next;
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
        {pages.map((p, i) => {
          const view = shown(src.sizes[p.src], p.rotate);
          return (
            <div key={`${p.src}-${i}`} className="card flex flex-col items-center gap-2 p-2">
              <div className="flex h-44 items-center justify-center">
                <PageCanvas doc={src.doc} index={p.src} width={view.w > view.h ? 130 : (130 * view.w) / view.h} rotation={view.r} aspect={view.h / view.w} className="overflow-hidden rounded border border-line" />
              </div>
              <span className="text-xs font-medium">
                {i + 1}
                {p.marks.length ? ` · ${p.marks.length} edit${p.marks.length === 1 ? "" : "s"}` : ""}
              </span>
              <div className="flex flex-wrap justify-center gap-0.5">
                <button type="button" className="icon-btn !h-8 !w-8" aria-label={`Move page ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowLeft size={15} />
                </button>
                <button type="button" className="icon-btn !h-8 !w-8" aria-label={`Rotate page ${i + 1} left`} onClick={() => rotate(i, false)}>
                  <RotateCcw size={15} />
                </button>
                <button type="button" className="icon-btn !h-8 !w-8" aria-label={`Rotate page ${i + 1} right`} onClick={() => rotate(i, true)}>
                  <RotateCw size={15} />
                </button>
                <button type="button" className="icon-btn !h-8 !w-8" aria-label={`Delete page ${i + 1}`} disabled={pages.length === 1} onClick={() => setPages((ps) => ps.filter((_, n) => n !== i))}>
                  <Trash2 size={15} />
                </button>
                <button type="button" className="icon-btn !h-8 !w-8" aria-label={`Move page ${i + 1} later`} disabled={i === pages.length - 1} onClick={() => move(i, 1)}>
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <aside className="card h-fit p-4 lg:sticky lg:top-20">
        <div className="mb-4 flex gap-2">
          <button type="button" className="btn btn-sm flex-1" onClick={() => setPages((ps) => ps.map((p) => ({ ...p, rotate: (p.rotate + 90) % 360, marks: p.marks.map((m) => turnMark(m, shown(src.sizes[p.src], p.rotate), true)) })))}>
            <RotateCw size={14} /> Rotate all
          </button>
          <button type="button" className="btn btn-sm flex-1" onClick={() => setPages((ps) => [...ps].reverse())}>
            Reverse order
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={Boolean(extras.pageNumbers)} onChange={(e) => setExtras({ ...extras, pageNumbers: e.target.checked ? { position: "bottom-center", start: 1 } : undefined })} />
          Add page numbers
        </label>
        {extras.pageNumbers && (
          <div className="mt-2 grid grid-cols-2 gap-2 pl-6">
            <select className="input !h-9 text-sm" value={extras.pageNumbers.position} onChange={(e) => setExtras({ ...extras, pageNumbers: { ...extras.pageNumbers!, position: e.target.value as "bottom-center" } })} aria-label="Position">
              <option value="bottom-center">Bottom centre</option>
              <option value="bottom-right">Bottom right</option>
              <option value="top-right">Top right</option>
            </select>
            <input
              className="input !h-9 text-sm"
              type="number"
              min={1}
              value={extras.pageNumbers.start}
              onChange={(e) => setExtras({ ...extras, pageNumbers: { ...extras.pageNumbers!, start: Math.max(1, Number(e.target.value) || 1) } })}
              aria-label="First number"
            />
          </div>
        )}
        <label className="mt-4 flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={Boolean(extras.watermark)} onChange={(e) => setExtras({ ...extras, watermark: e.target.checked ? { text: "CONFIDENTIAL", opacity: 0.18 } : undefined })} />
          Add a watermark
        </label>
        {extras.watermark && (
          <div className="mt-2 flex flex-col gap-2 pl-6">
            <input className="input !h-9 text-sm" value={extras.watermark.text} onChange={(e) => setExtras({ ...extras, watermark: { ...extras.watermark!, text: e.target.value } })} aria-label="Watermark text" maxLength={60} />
            <label className="flex items-center gap-2 text-xs text-muted">
              Strength
              <input type="range" min={0.06} max={0.5} step={0.02} value={extras.watermark.opacity} onChange={(e) => setExtras({ ...extras, watermark: { ...extras.watermark!, opacity: Number(e.target.value) } })} className="flex-1" />
            </label>
          </div>
        )}
        <p className="mt-4 text-xs text-muted">Page numbers and the watermark are added when you save.</p>
      </aside>
    </div>
  );
}
