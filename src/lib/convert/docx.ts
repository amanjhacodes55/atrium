import type { DocBody } from "../types";

// Word and other formats for Docs. Everything works on TipTap JSON; heavy libraries (docx, mammoth,
// TipTap's HTML helpers) are imported on demand so they stay out of the editor's first load.

export type JNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};

// ---- Import ----

export async function importDocx(file: File): Promise<DocBody> {
  const [mammoth, { generateJSON }, { richExtensions }] = await Promise.all([
    import("mammoth"),
    import("@tiptap/core"),
    import("@/components/rich/extensions"),
  ]);
  // Images come through as data URIs, which is how Atrium stores them.
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return { type: "doc", content: generateJSON(value || "<p></p>", richExtensions()), page: { size: "a4", margins: "normal" } };
}

// ---- HTML and Markdown ----

export async function docToHtml(content: unknown, title: string): Promise<string> {
  const [{ generateHTML }, { richExtensions }] = await Promise.all([import("@tiptap/core"), import("@/components/rich/extensions")]);
  const body = generateHTML(content as JNode, richExtensions());
  const esc = title.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc}</title>
<style>body{font-family:system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#111827}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #d1d5db;padding:.35em .6em;text-align:left}th{background:#f3f4f6}
blockquote{border-left:3px solid #d1d5db;margin-left:0;padding-left:1em;color:#4b5563}img{max-width:100%}
pre{background:#0f172a;color:#e2e8f0;padding:.8em 1em;border-radius:8px;overflow-x:auto}
ul[data-type=taskList]{list-style:none;padding-left:.2em}ul[data-type=taskList] li{display:flex;gap:.5em}ul[data-type=taskList] p{margin:0}</style>
</head><body>
${body}
</body></html>`;
}

function mdInline(nodes: JNode[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === "hardBreak") return "  \n";
      if (n.type !== "text") return "";
      let t = n.text ?? "";
      const has = (m: string) => n.marks?.some((x) => x.type === m);
      if (has("code")) return "`" + t + "`";
      t = t.replace(/([*_`[\]\\])/g, "\\$1");
      if (has("bold")) t = `**${t}**`;
      if (has("italic")) t = `*${t}*`;
      if (has("strike")) t = `~~${t}~~`;
      const link = n.marks?.find((x) => x.type === "link");
      if (link) t = `[${t}](${link.attrs?.href})`;
      return t;
    })
    .join("");
}

function mdBlocks(nodes: JNode[] = [], indent = ""): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "heading":
        out.push(`${"#".repeat(Number(n.attrs?.level) || 1)} ${mdInline(n.content)}`);
        break;
      case "paragraph":
        out.push(indent + mdInline(n.content));
        break;
      case "blockquote":
        out.push(
          mdBlocks(n.content)
            .map((l) => `> ${l}`)
            .join("\n>\n"),
        );
        break;
      case "codeBlock":
        out.push("```" + ((n.attrs?.language as string) || "") + "\n" + (n.content ?? []).map((t) => t.text).join("") + "\n```");
        break;
      case "horizontalRule":
        out.push("---");
        break;
      case "image":
        out.push(`![${(n.attrs?.alt as string) || ""}](${n.attrs?.src})`);
        break;
      case "bulletList":
      case "orderedList":
      case "taskList": {
        const lines = (n.content ?? []).map((li, i) => {
          const marker = n.type === "orderedList" ? `${i + 1}.` : n.type === "taskList" ? `- [${li.attrs?.checked ? "x" : " "}]` : "-";
          const [first, ...rest] = li.content ?? [];
          const head = `${indent}${marker} ${first ? mdInline(first.content) : ""}`;
          const sub = mdBlocks(rest, indent + "   ");
          return [head, ...sub].join("\n");
        });
        out.push(lines.join("\n"));
        break;
      }
      case "table": {
        const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => mdBlocks(c.content).join(" ").replace(/\|/g, "\\|").replace(/\n/g, " ")));
        if (!rows.length) break;
        const width = Math.max(...rows.map((r) => r.length));
        const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
        out.push([line(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n"));
        break;
      }
      default:
        if (n.content) out.push(...mdBlocks(n.content, indent));
    }
  }
  return out;
}

export function docToMarkdown(content: unknown): string {
  return mdBlocks((content as JNode)?.content).join("\n\n") + "\n";
}

// ---- Word export ----

type Docx = typeof import("docx");
type Child = import("docx").Paragraph | import("docx").Table;
type Run = import("docx").ParagraphChild;

const PAGE = {
  a4: { width: 11906, height: 16838 },
  letter: { width: 12240, height: 15840 },
};
const MARGINS = {
  normal: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
  narrow: { top: 720, bottom: 720, left: 720, right: 720 },
  wide: { top: 1440, bottom: 1440, left: 2880, right: 2880 },
};

const hex = (c: unknown) => {
  if (typeof c !== "string") return undefined;
  const m = c.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (m) return (m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1]).toUpperCase();
  const rgb = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return rgb
    ? rgb
        .slice(1, 4)
        .map((v) => Number(v).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()
    : undefined;
};

