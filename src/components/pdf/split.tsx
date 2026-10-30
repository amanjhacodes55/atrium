"use client";

import { useEffect, useMemo, useState } from "react";
import { Scissors } from "lucide-react";
import { baseName, extractPages, isPdf, openPdf, parseRanges, pdfBlob, readBytes, zipFiles, type PdfJsDoc } from "@/lib/pdf/core";
import { ACCEPT, DropZone, ErrorNote, PageCanvas, Result, ToolPage, useDriveFile, useJob, Working } from "./kit";

type Mode = "ranges" | "each" | "select";

export function SplitTool() {
  const job = useJob();
  const [src, setSrc] = useState<{ file: File; bytes: Uint8Array; doc: PdfJsDoc } | null>(null);
  const [mode, setMode] = useState<Mode>("ranges");
  const [ranges, setRanges] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [merge, setMerge] = useState(false);
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);

  useEffect(() => () => void src?.doc.destroy(), [src]);

  const open = (files: File[]) =>
    void job.run("Opening", async () => {
      const file = files[0];
      if (!isPdf(file)) throw new Error(`${file.name} isn't a PDF.`);
      const bytes = await readBytes(file);
      const doc = await openPdf(bytes);
      setSrc({ file, bytes, doc });
      setRanges(doc.numPages > 1 ? `1-${Math.ceil(doc.numPages / 2)}, ${Math.ceil(doc.numPages / 2) + 1}-${doc.numPages}` : "1");
    });

  useDriveFile((f) => open([f]));

  const groups = useMemo(() => {
    if (!src) return { list: [] as number[][], error: "" };
    const n = src.doc.numPages;
    try {
      if (mode === "each") return { list: Array.from({ length: n }, (_, i) => [i]), error: "" };
      if (mode === "select") {
        const pages = [...picked].sort((a, b) => a - b);
        return { list: merge ? [pages] : pages.map((p) => [p]), error: pages.length ? "" : "Tap the pages you want to keep." };
      }
      const list = parseRanges(ranges, n);
      return { list: merge ? [list.flat()] : list, error: "" };
    } catch (e) {
      return { list: [], error: (e as Error).message };
    }
  }, [src, mode, ranges, picked, merge]);

  if (result) return <ToolPage id="split"><Result blob={result.blob} name={result.name} onReset={() => (setResult(null), setSrc(null), setPicked(new Set()))} /></ToolPage>;

  return (
    <ToolPage id="split" wide={Boolean(src)}>
      {!src ? (
        job.busy ? <Working label={job.label} progress={0} /> : <DropZone accept={ACCEPT.pdf} onFiles={open} label="Choose a PDF file" hint="or drop it here" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div>
            <p className="mb-3 truncate text-sm text-muted">
              {src.file.name} · {src.doc.numPages} pages
            </p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-3">
              {Array.from({ length: src.doc.numPages }, (_, i) => {
                const group = groups.list.findIndex((g) => g.includes(i));
                const on = mode === "select" ? picked.has(i) : group >= 0;
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={mode !== "select"}
                    onClick={() => setPicked((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set([...s, i])))}
                    className={`relative rounded-lg border-2 bg-surface p-1.5 text-center transition ${on ? "border-accent" : "border-transparent opacity-60"}`}
                    aria-pressed={mode === "select" ? on : undefined}
                  >
                    <PageCanvas doc={src.doc} index={i} width={92} className="mx-auto overflow-hidden rounded border border-line" />
                    <span className="mt-1 block text-xs font-medium">{i + 1}</span>
                    {group >= 0 && mode !== "select" && groups.list.length > 1 && (
                      <span className="absolute left-1 top-1 rounded bg-accent px-1.5 text-[10px] font-semibold text-white">File {group + 1}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <aside className="card h-fit p-4 lg:sticky lg:top-20">
            <h2 className="mb-3 text-sm font-semibold">How to split</h2>
            <div className="flex flex-col gap-2 text-sm">
              {(
                [
                  ["ranges", "Page ranges"],
                  ["select", "Pick pages"],
                  ["each", "Every page as its own PDF"],
                ] as const
              ).map(([m, label]) => (
                <label key={m} className="flex items-center gap-2">
                  <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} /> {label}
                </label>
              ))}
            </div>
            {mode === "ranges" && (
              <label className="mt-4 block text-sm">
                <span className="mb-1 block font-medium">Ranges</span>
                <input className="input" value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="1-3, 5, 8-" inputMode="numeric" />
                <span className="mt-1 block text-xs text-muted">Each range makes a PDF. “8-” runs to the end.</span>
              </label>
            )}
            {mode !== "each" && (
              <label className="mt-4 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} /> Put them all in one PDF
              </label>
            )}
            {groups.error && <p className="mt-3 text-sm text-danger">{groups.error}</p>}
            <button
              type="button"
              className="btn btn-primary mt-4 w-full"
              disabled={!groups.list.length || job.busy}
              onClick={() =>
                void job.run("Splitting", async () => {
                  const name = baseName(src.file.name);
                  const parts = await extractPages(src.bytes, groups.list);
                  const label = (g: number[]) => (g.length === 1 ? `${g[0] + 1}` : `${g[0] + 1}-${g.at(-1)! + 1}`);
                  if (parts.length === 1) setResult({ blob: pdfBlob(parts[0]), name: `${name}-pages-${label(groups.list[0])}.pdf` });
                  else setResult({ blob: await zipFiles(parts.map((bytes, i) => ({ name: `${name}-${label(groups.list[i])}.pdf`, bytes }))), name: `${name}-split.zip` });
                })
              }
            >
              <Scissors size={16} /> {job.busy ? "Splitting…" : groups.list.length > 1 ? `Split into ${groups.list.length} PDFs` : "Split PDF"}
            </button>
            {groups.list.length > 1 && <p className="mt-2 text-center text-xs text-muted">Several PDFs download together as a .zip.</p>}
          </aside>
        </div>
      )}
      <ErrorNote text={job.error} />
    </ToolPage>
  );
}
