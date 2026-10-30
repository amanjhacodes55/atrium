"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Check, Combine, Download, FileInput, FileOutput, HardDriveUpload, ImagePlus, PenLine, RotateCcw, ScanText, Scissors, Upload } from "lucide-react";
import { api, downloadBlob, drive } from "@/lib/client";
import type { Item } from "@/lib/types";
import type { PdfJsDoc } from "@/lib/pdf/core";
import { TopBar, useSession } from "../shell";
import { useToast } from "../ui";

export const PDF_TOOLS = [
  { id: "merge", name: "Merge PDF", blurb: "Combine several PDFs into one, in the order you choose.", Icon: Combine, color: "#e5322d" },
  { id: "split", name: "Split PDF", blurb: "Pull out page ranges, or save every page as its own PDF.", Icon: Scissors, color: "#f59e0b" },
  { id: "edit", name: "Edit PDF", blurb: "Add text, images, boxes and drawings. Rotate, reorder and delete pages.", Icon: PenLine, color: "#7c3aed" },
  { id: "create", name: "Create PDF", blurb: "Turn photos, scans and images into a PDF.", Icon: ImagePlus, color: "#0ea5e9" },
  { id: "ocr", name: "OCR PDF", blurb: "Make scans and photos searchable, and copy their text.", Icon: ScanText, color: "#16a34a" },
  { id: "pdf-to-word", name: "PDF to Word", blurb: "Turn a PDF into a Word file or an Atrium document you can edit.", Icon: FileOutput, color: "#2563eb" },
  { id: "word-to-pdf", name: "Word to PDF", blurb: "Turn Word files and Atrium documents into PDFs.", Icon: FileInput, color: "#1d4ed8" },
] as const;

export type ToolId = (typeof PDF_TOOLS)[number]["id"];
export const toolOf = (id: string) => PDF_TOOLS.find((t) => t.id === id);

export const ACCEPT = {
  pdf: "application/pdf,.pdf",
  image: "image/*",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx",
};

export function ToolTile({ id, size = 40 }: { id: ToolId; size?: number }) {
  const t = toolOf(id)!;
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-[28%] text-white" style={{ width: size, height: size, background: t.color }}>
      <t.Icon size={size * 0.55} strokeWidth={2} />
    </span>
  );
}

/** Page frame for one tool: the PDF top bar, a way back to every tool, and the tool's name. */
export function ToolPage({ id, children, wide }: { id: ToolId; children: ReactNode; wide?: boolean }) {
  const t = toolOf(id)!;
  useEffect(() => {
    document.title = `${t.name} · Atrium PDF`;
  }, [t.name]);
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar title="PDF" color="var(--app-pdf)" />
      <main className={`mx-auto w-full flex-1 px-4 py-6 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>
        <Link href="/pdf" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft size={15} /> All PDF tools
        </Link>
        <div className="mb-6 flex items-center gap-3">
          <ToolTile id={id} size={44} />
          <div>
            <h1 className="text-xl font-semibold">{t.name}</h1>
            <p className="text-sm text-muted">{t.blurb}</p>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}

/** Drop files here or tap to choose them. */
export function DropZone({ accept, multiple, onFiles, label, hint }: { accept: string; multiple?: boolean; onFiles: (files: File[]) => void; label: string; hint?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...e.dataTransfer.files];
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${over ? "border-accent bg-accent-wash" : "border-line bg-surface hover:border-accent"}`}
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white">
        <Upload size={26} />
      </span>
      <div className="text-base font-semibold">{label}</div>
      <div className="text-sm text-muted">{hint ?? "or drop them here"}</div>
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}

/**
 * Starts a tool on a PDF from Drive: Drive's "Edit PDF" (and the Android app) link to a tool with
 * `?item=<id>`. Runs once, after the page has loaded.
 */
