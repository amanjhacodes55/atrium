"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Copy, FileInput, FileOutput, FileText, ScanText } from "lucide-react";
import { downloadBlob, drive, safeFileName } from "@/lib/client";
import { baseName, isImage, isPdf, pdfBlob, readBytes } from "@/lib/pdf/core";
import { OCR_LANGUAGES } from "@/lib/pdf/ocr";
import type { DocBody } from "@/lib/types";
import { useItems } from "../files";
import { useToast } from "../ui";
import { ACCEPT, DropZone, ErrorNote, fileSize, Result, ToolPage, useDriveFile, useJob, Working } from "./kit";

function LanguagePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">Language of the text</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {OCR_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
        <option value="eng+hin">English + Hindi</option>
      </select>
    </label>
  );
}

function Chosen({ file, onClear }: { file: File; onClear: () => void }) {
  return (
    <div className="card mb-4 flex items-center gap-3 p-3">
      <FileText size={22} className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{file.name}</div>
        <div className="text-xs text-muted">{fileSize(file.size)}</div>
      </div>
      <button type="button" className="btn btn-sm" onClick={onClear}>
        Change
      </button>
    </div>
  );
}

// ---- OCR ----

export function OcrTool() {
  const job = useJob();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [lang, setLang] = useState("eng");
  const [result, setResult] = useState<{ pdf: Blob; text: string } | null>(null);
  useDriveFile(setFile);

  if (result && file)
    return (
      <ToolPage id="ocr">
        <Result blob={result.pdf} name={`${baseName(file.name)}-ocr.pdf`} onReset={() => (setResult(null), setFile(null))}>
          <button type="button" className="btn" onClick={() => downloadBlob(new Blob([result.text], { type: "text/plain" }), `${baseName(file.name)}.txt`)}>
            <FileText size={16} /> Text (.txt)
          </button>
        </Result>
        <div className="card mt-4 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recognised text</h2>
            <button type="button" className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(result.text).then(() => toast("Copied"))}>
              <Copy size={14} /> Copy
            </button>
          </div>
          <textarea className="input !h-80 w-full font-mono text-xs leading-relaxed" readOnly value={result.text || "No text was found."} />
        </div>
      </ToolPage>
    );

  return (
    <ToolPage id="ocr">
      {!file ? (
        <DropZone
          accept={`${ACCEPT.pdf},${ACCEPT.image}`}
          onFiles={([f]) => (isPdf(f) || isImage(f) ? setFile(f) : toast("Choose a PDF or an image.", "error"))}
          label="Choose a scanned PDF or a photo"
          hint="The text is read on this device and laid invisibly over each page."
        />
      ) : job.busy ? (
        <Working label={job.label} progress={job.progress} />
      ) : (
        <>
          <Chosen file={file} onClear={() => setFile(null)} />
          <div className="card p-4">
            <LanguagePicker value={lang} onChange={setLang} />
            <p className="mt-2 text-xs text-muted">The first time you use a language its data (a few MB) is downloaded, then kept for next time.</p>
            <button
              type="button"
              className="btn btn-primary mt-4 w-full"
              onClick={() =>
                void job.run("Getting the text recogniser ready", async () => {
                  const { searchablePdf, ocrText } = await import("@/lib/pdf/ocr");
                  const out = await searchablePdf(file, lang, job.setProgress);
                  setResult({ pdf: pdfBlob(out.pdf), text: ocrText(out.pages) });
                })
              }
            >
              <ScanText size={16} /> Recognise text
            </button>
          </div>
        </>
      )}
      <ErrorNote text={job.error} />
    </ToolPage>
  );
}

// ---- PDF to Word ----

