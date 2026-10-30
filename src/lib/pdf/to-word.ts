"use client";

import type { DocBody } from "../types";
import { openPdf, type PdfJsDoc } from "./core";
import { ocrPdf, type OcrPage, type Progress } from "./ocr";

// PDF to Word. A PDF only knows where each piece of text sits, so this rebuilds the document's
// structure from the layout: lines from text on the same baseline, paragraphs from the gaps between
// lines, headings from bigger type, lists from bullet characters and numbers. Pages without text
// (scans) can be read with OCR instead.

export type Run = { text: string; bold?: boolean; italic?: boolean };
export type Block =
  | { type: "heading"; level: 1 | 2 | 3; runs: Run[]; align?: "center" }
  | { type: "paragraph"; runs: Run[]; align?: "center" }
  | { type: "item"; ordered: boolean; runs: Run[] }
  | { type: "pageBreak" };

type Piece = { text: string; x: number; y: number; w: number; size: number; bold: boolean; italic: boolean };
type Line = { pieces: Piece[]; x0: number; x1: number; y: number; size: number };

const BULLET = /^\s*([•◦▪▫●○■□➢►▶✓✔\-–*])\s+/;
const NUMBERED = /^\s*(\d{1,3}|[a-z]|[ivx]{1,4})[.)]\s+/i;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

