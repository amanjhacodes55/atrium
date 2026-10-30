"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, FileDown, Plus, X } from "lucide-react";
import { baseName, imagesToPdf, isImage, pdfBlob, type ImagePdfOptions } from "@/lib/pdf/core";
import { ACCEPT, DropZone, ErrorNote, Result, ToolPage, useJob, Working } from "./kit";

type Entry = { id: number; file: File; url: string };
let nextId = 0;

export function CreateTool() {
  const job = useJob();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [opts, setOpts] = useState<ImagePdfOptions>({ size: "a4", orientation: "auto", margin: 18 });
  const [result, setResult] = useState<Blob | null>(null);
  const [skipped, setSkipped] = useState("");
  const shown = useRef<Entry[]>([]);
  useEffect(() => {
    shown.current = entries;
  }, [entries]);
  useEffect(() => () => shown.current.forEach((e) => URL.revokeObjectURL(e.url)), []);

  const add = (files: File[]) => {
    const images = files.filter(isImage);
    setSkipped(images.length < files.length ? "Only images can go into a PDF here (JPG, PNG, WebP, GIF). The other files were left out." : "");
    setEntries((list) => [...list, ...images.map((file) => ({ id: nextId++, file, url: URL.createObjectURL(file) }))]);
  };

  const remove = (e: Entry) => {
    URL.revokeObjectURL(e.url);
    setEntries((list) => list.filter((x) => x.id !== e.id));
  };

  const move = (i: number, by: number) =>
    setEntries((list) => {
      const next = [...list];
      const [e] = next.splice(i, 1);
      next.splice(i + by, 0, e);
      return next;
    });

  if (result) return <ToolPage id="create"><Result blob={result} name={`${baseName(entries[0]?.file.name ?? "images")}.pdf`} onReset={() => (setResult(null), setEntries([]))} /></ToolPage>;

  return (
    <ToolPage id="create" wide={entries.length > 0}>
      {!entries.length ? (
        <DropZone accept={ACCEPT.image} multiple onFiles={add} label="Choose images" hint="Photos, scans or screenshots. Each image becomes a page." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
            {entries.map((e, i) => (
              <figure key={e.id} className="card relative p-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
                <img src={e.url} alt={e.file.name} className="mx-auto h-32 w-full rounded object-contain" />
                <figcaption className="mt-1 flex items-center justify-between gap-1 text-xs">
                  <button type="button" className="icon-btn !h-7 !w-7" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowLeft size={15} />
                  </button>
                  <span className="font-medium">{i + 1}</span>
                  <button type="button" className="icon-btn !h-7 !w-7" aria-label="Move later" disabled={i === entries.length - 1} onClick={() => move(i, 1)}>
                    <ArrowRight size={15} />
                  </button>
                </figcaption>
                <button type="button" className="icon-btn absolute right-1 top-1 !h-7 !w-7 bg-surface" aria-label={`Remove ${e.file.name}`} onClick={() => remove(e)}>
                  <X size={15} />
                </button>
              </figure>
            ))}
            <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line text-sm text-muted hover:border-accent">
              <Plus size={24} /> Add images
              <input type="file" hidden multiple accept={ACCEPT.image} onChange={(ev) => (add([...(ev.target.files ?? [])]), (ev.target.value = ""))} />
            </label>
          </div>
          <aside className="card h-fit p-4 lg:sticky lg:top-20">
            <h2 className="mb-3 text-sm font-semibold">Page settings</h2>
            <label className="mb-3 block text-sm">
              <span className="mb-1 block font-medium">Page size</span>
              <select className="input" value={opts.size} onChange={(e) => setOpts({ ...opts, size: e.target.value as ImagePdfOptions["size"] })}>
                <option value="a4">A4</option>
                <option value="letter">US Letter</option>
                <option value="fit">Same as the image</option>
              </select>
            </label>
            {opts.size !== "fit" && (
              <label className="mb-3 block text-sm">
                <span className="mb-1 block font-medium">Orientation</span>
                <select className="input" value={opts.orientation} onChange={(e) => setOpts({ ...opts, orientation: e.target.value as ImagePdfOptions["orientation"] })}>
                  <option value="auto">Match each image</option>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
            )}
            <label className="mb-4 block text-sm">
              <span className="mb-1 block font-medium">Margin</span>
              <select className="input" value={opts.margin} onChange={(e) => setOpts({ ...opts, margin: Number(e.target.value) })}>
                <option value={0}>None</option>
                <option value={18}>Small</option>
                <option value={40}>Large</option>
              </select>
            </label>
            {job.busy ? (
              <Working label={job.label} progress={0} />
            ) : (
              <button
                type="button"
                className="btn btn-primary w-full"
                onClick={() =>
                  void job.run("Making your PDF", async () => {
                    setResult(pdfBlob(await imagesToPdf(entries.map((e) => e.file), opts)));
                  })
                }
              >
                <FileDown size={16} /> Create PDF ({entries.length} page{entries.length === 1 ? "" : "s"})
              </button>
            )}
          </aside>
        </div>
      )}
      <ErrorNote text={job.error || skipped} />
    </ToolPage>
  );
}
