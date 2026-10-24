import type { Body, EditableKind, SheetTab, Slide } from "./types";

// Starting bodies for new files. Shared by the server (create) and tests.

export const blankSheet = (name = "Sheet1"): SheetTab => ({ name, cells: {}, styles: {}, colWidths: {} });

export const blankSlide = (id: string, title = true): Slide => ({
  id,
  bg: "#ffffff",
  notes: "",
  els: title
    ? [
        { id: `${id}-t`, type: "text", x: 80, y: 170, w: 800, h: 110, text: "Click to add title", size: 48, bold: true, align: "center", color: "#1f2937" },
        { id: `${id}-s`, type: "text", x: 160, y: 300, w: 640, h: 60, text: "Click to add subtitle", size: 24, align: "center", color: "#6b7280" },
      ]
    : [{ id: `${id}-t`, type: "text", x: 60, y: 40, w: 840, h: 80, text: "Title", size: 36, bold: true, color: "#1f2937" }],
});

export function blankBody(kind: EditableKind, id: string): Body {
  switch (kind) {
    case "doc":
      return { type: "doc", content: { type: "doc", content: [{ type: "paragraph" }] }, page: { size: "a4", margins: "normal" } };
    case "sheet":
      return { type: "sheet", sheets: [blankSheet()] };
    case "slides":
      return { type: "slides", theme: "light", slides: [blankSlide(`${id}1`)] };
    case "notebook":
      return {
        type: "notebook",
        color: "#7c3aed",
        sections: [
          {
            id: `${id}s`,
            name: "Quick notes",
            color: "#7c3aed",
            pages: [{ id: `${id}p`, title: "Untitled page", content: { type: "doc", content: [{ type: "paragraph" }] }, updatedAt: Date.now() }],
          },
        ],
      };
  }
}

export const DEFAULT_NAME: Record<EditableKind | "folder", string> = {
  doc: "Untitled document",
  sheet: "Untitled spreadsheet",
  slides: "Untitled presentation",
  notebook: "Untitled notebook",
  folder: "New folder",
};