/** Font size in Word half-points from a CSS size like "12pt" or "16px". */
const halfPoints = (size: unknown) => {
  if (typeof size !== "string") return undefined;
  const n = parseFloat(size);
  if (!n) return undefined;
  return Math.round((size.endsWith("px") ? n * 0.75 : n) * 2);
};

const firstFont = (f: unknown) => (typeof f === "string" && f ? f.split(",")[0].replace(/['"]/g, "").trim() : undefined);

function dataUrlBytes(src: string): { bytes: Uint8Array; type: "png" | "jpg" | "gif" | "bmp" } | null {
  const m = src.match(/^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/);
  if (!m) return null;
  const bin = typeof atob === "function" ? atob(m[2]) : Buffer.from(m[2], "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, type: m[1] === "jpeg" ? "jpg" : (m[1] as "png" | "jpg" | "gif" | "bmp") };
}

/** Pixel size from the image header (PNG, GIF, JPEG); falls back to 4:3. */
export function imageSize(b: Uint8Array): { w: number; h: number } {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  if (b[0] === 0x89 && b[1] === 0x50) return { w: (u16(16) << 16) | u16(18), h: (u16(20) << 16) | u16(22) };
  if (b[0] === 0x47 && b[1] === 0x49) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) break;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { w: u16(i + 7), h: u16(i + 5) };
      i += 2 + u16(i + 2);
    }
  }
  return { w: 400, h: 300 };
}

export async function exportDocx(body: DocBody, name: string): Promise<Blob> {
  const d: Docx = await import("docx");
  const page = PAGE[body.page?.size ?? "a4"];
  const margin = MARGINS[body.page?.margins ?? "normal"];
  // Usable width in pixels (twips / 15), so images never overflow the page.
  const maxImg = Math.floor((page.width - margin.left - margin.right) / 15);
  let listInstance = 0;

  const runs = (nodes: JNode[] = [], base: Record<string, unknown> = {}): Run[] => {
    const out: Run[] = [];
    for (const n of nodes) {
      if (n.type === "hardBreak") {
        out.push(new d.TextRun({ break: 1 }));
        continue;
      }
      if (n.type === "image") {
        const img = imageRun(n);
        if (img) out.push(img);
        continue;
      }
      if (n.type !== "text" || !n.text) continue;
      const marks = Object.fromEntries((n.marks ?? []).map((m) => [m.type, m.attrs ?? {}]));
      const style = (marks.textStyle ?? {}) as Record<string, unknown>;
      const hl = hex((marks.highlight as Record<string, unknown> | undefined)?.color ?? (marks.highlight ? "#fef08a" : undefined));
      const run = new d.TextRun({
        text: n.text,
        bold: Boolean(marks.bold) || undefined,
        italics: Boolean(marks.italic) || undefined,
        underline: marks.underline || marks.link ? {} : undefined,
        strike: Boolean(marks.strike) || undefined,
        color: hex(style.color) ?? (marks.link ? "2563EB" : undefined),
        size: halfPoints(style.fontSize) ?? (base.size as number | undefined),
        font: marks.code ? "Courier New" : (firstFont(style.fontFamily) ?? (base.font as string | undefined)),
        shading: hl ? { type: d.ShadingType.CLEAR, color: "auto", fill: hl } : undefined,
        ...(base.italics ? { italics: true } : {}),
      });
      const href = (marks.link as Record<string, unknown> | undefined)?.href;
      out.push(typeof href === "string" ? new d.ExternalHyperlink({ link: href, children: [run] }) : run);
    }
    return out;
  };

  const imageRun = (n: JNode) => {
    const src = n.attrs?.src;
    const data = typeof src === "string" ? dataUrlBytes(src) : null;
    if (!data) return null;
    const natural = imageSize(data.bytes);
    let w = Number(n.attrs?.width) || natural.w;
    let h = Number(n.attrs?.height) || (natural.h * w) / natural.w;
    if (w > maxImg) {
      h = (h * maxImg) / w;
      w = maxImg;
    }
    return new d.ImageRun({ type: data.type, data: data.bytes, transformation: { width: Math.round(w), height: Math.round(h) } });
  };

  const alignment = (n: JNode) =>
    ({ center: d.AlignmentType.CENTER, right: d.AlignmentType.RIGHT, justify: d.AlignmentType.JUSTIFIED })[n.attrs?.textAlign as string] ?? undefined;

  // `depth` is the nesting level of the list being written; `task` is the checkbox still to draw.
  type Ctx = { list?: { kind: "bullet" | "ordered"; level: number; instance: number }; quote?: boolean; task?: boolean | null; depth?: number };

  const blocks = (nodes: JNode[] = [], ctx: Ctx = {}): Child[] => {
    const out: Child[] = [];
    for (const n of nodes) {
      switch (n.type) {
        case "paragraph":
        case "heading": {
          const children = runs(n.content, ctx.quote ? { italics: true } : {});
          if (ctx.task != null) {
            children.unshift(new d.TextRun({ text: ctx.task ? "☑ " : "☐ " }));
            ctx = { ...ctx, task: null };
          }
          const level = Number(n.attrs?.level);
          out.push(
            new d.Paragraph({
              children,
              heading: n.type === "heading" ? [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3][level - 1] : undefined,
              alignment: alignment(n),
              bullet: ctx.list?.kind === "bullet" ? { level: ctx.list.level } : undefined,
              numbering: ctx.list?.kind === "ordered" ? { reference: "ordered", level: ctx.list.level, instance: ctx.list.instance } : undefined,
              indent: ctx.quote ? { left: 720 } : undefined,
              border: ctx.quote ? { left: { style: d.BorderStyle.SINGLE, size: 18, color: "D1D5DB", space: 12 } } : undefined,
            }),
          );
          // Only the first paragraph of a list item carries the bullet.
          if (ctx.list) ctx = { ...ctx, list: undefined };
          break;
        }
        case "blockquote":
          out.push(...blocks(n.content, { ...ctx, quote: true }));
          break;
        case "codeBlock": {
          const lines = (n.content ?? [])
            .map((t) => t.text ?? "")
            .join("")
            .split("\n");
          out.push(
            new d.Paragraph({
              shading: { type: d.ShadingType.CLEAR, color: "auto", fill: "F3F4F6" },
              children: lines.flatMap((line, i) => [new d.TextRun({ text: line, font: "Courier New", size: 20, break: i ? 1 : undefined })]),
            }),
          );
          break;
        }
        case "horizontalRule":
          out.push(new d.Paragraph({ border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: "D1D5DB", space: 1 } } }));
          break;
        case "image": {
          const img = imageRun(n);
          if (img) out.push(new d.Paragraph({ children: [img] }));
          break;
        }
        case "bulletList":
        case "orderedList":
        case "taskList": {
          const level = ctx.depth === undefined ? 0 : Math.min(ctx.depth + 1, 8);
          const instance = n.type === "orderedList" ? ++listInstance : 0;
          for (const li of n.content ?? []) {
            if (n.type === "taskList") {
              out.push(...blocks(li.content, { quote: ctx.quote, task: Boolean(li.attrs?.checked), depth: level }));
            } else {
              out.push(
                ...blocks(li.content, {
                  quote: ctx.quote,
                  list: { kind: n.type === "orderedList" ? "ordered" : "bullet", level, instance },
                  depth: level,
                }),
              );
            }
          }
          break;
        }
        case "table": {
          const rows = n.content ?? [];
          const cols = Math.max(1, ...rows.map((r) => (r.content ?? []).reduce((s, c) => s + (Number(c.attrs?.colspan) || 1), 0)));
          out.push(
            new d.Table({
              width: { size: 100, type: d.WidthType.PERCENTAGE },
              columnWidths: Array(cols).fill(Math.floor((page.width - margin.left - margin.right) / cols)),
              rows: rows.map(
                (r) =>
                  new d.TableRow({
                    tableHeader: (r.content ?? []).every((c) => c.type === "tableHeader") || undefined,
                    children: (r.content ?? []).map((c) => {
                      const header = c.type === "tableHeader";
                      const inner = blocks(c.content);
                      return new d.TableCell({
                        columnSpan: Number(c.attrs?.colspan) || 1,
                        rowSpan: Number(c.attrs?.rowspan) || 1,
                        shading: header ? { type: d.ShadingType.CLEAR, color: "auto", fill: "F3F4F6" } : undefined,
                        margins: { top: 60, bottom: 60, left: 100, right: 100 },
                        children: inner.length ? (header ? boldify(c.content) : inner) : [new d.Paragraph({})],
                      });
                    }),
                  }),
              ),
            }),
          );
          out.push(new d.Paragraph({}));
          break;
        }
        default:
          if (n.content) out.push(...blocks(n.content, ctx));
      }
    }
    return out;
  };

  // Header cells: same content, bold.
  const boldify = (nodes: JNode[] = []) =>
    blocks(nodes.map((p) => ({ ...p, content: p.content?.map((t) => (t.type === "text" ? { ...t, marks: [...(t.marks ?? []), { type: "bold" }] } : t)) })));

  const levels = Array.from({ length: 9 }, (_, level) => ({
    level,
    format: [d.LevelFormat.DECIMAL, d.LevelFormat.LOWER_LETTER, d.LevelFormat.LOWER_ROMAN][level % 3],
    text: `%${level + 1}.`,
    alignment: d.AlignmentType.START,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));

  const doc = new d.Document({
    title: name,
    creator: "Atrium",
    styles: { default: { document: { run: { font: "Calibri", size: 23 } } } },
    numbering: { config: [{ reference: "ordered", levels }] },
    sections: [
      {
        properties: { page: { size: page, margin } },
        children: blocks((body.content as JNode)?.content),
      },
    ],
  });
  return d.Packer.toBlob(doc);
}
