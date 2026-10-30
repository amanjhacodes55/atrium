"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Combine, Plus, X } from "lucide-react";
import { baseName, isPdf, mergePdfs, openPdf, pdfBlob, readBytes, type PdfJsDoc } from "@/lib/pdf/core";
import { ACCEPT, DropZone, ErrorNote, fileSize, PageCanvas, Result, ToolPage, useDriveFile, useJob, Working } from "./kit";

type Entry = { id: number; file: File; bytes: Uint8Array; doc: PdfJsDoc };
let nextId = 0;

export function MergeTool() {
  const job = useJob();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [result, setResult] = useState<Blob | null>(null);

  // Release every opened PDF when leaving the page.
  const open = useRef<Entry[]>([]);
  useEffect(() => {
    open.current = entries;
  }, [entries]);
  useEffect(() => () => open.current.forEach((e) => void e.doc.destroy()), []);

  const add = (files: File[]) =>
    void job.run("Opening your files", async () => {
      const added: Entry[] = [];
      for (const file of files) {
        if (!isPdf(file)) throw new Error(`${file.name} isn't a PDF.`);
        const bytes = await readBytes(file);
        added.push({ id: nextId++, file, bytes, doc: await openPdf(bytes) });
      }
      setEntries((list) => [...list, ...added]);
    });

  useDriveFile((f) => add([f]));

  const move = (i: number, by: number) =>
    setEntries((list) => {
      const next = [...list];
      const [e] = next.splice(i, 1);
      next.splice(i + by, 0, e);
      return next;
    });

  if (result) return <ToolPage id="merge"><Result blob={result} name={`${baseName(entries[0]?.file.name ?? "merged")}-merged.pdf`} onReset={() => (setResult(null), setEntries([]))} /></ToolPage>;

  return (
    <ToolPage id="merge">
      {job.busy && !entries.length ? (
        <Working label={job.label} progress={job.progress} />
      ) : !entries.length ? (
        <DropZone accept={ACCEPT.pdf} multiple onFiles={add} label="Choose PDF files" />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">The PDFs are joined from top to bottom. Use the arrows to change the order.</p>
          <ol className="flex flex-col gap-2">
            {entries.map((e, i) => (
              <li key={e.id} className="card flex items-center gap-3 p-2.5">
                <span className="w-5 text-center text-sm font-semibold text-muted">{i + 1}</span>
                <PageCanvas doc={e.doc} index={0} width={44} className="overflow-hidden rounded border border-line" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{e.file.name}</div>
                  <div className="text-xs text-muted">
                    {e.doc.numPages} page{e.doc.numPages === 1 ? "" : "s"} · {fileSize(e.file.size)}
                  </div>
                </div>
                <button type="button" className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp size={17} />
                </button>
                <button type="button" className="icon-btn" aria-label="Move down" disabled={i === entries.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown size={17} />
                </button>
                <button type="button" className="icon-btn" aria-label={`Remove ${e.file.name}`} onClick={() => setEntries((list) => list.filter((x) => x.id !== e.id))}>
                  <X size={17} />
                </button>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <label className="btn cursor-pointer">
              <Plus size={16} /> Add more PDFs
              <input type="file" hidden multiple accept={ACCEPT.pdf} onChange={(ev) => (add([...(ev.target.files ?? [])]), (ev.target.value = ""))} />
            </label>
            <button
              type="button"
              className="btn btn-primary ml-auto"
              disabled={entries.length < 2 || job.busy}
              onClick={() =>
                void job.run("Merging", async () => {
                  setResult(pdfBlob(await mergePdfs(entries.map((e) => e.bytes))));
                })
              }
            >
              <Combine size={16} /> {job.busy ? "Merging…" : `Merge ${entries.length} PDFs`}
            </button>
          </div>
          {entries.length < 2 && <p className="mt-2 text-xs text-muted">Add at least two PDFs to merge.</p>}
        </>
      )}
      <ErrorNote text={job.error} />
    </ToolPage>
  );
}
