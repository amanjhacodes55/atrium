import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { fitCentered, resizeBox, snapMove } from "@/components/slides/geometry";
import { exportPptx, hex, pxToPt } from "@/lib/convert/pptx";
import { templates } from "@/lib/templates/slides";
import type { SlidesBody } from "@/lib/types";

// 1x1 transparent PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("exportPptx", () => {
  it("writes a PowerPoint package with every slide, image and note", async () => {
    const body: SlidesBody = {
      type: "slides",
      theme: "light",
      slides: [
        {
          id: "a",
          bg: "#0f172a",
          notes: "Say hello",
          els: [
            { id: "t", type: "text", x: 80, y: 100, w: 800, h: 100, text: "Hello deck", size: 48, bold: true, color: "#fff", align: "center" },
            { id: "r", type: "rect", x: 10, y: 10, w: 100, h: 50, fill: "#ff0000" },
            { id: "i", type: "image", x: 300, y: 300, w: 100, h: 100, src: PNG },
          ],
        },
        { id: "b", bg: "#ffffff", notes: "", els: [{ id: "e", type: "ellipse", x: 0, y: 0, w: 50, h: 50, fill: "#00ff00" }] },
      ],
    };
    const blob = await exportPptx(body, "Test");
    expect(blob.size).toBeGreaterThan(1000);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file("ppt/slides/slide1.xml")).toBeTruthy();
    expect(zip.file("ppt/slides/slide2.xml")).toBeTruthy();
    const slide1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide1).toContain("Hello deck");
    expect(slide1).toContain("0F172A");
    expect(Object.keys(zip.files).some((f) => f.startsWith("ppt/media/"))).toBe(true);
    const notes = Object.keys(zip.files).filter((f) => f.startsWith("ppt/notesSlides/notesSlide") && f.endsWith(".xml"));
    const allNotes = await Promise.all(notes.map((f) => zip.file(f)!.async("string")));
    expect(allNotes.join("")).toContain("Say hello");
  });

  it("exports every built-in template", async () => {
    for (const t of templates) {
      const blob = await exportPptx(t.body as SlidesBody, t.name);
      expect(blob.size).toBeGreaterThan(1000);
    }
  });
});

describe("helpers", () => {
  it("normalises colours and font sizes", () => {
    expect(hex("#abc")).toBe("AABBCC");
    expect(hex("#1e3a8a")).toBe("1E3A8A");
    expect(hex("red", "000000")).toBe("000000");
    expect(hex(undefined, "FFFFFF")).toBe("FFFFFF");
    expect(pxToPt(32)).toBe(24);
  });

  it("resizes from any handle and keeps aspect on corners", () => {
    const box = { x: 100, y: 100, w: 200, h: 100 };
    expect(resizeBox(box, "se", 50, 20)).toEqual({ x: 100, y: 100, w: 250, h: 120 });
    expect(resizeBox(box, "nw", 50, 20)).toEqual({ x: 150, y: 120, w: 150, h: 80 });
    expect(resizeBox(box, "e", -1000, 0).w).toBe(12);
    const kept = resizeBox(box, "se", 100, 0, true);
    expect(kept.w / kept.h).toBeCloseTo(2);
    expect(resizeBox(box, "n", 0, -30)).toEqual({ x: 100, y: 70, w: 200, h: 130 });
  });

  it("snaps to the canvas centre and other elements", () => {
    const canvas = { w: 960, h: 540 };
    const centred = snapMove({ x: 377, y: 10, w: 200, h: 50 }, [], canvas);
    expect(centred.x).toBe(380);
    expect(centred.guides.x).toBe(480);
    const toOther = snapMove({ x: 503, y: 300, w: 50, h: 50 }, [{ x: 100, y: 100, w: 400, h: 50 }], canvas);
    expect(toOther.x).toBe(500);
    const free = snapMove({ x: 200, y: 200, w: 33, h: 33 }, [], canvas);
    expect(free).toEqual({ x: 200, y: 200, guides: { x: null, y: null } });
  });

  it("fits images inside a box, centred", () => {
    expect(fitCentered(1200, 600, 600, 400, { w: 960, h: 540 })).toEqual({ x: 180, y: 120, w: 600, h: 300 });
    expect(fitCentered(100, 50, 600, 400, { w: 960, h: 540 })).toEqual({ x: 430, y: 245, w: 100, h: 50 });
  });
});
