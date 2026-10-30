"use client";

import type { PDFDocument, PDFFont } from "pdf-lib";

// The PDF tools all run in the browser: pdf-lib writes PDFs, pdf.js reads and draws them. Both are
// imported on demand so they stay out of every other page's bundle.

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
export type PdfJsDoc = import("pdfjs-dist/legacy/build/pdf.mjs").PDFDocumentProxy;

let pdfjsLoad: Promise<PdfJs> | null = null;

/** pdf.js with its worker started. The legacy build also runs in older Android WebViews. */
export function pdfjs(): Promise<PdfJs> {
  return (pdfjsLoad ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
    m.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    return m;
  }));
}

export const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
export const isImage = (f: File) => f.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp)$/i.test(f.name);
export const baseName = (name: string) => name.replace(/\.[a-z0-9]{1,5}$/i, "") || "document";

/** Opens a PDF for reading and drawing. pdf.js takes ownership of the buffer, so it gets a copy. */
export async function openPdf(bytes: Uint8Array): Promise<PdfJsDoc> {
  const m = await pdfjs();
  try {
    return await m.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  } catch (e) {
    if ((e as Error).name === "PasswordException") throw new Error("This PDF is password-protected. Remove the password first.");
    throw new Error("That file isn't a PDF that can be read.");
  }
}

/** Opens a PDF for writing with pdf-lib, with a readable error for locked or broken files. */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  const { PDFDocument } = await import("pdf-lib");
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    if (/encrypt/i.test((e as Error).message)) throw new Error("This PDF is password-protected. Remove the password first.");
    throw new Error("That file isn't a PDF that can be read.");
  }
}

export async function readBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export const pdfBlob = (bytes: Uint8Array) => new Blob([bytes as BlobPart], { type: "application/pdf" });

/**
 * Draws one page onto a canvas. `rotation` is the page's total rotation (its own plus any added).
 * `width` is the CSS width to draw at; the canvas gets device pixels so it stays sharp.
 */
export async function renderPage(doc: PdfJsDoc, index: number, opts: { width?: number; scale?: number; rotation?: number } = {}): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(index + 1);
  const rotation = opts.rotation ?? page.rotate;
  const base = page.getViewport({ scale: 1, rotation });
  const scale = opts.scale ?? (opts.width ?? 160) / base.width;
  const ratio = opts.scale ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: scale * ratio, rotation });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return canvas;
}

// ---- Page ranges ----

/**
 * Parses "1-3, 5, 8-" into zero-based page groups, one per comma. Throws a readable error for
 * pages that don't exist. `8-` runs to the last page and `-3` starts at the first.
 */
export function parseRanges(input: string, pageCount: number): number[][] {
  const groups: number[][] = [];
  for (const raw of input.split(/[,;]/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^(\d*)\s*[-–]\s*(\d*)$/) ?? part.match(/^(\d+)$/);
    if (!m) throw new Error(`“${part}” isn't a page or a range like 2-5.`);
    const single = m.length === 2;
    const from = single ? Number(m[1]) : m[1] ? Number(m[1]) : 1;
    const to = single ? from : m[2] ? Number(m[2]) : pageCount;
    if (from < 1 || to < 1 || from > pageCount || to > pageCount) throw new Error(`This PDF has ${pageCount} page${pageCount === 1 ? "" : "s"}; “${part}” is outside it.`);
    const step = from <= to ? 1 : -1;
    const group: number[] = [];
    for (let p = from; p !== to + step; p += step) group.push(p - 1);
    groups.push(group);
  }
  if (!groups.length) throw new Error("Enter the pages to keep, like 1-3, 5.");
  return groups;
}

// ---- Merge and split ----

export async function mergePdfs(files: Uint8Array[]): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  for (const bytes of files) {
    const src = await loadPdf(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}

/** One new PDF per group of zero-based page indexes. */
export async function extractPages(bytes: Uint8Array, groups: number[][]): Promise<Uint8Array[]> {
  const { PDFDocument } = await import("pdf-lib");
  const src = await loadPdf(bytes);
  const out: Uint8Array[] = [];
  for (const group of groups) {
    const doc = await PDFDocument.create();
    const pages = await doc.copyPages(src, group);
    pages.forEach((p) => doc.addPage(p));
    out.push(await doc.save());
  }
  return out;
}

/** A .zip of several files, for splits that make more than one PDF. */
export async function zipFiles(files: { name: string; bytes: Uint8Array }[]): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.bytes);
  return zip.generateAsync({ type: "blob" });
}

// ---- Images to PDF ----

export const PAGE_SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
} as const;

export type ImagePdfOptions = { size: "fit" | keyof typeof PAGE_SIZES; orientation: "auto" | "portrait" | "landscape"; margin: number };

/** JPEG or PNG bytes for any image the browser can show (WebP, GIF, BMP… are redrawn as JPEG or PNG). */
async function imageBytes(file: File): Promise<{ bytes: Uint8Array; png: boolean }> {
  if (/^image\/jpe?g$/.test(file.type) || /\.jpe?g$/i.test(file.name)) return { bytes: await readBytes(file), png: false };
  if (file.type === "image/png" || /\.png$/i.test(file.name)) return { bytes: await readBytes(file), png: true };
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(`${file.name} isn't an image that can be read.`);
  });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  const png = file.type === "image/gif";
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't read the image."))), png ? "image/png" : "image/jpeg", 0.92));
  return { bytes: await readBytes(blob), png };
}

export async function imagesToPdf(files: File[], opts: ImagePdfOptions): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  for (const file of files) {
    const { bytes, png } = await imageBytes(file);
    const img = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    if (opts.size === "fit") {
      // One point per pixel at 96 dpi, so a photo comes out at a sensible physical size.
      const w = img.width * 0.75 + opts.margin * 2;
      const h = img.height * 0.75 + opts.margin * 2;
      doc.addPage([w, h]).drawImage(img, { x: opts.margin, y: opts.margin, width: img.width * 0.75, height: img.height * 0.75 });
      continue;
    }
    let [w, h]: number[] = [...PAGE_SIZES[opts.size]];
    const landscape = opts.orientation === "landscape" || (opts.orientation === "auto" && img.width > img.height);
    if (landscape) [w, h] = [h, w];
    const boxW = w - opts.margin * 2;
    const boxH = h - opts.margin * 2;
    const scale = Math.min(boxW / img.width, boxH / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    doc.addPage([w, h]).drawImage(img, { x: (w - dw) / 2, y: (h - dh) / 2, width: dw, height: dh });
  }
  return doc.save();
}

// ---- Text with the standard PDF fonts ----

/**
 * The 14 standard PDF fonts only cover Western European text. Characters they can't draw become "?"
 * instead of failing the whole file.
 */
export function encodable(font: PDFFont, text: string): string {
  const set = charSets.get(font) ?? new Set(font.getCharacterSet());
  charSets.set(font, set);
  let out = "";
  for (const ch of text) out += set.has(ch.codePointAt(0)!) ? ch : ch === "\t" ? "    " : "?";
  return out;
}
const charSets = new WeakMap<PDFFont, Set<number>>();

/** "#rrggbb" to pdf-lib's rgb(). */
export async function color(hex: string) {
  const { rgb } = await import("pdf-lib");
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return rgb(0, 0, 0);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}
