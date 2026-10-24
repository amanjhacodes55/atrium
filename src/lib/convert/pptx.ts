import type { Slide, SlideEl, SlidesBody } from "../types";

// PowerPoint in and out. Slides are 960x540 px; PowerPoint's 16:9 layout is 10x5.625 in, so one
// inch is 96 px and a pixel font size is 0.75 pt.

const PX_PER_IN = 96;
const inches = (px: number) => Math.round((px / PX_PER_IN) * 1000) / 1000;
export const pxToPt = (px: number) => Math.round(px * 0.75 * 10) / 10;

/** "#abc" / "#aabbcc" / "aabbcc" -> "AABBCC" (pptxgenjs wants hex without "#"). */
export function hex(color: string | undefined, fallback = "000000"): string {
  if (!color) return fallback;
  let c = color.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(c)) c = c.replace(/./g, (ch) => ch + ch);
  return /^[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : fallback;
}

const FONT_FACE = { sans: "Calibri", serif: "Georgia", mono: "Consolas" } as const;

export async function exportPptx(body: SlidesBody, name: string): Promise<Blob> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = name;
  pptx.company = "Atrium";

  for (const s of body.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: hex(s.bg, "FFFFFF") };
    for (const el of s.els) {
      const box = { x: inches(el.x), y: inches(el.y), w: inches(el.w), h: inches(el.h) };
      if (el.type === "text") {
        slide.addText(el.text ?? "", {
          ...box,
          fontSize: pxToPt(el.size ?? 24),
          bold: Boolean(el.bold),
          italic: Boolean(el.italic),
          underline: el.underline ? { style: "sng" } : undefined,
          color: hex(el.color, "1F2937"),
          align: el.align ?? "left",
          valign: "top",
          fontFace: FONT_FACE[el.font ?? "sans"],
          fill: el.fill ? { color: hex(el.fill) } : undefined,
          margin: [3, 6, 3, 6],
          fit: "none",
        });
      } else if (el.type === "rect" || el.type === "ellipse") {
        slide.addShape(el.type === "ellipse" ? pptx.ShapeType.ellipse : pptx.ShapeType.roundRect, {
          ...box,
          rectRadius: el.type === "rect" ? inches(6) : undefined,
          fill: { color: hex(el.fill, "CBD5E1") },
          line: el.stroke && el.strokeWidth ? { color: hex(el.stroke), width: pxToPt(el.strokeWidth) } : { type: "none" },
        });
      } else if (el.type === "image" && el.src?.startsWith("data:")) {
        slide.addImage({ ...box, data: el.src.slice(5), sizing: { type: "contain", w: box.w, h: box.h } });
      }
    }
    if (s.notes) slide.addNotes(s.notes);
  }

  const out = (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

// ---- Import (best effort): text boxes, basic shapes, pictures, solid backgrounds and notes ----

const kids = (el: Element | null | undefined, name: string): Element[] =>
  el ? Array.from(el.children).filter((c) => c.localName === name) : [];
const kid = (el: Element | null | undefined, name: string) => kids(el, name)[0] ?? null;
const all = (el: Element | Document, name: string) => Array.from(el.getElementsByTagNameNS("*", name));
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function solid(el: Element | null): string | undefined {
  const fill = el && (el.localName === "solidFill" ? el : kid(el, "solidFill"));
  const rgb = kid(fill, "srgbClr")?.getAttribute("val");
  return rgb ? `#${rgb.toLowerCase()}` : undefined;
}

function resolvePath(base: string, target: string) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };

