"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronUp, FileDown, ImagePlus, Maximize2, Minus, Plus, Settings2, Trash2, X } from "lucide-react";
import { baseName, imagesToPdf, isImage, PAGE_SIZES, pdfBlob, type ImagePdfOptions } from "@/lib/pdf/core";
import { TopBar } from "../shell";
import { ACCEPT, DropZone, ErrorNote, fileSize, Result, ToolPage, useJob, Working } from "./kit";

type Entry = { id: number; file: File; url: string; w: number; h: number };
let nextId = 0;

/** 100% zoom is actual size: one PDF point is 1/72 inch, one CSS pixel 1/96. */
const PX_PER_PT = 96 / 72;
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3];

/**
 * Where an image lands on its page, in points: the same arithmetic as imagesToPdf, so the preview is
 * exactly what the saved PDF will be.
 */
function layout(e: Entry, opts: ImagePdfOptions) {
  if (opts.size === "fit") {
    const iw = e.w * 0.75;
    const ih = e.h * 0.75;
    return { pw: iw + opts.margin * 2, ph: ih + opts.margin * 2, x: opts.margin, y: opts.margin, iw, ih };
  }
  let [pw, ph]: number[] = [...PAGE_SIZES[opts.size]];
  const landscape = opts.orientation === "landscape" || (opts.orientation === "auto" && e.w > e.h);
  if (landscape) [pw, ph] = [ph, pw];
  const scale = Math.min((pw - opts.margin * 2) / e.w, (ph - opts.margin * 2) / e.h);
  const iw = e.w * scale;
  const ih = e.h * scale;
  return { pw, ph, x: (pw - iw) / 2, y: (ph - ih) / 2, iw, ih };
}

const loadSize = (url: string) =>
  new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = url;
  });

export function CreateTool() {
  const job = useJob();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [opts, setOpts] = useState<ImagePdfOptions>({ size: "a4", orientation: "auto", margin: 18 });
  const [name, setName] = useState("");
  const [result, setResult] = useState<Blob | null>(null);
  const [skipped, setSkipped] = useState("");
  const shown = useRef<Entry[]>([]);
  useEffect(() => {
    shown.current = entries;
  }, [entries]);
  useEffect(() => () => shown.current.forEach((e) => URL.revokeObjectURL(e.url)), []);

  const add = async (files: File[]) => {
    const images = files.filter(isImage);
    setSkipped(images.length < files.length ? "Only images can go into a PDF here (JPG, PNG, WebP, GIF). The other files were left out." : "");
    const added = await Promise.all(
      images.map(async (file) => {
        const url = URL.createObjectURL(file);
        return { id: nextId++, file, url, ...(await loadSize(url)) };
      }),
    );
    if (added.length) setName((n) => n || baseName(added[0].file.name));
    setEntries((list) => [...list, ...added]);
  };

  const reset = () => {
    entries.forEach((e) => URL.revokeObjectURL(e.url));
    setEntries([]);
    setResult(null);
    setName("");
  };

  if (result) {
    return (
      <ToolPage id="create">
        <Result blob={result} name={`${name.trim() || "images"}.pdf`} onReset={reset} />
      </ToolPage>
    );
  }

  if (!entries.length) {
    return (
      <ToolPage id="create">
        <DropZone accept={ACCEPT.image} multiple onFiles={(f) => void add(f)} label="Choose images" hint="Photos, scans or screenshots. Each image becomes a page." />
        <ErrorNote text={skipped} />
      </ToolPage>
    );
  }

  return (
    <Workspace
      entries={entries}
      setEntries={setEntries}
      opts={opts}
      setOpts={setOpts}
      name={name}
      setName={setName}
      onAdd={(f) => void add(f)}
      error={job.error || skipped}
      busy={job.busy}
      busyLabel={job.label}
      onCreate={() =>
        void job.run("Making your PDF", async () => {
          setResult(pdfBlob(await imagesToPdf(entries.map((e) => e.file), opts)));
        })
      }
    />
  );
}

type WorkspaceProps = {
  entries: Entry[];
  setEntries: (f: (list: Entry[]) => Entry[]) => void;
  opts: ImagePdfOptions;
  setOpts: (o: ImagePdfOptions) => void;
  name: string;
  setName: (n: string) => void;
  onAdd: (files: File[]) => void;
  onCreate: () => void;
  error: string;
  busy: boolean;
  busyLabel: string;
};

