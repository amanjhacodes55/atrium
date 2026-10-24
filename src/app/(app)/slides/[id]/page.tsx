"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  Circle,
  Copy,
  FileUp,
  ImagePlus,
  Italic,
  Palette,
  Play,
  Plus,
  Redo2,
  Square,
  Trash2,
  Type,
  Underline,
  Undo2,
} from "lucide-react";
import { downloadIcon, EditorHeader, useAutosave } from "@/components/editor-shell";
import { Slideshow } from "@/components/slides/present";
import { ElementView, elementStyle, H, SlideView, THEMES, themeOf, W, type Theme } from "@/components/slides/render";
import { fitCentered, HANDLES, resizeBox, snapMove, type Box, type Guides, type Handle } from "@/components/slides/geometry";
import { Dropdown, Spinner, useDismiss, useToast } from "@/components/ui";
import { downloadBlob, drive, imageToDataUrl, pickFile, safeFileName } from "@/lib/client";
import type { Item, Slide, SlideEl, SlidesBody } from "@/lib/types";

const uid = () => Math.random().toString(36).slice(2, 10);
const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60, 72, 96];

type Layout = "title" | "content" | "section" | "blank";

function makeSlide(layout: Layout, theme: Theme): Slide {
  const id = uid();
  const text = (x: number, y: number, w: number, h: number, t: string, size: number, extra: Partial<SlideEl> = {}): SlideEl => ({
    id: uid(),
    type: "text",
    x,
    y,
    w,
    h,
    text: t,
    size,
    color: theme.text,
    ...extra,
  });
  const els: SlideEl[] =
    layout === "title"
      ? [
          text(80, 170, 800, 110, "Click to add title", 48, { bold: true, align: "center", color: theme.title }),
          text(160, 300, 640, 60, "Click to add subtitle", 24, { align: "center" }),
        ]
      : layout === "content"
        ? [text(60, 40, 840, 80, "Title", 36, { bold: true, color: theme.title }), text(60, 140, 840, 360, "•  First point\n•  Second point\n•  Third point", 24)]
        : layout === "section"
          ? [
              { id: uid(), type: "rect", x: 80, y: 230, w: 10, h: 90, fill: theme.accent },
              text(110, 225, 760, 100, "Section title", 54, { bold: true, color: theme.title }),
            ]
          : [];
  return { id, bg: theme.bg, els, notes: "" };
}

/** Repaints a slide for a new theme: backgrounds and text colours that matched the old theme. */
function retheme(slide: Slide, from: Theme, to: Theme): Slide {
  const map = (c: string | undefined) => (c === from.title ? to.title : c === from.text ? to.text : c === from.accent ? to.accent : c);
  return {
    ...slide,
    bg: slide.bg === from.bg ? to.bg : slide.bg,
    els: slide.els.map((e) => (e.type === "text" ? { ...e, color: map(e.color) } : { ...e, fill: e.fill === from.accent ? to.accent : e.fill })),
  };
}

type Drag =
  | { kind: "move"; id: string; px: number; py: number; orig: Box; others: Box[]; moved: boolean }
  | { kind: "resize"; id: string; handle: Handle; px: number; py: number; orig: Box; moved: boolean };