export async function importPptx(file: Blob): Promise<SlidesBody> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = async (path: string) => {
    const text = await zip.file(path)?.async("string");
    return text ? new DOMParser().parseFromString(text, "application/xml") : null;
  };
  const rels = async (path: string) => {
    const parts = path.split("/");
    const doc = await xml(`${parts.slice(0, -1).join("/")}/_rels/${parts.at(-1)}.rels`);
    const map = new Map<string, { target: string; type: string }>();
    for (const r of doc ? all(doc, "Relationship") : []) {
      map.set(r.getAttribute("Id")!, { target: resolvePath(path, r.getAttribute("Target")!), type: r.getAttribute("Type") ?? "" });
    }
    return map;
  };

  const pres = await xml("ppt/presentation.xml");
  if (!pres) throw new Error("This is not a PowerPoint file.");
  const size = all(pres, "sldSz")[0];
  const cx = Number(size?.getAttribute("cx")) || 12192000;
  const cy = Number(size?.getAttribute("cy")) || 6858000;
  const sx = 960 / cx;
  const sy = 540 / cy;
  const presRels = await rels("ppt/presentation.xml");
  const order = all(pres, "sldId").map((s) => presRels.get(s.getAttributeNS(R_NS, "id") ?? s.getAttribute("r:id") ?? "")?.target).filter(Boolean) as string[];

  const slides: Slide[] = [];
  let n = 0;
  for (const path of order) {
    const doc = await xml(path);
    if (!doc) continue;
    const slideRels = await rels(path);
    const id = `imp${Date.now().toString(36)}${n++}`;
    const slide: Slide = { id, bg: "#ffffff", els: [], notes: "" };
    const bg = all(doc, "bgPr")[0];
    slide.bg = solid(bg) ?? "#ffffff";

    let k = 0;
    const place = (el: Element, fallback: { x: number; y: number; w: number; h: number }) => {
      const xfrm = all(el, "xfrm")[0];
      const off = kid(xfrm, "off");
      const ext = kid(xfrm, "ext");
      if (!off || !ext) return fallback;
      return {
        x: Math.round(Number(off.getAttribute("x")) * sx),
        y: Math.round(Number(off.getAttribute("y")) * sy),
        w: Math.max(10, Math.round(Number(ext.getAttribute("cx")) * sx)),
        h: Math.max(10, Math.round(Number(ext.getAttribute("cy")) * sy)),
      };
    };

    for (const sp of all(doc, "sp")) {
      const ph = all(sp, "ph")[0]?.getAttribute("type") ?? (all(sp, "ph")[0] ? "body" : null);
      const isTitle = ph === "title" || ph === "ctrTitle";
      const box = place(sp, isTitle ? { x: 60, y: 30, w: 840, h: 90 } : { x: 60, y: 140, w: 840, h: 360 });
      const spPr = kid(sp, "spPr");
      const geom = kid(spPr, "prstGeom")?.getAttribute("prst");
      const fill = solid(spPr);
      const paragraphs = all(sp, "p").filter((p) => p.parentElement?.localName === "txBody");
      const text = paragraphs.map((p) => all(p, "t").map((t) => t.textContent).join("")).join("\n");
      if (fill && (geom === "ellipse" || (!text.trim() && geom))) {
        slide.els.push({ id: `${id}e${k++}`, type: geom === "ellipse" ? "ellipse" : "rect", ...box, fill });
      }
      if (!text.trim()) continue;
      const rPr = all(sp, "rPr")[0] ?? all(sp, "defRPr")[0];
      const algn = all(sp, "pPr")[0]?.getAttribute("algn");
      const sz = Number(rPr?.getAttribute("sz"));
      const el: SlideEl = {
        id: `${id}t${k++}`,
        type: "text",
        ...box,
        text,
        size: sz ? Math.round((sz / 100) / 0.75) : isTitle ? 40 : 22,
        bold: rPr?.getAttribute("b") === "1" || isTitle,
        italic: rPr?.getAttribute("i") === "1",
        align: algn === "ctr" ? "center" : algn === "r" ? "right" : "left",
        color: solid(rPr) ?? "#1f2937",
      };
      if (fill && geom !== "ellipse") el.fill = fill;
      slide.els.push(el);
    }

    for (const pic of all(doc, "pic")) {
      const embed = all(pic, "blip")[0]?.getAttributeNS(R_NS, "embed");
      const target = embed ? slideRels.get(embed)?.target : undefined;
      const data = target ? await zip.file(target)?.async("base64") : undefined;
      const ext = target?.split(".").pop()?.toLowerCase() ?? "";
      if (!data || !MIME[ext]) continue;
      slide.els.push({ id: `${id}i${k++}`, type: "image", ...place(pic, { x: 180, y: 90, w: 600, h: 360 }), src: `data:${MIME[ext]};base64,${data}` });
    }

    const notesPath = [...slideRels.values()].find((r) => r.type.endsWith("/notesSlide"))?.target;
    const notes = notesPath ? await xml(notesPath) : null;
    if (notes) {
      slide.notes = all(notes, "sp")
        .filter((sp) => all(sp, "ph")[0]?.getAttribute("type") === "body")
        .map((sp) => all(sp, "p").map((p) => all(p, "t").map((t) => t.textContent).join("")).join("\n"))
        .join("\n")
        .trim();
    }
    slides.push(slide);
  }
  if (!slides.length) throw new Error("No slides found in that file.");
  return { type: "slides", theme: "light", slides };
}