/** The document view, as in Acrobat: page thumbnails, the pages on a grey canvas, and page setup. */
function Workspace({ entries, setEntries, opts, setOpts, name, setName, onAdd, onCreate, error, busy, busyLabel }: WorkspaceProps) {
  const canvas = useRef<HTMLDivElement>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [fitScale, setFitScale] = useState(0.75);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [setup, showSetup] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropping, setDropping] = useState(false);

  const pages = entries.map((e) => ({ e, ...layout(e, opts) }));
  const widest = Math.max(...pages.map((p) => p.pw));
  const scale = zoom === "fit" ? fitScale : zoom;

  // "Fit width": the widest page fills the canvas, less a gutter.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const measure = () => setFitScale(Math.min(2, Math.max(0.2, (el.clientWidth - 48) / (widest * PX_PER_PT))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [widest]);

  // The page counter follows whichever page fills most of the view.
  useEffect(() => {
    const root = canvas.current;
    if (!root) return;
    const seen = new Map<Element, number>();
    const io = new IntersectionObserver(
      (records) => {
        records.forEach((r) => seen.set(r.target, r.intersectionRatio));
        let best = -1;
        let at = 0;
        entries.forEach((e, i) => {
          const el = pageEls.current.get(e.id);
          const ratio = el ? (seen.get(el) ?? 0) : 0;
          if (ratio > best) [best, at] = [ratio, i];
        });
        setCurrent(at);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    pageEls.current.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [entries, scale]);

  const goTo = useCallback(
    (i: number) => {
      const e = entries[Math.max(0, Math.min(entries.length - 1, i))];
      if (!e) return;
      setSelected(e.id);
      pageEls.current.get(e.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [entries],
  );

  const remove = useCallback(
    (id: number) =>
      setEntries((list) => {
        const e = list.find((x) => x.id === id);
        if (e) URL.revokeObjectURL(e.url);
        return list.filter((x) => x.id !== id);
      }),
    [setEntries],
  );

  const move = (from: number, to: number) =>
    setEntries((list) => {
      if (to < 0 || to >= list.length || from === to) return list;
      const next = [...list];
      const [e] = next.splice(from, 1);
      next.splice(to, 0, e);
      return next;
    });

  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOMS.find((z) => z > scale + 0.001) : [...ZOOMS].reverse().find((z) => z < scale - 0.001);
    if (next) setZoom(next);
  };

  // Keyboard, as in a PDF viewer: arrows page, Delete removes the selected page, Ctrl +/- zooms.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement).closest("input, select, textarea")) return;
      if (ev.key === "ArrowDown" || ev.key === "PageDown") {
        ev.preventDefault();
        goTo(current + 1);
      } else if (ev.key === "ArrowUp" || ev.key === "PageUp") {
        ev.preventDefault();
        goTo(current - 1);
      } else if ((ev.key === "Delete" || ev.key === "Backspace") && selected !== null) {
        remove(selected);
      } else if ((ev.ctrlKey || ev.metaKey) && (ev.key === "=" || ev.key === "+" || ev.key === "-")) {
        ev.preventDefault();
        step(ev.key === "-" ? -1 : 1);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const onDropFiles = (ev: DragEvent) => {
    setDropping(false);
    if (!ev.dataTransfer.files.length) return;
    ev.preventDefault();
    onAdd([...ev.dataTransfer.files]);
  };

  const addButton = (className: string) => (
    <label className={className}>
      <ImagePlus size={16} /> <span>Add images</span>
      <input type="file" hidden multiple accept={ACCEPT.image} onChange={(ev) => (onAdd([...(ev.target.files ?? [])]), (ev.target.value = ""))} />
    </label>
  );

  const createButton = (
    <button type="button" className="btn btn-pdf mt-4 w-full" onClick={onCreate}>
      <FileDown size={16} /> Create PDF ({entries.length} page{entries.length === 1 ? "" : "s"})
    </button>
  );

  return (
    <div className="relative flex h-dvh flex-col bg-[var(--pdf-canvas)]">
      <TopBar title="PDF" color="var(--app-pdf)" />

      {/* The document toolbar */}
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-surface px-2 sm:gap-2 sm:px-3">
        <Link href="/pdf" className="icon-btn" aria-label="All PDF tools" title="All PDF tools">
          <ArrowLeft size={18} />
        </Link>
        <input
          className="field-sizing-content min-w-16 max-w-32 truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-semibold hover:border-line focus:border-accent focus:outline-none sm:max-w-56"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Untitled"
          aria-label="File name"
          id="pdf-name"
        />
        <span className="-ml-1 hidden text-sm text-muted sm:inline">.pdf</span>

        <div className="mx-auto flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5 text-sm">
          <button type="button" className="icon-btn !h-7 !w-7" onClick={() => goTo(current - 1)} disabled={current === 0} aria-label="Previous page">
            <ChevronUp size={16} />
          </button>
          <span className="min-w-12 text-center tabular-nums" aria-live="polite" id="pdf-page-count">
            {current + 1} / {entries.length}
          </span>
          <button type="button" className="icon-btn !h-7 !w-7" onClick={() => goTo(current + 1)} disabled={current === entries.length - 1} aria-label="Next page">
            <ChevronDown size={16} />
          </button>
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
          <button type="button" className="icon-btn hidden !h-7 !w-7 sm:grid" onClick={() => step(-1)} aria-label="Zoom out">
            <Minus size={15} />
          </button>
          <button type="button" className="hidden min-w-12 rounded px-1 text-center tabular-nums hover:bg-hover sm:block" onClick={() => setZoom(1)} title="Actual size">
            {Math.round(scale * 100)}%
          </button>
          <button type="button" className="icon-btn hidden !h-7 !w-7 sm:grid" onClick={() => step(1)} aria-label="Zoom in">
            <Plus size={15} />
          </button>
          <button type="button" className={`icon-btn hidden !h-7 !w-7 sm:grid ${zoom === "fit" ? "text-[var(--app-pdf)]" : ""}`} onClick={() => setZoom("fit")} aria-label="Fit width" title="Fit width">
            <Maximize2 size={14} />
          </button>
        </div>

        <button type="button" className="icon-btn lg:hidden" onClick={() => showSetup(!setup)} aria-label="Page setup" aria-expanded={setup}>
          <Settings2 size={18} />
        </button>
        {addButton("btn hidden cursor-pointer md:inline-flex")}
        <button type="button" className="btn btn-pdf" onClick={onCreate} disabled={busy} id="create-pdf">
          <FileDown size={16} /> <span className="hidden sm:inline">Create PDF</span>
          <span className="sm:hidden">Save</span>
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* Page thumbnails: drag to reorder */}
        <aside className="hidden w-44 shrink-0 flex-col border-r border-line bg-surface md:flex">
          <div className="flex items-center justify-between px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">
            Pages <span className="font-normal normal-case">{entries.length}</span>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4 pt-2">
            {pages.map(({ e, pw, ph, x, y, iw, ih }, i) => (
              <div
                key={e.id}
                draggable
                onDragStart={(ev) => {
                  setDragging(i);
                  ev.dataTransfer.effectAllowed = "move";
                  ev.dataTransfer.setData("text/plain", String(i));
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(ev) => dragging !== null && ev.preventDefault()}
                onDrop={(ev) => {
                  if (dragging === null) return;
                  ev.preventDefault();
                  move(dragging, i);
                  setDragging(null);
                }}
                className={`cursor-grab text-center ${dragging === i ? "opacity-40" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  className={`relative mx-auto block overflow-hidden bg-white shadow-sm ring-2 transition ${current === i ? "ring-[var(--app-pdf)]" : "ring-transparent hover:ring-line"}`}
                  style={{ width: 112, height: (112 * ph) / pw }}
                  aria-label={`Go to page ${i + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
                  <img src={e.url} alt="" draggable={false} className="absolute" style={{ left: `${(x / pw) * 100}%`, top: `${(y / ph) * 100}%`, width: `${(iw / pw) * 100}%`, height: `${(ih / ph) * 100}%` }} />
                </button>
                <span className={`mt-1 inline-block rounded px-1.5 text-xs ${current === i ? "bg-[var(--app-pdf)] text-white" : "text-muted"}`}>{i + 1}</span>
              </div>
            ))}
            {addButton("flex cursor-pointer flex-col items-center gap-1 rounded-md border-2 border-dashed border-line py-4 text-xs text-muted hover:border-[var(--app-pdf)] hover:text-ink")}
          </div>
        </aside>

        {/* The pages, as they will print */}
        <div
          ref={canvas}
          className={`min-w-0 flex-1 overflow-auto ${dropping ? "outline-dashed outline-2 -outline-offset-4 outline-[var(--app-pdf)]" : ""}`}
          onClick={(ev) => ev.target === ev.currentTarget && setSelected(null)}
          onDragOver={(ev) => {
            if (dragging === null && ev.dataTransfer.types.includes("Files")) {
              ev.preventDefault();
              setDropping(true);
            }
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={onDropFiles}
          id="pdf-canvas"
        >
          <div className="flex min-w-fit flex-col items-center gap-6 px-6 pb-28 pt-6 md:pb-6">
            {pages.map(({ e, pw, ph, x, y, iw, ih }, i) => {
              const k = scale * PX_PER_PT;
              return (
                <div key={e.id} className="pdf-page-in" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                  <div
                    ref={(el) => {
                      if (el) pageEls.current.set(e.id, el);
                      else pageEls.current.delete(e.id);
                    }}
                    data-page={i + 1}
                    onClick={() => setSelected(e.id)}
                    className={`group relative scroll-mt-6 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.25)] outline-2 outline-offset-4 ${selected === e.id ? "outline outline-[var(--app-pdf)]" : "outline-none"}`}
                    style={{ width: pw * k, height: ph * k }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
                    <img src={e.url} alt={e.file.name} draggable={false} className="absolute select-none" style={{ left: x * k, top: y * k, width: iw * k, height: ih * k }} />
                    <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
                      <button type="button" className="page-tool" onClick={(ev) => (ev.stopPropagation(), move(i, i - 1))} disabled={i === 0} aria-label={`Move page ${i + 1} up`}>
                        <ChevronUp size={15} />
                      </button>
                      <button type="button" className="page-tool" onClick={(ev) => (ev.stopPropagation(), move(i, i + 1))} disabled={i === entries.length - 1} aria-label={`Move page ${i + 1} down`}>
                        <ChevronDown size={15} />
                      </button>
                      <button type="button" className="page-tool hover:!bg-[var(--app-pdf)]" onClick={(ev) => (ev.stopPropagation(), remove(e.id))} aria-label={`Remove page ${i + 1}`}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 text-center text-xs text-[var(--pdf-canvas-ink)]">
                    Page {i + 1} · {Math.round((pw / 72) * 25.4)} × {Math.round((ph / 72) * 25.4)} mm
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Page setup: a side pane on wide screens, a sheet over the canvas on narrow ones */}
        <aside
          className={`absolute inset-x-0 bottom-0 z-20 max-h-[75%] overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-4 shadow-2xl transition-transform duration-300 lg:static lg:z-auto lg:max-h-none lg:w-72 lg:shrink-0 lg:translate-y-0 lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-none ${setup ? "translate-y-0" : "translate-y-full"}`}
          aria-label="Page setup"
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Page setup</h2>
            <button type="button" className="icon-btn !h-7 !w-7 lg:hidden" onClick={() => showSetup(false)} aria-label="Close page setup">
              <X size={16} />
            </button>
          </div>
          <Segmented
            label="Page size"
            value={opts.size}
            options={[
              ["a4", "A4"],
              ["letter", "Letter"],
              ["fit", "Image"],
            ]}
            onChange={(size) => setOpts({ ...opts, size })}
          />
          {opts.size !== "fit" && (
            <Segmented
              label="Orientation"
              value={opts.orientation}
              options={[
                ["auto", "Auto"],
                ["portrait", "Portrait"],
                ["landscape", "Landscape"],
              ]}
              onChange={(orientation) => setOpts({ ...opts, orientation })}
            />
          )}
          <Segmented
            label="Margin"
            value={String(opts.margin)}
            options={[
              ["0", "None"],
              ["18", "Small"],
              ["40", "Large"],
            ]}
            onChange={(m) => setOpts({ ...opts, margin: Number(m) })}
          />
          <p className="text-xs text-muted">The preview is exactly what the PDF will be. Drag the thumbnails, or use the arrows on each page, to reorder.</p>
          <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Pages</span>
              <span className="font-medium">{entries.length}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted">Images</span>
              <span className="font-medium">{fileSize(entries.reduce((s, e) => s + e.file.size, 0))}</span>
            </div>
          </div>
          {busy ? (
            <div className="mt-4">
              <Working label={busyLabel} progress={0} />
            </div>
          ) : (
            createButton
          )}
          <ErrorNote text={error} />
        </aside>

        {/* Thumbnails on phones: a strip along the bottom */}
        <div className={`absolute inset-x-0 bottom-0 z-10 flex gap-2 overflow-x-auto border-t border-line bg-surface/95 p-2 backdrop-blur md:hidden ${setup ? "invisible" : ""}`}>
          {pages.map(({ e, pw, ph }, i) => (
            <button
              key={e.id}
              type="button"
              onClick={() => goTo(i)}
              className={`relative shrink-0 overflow-hidden bg-white ring-2 ${current === i ? "ring-[var(--app-pdf)]" : "ring-line"}`}
              style={{ height: 64, width: (64 * pw) / ph }}
              aria-label={`Go to page ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
              <img src={e.url} alt="" className="h-full w-full object-contain" />
              <span className="absolute bottom-0 right-0 bg-black/60 px-1 text-[10px] text-white">{i + 1}</span>
            </button>
          ))}
          {addButton("flex h-16 w-12 shrink-0 cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed border-line text-muted [&>span]:hidden")}
        </div>
      </div>

      {busy && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/30 p-6 lg:hidden">
          <div className="w-full max-w-sm">
            <Working label={busyLabel} progress={0} />
          </div>
        </div>
      )}
      {error && !setup && (
        <div className="absolute bottom-24 left-1/2 z-30 w-[min(90vw,32rem)] -translate-x-1/2 lg:hidden">
          <ErrorNote text={error} />
        </div>
      )}
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-xs font-medium text-ink-2">{label}</div>
      <div className="grid rounded-lg border border-line bg-surface-2 p-0.5" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }} role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={`rounded-md py-1.5 text-sm transition ${value === v ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink-2"}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