export function useDriveFile(onFile: (file: File) => void) {
  const toast = useToast();
  const done = useRef(false);
  const handler = useRef(onFile);
  useEffect(() => {
    handler.current = onFile;
  });
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("item");
    if (!id || done.current) return;
    done.current = true;
    void (async () => {
      const { item } = await api<{ item: Item }>(`/api/items/${encodeURIComponent(id)}`);
      const res = await fetch(`/api/items/${encodeURIComponent(id)}/file`);
      if (!res.ok) throw new Error("That file couldn't be opened.");
      handler.current(new File([await res.blob()], item.name, { type: item.mime || "application/pdf" }));
    })().catch((e: Error) => toast(e.message, "error"));
  }, [toast]);
}

/** Runs one long job at a time and reports its progress and errors. */
export function useJob() {
  const [state, setState] = useState<{ busy: boolean; progress: number; label: string; error: string }>({ busy: false, progress: 0, label: "", error: "" });
  const progress = useCallback((progress: number, label: string) => setState((s) => ({ ...s, progress, label })), []);
  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setState({ busy: true, progress: 0, label, error: "" });
    try {
      const out = await fn();
      setState({ busy: false, progress: 1, label: "", error: "" });
      return out;
    } catch (e) {
      console.error(e);
      setState({ busy: false, progress: 0, label: "", error: (e as Error).message || "Something went wrong." });
      return undefined;
    }
  }, []);
  return { ...state, run, setProgress: progress };
}

export function Working({ label, progress }: { label: string; progress: number }) {
  return (
    <div className="card p-6 text-center" role="status">
      <div className="mb-3 text-sm font-medium">{label || "Working"}…</div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full bg-accent transition-all ${progress ? "" : "w-1/3 animate-pulse"}`} style={progress ? { width: `${Math.round(progress * 100)}%` } : undefined} />
      </div>
      <p className="mt-3 text-xs text-muted">Your files are processed on this device. Nothing is uploaded.</p>
    </div>
  );
}

export function ErrorNote({ text }: { text: string }) {
  return text ? <p className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{text}</p> : null;
}

/** The finished file: download it, keep it in Drive, or start again. */
export function Result({ blob, name, onReset, children }: { blob: Blob; name: string; onReset: () => void; children?: ReactNode }) {
  const toast = useToast();
  const { user, refresh } = useSession();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  return (
    <div className="card p-6 text-center">
      <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-600 text-white">
        <Check size={26} />
      </span>
      <h2 className="text-lg font-semibold">Done</h2>
      <p className="mt-1 break-all text-sm text-muted">
        {name} · {(blob.size / 1024 / 1024).toFixed(blob.size < 1048576 ? 2 : 1)} MB
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button type="button" className="btn btn-primary" onClick={() => downloadBlob(blob, name)}>
          <Download size={16} /> Download
        </button>
        {user && (
          <button
            type="button"
            className="btn"
            disabled={saved || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await drive.upload(new File([blob], name, { type: blob.type }), null);
                setSaved(true);
                refresh();
                toast(`Saved ${name} to Drive`);
              } catch (e) {
                toast((e as Error).message, "error");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saved ? <Check size={16} /> : <HardDriveUpload size={16} />} {saved ? "Saved to Drive" : "Save to Drive"}
          </button>
        )}
        {children}
        <button type="button" className="btn btn-ghost" onClick={onReset}>
          <RotateCcw size={16} /> Start over
        </button>
      </div>
    </div>
  );
}

/**
 * A page of an open PDF, drawn into a canvas at the given CSS width once it scrolls near the screen.
 * `aspect` (height / width) holds its space until then.
 */
export function PageCanvas({ doc, index, width, rotation, aspect, className }: { doc: PdfJsDoc; index: number; width: number; rotation?: number; aspect?: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!near) return;
    let live = true;
    void import("@/lib/pdf/core").then(({ renderPage }) =>
      renderPage(doc, index, { width, rotation }).then((canvas) => {
        if (!live || !box.current) return;
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        canvas.style.display = "block";
        box.current.replaceChildren(canvas);
      }),
    );
    return () => {
      live = false;
    };
  }, [near, doc, index, width, rotation]);
  return <div ref={box} className={`bg-white ${className ?? ""}`} style={{ width, minHeight: aspect ? width * aspect : undefined }} />;
}

export const fileSize = (n: number) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
