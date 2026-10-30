"use client";

import type { PDFDocument, PDFFont, PDFPage } from "pdf-lib";
import type { JNode } from "../convert/docx";
import type { DocBody } from "../types";
import { encodable, PAGE_SIZES } from "./core";

// Word and Atrium documents to PDF, typeset directly into a PDF with real, selectable text.
// Layout works in boxes: every block becomes a list of boxes (a line of text, an image, a table row),
// each with a height and a draw function, and the paginator stacks them onto pages. Indents, quote
// bars and list markers wrap the boxes of what they contain.

type Rgb = import("pdf-lib").RGB;
type Family = "sans" | "serif" | "mono";
type Style = { family: Family; bold: boolean; italic: boolean; size: number; color: string; underline?: boolean; strike?: boolean; highlight?: string; code?: boolean };
type Box = { h: number; gap?: boolean; draw: (page: PDFPage, x: number, top: number) => void };

const MARGINS = { normal: [72, 72], narrow: [36, 36], wide: [72, 144] } as const;
const BODY: Style = { family: "sans", bold: false, italic: false, size: 11, color: "#111827" };
const HEADING = { 1: 22, 2: 17, 3: 14 } as Record<number, number>;
const LINE = 1.4;
const INDENT = 20;

const FONT_KEYS = {
  sans: ["Helvetica", "HelveticaBold", "HelveticaOblique", "HelveticaBoldOblique"],
  serif: ["TimesRoman", "TimesRomanBold", "TimesRomanItalic", "TimesRomanBoldItalic"],
  mono: ["Courier", "CourierBold", "CourierOblique", "CourierBoldOblique"],
} as const;

const hex = (c: unknown): string | undefined => {
  if (typeof c !== "string") return undefined;
  const m = c.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (m) return "#" + (m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1]);
  const rgb = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return rgb ? "#" + rgb.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, "0")).join("") : undefined;
};

const points = (size: unknown) => {
  if (typeof size !== "string") return undefined;
  const n = parseFloat(size);
  return n ? (size.endsWith("px") ? n * 0.75 : n) : undefined;
};

const familyOf = (f: unknown): Family | undefined => {
  if (typeof f !== "string" || !f) return undefined;
  if (/courier|mono/i.test(f)) return "mono";
  if (/times|georgia|garamond|(^|[^-])serif/i.test(f)) return "serif";
  return "sans";
};

class Typesetter {
  private fonts = new Map<string, PDFFont>();
  private rgbs = new Map<string, Rgb>();
  constructor(
    private doc: PDFDocument,
    private lib: typeof import("pdf-lib"),
  ) {}

  async font(s: Pick<Style, "family" | "bold" | "italic">) {
    const key = FONT_KEYS[s.family][(s.bold ? 1 : 0) + (s.italic ? 2 : 0)];
    if (!this.fonts.has(key)) this.fonts.set(key, await this.doc.embedFont(this.lib.StandardFonts[key]));
    return this.fonts.get(key)!;
  }

