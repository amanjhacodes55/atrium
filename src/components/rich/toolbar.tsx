"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Baseline,
  Columns3,
  Eraser,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Redo2,
  Rows3,
  Strikethrough,
  Table2,
  Trash2,
  Underline,
  Undo2,
} from "lucide-react";
import { imageToDataUrl, pickFile } from "@/lib/client";
import { PromptDialog, useDismiss, useToast } from "../ui";
import { FONT_SIZES, FONTS } from "./extensions";

const TEXT_COLORS = ["#111827", "#4b5563", "#9ca3af", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#2563eb", "#7c3aed", "#db2777", "#ffffff"];
const HIGHLIGHTS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#fed7aa", "#e9d5ff", "#fecaca", "#e5e7eb"];

function Btn({ label, on, disabled, onClick, children }: { label: string; on?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="icon-btn disabled:opacity-35"
      aria-label={label}
      title={label}
      aria-pressed={on}
      data-on={on || undefined}
      disabled={disabled}
      // Keep the selection in the editor when clicking toolbar buttons.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Swatches({
  label,
  icon,
  colors,
  current,
  onPick,
  onClear,
}: {
  label: string;
  icon: ReactNode;
  colors: string[];
  current?: string;
  onPick: (c: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="icon-btn flex-col !gap-0"
        aria-label={label}
        title={label}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        <span
          className="-mt-0.5 h-[3px] w-4 rounded-full"
          style={{ background: current || "transparent", outline: current ? undefined : "1px solid var(--line)" }}
        />
      </button>
      {open && (
        <div className="menu left-0 top-full mt-1 !min-w-0 w-[11.5rem] p-2">
          <div className="grid grid-cols-6 gap-1.5">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                className="h-6 w-6 rounded-md border border-line"
                style={{ background: c }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(c);
                  close();
                }}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-1 text-xs text-ink-2">
              <input type="color" className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" onChange={(e) => onPick(e.target.value)} />
              Custom
            </label>
            <button
              type="button"
              className="text-xs text-ink-2 hover:text-ink"
              onClick={() => {
                onClear();
                close();
              }}
            >
              None
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Formatting toolbar for a TipTap editor (Docs and Notebook). */
export function RichToolbar({ editor, extra }: { editor: Editor; extra?: ReactNode }) {
  const toast = useToast();
  const [linking, setLinking] = useState<string | null>(null);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: e.isActive("heading", { level: 1 })
        ? "h1"
        : e.isActive("heading", { level: 2 })
          ? "h2"
          : e.isActive("heading", { level: 3 })
            ? "h3"
            : e.isActive("blockquote")
              ? "quote"
              : e.isActive("codeBlock")
                ? "code"
                : "p",
      font: (e.getAttributes("textStyle").fontFamily as string) || "",
      size: ((e.getAttributes("textStyle").fontSize as string) || "").replace("pt", ""),
      color: e.getAttributes("textStyle").color as string | undefined,
      highlight: e.getAttributes("highlight").color as string | undefined,
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      link: e.isActive("link"),
      align: (["center", "right", "justify"].find((a) => e.isActive({ textAlign: a })) ?? "left") as string,
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      inTable: e.isActive("table"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      canSink: e.can().sinkListItem("listItem") || e.can().sinkListItem("taskItem"),
      canLift: e.can().liftListItem("listItem") || e.can().liftListItem("taskItem"),
    }),
  });
  const chain = () => editor.chain().focus();

  const setStyle = (v: string) => {
    if (v === "p") chain().setParagraph().run();
    else if (v === "quote") chain().setParagraph().toggleBlockquote().run();
    else if (v === "code") chain().toggleCodeBlock().run();
    else
      chain()
        .setHeading({ level: Number(v[1]) as 1 | 2 | 3 })
        .run();
  };

  const insertImage = async () => {
    const file = await pickFile("image/*");
    if (!file) return;
    try {
      chain()
        .setImage({ src: await imageToDataUrl(file) })
        .run();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const indent = (dir: "in" | "out") => {
    const type = editor.isActive("taskItem") ? "taskItem" : "listItem";
    if (dir === "in") chain().sinkListItem(type).run();
    else chain().liftListItem(type).run();
  };

  return (
    <div className="toolbar no-print" role="toolbar" aria-label="Formatting">
      <Btn label="Undo (Ctrl+Z)" disabled={!s.canUndo} onClick={() => chain().undo().run()}>
        <Undo2 size={17} />
      </Btn>
      <Btn label="Redo (Ctrl+Y)" disabled={!s.canRedo} onClick={() => chain().redo().run()}>
        <Redo2 size={17} />
      </Btn>
      <span className="sep" />
      <select aria-label="Text style" value={s.style} onChange={(e) => setStyle(e.target.value)} className="w-[7.5rem]">
        <option value="p">Normal text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="quote">Quote</option>
        <option value="code">Code</option>
      </select>
      <select
        aria-label="Font"
        value={FONTS.some((f) => f.value === s.font) ? s.font : ""}
        onChange={(e) => (e.target.value ? chain().setFontFamily(e.target.value).run() : chain().unsetFontFamily().run())}
        className="w-[7.5rem]"
      >
        {FONTS.map((f) => (
          <option key={f.label} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Font size"
        value={s.size}
        onChange={(e) => (e.target.value ? chain().setFontSize(`${e.target.value}pt`).run() : chain().unsetFontSize().run())}
        className="w-[3.6rem]"
      >
        <option value="">—</option>
        {(FONT_SIZES.includes(s.size) || !s.size ? FONT_SIZES : [s.size, ...FONT_SIZES]).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <span className="sep" />
      <Btn label="Bold (Ctrl+B)" on={s.bold} onClick={() => chain().toggleBold().run()}>
        <Bold size={17} />
      </Btn>
      <Btn label="Italic (Ctrl+I)" on={s.italic} onClick={() => chain().toggleItalic().run()}>
        <Italic size={17} />
      </Btn>
      <Btn label="Underline (Ctrl+U)" on={s.underline} onClick={() => chain().toggleUnderline().run()}>
        <Underline size={17} />
      </Btn>
      <Btn label="Strikethrough" on={s.strike} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough size={17} />
      </Btn>
      <Swatches
        label="Text colour"
        icon={<Baseline size={16} />}
        colors={TEXT_COLORS}
        current={s.color}
        onPick={(c) => chain().setColor(c).run()}
        onClear={() => chain().unsetColor().run()}
      />
      <Swatches
        label="Highlight"
        icon={<Highlighter size={16} />}
        colors={HIGHLIGHTS}
        current={s.highlight}
        onPick={(c) => chain().setHighlight({ color: c }).run()}
        onClear={() => chain().unsetHighlight().run()}
      />
      <span className="sep" />
      <Btn label="Link" on={s.link} onClick={() => setLinking((editor.getAttributes("link").href as string) || "https://")}>
        <Link2 size={17} />
      </Btn>
      <Btn label="Insert image" onClick={insertImage}>
        <ImagePlus size={17} />
      </Btn>
      <Btn label="Insert table" onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <Table2 size={17} />
      </Btn>
      <Btn label="Horizontal line" onClick={() => chain().setHorizontalRule().run()}>
        <Minus size={17} />
      </Btn>
      <span className="sep" />
      <Btn label="Align left" on={s.align === "left"} onClick={() => chain().setTextAlign("left").run()}>
        <AlignLeft size={17} />
      </Btn>
      <Btn label="Align centre" on={s.align === "center"} onClick={() => chain().setTextAlign("center").run()}>
        <AlignCenter size={17} />
      </Btn>
      <Btn label="Align right" on={s.align === "right"} onClick={() => chain().setTextAlign("right").run()}>
        <AlignRight size={17} />
      </Btn>
      <Btn label="Justify" on={s.align === "justify"} onClick={() => chain().setTextAlign("justify").run()}>
        <AlignJustify size={17} />
      </Btn>
      <span className="sep" />
      <Btn label="Bulleted list" on={s.bullet} onClick={() => chain().toggleBulletList().run()}>
        <List size={17} />
      </Btn>
      <Btn label="Numbered list" on={s.ordered} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered size={17} />
      </Btn>
      <Btn label="Checklist" on={s.task} onClick={() => chain().toggleTaskList().run()}>
        <ListChecks size={17} />
      </Btn>
      <Btn label="Decrease indent" disabled={!s.canLift} onClick={() => indent("out")}>
        <IndentDecrease size={17} />
      </Btn>
      <Btn label="Increase indent" disabled={!s.canSink} onClick={() => indent("in")}>
        <IndentIncrease size={17} />
      </Btn>
      <span className="sep" />
      <Btn label="Clear formatting" onClick={() => chain().unsetAllMarks().clearNodes().run()}>
        <Eraser size={17} />
      </Btn>
      {s.inTable && (
        <>
          <span className="sep" />
          <Btn label="Add row below" onClick={() => chain().addRowAfter().run()}>
            <Rows3 size={17} />
          </Btn>
          <Btn label="Add column right" onClick={() => chain().addColumnAfter().run()}>
            <Columns3 size={17} />
          </Btn>
          <button type="button" className="btn btn-ghost btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteRow().run()}>
            − Row
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteColumn().run()}>
            − Column
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().toggleHeaderRow().run()}>
            Header row
          </button>
          <Btn label="Delete table" onClick={() => chain().deleteTable().run()}>
            <Trash2 size={17} />
          </Btn>
        </>
      )}
      {extra}
      {linking !== null && (
        <PromptDialog
          title="Link"
          initial={linking}
          confirm="Apply"
          onClose={() => setLinking(null)}
          onSubmit={(href) => {
            const clean = href === "https://" ? "" : href;
            if (!clean) chain().extendMarkRange("link").unsetLink().run();
            else if (!/^(https?:|mailto:|tel:|#|\/)/i.test(clean)) throw new Error("Use a web address starting with https://, mailto: or tel:.");
            else if (editor.state.selection.empty && !editor.isActive("link"))
              chain()
                .insertContent({ type: "text", text: clean, marks: [{ type: "link", attrs: { href: clean } }] })
                .run();
            else chain().extendMarkRange("link").setLink({ href: clean }).run();
          }}
        />
      )}
    </div>
  );
}