async function pageLines(doc: PdfJsDoc, index: number): Promise<{ lines: Line[]; width: number }> {
  const page = await doc.getPage(index + 1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  // Real font names ("ABCDEF+Arial-BoldMT") are only known once the page's fonts are loaded.
  await page.getOperatorList();
  const fontName = (id: string): string => {
    try {
      return (page.commonObjs.get(id) as { name?: string } | undefined)?.name ?? "";
    } catch {
      return "";
    }
  };
  const pieces: Piece[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    // Into the shown page's coordinates (top-left origin), which also undoes any page rotation.
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    const size = Math.hypot(item.transform[2], item.transform[3]) || item.height || 10;
    const name = fontName(item.fontName);
    pieces.push({ text: item.str, x, y, w: item.width, size, bold: /bold|black|heavy|semibold|demi/i.test(name), italic: /italic|oblique/i.test(name) });
  }
  page.cleanup();

  // Text on the same baseline (within a third of its size) is one line, read left to right.
  pieces.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Line[] = [];
  for (const p of pieces) {
    const line = lines.find((l) => Math.abs(l.y - p.y) < Math.max(2, l.size * 0.35));
    if (line) line.pieces.push(p);
    else lines.push({ pieces: [p], x0: 0, x1: 0, y: p.y, size: p.size });
  }
  for (const l of lines) {
    l.pieces.sort((a, b) => a.x - b.x);
    l.x0 = l.pieces[0].x;
    l.x1 = Math.max(...l.pieces.map((p) => p.x + p.w));
    l.size = Math.max(...l.pieces.map((p) => p.size));
  }
  lines.sort((a, b) => a.y - b.y);
  return { lines, width: viewport.width };
}

/** The runs of one line, with a space wherever there is a visible gap between pieces of text. */
function lineRuns(line: Line): Run[] {
  const runs: Run[] = [];
  let prev: Piece | null = null;
  for (const p of line.pieces) {
    let text = p.text;
    if (prev && p.x - (prev.x + prev.w) > p.size * 0.15 && !/\s$/.test(prev.text) && !/^\s/.test(text)) text = " " + text;
    const last = runs.at(-1);
    if (last && Boolean(last.bold) === p.bold && Boolean(last.italic) === p.italic) last.text += text;
    else runs.push({ text, ...(p.bold ? { bold: true } : {}), ...(p.italic ? { italic: true } : {}) });
    prev = p;
  }
  return runs;
}

const plain = (runs: Run[]) => runs.map((r) => r.text).join("");

/** Adds a line's runs to a paragraph, joining words split by a hyphen at the end of the line. */
function append(target: Run[], runs: Run[]) {
  const last = target.at(-1);
  if (last) {
    if (/[A-Za-z]-$/.test(last.text) && /^[a-z]/.test(runs[0]?.text ?? "")) last.text = last.text.slice(0, -1);
    else if (!/\s$/.test(last.text)) runs = [{ ...runs[0], text: " " + runs[0].text }, ...runs.slice(1)];
  }
  for (const r of runs) {
    const end = target.at(-1);
    if (end && Boolean(end.bold) === Boolean(r.bold) && Boolean(end.italic) === Boolean(r.italic)) end.text += r.text;
    else target.push({ ...r });
  }
}

function stripMarker(runs: Run[], marker: RegExp): Run[] {
  const [first, ...rest] = runs;
  return [{ ...first, text: first.text.replace(marker, "") }, ...rest].filter((r) => r.text);
}

function linesToBlocks(lines: Line[], pageWidth: number, body: number): Block[] {
  const blocks: Block[] = [];
  // Normal line spacing: a low quantile of the gaps, since blank lines and headings only make gaps bigger.
  const gaps = lines
    .slice(1)
    .map((l, i) => l.y - lines[i].y)
    .filter((g) => g > 0)
    .sort((a, b) => a - b);
  const spacing = Math.min(gaps[Math.floor(gaps.length / 4)] ?? body * 1.3, body * 1.8);
  const left = median(lines.map((l) => l.x0));
  let open: Extract<Block, { runs: Run[] }> | null = null;
  let prev: Line | null = null;

  for (const line of lines) {
    const runs = lineRuns(line);
    const text = plain(runs);
    const ratio = line.size / body;
    const level = ratio >= 1.75 ? 1 : ratio >= 1.35 ? 2 : ratio >= 1.15 && runs.every((r) => r.bold) && text.length < 90 ? 3 : 0;
    const centered = Math.abs((line.x0 + line.x1) / 2 - pageWidth / 2) < pageWidth * 0.04 && line.x0 > left + pageWidth * 0.08;
    const gap = prev ? line.y - prev.y : 0;
    const sameSize = prev && Math.abs(prev.size - line.size) < body * 0.15;
    // A line carries on the paragraph above when it is close below it, in the same size, and not a list item or heading.
    const continues =
      open && prev && sameSize && gap < spacing * 1.45 && gap > 0 && !BULLET.test(text) && !NUMBERED.test(text) && (open.type !== "heading" || level > 0) && !(centered && open.type !== "heading");

    if (continues && open) {
      append(open.runs, runs);
    } else if (level) {
      open = { type: "heading", level: level as 1 | 2 | 3, runs, ...(centered ? { align: "center" as const } : {}) };
      blocks.push(open);
    } else if (BULLET.test(text)) {
      open = { type: "item", ordered: false, runs: stripMarker(runs, BULLET) };
      blocks.push(open);
    } else if (NUMBERED.test(text) && /^\s*\d/.test(text)) {
      open = { type: "item", ordered: true, runs: stripMarker(runs, NUMBERED) };
      blocks.push(open);
    } else {
      open = { type: "paragraph", runs, ...(centered ? { align: "center" as const } : {}) };
      blocks.push(open);
    }
    prev = line;
  }
  return blocks;
}

function ocrToBlocks(page: OcrPage): Block[] {
  return page.paragraphs.map((para) => {
    const runs: Run[] = [];
    for (const line of para) append(runs, [{ text: line.text }]);
    return { type: "paragraph" as const, runs };
  });
}

export type PdfToWordOptions = { ocr: boolean; lang: string };

export async function pdfToBlocks(bytes: Uint8Array, opts: PdfToWordOptions, progress?: Progress): Promise<Block[]> {
  const doc = await openPdf(bytes);
  const pages: { lines: Line[]; width: number }[] = [];
  try {
    for (let i = 0; i < doc.numPages; i++) {
      progress?.(i / doc.numPages, `Reading page ${i + 1} of ${doc.numPages}`);
      pages.push(await pageLines(doc, i));
    }
  } finally {
    void doc.destroy();
  }
  // Body text size: the size most of the document's text is set in.
  const body = median(pages.flatMap((p) => p.lines.flatMap((l) => l.pieces.map((x) => x.size)))) || 11;
  const scanned = pages.flatMap((p, i) => (p.lines.length < 2 ? [i] : []));
  const ocr = opts.ocr && scanned.length ? await ocrPdf(bytes, opts.lang, progress, scanned) : [];

  const blocks: Block[] = [];
  pages.forEach((p, i) => {
    if (i > 0) blocks.push({ type: "pageBreak" });
    blocks.push(...(ocr[i] ? ocrToBlocks(ocr[i]!) : linesToBlocks(p.lines, p.width, body)));
  });
  if (!blocks.some((b) => b.type !== "pageBreak"))
    throw new Error(opts.ocr ? "No text was found in this PDF, even with OCR." : "This PDF has no text, only images. Turn on OCR to read scanned pages.");
  return blocks;
}

export async function blocksToDocx(blocks: Block[]): Promise<Blob> {
  const d = await import("docx");
  const runs = (rs: Run[]) => rs.map((r) => new d.TextRun({ text: r.text, bold: r.bold, italics: r.italic }));
  const HEADING = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3] as const;
  const children: import("docx").Paragraph[] = [];
  let breakNext = false;
  for (const b of blocks) {
    if (b.type === "pageBreak") {
      breakNext = true;
      continue;
    }
    const base = { pageBreakBefore: breakNext || undefined };
    breakNext = false;
    if (b.type === "heading") children.push(new d.Paragraph({ ...base, heading: HEADING[b.level], children: runs(b.runs), alignment: b.align ? d.AlignmentType.CENTER : undefined }));
    else if (b.type === "item")
      children.push(new d.Paragraph({ ...base, children: runs(b.runs), ...(b.ordered ? { numbering: { reference: "numbers", level: 0 } } : { bullet: { level: 0 } }) }));
    else children.push(new d.Paragraph({ ...base, children: runs(b.runs), alignment: b.align ? d.AlignmentType.CENTER : undefined, spacing: { after: 120 } }));
  }
  const doc = new d.Document({
    numbering: {
      config: [{ reference: "numbers", levels: [{ level: 0, format: d.LevelFormat.DECIMAL, text: "%1.", alignment: d.AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }],
    },
    sections: [{ children }],
  });
  return d.Packer.toBlob(doc);
}

/** The same blocks as an Atrium document, to open and edit in Docs. Docs lays out its own pages, so page breaks are dropped. */
export function blocksToDoc(blocks: Block[]): DocBody {
  type J = { type: string; attrs?: Record<string, unknown>; content?: J[]; text?: string; marks?: { type: string }[] };
  const inline = (rs: Run[]): J[] | undefined => {
    const nodes = rs.filter((r) => r.text).map((r) => ({ type: "text", text: r.text, ...(r.bold || r.italic ? { marks: [...(r.bold ? [{ type: "bold" }] : []), ...(r.italic ? [{ type: "italic" }] : [])] } : {}) }));
    return nodes.length ? nodes : undefined;
  };
  const content: J[] = [];
  for (const b of blocks) {
    if (b.type === "pageBreak") continue;
    if (b.type === "item") {
      const kind = b.ordered ? "orderedList" : "bulletList";
      const item: J = { type: "listItem", content: [{ type: "paragraph", content: inline(b.runs) }] };
      const last = content.at(-1);
      if (last?.type === kind) last.content!.push(item);
      else content.push({ type: kind, content: [item] });
      continue;
    }
    const attrs = b.align ? { textAlign: b.align } : undefined;
    content.push(b.type === "heading" ? { type: "heading", attrs: { level: b.level, ...attrs }, content: inline(b.runs) } : { type: "paragraph", ...(attrs ? { attrs } : {}), content: inline(b.runs) });
  }
  return { type: "doc", content: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] }, page: { size: "a4", margins: "normal" } };
}