  rgb(c: string) {
    if (!this.rgbs.has(c)) {
      const h = hex(c) ?? "#000000";
      this.rgbs.set(c, this.lib.rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255));
    }
    return this.rgbs.get(c)!;
  }

  // ---- Inline text ----

  /** Words with their style, in reading order; "\n" entries are hard line breaks. */
  private async words(nodes: JNode[] = [], base: Style) {
    const out: { text: string; style: Style; font: PDFFont; space: boolean }[] = [];
    for (const n of nodes) {
      if (n.type === "hardBreak") {
        out.push({ text: "\n", style: base, font: await this.font(base), space: false });
        continue;
      }
      if (n.type !== "text" || !n.text) continue;
      const marks = Object.fromEntries((n.marks ?? []).map((m) => [m.type, (m.attrs ?? {}) as Record<string, unknown>]));
      const ts = marks.textStyle ?? {};
      const style: Style = {
        ...base,
        family: marks.code ? "mono" : (familyOf(ts.fontFamily) ?? base.family),
        bold: base.bold || Boolean(marks.bold),
        italic: base.italic || Boolean(marks.italic),
        size: points(ts.fontSize) ?? base.size,
        color: hex(ts.color) ?? (marks.link ? "#2563eb" : base.color),
        underline: Boolean(marks.underline || marks.link),
        strike: Boolean(marks.strike),
        highlight: marks.highlight ? (hex(marks.highlight.color) ?? "#fef08a") : marks.code ? "#eef2f7" : undefined,
        code: Boolean(marks.code),
      };
      const font = await this.font(style);
      // Split into words, remembering which were followed by a space.
      for (const part of n.text.match(/[^\s]+\s*|\s+/g) ?? []) {
        const word = part.trimEnd();
        if (!word) {
          const last = out.at(-1);
          if (last) last.space = true;
          continue;
        }
        out.push({ text: encodable(font, word), style, font, space: word.length < part.length });
      }
    }
    return out;
  }

  /** Wraps inline content into line boxes `width` wide. */
  async lines(nodes: JNode[] | undefined, base: Style, width: number, align = "left"): Promise<Box[]> {
    const words = await this.words(nodes, base);
    type Seg = { text: string; style: Style; font: PDFFont; x: number; w: number };
    const lines: { segs: Seg[]; width: number; size: number; spaces: number; last: boolean }[] = [];
    let line: (typeof lines)[number] = { segs: [], width: 0, size: base.size, spaces: 0, last: false };
    let pendingSpace = 0;
    const flush = (last: boolean) => {
      line.last = last;
      lines.push(line);
      line = { segs: [], width: 0, size: base.size, spaces: 0, last: false };
      pendingSpace = 0;
    };
    for (const w of words) {
      if (w.text === "\n") {
        flush(true);
        continue;
      }
      let text = w.text;
      let tw = w.font.widthOfTextAtSize(text, w.style.size);
      if (line.segs.length && line.width + pendingSpace + tw > width) flush(false);
      // A word longer than the line is broken wherever it runs out of room.
      while (tw > width && text.length > 1) {
        let n = text.length - 1;
        while (n > 1 && w.font.widthOfTextAtSize(text.slice(0, n), w.style.size) > width - line.width) n--;
        const head = text.slice(0, n);
        const hw = w.font.widthOfTextAtSize(head, w.style.size);
        line.segs.push({ text: head, style: w.style, font: w.font, x: line.width, w: hw });
        line.size = Math.max(line.size, w.style.size);
        line.width += hw;
        flush(false);
        text = text.slice(n);
        tw = w.font.widthOfTextAtSize(text, w.style.size);
      }
      const x = line.segs.length ? line.width + pendingSpace : 0;
      if (line.segs.length && pendingSpace) line.spaces++;
      line.segs.push({ text, style: w.style, font: w.font, x, w: tw });
      line.size = Math.max(line.size, w.style.size);
      line.width = x + tw;
      pendingSpace = w.space ? w.font.widthOfTextAtSize(" ", w.style.size) : 0;
    }
    if (line.segs.length || !lines.length) flush(true);

    return lines.map((l) => {
      const h = l.size * LINE;
      const extra = width - l.width;
      const offset = align === "center" ? extra / 2 : align === "right" ? extra : 0;
      // Justified lines spread the leftover room over their spaces, except a paragraph's last line.
      const stretch = align === "justify" && !l.last && l.spaces ? extra / l.spaces : 0;
      return {
        h,
        draw: (page, x0, top) => {
          const pageH = page.getHeight();
          const baseline = top + (h - l.size) / 2 + l.size * 0.8;
          let spaces = 0;
          l.segs.forEach((s, i) => {
            if (i > 0 && s.x > l.segs[i - 1].x + l.segs[i - 1].w + 0.01) spaces++;
            const x = x0 + offset + s.x + spaces * stretch;
            const y = pageH - baseline;
            if (s.style.highlight) page.drawRectangle({ x: x - 1, y: y - s.style.size * 0.25, width: s.w + 2, height: s.style.size * 1.15, color: this.rgb(s.style.highlight) });
            page.drawText(s.text, { x, y, size: s.style.size, font: s.font, color: this.rgb(s.style.color) });
            const rule = (dy: number) => page.drawLine({ start: { x, y: y + dy }, end: { x: x + s.w, y: y + dy }, thickness: Math.max(0.5, s.style.size / 16), color: this.rgb(s.style.color) });
            if (s.style.underline) rule(-s.style.size * 0.12);
            if (s.style.strike) rule(s.style.size * 0.3);
          });
        },
      };
    });
  }

  // ---- Blocks ----

  async blocks(nodes: JNode[] = [], width: number, base: Style = BODY): Promise<Box[]> {
    const out: Box[] = [];
    for (const n of nodes) out.push(...(await this.block(n, width, base)));
    return out;
  }

  private gap = (h: number): Box => ({ h, gap: true, draw: () => {} });

  private async block(n: JNode, width: number, base: Style): Promise<Box[]> {
    const align = (n.attrs?.textAlign as string) || "left";
    switch (n.type) {
      case "paragraph": {
        const images = (n.content ?? []).filter((c) => c.type === "image");
        const boxes = await this.lines(n.content, base, width, align);
        for (const img of images) boxes.push(...(await this.image(img, width)));
        return [...boxes, this.gap(base.size * 0.6)];
      }
      case "heading": {
        const level = Number(n.attrs?.level) || 1;
        const size = HEADING[level] ?? 13;
        return [this.gap(size * 0.7), ...(await this.lines(n.content, { ...base, size, bold: true }, width, align)), this.gap(size * 0.35)];
      }
      case "blockquote": {
        const inner = await this.blocks(n.content, width - 14, { ...base, color: "#4b5563", italic: true });
        return inner.map((b) => ({
          ...b,
          draw: (page, x, top) => {
            b.draw(page, x + 14, top);
            if (!b.gap) page.drawRectangle({ x, y: page.getHeight() - top - b.h, width: 3, height: b.h, color: this.rgb("#d1d5db") });
          },
        }));
      }
      case "codeBlock": {
        // Monospaced, so lines keep their indentation and wrap at a fixed number of characters.
        const size = 9.5;
        const font = await this.font({ family: "mono", bold: false, italic: false });
        const per = Math.max(1, Math.floor((width - 16) / font.widthOfTextAtSize("M", size)));
        const text = (n.content ?? []).map((c) => c.text ?? "").join("");
        const bg = (page: PDFPage, x: number, top: number, h: number) => page.drawRectangle({ x, y: page.getHeight() - top - h, width, height: h, color: this.rgb("#0f172a") });
        const lines: Box[] = [];
        for (const raw of text.split("\n"))
          for (const chunk of encodable(font, raw.replace(/\t/g, "    ")).match(new RegExp(`.{1,${per}}`, "g")) ?? [""]) {
            const h = size * LINE;
            lines.push({
              h,
              draw: (page, x, top) => {
                bg(page, x, top, h);
                page.drawText(chunk, { x: x + 8, y: page.getHeight() - top - (h - size) / 2 - size * 0.8, size, font, color: this.rgb("#e2e8f0") });
              },
            });
          }
        const pad: Box = { h: 6, draw: (page, x, top) => bg(page, x, top, 6) };
        return [pad, ...lines, pad, this.gap(8)];
      }
      case "bulletList":
      case "orderedList":
      case "taskList": {
        const out: Box[] = [];
        const start = Number(n.attrs?.start) || 1;
        for (const [i, item] of (n.content ?? []).entries()) {
          const inner = (await this.blocks(item.content, width - INDENT, base)).filter((b, j, all) => !(b.gap && j === all.length - 1));
          const first = inner.findIndex((b) => !b.gap);
          const marker = n.type === "orderedList" ? `${start + i}.` : n.type === "bulletList" ? "•" : null;
          const font = await this.font(base);
          inner.forEach((b, j) =>
            out.push({
              ...b,
              draw: (page, x, top) => {
                b.draw(page, x + INDENT, top);
                if (j !== first) return;
                const y = page.getHeight() - (top + (b.h - base.size) / 2 + base.size * 0.8);
                if (marker) {
                  const w = font.widthOfTextAtSize(marker, base.size);
                  page.drawText(marker, { x: x + INDENT - 6 - w, y, size: base.size, font, color: this.rgb(base.color) });
                } else {
                  const s = base.size * 0.8;
                  page.drawRectangle({ x: x + 2, y: y - 1, width: s, height: s, borderColor: this.rgb("#6b7280"), borderWidth: 0.9 });
                  if (item.attrs?.checked) page.drawSvgPath(`M0 ${s * 0.55} L${s * 0.38} ${s * 0.9} L${s} 0`, { x: x + 2, y: y - 1 + s, borderColor: this.rgb("#2563eb"), borderWidth: 1.4 });
                }
              },
            }),
          );
        }
        return [...out, this.gap(base.size * 0.5)];
      }
      case "horizontalRule":
        return [{ h: 16, draw: (page, x, top) => page.drawLine({ start: { x, y: page.getHeight() - top - 8 }, end: { x: x + width, y: page.getHeight() - top - 8 }, thickness: 0.8, color: this.rgb("#d1d5db") }) }];
      case "image":
        return this.image(n, width);
      case "table":
        return [...(await this.table(n, width, base)), this.gap(10)];
      default:
        return n.content ? this.blocks(n.content, width, base) : [];
    }
  }

  private async image(n: JNode, width: number): Promise<Box[]> {
    const src = n.attrs?.src;
    if (typeof src !== "string") return [];
    const img = await this.embedImage(src).catch(() => null);
    if (!img) return [];
    // Sizes in the editor are CSS pixels.
    let w = (Number(n.attrs?.width) || img.width) * 0.75;
    let h = (Number(n.attrs?.height) || (img.height * (Number(n.attrs?.width) || img.width)) / img.width) * 0.75;
    if (w > width) [w, h] = [width, (h * width) / w];
    return [{ h: h + 6, draw: (page, x, top) => page.drawImage(img, { x, y: page.getHeight() - top - h - 3, width: w, height: h }) }];
  }

  private async embedImage(src: string) {
    const m = src.match(/^data:image\/(png|jpe?g);base64,/);
    if (m) {
      const bytes = Uint8Array.from(atob(src.slice(m[0].length)), (c) => c.charCodeAt(0));
      return m[1] === "png" ? this.doc.embedPng(bytes) : this.doc.embedJpg(bytes);
    }
    // Anything else the browser can show (GIF, WebP, SVG, or a URL) is redrawn as a PNG.
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.src = src;
    await el.decode();
    const canvas = document.createElement("canvas");
    canvas.width = el.naturalWidth;
    canvas.height = el.naturalHeight;
    canvas.getContext("2d")!.drawImage(el, 0, 0);
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("image"))), "image/png"));
    return this.doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
  }

  private async table(n: JNode, width: number, base: Style): Promise<Box[]> {
    const rows = n.content ?? [];
    const cols = Math.max(1, ...rows.map((r) => (r.content ?? []).reduce((s, c) => s + (Number(c.attrs?.colspan) || 1), 0)));
    // Column widths from the editor (pixels) where they were set, the rest shared equally, then scaled to fit.
    const set: (number | null)[] = Array(cols).fill(null);
    for (const r of rows) {
      let c = 0;
      for (const cell of r.content ?? []) {
        const span = Number(cell.attrs?.colspan) || 1;
        const cw = cell.attrs?.colwidth as number[] | null | undefined;
        cw?.forEach((w, k) => w && set[c + k] == null && (set[c + k] = w));
        c += span;
      }
    }
    const known = set.reduce<number>((s, w) => s + (w ?? 0), 0);
    const unknown = set.filter((w) => w == null).length;
    const fallback = unknown ? Math.max(40, (width / 0.75 - known) / unknown) : 0;
    const raw = set.map((w) => w ?? fallback);
    const total = raw.reduce((s, w) => s + w, 0);
    const colW = raw.map((w) => (w * width) / total);
    const pad = 5;
    const cellStyle = { ...base, size: Math.min(base.size, 10) };

    const out: Box[] = [];
    for (const r of rows) {
      const cells: { x: number; w: number; header: boolean; boxes: Box[] }[] = [];
      let c = 0;
      for (const cell of r.content ?? []) {
        const span = Number(cell.attrs?.colspan) || 1;
        const x = colW.slice(0, c).reduce((s, w) => s + w, 0);
        const w = colW.slice(c, c + span).reduce((s, v) => s + v, 0);
        const header = cell.type === "tableHeader";
        const boxes = (await this.blocks(cell.content, w - pad * 2, header ? { ...cellStyle, bold: true } : cellStyle)).filter((b, j, all) => !(b.gap && j === all.length - 1));
        cells.push({ x, w, header, boxes });
        c += span;
      }
      const h = Math.max(cellStyle.size * LINE, ...cells.map((cell) => cell.boxes.reduce((s, b) => s + b.h, 0))) + pad * 2;
      out.push({
        h,
        draw: (page, x0, top) => {
          const y = page.getHeight() - top - h;
          for (const cell of cells) {
            page.drawRectangle({ x: x0 + cell.x, y, width: cell.w, height: h, borderColor: this.rgb("#d1d5db"), borderWidth: 0.7, ...(cell.header ? { color: this.rgb("#f3f4f6") } : {}) });
            let t = top + pad;
            for (const b of cell.boxes) {
              b.draw(page, x0 + cell.x + pad, t);
              t += b.h;
            }
          }
        },
      });
    }
    return out;
  }
}

export async function docToPdf(body: DocBody, title = "Document"): Promise<Uint8Array> {
  const lib = await import("pdf-lib");
  const doc = await lib.PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator("Atrium");
  const [pw, ph] = PAGE_SIZES[body.page?.size ?? "a4"];
  const [mv, mh] = MARGINS[body.page?.margins ?? "normal"];
  const width = pw - mh * 2;
  const t = new Typesetter(doc, lib);
  const root = body.content as JNode | undefined;
  const boxes = await t.blocks(root?.content ?? [], width);

  let page = doc.addPage([pw, ph]);
  let top = mv;
  for (const b of boxes) {
    if (top + b.h > ph - mv && top > mv) {
      if (b.gap) continue;
      page = doc.addPage([pw, ph]);
      top = mv;
    }
    // Space before a block is dropped at the top of a page.
    if (b.gap && top === mv) continue;
    b.draw(page, mh, top);
    top += b.h;
  }
  return doc.save();
}
