"use client";

import type { PDFPage } from "pdf-lib";
import { color, encodable, loadPdf } from "./core";

// Edits made in the PDF editor. Marks are positioned in points on the page as it is shown, with the
// origin at the top-left, which is how the editor draws them. They are mapped onto the page's own
// coordinates (bottom-left origin, possibly rotated, possibly offset by its crop box) when saved.

export type FontName = "sans" | "serif" | "mono";

export type Mark =
  | { id: string; kind: "text"; x: number; y: number; text: string; size: number; color: string; font: FontName; bold: boolean }
  | { id: string; kind: "rect"; x: number; y: number; w: number; h: number; color: string; opacity: number }
  | { id: string; kind: "image"; x: number; y: number; w: number; h: number; src: string }
  | { id: string; kind: "ink"; points: [number, number][]; color: string; width: number };

/** One page of the result: which source page it is, the rotation added to it, and what is drawn on it. */
export type EditPage = { src: number; rotate: number; marks: Mark[] };

export type Extras = {
  pageNumbers?: { position: "bottom-center" | "bottom-right" | "top-right"; start: number };
  watermark?: { text: string; opacity: number };
};

/** Line height used both on screen and in the saved file, so text lands where it was typed. */
export const LINE = 1.25;

const FONTS = {
  sans: ["Helvetica", "HelveticaBold"],
  serif: ["TimesRoman", "TimesRomanBold"],
  mono: ["Courier", "CourierBold"],
} as const;

/**
 * Maps a point on the page as shown (top-left origin, points) to the page's own coordinates.
 * `w`/`h` are the shown size, `r` the page's total clockwise rotation.
 */
export function toPage(x: number, y: number, view: { w: number; h: number }, box: { x: number; y: number; width: number; height: number }, r: number) {
  const u = x / view.w;
  const v = y / view.h;
  const { width: W, height: H } = box;
  const [px, py] = r === 90 ? [v * W, u * H] : r === 180 ? [(1 - u) * W, v * H] : r === 270 ? [(1 - v) * W, (1 - u) * H] : [u * W, (1 - v) * H];
  return { x: box.x + px, y: box.y + py };
}

function dataUrlBytes(src: string) {
  const m = src.match(/^data:image\/(png|jpe?g);base64,(.+)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, png: m[1] === "png" };
}

export async function applyEdits(bytes: Uint8Array, pages: EditPage[], extras: Extras = {}): Promise<Uint8Array> {
  const lib = await import("pdf-lib");
  const { PDFDocument, StandardFonts, degrees } = lib;
  const src = await loadPdf(bytes);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(
    src,
    pages.map((p) => p.src),
  );
  const fonts = new Map<string, import("pdf-lib").PDFFont>();
  const font = async (name: FontName, bold: boolean) => {
    const key = FONTS[name][bold ? 1 : 0];
    if (!fonts.has(key)) fonts.set(key, await out.embedFont(StandardFonts[key]));
    return fonts.get(key)!;
  };

  for (let i = 0; i < pages.length; i++) {
    const spec = pages[i];
    const page = out.addPage(copied[i]);
    const r = (((page.getRotation().angle + spec.rotate) % 360) + 360) % 360;
    page.setRotation(degrees(r));
    const box = page.getCropBox();
    const view = r % 180 ? { w: box.height, h: box.width } : { w: box.width, h: box.height };
    const at = (x: number, y: number) => toPage(x, y, view, box, r);
    const rotate = degrees(r);

    for (const m of spec.marks) {
      if (m.kind === "text") {
        const f = await font(m.font, m.bold);
        const c = await color(m.color);
        m.text.split("\n").forEach((line, n) => {
          // drawText anchors at the baseline; the editor's box starts at the top of the line. The
          // browser centres the font's ascent + descent (Arial's: 0.905 + 0.212) in each line.
          const top = m.y + n * m.size * LINE;
          const baseline = top + (m.size * (LINE - 1.117)) / 2 + m.size * 0.905;
          page.drawText(encodable(f, line), { ...at(m.x, baseline), size: m.size, font: f, color: c, rotate });
        });
      } else if (m.kind === "rect") {
        page.drawRectangle({ ...at(m.x, m.y + m.h), width: m.w, height: m.h, color: await color(m.color), opacity: m.opacity, rotate });
      } else if (m.kind === "image") {
        const data = dataUrlBytes(m.src);
        if (!data) continue;
        const img = data.png ? await out.embedPng(data.bytes) : await out.embedJpg(data.bytes);
        page.drawImage(img, { ...at(m.x, m.y + m.h), width: m.w, height: m.h, rotate });
      } else if (m.kind === "ink" && m.points.length) {
        // SVG paths run right and down from their anchor, the same way the shown page does.
        const path = m.points.map(([x, y], n) => `${n ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ") + (m.points.length === 1 ? " l0.01 0" : "");
        page.drawSvgPath(path, { ...at(0, 0), borderColor: await color(m.color), borderWidth: m.width, borderLineCap: lib.LineCapStyle.Round, rotate });
      }
    }

    if (extras.watermark?.text.trim()) await watermark(page, extras.watermark, view, at, r, await font("sans", true));
    if (extras.pageNumbers) {
      const f = await font("sans", false);
      const label = String(extras.pageNumbers.start + i);
      const size = 10;
      const w = f.widthOfTextAtSize(label, size);
      const pos = extras.pageNumbers.position;
      const x = pos === "bottom-center" ? (view.w - w) / 2 : view.w - 36 - w;
      const y = pos === "top-right" ? 28 : view.h - 22;
      page.drawText(label, { ...at(x, y), size, font: f, color: lib.rgb(0.3, 0.3, 0.3), rotate });
    }
  }
  return out.save();
}

async function watermark(
  page: PDFPage,
  wm: NonNullable<Extras["watermark"]>,
  view: { w: number; h: number },
  at: (x: number, y: number) => { x: number; y: number },
  r: number,
  font: import("pdf-lib").PDFFont,
) {
  const { degrees, rgb } = await import("pdf-lib");
  const text = encodable(font, wm.text.trim());
  // Diagonal across the middle, sized to fill most of the page's width.
  const angle = Math.atan2(view.h, view.w);
  const size = Math.min(110, (Math.hypot(view.w, view.h) * 0.7) / Math.max(1, font.widthOfTextAtSize(text, 1)));
  const w = font.widthOfTextAtSize(text, size);
  const cx = view.w / 2 - (Math.cos(angle) * w) / 2 + (Math.sin(angle) * size * 0.35);
  const cy = view.h / 2 + (Math.sin(angle) * w) / 2 + (Math.cos(angle) * size * 0.35);
  page.drawText(text, { ...at(cx, cy), size, font, color: rgb(0.55, 0.55, 0.6), opacity: wm.opacity, rotate: degrees(r + (angle * 180) / Math.PI) });
}