export function PdfToWordTool() {
  const job = useJob();
  const router = useRouter();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [ocr, setOcr] = useState(true);
  const [lang, setLang] = useState("eng");
  const [result, setResult] = useState<{ docx: Blob; doc: DocBody } | null>(null);
  const [opening, setOpening] = useState(false);
  useDriveFile(setFile);

  if (result && file)
    return (
      <ToolPage id="pdf-to-word">
        <Result blob={result.docx} name={`${baseName(file.name)}.docx`} onReset={() => (setResult(null), setFile(null))}>
          <button
            type="button"
            className="btn"
            disabled={opening}
            onClick={async () => {
              setOpening(true);
              try {
                const item = await drive.create("doc", { name: baseName(file.name), body: result.doc });
                router.push(`/docs/${item.id}`);
              } catch (e) {
                toast((e as Error).message, "error");
                setOpening(false);
              }
            }}
          >
            <FileText size={16} /> {opening ? "Opening…" : "Open in Atrium Docs"}
          </button>
        </Result>
        <p className="mt-3 text-center text-xs text-muted">Headings, paragraphs, lists, bold and italic are kept. Check tables and multi-column layouts, which come out as plain text.</p>
      </ToolPage>
    );

  return (
    <ToolPage id="pdf-to-word">
      {!file ? (
        <DropZone accept={ACCEPT.pdf} onFiles={([f]) => (isPdf(f) ? setFile(f) : toast("Choose a PDF.", "error"))} label="Choose a PDF file" hint="or drop it here" />
      ) : job.busy ? (
        <Working label={job.label} progress={job.progress} />
      ) : (
        <>
          <Chosen file={file} onClear={() => setFile(null)} />
          <div className="card p-4">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={ocr} onChange={(e) => setOcr(e.target.checked)} />
              <span>
                <span className="font-medium">Read scanned pages with OCR</span>
                <span className="block text-xs text-muted">Pages that are only an image (a scan or photo) are read as text.</span>
              </span>
            </label>
            {ocr && (
              <div className="mt-3">
                <LanguagePicker value={lang} onChange={setLang} />
              </div>
            )}
            <button
              type="button"
              className="btn btn-primary mt-4 w-full"
              onClick={() =>
                void job.run("Reading the PDF", async () => {
                  const w = await import("@/lib/pdf/to-word");
                  const blocks = await w.pdfToBlocks(await readBytes(file), { ocr, lang }, job.setProgress);
                  setResult({ docx: await w.blocksToDocx(blocks), doc: w.blocksToDoc(blocks) });
                })
              }
            >
              <FileOutput size={16} /> Convert to Word
            </button>
          </div>
        </>
      )}
      <ErrorNote text={job.error} />
    </ToolPage>
  );
}

// ---- Word to PDF ----

export function WordToPdfTool() {
  const job = useJob();
  const toast = useToast();
  const { items } = useItems();
  const docs = useMemo(() => (items ?? []).filter((i) => i.kind === "doc" && !i.trashedAt).sort((a, b) => b.updatedAt - a.updatedAt), [items]);
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);

  const convert = (name: string, load: () => Promise<DocBody>) =>
    void job.run(`Converting ${name}`, async () => {
      const { docToPdf } = await import("@/lib/pdf/from-doc");
      const body = await load();
      setResult({ blob: pdfBlob(await docToPdf(body, name)), name: `${safeFileName(name)}.pdf` });
    });

  if (result) return <ToolPage id="word-to-pdf"><Result blob={result.blob} name={result.name} onReset={() => setResult(null)} /></ToolPage>;

  return (
    <ToolPage id="word-to-pdf">
      {job.busy ? (
        <Working label={job.label} progress={0} />
      ) : (
        <>
          <DropZone
            accept={ACCEPT.docx}
            onFiles={([f]) =>
              /\.docx$/i.test(f.name)
                ? convert(baseName(f.name), async () => (await import("@/lib/convert/docx")).importDocx(f))
                : toast("Choose a Word file (.docx). Older .doc files need saving as .docx first.", "error")
            }
            label="Choose a Word file"
            hint=".docx, or pick one of your Atrium documents below"
          />
          {docs.length > 0 && (
            <>
              <h2 className="mb-2 mt-6 text-sm font-medium text-ink-2">Your Atrium documents</h2>
              <ul className="card divide-y divide-line">
                {docs.slice(0, 12).map((d) => (
                  <li key={d.id}>
                    <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-hover" onClick={() => convert(d.name, async () => (await drive.body<DocBody>(d.id)).body)}>
                      <FileText size={18} className="shrink-0" style={{ color: "var(--app-doc)" }} />
                      <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
                      <FileInput size={16} className="text-muted" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <ErrorNote text={job.error} />
    </ToolPage>
  );
}
