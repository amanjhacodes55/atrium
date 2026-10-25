"use client";

import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { Extensions } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import Collaboration, { isChangeOrigin } from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import type { LiveDoc, LiveUser } from "@/lib/live-client";
import { EMPTY_DOC, richExtensions } from "./extensions";
import "./rich.css";

/**
 * A TipTap editor over Atrium's rich-text schema. Remount (via `key`) to load different content.
 * With `live`, the content comes from the shared Yjs document instead of `content`, other people's
 * carets are shown, and `onChange` reports whether the change was yours or arrived from someone else.
 */
export function useRich({
  content,
  onChange,
  placeholder,
  editable = true,
  live,
  extra,
}: {
  content: unknown;
  onChange?: (json: unknown, editor: Editor, remote: boolean) => void;
  placeholder?: string;
  editable?: boolean;
  live?: { doc: LiveDoc; user: LiveUser };
  extra?: Extensions;
}) {
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  });
  const extensions = useMemo(
    () => [
      ...richExtensions({ placeholder, editable, live: Boolean(live) }),
      ...(live
        ? [
            Collaboration.configure({ document: live.doc.doc }),
            CollaborationCaret.configure({ provider: live.doc, user: live.user }),
          ]
        : []),
      ...(extra ?? []),
    ],
    // The editor is remounted (by key) whenever these change, so the first values are the ones that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placeholder, editable, live],
  );
  return useEditor({
    extensions,
    // A live document's content is in the Yjs doc; passing it here as well would insert it twice.
    content: live ? undefined : ((content as object) ?? EMPTY_DOC),
    editable,
    immediatelyRender: false,
    editorProps: { attributes: { class: "prose-atrium", spellcheck: "true" } },
    onUpdate: ({ editor, transaction }) => changed.current?.(editor.getJSON(), editor, live ? isChangeOrigin(transaction as Transaction) : false),
  });
}

export function RichContent({ editor, className = "" }: { editor: Editor | null; className?: string }) {
  return <EditorContent editor={editor} className={className} />;
}
