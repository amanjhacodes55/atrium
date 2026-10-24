import { describe, expect, it } from "vitest";
import { docToMarkdown, exportDocx, imageSize } from "@/lib/convert/docx";
import { templates as docTemplates } from "@/lib/templates/doc";
import { templates as notebookTemplates } from "@/lib/templates/notebook";
import { doc, h, ol, p, table, tasks, text, ul } from "@/lib/templates/tiptap";
import type { DocBody } from "@/lib/types";

// 1x1 transparent PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const sample: DocBody = {
  type: "doc",
  page: { size: "letter", margins: "narrow" },
  content: doc(
    h(1, "Report"),
    p(text("Bold", "bold"), " and ", text("italic", "italic")),
    ul("one", "two"),
    { type: "bulletList", content: [{ type: "listItem", content: [p("parent"), ol("child a", "child b")] }] },
    tasks(["done", true], "todo"),
    table([
      ["A", "B"],
      ["1", "2"],
    ]),
    { type: "image", attrs: { src: PNG } },
  ),
};

describe("exportDocx", () => {
  it("produces a .docx zip", async () => {
    const blob = await exportDocx(sample, "Report");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(2000);
    // ZIP local file header.
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("exports every doc template", async () => {
    for (const t of docTemplates) {
      const blob = await exportDocx(t.body as DocBody, t.name);
      expect(blob.size).toBeGreaterThan(1000);
    }
  });
});

describe("docToMarkdown", () => {
  it("converts headings, marks, lists, tasks and tables", () => {
    const md = docToMarkdown(sample.content);
    expect(md).toContain("# Report");
    expect(md).toContain("**Bold** and *italic*");
    expect(md).toContain("- one");
    expect(md).toContain("   1. child a");
    expect(md).toContain("- [x] done");
    expect(md).toContain("| A | B |");
  });
});

describe("imageSize", () => {
  it("reads PNG dimensions", () => {
    const bytes = Uint8Array.from(Buffer.from(PNG.split(",")[1], "base64"));
    expect(imageSize(bytes)).toEqual({ w: 1, h: 1 });
  });
});

describe("templates", () => {
  // ProseMirror rejects empty text nodes, so a template with one would fail to open.
  const walk = (n: { text?: string; type: string; content?: unknown[] }): void => {
    if (n.type === "text") expect(n.text).not.toBe("");
    (n.content as (typeof n)[] | undefined)?.forEach(walk);
  };
  it("have no empty text nodes", () => {
    for (const t of docTemplates) walk((t.body as DocBody).content as never);
    for (const t of notebookTemplates) if (t.body.type === "notebook") for (const s of t.body.sections) for (const pg of s.pages) walk(pg.content as never);
  });
});
