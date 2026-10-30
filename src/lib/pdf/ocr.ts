"use client";

import { color, encodable, isPdf, loadPdf, openPdf, readBytes, renderPage } from "./core";
import { toPage } from "./edit";

// Text recognition with Tesseract, compiled to WebAssembly and run in a worker. Its code and the
// language data download from jsDelivr the first time, then the browser caches them.

export const OCR_LANGUAGES = [
  { code: "eng", name: "English" },
  { code: "hin", name: "Hindi" },
  { code: "spa", name: "Spanish" },
  { code: "fra", name: "French" },
  { code: "deu", name: "German" },
  { code: "por", name: "Portuguese" },
  { code: "ita", name: "Italian" },
  { code: "ben", name: "Bengali" },
  { code: "tam", name: "Tamil" },
  { code: "tel", name: "Telugu" },
  { code: "mar", name: "Marathi" },
  { code: "guj", name: "Gujarati" },
  { code: "urd", name: "Urdu" },
  { code: "ara", name: "Arabic" },
  { code: "rus", name: "Russian" },
  { code: "chi_sim", name: "Chinese (Simplified)" },
  { code: "jpn", name: "Japanese" },
  { code: "kor", name: "Korean" },
] as const;

export type OcrWord = { text: string; x0: number; y0: number; x1: number; y1: number };
export type OcrLine = { words: OcrWord[]; text: string };
/** One recognised page. Coordinates are in points on the page as shown (top-left origin). */
export type OcrPage = { width: number; height: number; text: string; paragraphs: OcrLine[][] };

export type Progress = (done: number, label: string) => void;

type TesseractWorker = import("tesseract.js").Worker;

async function createWorker(lang: string, progress?: Progress, step?: { at: number; of: number }) {
  const { createWorker } = await import("tesseract.js");
  return createWorker(lang, 1, {
    logger: (m) => {
      if (!progress || !step) return;
      if (m.status === "recognizing text") progress((step.at + m.progress) / step.of, `Reading page ${step.at + 1} of ${step.of}`);
      else if (/load|initializ/i.test(m.status)) progress(step.at / step.of, "Getting the text recogniser ready");
    },
  });
}

/** Pixels per point for OCR: about 200 dpi, which Tesseract reads well, without huge canvases on phones. */
const ocrScale = (width: number) => Math.min(200 / 72, 2400 / width);

async function recognize(worker: TesseractWorker, image: HTMLCanvasElement, scale: number): Promise<OcrPage> {
  const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
  const paragraphs: OcrLine[][] = [];
  for (const block of data.blocks ?? [])
    for (const para of block.paragraphs) {
      const lines = para.lines
        .map((line) => {
          const words = line.words
            .filter((w) => w.text.trim() && w.confidence > 20)
            .map((w) => ({ text: w.text, x0: w.bbox.x0 / scale, y0: w.bbox.y0 / scale, x1: w.bbox.x1 / scale, y1: w.bbox.y1 / scale }));
          return { words, text: words.map((w) => w.text).join(" ") };
        })
        .filter((l) => l.words.length);
      if (lines.length) paragraphs.push(lines);
    }
  return { width: image.width / scale, height: image.height / scale, text: data.text, paragraphs };
}

async function imageCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(`${file.name} isn't an image that can be read.`);
  });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}

/**
 * Recognises the text on chosen pages of a PDF (all of them by default). Pages not in `only` come
 * back as null, which lets PDF to Word read just its scanned pages.
 */
export async function ocrPdf(bytes: Uint8Array, lang: string, progress?: Progress, only?: number[]): Promise<(OcrPage | null)[]> {
  const doc = await openPdf(bytes);
  const pages = only ?? Array.from({ length: doc.numPages }, (_, i) => i);
  const step = { at: 0, of: pages.length };
  const worker = await createWorker(lang, progress, step);
  const out: (OcrPage | null)[] = Array(doc.numPages).fill(null);
  try {
    for (const [n, index] of pages.entries()) {
      step.at = n;
      progress?.(n / pages.length, `Reading page ${n + 1} of ${pages.length}`);
      const page = await doc.getPage(index + 1);
      const width = page.getViewport({ scale: 1 }).width;
      const scale = ocrScale(width);
      out[index] = await recognize(worker, await renderPage(doc, index, { scale }), scale);
    }
  } finally {
    await worker.terminate();
    void doc.destroy();
  }
  return out;
}

export async function ocrImages(files: File[], lang: string, progress?: Progress): Promise<{ pages: OcrPage[]; canvases: HTMLCanvasElement[] }> {
  const step = { at: 0, of: files.length };
  const worker = await createWorker(lang, progress, step);
  const pages: OcrPage[] = [];
  const canvases: HTMLCanvasElement[] = [];
  try {
    for (const [n, file] of files.entries()) {
      step.at = n;
      const canvas = await imageCanvas(file);
      canvases.push(canvas);
      // Photos are measured at 96 dpi, like Images to PDF.
      pages.push(await recognize(worker, canvas, 1 / 0.75));
    }
  } finally {
    await worker.terminate();
  }
  return { pages, canvases };
}

/**
 * Lays the recognised words over the page as invisible text, so the PDF looks the same but can be
 * searched, selected and copied. Words in scripts the standard PDF fonts can't hold are left out of
 * that layer; the .txt and Word downloads keep them.
 */
async function addTextLayer(doc: import("pdf-lib").PDFDocument, font: import("pdf-lib").PDFFont, pageIndex: number, ocr: OcrPage) {
  const { degrees } = await import("pdf-lib");
  const page = doc.getPage(pageIndex);
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const box = page.getCropBox();
  const view = { w: ocr.width, h: ocr.height };
  const ink = await color("#000000");
  for (const para of ocr.paragraphs)
    for (const line of para)
      for (const w of line.words) {
        const text = encodable(font, w.text);
        if (!text.replace(/\?/g, "")) continue;
        const height = w.y1 - w.y0;
        const unit = font.widthOfTextAtSize(text, 1) || 1;
        const size = Math.max(1, Math.min(height * 1.15, (w.x1 - w.x0) / unit));
        page.drawText(text, { ...toPage(w.x0, w.y1 - height * 0.15, view, box, r), size, font, color: ink, opacity: 0, rotate: degrees(r) });
      }
}

export async function searchablePdf(file: File, lang: string, progress?: Progress): Promise<{ pdf: Uint8Array; pages: OcrPage[] }> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  if (isPdf(file)) {
    const bytes = await readBytes(file);
    const pages = (await ocrPdf(bytes, lang, progress)) as OcrPage[];
    progress?.(1, "Adding the text layer");
    const doc = await loadPdf(bytes);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const [i, p] of pages.entries()) await addTextLayer(doc, font, i, p);
    return { pdf: await doc.save(), pages };
  }
  const { pages, canvases } = await ocrImages([file], lang, progress);
  progress?.(1, "Adding the text layer");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [i, canvas] of canvases.entries()) {
    const jpg = await doc.embedJpg(await readBytes(await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.9))));
    doc.addPage([pages[i].width, pages[i].height]).drawImage(jpg, { x: 0, y: 0, width: pages[i].width, height: pages[i].height });
    await addTextLayer(doc, font, i, pages[i]);
  }
  return { pdf: await doc.save(), pages };
}

/** Plain text of recognised pages, a blank line between paragraphs and a rule between pages. */
export const ocrText = (pages: OcrPage[]) =>
  pages.map((p) => p.paragraphs.map((para) => para.map((l) => l.text).join("\n")).join("\n\n")).join("\n\n──────────\n\n");
