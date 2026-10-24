import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";

// One extension list for the Docs and Notebook editors, the read-only viewers and Word import, so
// every path understands exactly the same document schema.
export function richExtensions(opts: { placeholder?: string; editable?: boolean } = {}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: !opts.editable,
        autolink: true,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      },
    }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    Highlight.configure({ multicolor: true }),
    Image.configure({
      allowBase64: true,
      resize: opts.editable
        ? { enabled: true, directions: ["bottom-right", "bottom-left"], minWidth: 40, minHeight: 40, alwaysPreserveAspectRatio: true }
        : false,
    }),
    Table.configure({ resizable: Boolean(opts.editable) }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    ...(opts.placeholder ? [Placeholder.configure({ placeholder: opts.placeholder })] : []),
  ];
}

export const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

export const FONTS = [
  { label: "Default", value: "" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Courier New", value: "'Courier New', monospace" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', sans-serif" },
];

export const FONT_SIZES = ["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "32", "36", "48", "72"];