export default function SlidesEditor() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [item, setItem] = useState<Item | null>(null);
  const [body, setBodyState] = useState<SlidesBody | null>(null);
  const [error, setError] = useState("");
  const [cur, setCur] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [guides, setGuides] = useState<Guides>({ x: null, y: null });
  const [scale, setScale] = useState(0.6);
  const [presenting, setPresenting] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // The body lives in a ref (read by event handlers) and in state (for rendering).
  const bodyRef = useRef<SlidesBody | null>(null);
  const past = useRef<SlidesBody[]>([]);
  const future = useRef<SlidesBody[]>([]);
  const drag = useRef<Drag | null>(null);
  const clipboard = useRef<SlideEl | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const dragSlide = useRef<number | null>(null);
  const { state: save, changed } = useAutosave(id, setItem);

  useEffect(() => {
    drive
      .body<SlidesBody>(id)
      .then(({ item, body }) => {
        if (!body.slides.length) body.slides.push(makeSlide("title", themeOf(body.theme)));
        bodyRef.current = body;
        setItem(item);
        setBodyState(body);
      })
      .catch((e) => setError((e as Error).message));
  }, [id]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setScale(Math.max(0.2, Math.min((width - 48) / W, (height - 48) / H)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [body === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const snapshot = useCallback(() => {
    if (!bodyRef.current) return;
    past.current.push(bodyRef.current);
    if (past.current.length > 100) past.current.shift();
    future.current = [];
  }, []);

  /** Applies an edit. `history: false` is for live drags, which snapshot once when they start. */
  const apply = useCallback(
    (fn: (b: SlidesBody) => SlidesBody, history = true) => {
      const prev = bodyRef.current;
      if (!prev) return;
      const next = fn(prev);
      if (next === prev) return;
      if (history) snapshot();
      bodyRef.current = next;
      setBodyState(next);
      changed(next);
    },
    [changed, snapshot],
  );

  const curRef = useRef(cur);
  useEffect(() => {
    curRef.current = cur;
  }, [cur]);

  const editSlide = useCallback(
    (fn: (s: Slide) => Slide, history = true) =>
      apply((b) => ({ ...b, slides: b.slides.map((s, i) => (i === curRef.current ? fn(s) : s)) }), history),
    [apply],
  );
  const editEl = useCallback(
    (elId: string, patch: Partial<SlideEl>, history = true) => editSlide((s) => ({ ...s, els: s.els.map((e) => (e.id === elId ? { ...e, ...patch } : e)) }), history),
    [editSlide],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev || !bodyRef.current) return;
    future.current.push(bodyRef.current);
    bodyRef.current = prev;
    setBodyState(prev);
    changed(prev);
    setCur((c) => Math.min(c, prev.slides.length - 1));
  }, [changed]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next || !bodyRef.current) return;
    past.current.push(bodyRef.current);
    bodyRef.current = next;
    setBodyState(next);
    changed(next);
    setCur((c) => Math.min(c, next.slides.length - 1));
  }, [changed]);

  const theme = themeOf(body?.theme ?? "light");
  const slide = body?.slides[cur];
  const selected = slide?.els.find((e) => e.id === sel) ?? null;

  // ---- Slides ----

  const addSlide = (layout: Layout, at = cur + 1) => {
    const s = makeSlide(layout, theme);
    apply((b) => ({ ...b, slides: [...b.slides.slice(0, at), s, ...b.slides.slice(at)] }));
    setCur(at);
    setSel(null);
  };
  const duplicateSlide = (index: number) => {
    apply((b) => {
      const src = b.slides[index];
      const copy: Slide = { ...structuredClone(src), id: uid(), els: src.els.map((e) => ({ ...e, id: uid() })) };
      return { ...b, slides: [...b.slides.slice(0, index + 1), copy, ...b.slides.slice(index + 1)] };
    });
    setCur(index + 1);
  };
  const deleteSlide = (index: number) => {
    if (!bodyRef.current) return;
    if (bodyRef.current.slides.length === 1) {
      apply((b) => ({ ...b, slides: [makeSlide("blank", theme)] }));
    } else {
      apply((b) => ({ ...b, slides: b.slides.filter((_, i) => i !== index) }));
      setCur((c) => Math.max(0, c >= index ? c - 1 : c));
    }
    setSel(null);
  };
  const moveSlide = (from: number, to: number) => {
    if (from === to) return;
    apply((b) => {
      const slides = [...b.slides];
      const [s] = slides.splice(from, 1);
      slides.splice(to, 0, s);
      return { ...b, slides };
    });
    setCur(to);
  };

  // ---- Elements ----

  const addEl = (el: Omit<SlideEl, "id">) => {
    const full = { ...el, id: uid() } as SlideEl;
    editSlide((s) => ({ ...s, els: [...s.els, full] }));
    setSel(full.id);
    return full;
  };
  const addText = () => {
    const el = addEl({ type: "text", x: 280, y: 230, w: 400, h: 70, text: "Text", size: 28, color: theme.text });
    setEditing(el.id);
  };
  const addShape = (type: "rect" | "ellipse") => addEl({ type, x: 380, y: 170, w: 200, h: 200, fill: theme.accent });
  const addImageFile = async (file: File) => {
    try {
      const src = await imageToDataUrl(file);
      const img = new Image();
      img.src = src;
      await img.decode();
      addEl({ type: "image", ...fitCentered(img.naturalWidth, img.naturalHeight, 600, 400, { w: W, h: H }), src });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const addImage = async () => {
    const file = await pickFile("image/*");
    if (file) await addImageFile(file);
  };
  const removeSel = useCallback(() => {
    if (!sel) return;
    editSlide((s) => ({ ...s, els: s.els.filter((e) => e.id !== sel) }));
    setSel(null);
  }, [sel, editSlide]);
  const duplicateEl = useCallback(
    (el: SlideEl) => {
      const copy = { ...el, id: uid(), x: el.x + 20, y: el.y + 20 };
      editSlide((s) => ({ ...s, els: [...s.els, copy] }));
      setSel(copy.id);
    },
    [editSlide],
  );
  const reorder = (dir: 1 | -1) => {
    if (!sel) return;
    editSlide((s) => {
      const i = s.els.findIndex((e) => e.id === sel);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.els.length) return s;
      const els = [...s.els];
      [els[i], els[j]] = [els[j], els[i]];
      return { ...s, els };
    });
  };

  // ---- Pointer: move and resize ----

  const startDrag = (e: ReactPointerEvent, d: Drag) => {
    e.stopPropagation();
    e.preventDefault();
    drag.current = d;
    const onMove = (ev: PointerEvent) => {
      const g = drag.current;
      if (!g) return;
      const dx = (ev.clientX - g.px) / scale;
      const dy = (ev.clientY - g.py) / scale;
      if (!g.moved) {
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
        g.moved = true;
        snapshot();
      }
      if (g.kind === "move") {
        const raw = { ...g.orig, x: g.orig.x + dx, y: g.orig.y + dy };
        const snapped = ev.altKey ? { x: Math.round(raw.x), y: Math.round(raw.y), guides: { x: null, y: null } } : snapMove(raw, g.others, { w: W, h: H });
        setGuides(snapped.guides);
        editEl(g.id, { x: snapped.x, y: snapped.y }, false);
      } else {
        editEl(g.id, resizeBox(g.orig, g.handle, dx, dy, ev.shiftKey), false);
      }
    };
    const onUp = () => {
      drag.current = null;
      setGuides({ x: null, y: null });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onElDown = (e: ReactPointerEvent, el: SlideEl) => {
    if (editing === el.id || e.button !== 0) return;
    setEditing(null);
    setSel(el.id);
    const box = { x: el.x, y: el.y, w: el.w, h: el.h };
    const others = slide!.els.filter((o) => o.id !== el.id).map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }));
    startDrag(e, { kind: "move", id: el.id, px: e.clientX, py: e.clientY, orig: box, others, moved: false });
  };

  // ---- Keyboard and clipboard ----

  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const onKey = (e: KeyboardEvent) => {
      if (presenting !== null || typing(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "d" && selected) {
        e.preventDefault();
        duplicateEl(selected);
      } else if (mod && e.key.toLowerCase() === "c" && selected) {
        clipboard.current = structuredClone(selected);
      } else if (mod && e.key.toLowerCase() === "x" && selected) {
        clipboard.current = structuredClone(selected);
        removeSel();
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel) {
        e.preventDefault();
        removeSel();
      } else if (e.key === "Escape") {
        setSel(null);
      } else if (e.key === "Enter" && selected?.type === "text") {
        e.preventDefault();
        setEditing(selected.id);
      } else if (e.key.startsWith("Arrow") && selected) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        editEl(selected.id, { x: selected.x + dx, y: selected.y + dy });
      } else if (!selected && (e.key === "PageDown" || e.key === "ArrowDown")) {
        setCur((c) => Math.min((bodyRef.current?.slides.length ?? 1) - 1, c + 1));
      } else if (!selected && (e.key === "PageUp" || e.key === "ArrowUp")) {
        setCur((c) => Math.max(0, c - 1));
      } else if (e.key === "F5") {
        e.preventDefault();
        setPresenting(e.shiftKey ? curRef.current : 0);
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (presenting !== null || typing(e.target)) return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        void addImageFile(file);
      } else if (clipboard.current) {
        e.preventDefault();
        const copy = { ...clipboard.current, id: uid(), x: clipboard.current.x + 20, y: clipboard.current.y + 20 };
        clipboard.current = copy;
        editSlide((s) => ({ ...s, els: [...s.els, copy] }));
        setSel(copy.id);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("paste", onPaste);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, sel, presenting, undo, redo, removeSel, duplicateEl, editEl, editSlide]);

  const closeMenu = useCallback(() => setMenu(null), []);
  const menuRef = useDismiss(menu !== null, closeMenu);

  if (error) return <p className="p-10 text-center text-danger">{error}</p>;
  if (!item || !body || !slide) return <Spinner label="Opening presentation" />;

  const download = async () => {
    try {
      downloadBlob(await exportPptxLazy(body, item.name), `${safeFileName(item.name)}.pptx`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const importDeck = async () => {
    const file = await pickFile(".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation");
    if (!file) return;
    try {
      const { importPptx } = await import("@/lib/convert/pptx");
      const imported = await importPptx(file);
      apply((b) => ({ ...b, slides: [...b.slides, ...imported.slides] }));
      setCur(bodyRef.current!.slides.length - imported.slides.length);
      toast(`Added ${imported.slides.length} slide${imported.slides.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast((e as Error).message || "That file could not be read.", "error");
    }
  };
  const setTheme = (to: Theme) =>
    apply((b) => {
      const from = themeOf(b.theme);
      return { ...b, theme: to.id, slides: b.slides.map((s) => retheme(s, from, to)) };
    });

  const isText = selected?.type === "text";
  const hasFill = selected && selected.type !== "image";

  return (
    <div className="slides-root flex h-screen flex-col overflow-hidden">
      <EditorHeader
        kind="slides"
        item={item}
        setItem={setItem}
        save={save}
        fileMenu={[
          { label: "Download PowerPoint (.pptx)", icon: downloadIcon, onClick: download },
          { label: "Download PDF", icon: downloadIcon, onClick: () => window.print() },
          { label: "Import slides from .pptx", icon: <FileUp size={16} />, onClick: importDeck },
        ]}
        right={
          <button type="button" className="btn btn-sm" onClick={() => setPresenting(cur)} title="Present (F5 from start)">
            <Play size={14} style={{ color: "var(--app-slides)" }} /> Present
          </button>
        }
      />

      <div className="toolbar no-print">
        <Dropdown
          label="New slide"
          className="icon-btn !w-auto gap-1 px-2 text-sm"
          trigger={
            <>
              <Plus size={16} /> Slide
            </>
          }
          items={[
            { label: "Title slide", onClick: () => addSlide("title") },
            { label: "Title and content", onClick: () => addSlide("content") },
            { label: "Section header", onClick: () => addSlide("section") },
            { label: "Blank", onClick: () => addSlide("blank") },
          ]}
        />
        <button type="button" className="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={undo}>
          <Undo2 size={17} />
        </button>
        <button type="button" className="icon-btn" title="Redo (Ctrl+Y)" aria-label="Redo" onClick={redo}>
          <Redo2 size={17} />
        </button>
        <span className="sep" />
        <button type="button" className="icon-btn" title="Text box" aria-label="Text box" onClick={addText}>
          <Type size={17} />
        </button>
        <button type="button" className="icon-btn" title="Rectangle" aria-label="Rectangle" onClick={() => addShape("rect")}>
          <Square size={17} />
        </button>
        <button type="button" className="icon-btn" title="Ellipse" aria-label="Ellipse" onClick={() => addShape("ellipse")}>
          <Circle size={17} />
        </button>
        <button type="button" className="icon-btn" title="Image" aria-label="Image" onClick={addImage}>
          <ImagePlus size={17} />
        </button>
        <span className="sep" />
        {isText && selected && (
          <>
            <select aria-label="Font" value={selected.font ?? "sans"} onChange={(e) => editEl(selected.id, { font: e.target.value as SlideEl["font"] })}>
              <option value="sans">Sans</option>
              <option value="serif">Serif</option>
              <option value="mono">Mono</option>
            </select>
            <select aria-label="Font size" value={selected.size ?? 24} onChange={(e) => editEl(selected.id, { size: Number(e.target.value) })}>
              {[...new Set([...SIZES, selected.size ?? 24])].sort((a, b) => a - b).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button type="button" className="icon-btn" aria-label="Bold" data-on={Boolean(selected.bold)} onClick={() => editEl(selected.id, { bold: !selected.bold })}>
              <Bold size={16} />
            </button>
            <button type="button" className="icon-btn" aria-label="Italic" data-on={Boolean(selected.italic)} onClick={() => editEl(selected.id, { italic: !selected.italic })}>
              <Italic size={16} />
            </button>
            <button type="button" className="icon-btn" aria-label="Underline" data-on={Boolean(selected.underline)} onClick={() => editEl(selected.id, { underline: !selected.underline })}>
              <Underline size={16} />
            </button>
            {(["left", "center", "right"] as const).map((a) => {
              const Icon = a === "left" ? AlignLeft : a === "center" ? AlignCenter : AlignRight;
              return (
                <button key={a} type="button" className="icon-btn" aria-label={`Align ${a}`} data-on={(selected.align ?? "left") === a} onClick={() => editEl(selected.id, { align: a })}>
                  <Icon size={16} />
                </button>
              );
            })}
            <ColorButton label="Text colour" letter="A" value={selected.color ?? "#1f2937"} onChange={(c) => editEl(selected.id, { color: c })} />
          </>
        )}
        {hasFill && selected && (
          <ColorButton
            label={isText ? "Highlight" : "Fill"}
            icon={<Palette size={15} />}
            value={selected.fill ?? (isText ? "#ffffff" : "#cbd5e1")}
            onChange={(c) => editEl(selected.id, { fill: c })}
            onClear={isText ? () => editEl(selected.id, { fill: undefined }) : undefined}
          />
        )}
        {selected && (
          <>
            <button type="button" className="icon-btn" title="Bring forward" aria-label="Bring forward" onClick={() => reorder(1)}>
              <ArrowUpToLine size={16} />
            </button>
            <button type="button" className="icon-btn" title="Send backward" aria-label="Send backward" onClick={() => reorder(-1)}>
              <ArrowDownToLine size={16} />
            </button>
            <button type="button" className="icon-btn" title="Duplicate (Ctrl+D)" aria-label="Duplicate" onClick={() => duplicateEl(selected)}>
              <Copy size={16} />
            </button>
            <button type="button" className="icon-btn" title="Delete" aria-label="Delete element" onClick={removeSel}>
              <Trash2 size={16} />
            </button>
            <span className="sep" />
          </>
        )}
        {!selected && (
          <>
            <ColorButton label="Background" text="Background" value={slide.bg} onChange={(c) => editSlide((s) => ({ ...s, bg: c }))} />
            <Dropdown
              label="Theme"
              className="icon-btn !w-auto gap-1 px-2 text-sm"
              trigger={
                <>
                  <span className="h-3.5 w-3.5 rounded-sm ring-1 ring-black/20" style={{ background: theme.bg }} /> Theme
                </>
              }
              items={THEMES.map((t) => ({
                label: t.name,
                hint: t.id === theme.id ? "current" : undefined,
                icon: <span className="h-4 w-4 rounded ring-1 ring-black/20" style={{ background: `linear-gradient(135deg, ${t.bg} 55%, ${t.accent} 55%)` }} />,
                onClick: () => setTheme(t),
              }))}
            />
          </>
        )}
      </div>

      <div className="no-print flex min-h-0 flex-1">
        {/* Slide sorter */}
        <aside className="w-52 shrink-0 overflow-y-auto border-r border-line bg-surface p-3" aria-label="Slides">
          <ol className="flex flex-col gap-3">
            {body.slides.map((s, i) => (
              <li
                key={s.id}
                draggable
                onDragStart={() => (dragSlide.current = i)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(i);
                }}
                onDragLeave={() => setDragOver((d) => (d === i ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragSlide.current !== null) moveSlide(dragSlide.current, i);
                  dragSlide.current = null;
                  setDragOver(null);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCur(i);
                  setMenu({ x: e.clientX, y: e.clientY, index: i });
                }}
                className="flex gap-2"
              >
                <span className="w-4 pt-1 text-right text-xs tabular-nums text-muted">{i + 1}</span>
                <button
                  type="button"
                  aria-label={`Slide ${i + 1}`}
                  aria-current={i === cur}
                  onClick={() => {
                    setCur(i);
                    setSel(null);
                    setEditing(null);
                  }}
                  className={`overflow-hidden rounded-md ring-2 transition ${i === cur ? "ring-[var(--app-slides)]" : "ring-line hover:ring-ink-2/40"} ${dragOver === i ? "translate-y-1" : ""}`}
                >
                  <SlideView slide={s} scale={0.16} />
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn-sm mt-3 w-full" onClick={() => addSlide("content", body.slides.length)}>
            <Plus size={14} /> New slide
          </button>
        </aside>

        {/* Canvas */}
        <main className="flex min-w-0 flex-1 flex-col bg-plane">
          <div
            ref={stage}
            className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) {
                setSel(null);
                setEditing(null);
              }
            }}
          >
            <div className="relative shadow-lg ring-1 ring-black/10" style={{ width: W * scale, height: H * scale, background: slide.bg }}>
              <div
                className="absolute left-0 top-0"
                style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: "0 0" }}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) {
                    setSel(null);
                    setEditing(null);
                  }
                }}
              >
                {slide.els.map((el) =>
                  editing === el.id && el.type === "text" ? (
                    <TextEditor
                      key={el.id}
                      el={el}
                      onStart={snapshot}
                      onChange={(patch) => editEl(el.id, patch, false)}
                      onDone={() => setEditing(null)}
                    />
                  ) : (
                    <div
                      key={el.id}
                      onPointerDown={(e) => onElDown(e, el)}
                      onDoubleClick={() => el.type === "text" && setEditing(el.id)}
                      className="group absolute cursor-move"
                      style={{ left: el.x, top: el.y, width: el.w, height: el.h }}
                    >
                      <ElementView el={{ ...el, x: 0, y: 0 }} />
                      {sel !== el.id && <div className="pointer-events-none absolute inset-0 outline-dashed outline-1 outline-transparent group-hover:outline-sky-400" />}
                    </div>
                  ),
                )}
                {selected && (
                  <div className="pointer-events-none absolute" style={{ left: selected.x, top: selected.y, width: selected.w, height: selected.h, outline: `${2 / scale}px solid #0ea5e9` }}>
                    {editing !== selected.id &&
                      HANDLES.map((h) => (
                        <span
                          key={h}
                          onPointerDown={(e) =>
                            startDrag(e, { kind: "resize", id: selected.id, handle: h, px: e.clientX, py: e.clientY, orig: { x: selected.x, y: selected.y, w: selected.w, h: selected.h }, moved: false })
                          }
                          className="pointer-events-auto absolute rounded-full border-sky-500 bg-white"
                          style={{
                            width: 10 / scale,
                            height: 10 / scale,
                            borderWidth: 1.5 / scale,
                            left: h.includes("w") ? 0 : h.includes("e") ? "100%" : "50%",
                            top: h.includes("n") ? 0 : h.includes("s") ? "100%" : "50%",
                            transform: "translate(-50%, -50%)",
                            cursor: `${h}-resize`,
                          }}
                        />
                      ))}
                  </div>
                )}
                {guides.x !== null && <div className="pointer-events-none absolute top-0 h-full bg-pink-500" style={{ left: guides.x, width: 1 / scale }} />}
                {guides.y !== null && <div className="pointer-events-none absolute left-0 w-full bg-pink-500" style={{ top: guides.y, height: 1 / scale }} />}
              </div>
            </div>
          </div>
          <div className="border-t border-line bg-surface">
            <textarea
              aria-label="Speaker notes"
              placeholder="Click to add speaker notes"
              value={slide.notes}
              onFocus={snapshot}
              onChange={(e) => editSlide((s) => ({ ...s, notes: e.target.value }), false)}
              className="block h-24 w-full resize-none bg-transparent px-5 py-3 text-sm text-ink outline-none placeholder:text-muted"
            />
          </div>
        </main>
      </div>

      {menu && (
        <div ref={menuRef} className="menu fixed" style={{ left: menu.x, top: menu.y }}>
          <MenuButton label="New slide after" onClick={() => addSlide("content", menu.index + 1)} close={closeMenu} />
          <MenuButton label="Duplicate slide" onClick={() => duplicateSlide(menu.index)} close={closeMenu} />
          <MenuButton label="Move up" onClick={() => moveSlide(menu.index, Math.max(0, menu.index - 1))} close={closeMenu} />
          <MenuButton label="Move down" onClick={() => moveSlide(menu.index, Math.min(body.slides.length - 1, menu.index + 1))} close={closeMenu} />
          <MenuButton label="Present from here" onClick={() => setPresenting(menu.index)} close={closeMenu} />
          <MenuButton label="Delete slide" danger onClick={() => deleteSlide(menu.index)} close={closeMenu} />
        </div>
      )}

      {/* Print / PDF: one slide per landscape page. */}
      <div className="slides-print">
        {body.slides.map((s) => (
          <div key={s.id} className="slides-print-page">
            <SlideView slide={s} />
          </div>
        ))}
      </div>
      <style>{`
        .slides-print { display: none; }
        @media print {
          @page { size: ${W}px ${H}px; margin: 0; }
          .slides-root { height: auto !important; overflow: visible !important; display: block !important; }
          .slides-print { display: block; }
          .slides-print-page { width: ${W}px; height: ${H}px; overflow: hidden; break-after: page; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      {presenting !== null && <Slideshow slides={body.slides} start={presenting} onClose={() => setPresenting(null)} />}
    </div>
  );
}

const exportPptxLazy = async (body: SlidesBody, name: string) => (await import("@/lib/convert/pptx")).exportPptx(body, name);

function MenuButton({ label, onClick, close, danger }: { label: string; onClick: () => void; close: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      className="menu-item"
      style={danger ? { color: "var(--danger)" } : undefined}
      onClick={() => {
        close();
        onClick();
      }}
    >
      {label}
    </button>
  );
}

/** In-place text editing: a textarea styled exactly like the text box, growing as you type. */
function TextEditor({ el, onStart, onChange, onDone }: { el: SlideEl; onStart: () => void; onChange: (patch: Partial<SlideEl>) => void; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    onStart();
    const ta = ref.current;
    if (ta) {
      ta.focus();
      ta.select();
    }
    // Only when editing starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <textarea
      ref={ref}
      aria-label="Edit text"
      value={el.text ?? ""}
      onChange={(e) => {
        const ta = e.target;
        const patch: Partial<SlideEl> = { text: ta.value };
        if (ta.scrollHeight > el.h) patch.h = ta.scrollHeight;
        onChange(patch);
      }}
      onBlur={onDone}
      onKeyDown={(e) => {
        if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
        e.stopPropagation();
      }}
      style={{ ...elementStyle(el), resize: "none", border: "none", outline: "2px solid #0ea5e9", background: el.fill ?? "transparent", overflow: "hidden" }}
    />
  );
}

function ColorButton({
  label,
  value,
  onChange,
  onClear,
  letter,
  icon,
  text,
}: {
  label: string;
  value: string;
  onChange: (c: string) => void;
  onClear?: () => void;
  letter?: string;
  icon?: React.ReactNode;
  text?: string;
}) {
  return (
    <span className="flex items-center">
      <label className={`icon-btn relative cursor-pointer ${text ? "!w-auto gap-1.5 px-2 text-sm" : ""}`} title={label}>
        <span className="flex flex-col items-center leading-none">
          {letter ? <span className="text-[13px] font-semibold">{letter}</span> : icon}
          {!text && <span className="mt-0.5 h-1 w-4 rounded-sm" style={{ background: value }} />}
        </span>
        {text && (
          <>
            <span className="h-3.5 w-3.5 rounded-sm ring-1 ring-black/20" style={{ background: value }} />
            {text}
          </>
        )}
        <input type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
      {onClear && (
        <button type="button" className="px-1 text-xs text-muted hover:text-ink" onClick={onClear} title={`Clear ${label.toLowerCase()}`}>
          ×
        </button>
      )}
    </span>
  );
}
