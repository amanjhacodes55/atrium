import type { Body, EditableKind } from "../types";

/** A starting point shown on each app's home page next to "Blank". */
export type Template = { name: string; description: string; body: Body };
export type { EditableKind };
