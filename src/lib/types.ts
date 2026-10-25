// Types shared by the server and the browser.

export const KINDS = ["folder", "doc", "sheet", "slides", "notebook", "file"] as const;
export type Kind = (typeof KINDS)[number];
/** Kinds that open in one of Atrium's editors and store a JSON body. */
export const EDITABLE = ["doc", "sheet", "slides", "notebook"] as const;
export type EditableKind = (typeof EDITABLE)[number];

export type Item = {
  id: string;
  kind: Kind;
  name: string;
  parentId: string | null;
  /** Uploaded files only. */
  mime?: string;
  /** Bytes of the stored body. */
  size: number;
  starred: boolean;
  trashedAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** Set while a public link is on. */
  shareId: string | null;
  /** What people with the link can do. Absent on older items, which means "view". */
  shareRole?: ShareRole;
};

export type ShareRole = "view" | "edit";

export type PublicUser = { id: string; email: string; name: string; guest: boolean; createdAt: number };

export type Usage = { used: number; quota: number };

// ---- Document bodies ----

/** Docs: a TipTap/ProseMirror JSON document plus page settings. */
export type DocBody = { type: "doc"; content: unknown; page?: { size: "a4" | "letter"; margins: "normal" | "narrow" | "wide" } };

/** Sheets: sparse cells per sheet, keyed "A1". Values starting with "=" are formulas. */
export type CellStyle = {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  /** Strikethrough. */
  s?: boolean;
  align?: "left" | "center" | "right";
  /** Vertical alignment; like Excel and Google Sheets, cells sit at the bottom when unset. */
  valign?: "top" | "middle" | "bottom";
  /** Wrap long text onto more lines; the row grows to fit. */
  wrap?: boolean;
  color?: string;
  bg?: string;
  /** Font size in points (10 when unset) and family. */
  size?: number;
  font?: string;
  /** Cell borders as CSS colours, drawn 1px solid on each named side. */
  border?: { t?: string; r?: string; b?: string; l?: string };
  fmt?: "general" | "number" | "currency" | "percent" | "date";
  /** An exact Excel number format code (e.g. "#,##0.00;[Red](#,##0.00)"); wins over fmt. */
  numFmt?: string;
};
export type SheetTab = {
  name: string;
  cells: Record<string, string>;
  styles: Record<string, CellStyle>;
  colWidths: Record<number, number>;
  /** Row heights in px where they differ from the default. Wrapped text can make a row taller. */
  rowHeights?: Record<number, number>;
  /** Merged ranges in A1 notation ("A1:C2"); the top-left cell holds the value. */
  merges?: string[];
  frozen?: { rows: number; cols: number };
};
export type SheetBody = { type: "sheet"; sheets: SheetTab[] };

/** Slides: absolutely positioned elements on a 960x540 canvas. */
export type SlideEl = {
  id: string;
  type: "text" | "rect" | "ellipse" | "image";
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  color?: string;
  fill?: string;
  src?: string;
  underline?: boolean;
  /** CSS font-family keyword: "sans" (default), "serif" or "mono". */
  font?: "sans" | "serif" | "mono";
  /** Outline colour and width (px) for shapes. */
  stroke?: string;
  strokeWidth?: number;
};
export type Slide = { id: string; bg: string; els: SlideEl[]; notes: string };
export type SlidesBody = { type: "slides"; theme: string; slides: Slide[] };

/** Notebook: sections of pages; each page is a TipTap JSON document. */
export type NotePage = { id: string; title: string; content: unknown; updatedAt: number };
export type NoteSection = { id: string; name: string; color: string; pages: NotePage[] };
export type NotebookBody = { type: "notebook"; color: string; sections: NoteSection[] };

export type Body = DocBody | SheetBody | SlidesBody | NotebookBody;

export const EDITOR_PATH: Record<EditableKind, string> = {
  doc: "/docs",
  sheet: "/sheets",
  slides: "/slides",
  notebook: "/notebook",
};
