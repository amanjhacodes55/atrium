"use client";

import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { EMPTY_DOC, richExtensions } from "./extensions";
import "./rich.css";

/** A TipTap editor over Atrium's rich-text schema. Remount (via `key`) to load different content. */
export function useRich({
  content,
  onChange,
  placeholder,
  editable = true,
}: {
  content: unknown;
  onChange?: (json: unknown, editor: Editor) => void;
  placeholder?: string;
  editable?: boolean;
}) {
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  });
  const extensions = useMemo(() => richExtensions({ placeholder, editable }), [placeholder, editable]);
  return useEditor({
    extensions,
    content: (content as object) ?? EMPTY_DOC,
    editable,
    immediatelyRender: false,
    editorProps: { attributes: { class: "prose-atrium", spellcheck: "true" } },
    onUpdate: ({ editor }) => changed.current?.(editor.getJSON(), editor),
  });
}

export function RichContent({ editor, className = "" }: { editor: Editor | null; className?: string }) {
  return <EditorContent editor={editor} className={className} />;
}
