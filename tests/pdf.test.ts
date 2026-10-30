import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { extractPages, imagesToPdf, mergePdfs, parseRanges } from "@/lib/pdf/core";
import { applyEdits, toPage } from "@/lib/pdf/edit";
import { docToPdf } from "@/lib/pdf/from-doc";
import { blocksToDoc, blocksToDocx, type Block } from "@/lib/pdf/to-word";
import { templates as docTemplates } from "@/lib/templates/doc";
import { doc, h, p, table, tasks, text, ul } from "@/lib/templates/tiptap";
import type { DocBody } from "@/lib/types";

async function makePdf(pages: [number, number][]): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (const size of pages) d.addPage(size);
  return d.save();
}

const sizes = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPages().map((pg) => [Math.round(pg.getWidth()), Math.round(pg.getHeight())]);

describe("parseRanges", () => {
  it("reads single pages, ranges and open ends", () => {
    expect(parseRanges("1-3, 5", 9)).toEqual([[0, 1, 2], [4]]);
    expect(parseRanges("8-", 9)).toEqual([[7, 8]]);
    expect(parseRanges("-2", 9)).toEqual([[0, 1]]);
    expect(parseRanges("3-1", 9)).toEqual([[2, 1, 0]]);
  });

  it("explains pages that don't exist and nonsense", () => {
    expect(() => parseRanges("2-12", 9)).toThrow(/9 pages/);
    expect(() => parseRanges("abc", 9)).toThrow(/isn't a page/);
    expect(() => parseRanges(" , ", 9)).toThrow(/Enter the pages/);
  });
});

describe("merge and split", () => {
  it("merges files in order and splits ranges back out", async () => {
    const a = await makePdf([
      [100, 200],
      [110, 200],
    ]);
    const b = await makePdf([[300, 400]]);
    const merged = await mergePdfs([a, b]);
    expect(await sizes(merged)).toEqual([
      [100, 200],
      [110, 200],
      [300, 400],
    ]);
    const parts = await extractPages(merged, [[2], [1, 0]]);
    expect(await sizes(parts[0])).toEqual([[300, 400]]);
    expect(await sizes(parts[1])).toEqual([
      [110, 200],
      [100, 200],
    ]);
  });

  it("rejects files that aren't PDFs", async () => {
    await expect(mergePdfs([new TextEncoder().encode("hello")])).rejects.toThrow(/isn't a PDF/);
  });
});

describe("toPage", () => {
  const box = { x: 0, y: 0, width: 600, height: 800 };
  it("flips y on an upright page", () => {
    expect(toPage(0, 0, { w: 600, h: 800 }, box, 0)).toEqual({ x: 0, y: 800 });
    expect(toPage(600, 800, { w: 600, h: 800 }, box, 0)).toEqual({ x: 600, y: 0 });
  });

  it("maps the shown corners of rotated pages onto the right page corners", () => {
    // Turned a quarter clockwise, the shown top-left is the page's bottom-left.
    expect(toPage(0, 0, { w: 800, h: 600 }, box, 90)).toEqual({ x: 0, y: 0 });
    expect(toPage(800, 0, { w: 800, h: 600 }, box, 90)).toEqual({ x: 0, y: 800 });
    expect(toPage(0, 0, { w: 600, h: 800 }, box, 180)).toEqual({ x: 600, y: 0 });
    expect(toPage(0, 0, { w: 800, h: 600 }, box, 270)).toEqual({ x: 600, y: 800 });
  });

  it("adds the crop box offset", () => {
    expect(toPage(0, 0, { w: 600, h: 800 }, { ...box, x: 10, y: 20 }, 0)).toEqual({ x: 10, y: 820 });
  });
});

describe("applyEdits", () => {
  it("reorders, rotates and drops pages and draws marks", async () => {
    const src = await makePdf([
      [200, 300],
      [400, 500],
      [600, 700],
    ]);
    const out = await applyEdits(
      src,
      [
        { src: 2, rotate: 90, marks: [{ id: "t", kind: "text", x: 10, y: 10, text: "Hello ✓ wörld", size: 12, color: "#dc2626", font: "serif", bold: true }] },
        {
          src: 0,
          rotate: 0,
          marks: [
            { id: "r", kind: "rect", x: 5, y: 5, w: 50, h: 20, color: "#ffffff", opacity: 1 },
            { id: "i", kind: "ink", points: [[1, 1], [20, 30]], color: "#000000", width: 2 },
          ],
        },
      ],
      { pageNumbers: { position: "bottom-center", start: 1 }, watermark: { text: "DRAFT", opacity: 0.2 } },
    );
    const d = await PDFDocument.load(out);
    expect(d.getPageCount()).toBe(2);
    expect(d.getPage(0).getRotation().angle).toBe(90);
    expect(Math.round(d.getPage(1).getWidth())).toBe(200);
  });
});

describe("imagesToPdf", () => {
  it("puts each image on its own page, landscape images on landscape pages", async () => {
    // A 2x1 PNG.
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAGAQH/Hf+AAAAAAElFTkSuQmCC"), (c) => c.charCodeAt(0));
    const file = new File([png], "wide.png", { type: "image/png" });
    const out = await imagesToPdf([file, file], { size: "a4", orientation: "auto", margin: 18 });
    expect(await sizes(out)).toEqual([
      [842, 595],
      [842, 595],
    ]);
  });
});

describe("docToPdf", () => {
  it("typesets every document template onto pages", async () => {
    for (const t of docTemplates) {
      const out = await docToPdf(t.body as DocBody, t.name);
      expect((await PDFDocument.load(out)).getPageCount(), t.name).toBeGreaterThan(0);
    }
  });

  it("flows long documents onto more pages and keeps the page size", async () => {
    const long = Array.from({ length: 120 }, (_, i) => p(`Paragraph ${i} `.repeat(12)));
    const body: DocBody = {
      type: "doc",
      page: { size: "letter", margins: "narrow" },
      content: doc(h(1, "Title"), ...long, ul("a", "b"), tasks(["done", true], "todo"), table([["A", "B"], ["1", "2"]]), p(text("ünïcödé ✓ 中文", "bold"))),
    };
    const d = await PDFDocument.load(await docToPdf(body));
    expect(d.getPageCount()).toBeGreaterThan(3);
    expect(Math.round(d.getPage(0).getWidth())).toBe(612);
  });
});

describe("PDF to Word output", () => {
  const blocks: Block[] = [
    { type: "heading", level: 1, runs: [{ text: "Report", bold: true }], align: "center" },
    { type: "paragraph", runs: [{ text: "Plain " }, { text: "bold", bold: true }] },
    { type: "item", ordered: false, runs: [{ text: "one" }] },
    { type: "item", ordered: false, runs: [{ text: "two" }] },
    { type: "pageBreak" },
    { type: "item", ordered: true, runs: [{ text: "first" }] },
  ];

  it("groups list items into lists for Atrium Docs", () => {
    const body = blocksToDoc(blocks);
    const content = (body.content as { content: { type: string; content?: unknown[] }[] }).content;
    expect(content.map((n) => n.type)).toEqual(["heading", "paragraph", "bulletList", "orderedList"]);
    expect(content[2].content).toHaveLength(2);
  });

  it("writes a Word file", async () => {
    const blob = await blocksToDocx(blocks);
    expect(blob.size).toBeGreaterThan(1000);
  });
});
