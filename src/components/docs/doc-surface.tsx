"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { useRich } from "@/components/rich/editor";
import { RichToolbar } from "@/components/rich/toolbar";
import type { LiveDoc, LiveStatus, LiveUser, Presence } from "@/lib/live-client";
import type { DocBody } from "@/lib/types";
import { useLivePage, usePresence } from "./live";
import { PagedSurface, pageGeometry, type PageSettings } from "./paged";
import { Pagination } from "./pagination";

export type DocContext = {
  editor: Editor | null;
  page: PageSettings;
  setPage: (p: PageSettings) => void;
  people: Presence[];
  status: LiveStatus;
  /** The document as it is right now, for downloads. */
  snapshot: () => DocBody;
};

/**
 * A live document laid out on pages: header (supplied by the caller), toolbar, the pages, and a
 * status bar. Shared by the owner's editor and by public links (editable or not). `onChange` fires
 * for edits made here, not for ones arriving from other people, so only the person typing saves.
 */
export function LiveDocEditor({
  live,
  user,
  editable,
  onChange,
  header,
}: {
  live: LiveDoc;
  user: LiveUser;
  editable: boolean;
  onChange?: (body: DocBody) => void;
  header: (ctx: DocContext) => ReactNode;
}) {
  const [page, setLivePage] = useLivePage(live);
  const [pages, setPages] = useState(1);
  const [counts, setCounts] = useState({ words: 0, chars: 0 });
  const { people, status } = usePresence(live);
  // The pagination plugin and the change handler outlive renders, so they read the page from here.
  const latest = useRef(page);
  useEffect(() => {
    latest.current = page;
  }, [page]);

  // The getter runs inside the plugin after layout, never during render.
  // eslint-disable-next-line react-hooks/refs
  const extra = useMemo(() => [Pagination.configure({ geometry: () => pageGeometry(latest.current), onPages: setPages })], []);
  // One identity per mount; a later rename is pushed with updateUser below.
  const [liveOpt] = useState(() => ({ doc: live, user }));
  const count = useCallback((text: string) => setCounts({ words: (text.match(/\S+/g) ?? []).length, chars: text.length }), []);
  const editor = useRich({
    content: null,
    live: liveOpt,
    editable,
    extra,
    placeholder: editable ? "Start typing…" : undefined,
    onChange: (json, ed, remote) => {
      count(ed.getText());
      if (!remote && editable) onChange?.({ type: "doc", content: json, page: latest.current });
    },
  });

  useEffect(() => {
    // The editor only exists after mount, so the first count has to happen here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (editor) count(editor.getText());
  }, [editor, count]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.commands.updateUser(user);
  }, [editor, user]);

  const setPage = (p: PageSettings) => {
    setLivePage(p);
    if (editor) onChange?.({ type: "doc", content: editor.getJSON(), page: p });
  };
  const snapshot = (): DocBody => ({ type: "doc", content: editor?.getJSON(), page });
  const g = pageGeometry(page);

  return (
    <div className="flex h-dvh flex-col">
      <style>{`@media print { @page { size: ${page.size === "a4" ? "A4" : "letter"}; margin: ${g.top}px ${g.right}px ${g.bottom}px ${g.left}px; } }`}</style>
      {header({ editor, page, setPage, people, status, snapshot })}
      {editable && editor && <RichToolbar editor={editor} />}
      <div className="flex-1 overflow-auto bg-plane px-4 py-6 print:overflow-visible print:bg-white print:p-0">
        <PagedSurface editor={editor} page={page} pages={pages} onBackgroundClick={() => editor?.commands.focus("end")} />
      </div>
      <footer className="no-print flex h-7 items-center gap-4 border-t border-line bg-surface px-4 text-xs text-muted">
        <span>
          {pages} {pages === 1 ? "page" : "pages"}
        </span>
        <span>
          {counts.words.toLocaleString()} {counts.words === 1 ? "word" : "words"}
        </span>
        <span className="max-sm:hidden">{counts.chars.toLocaleString()} characters</span>
        <span className="flex-1" />
        {people.length > 1 && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#16a34a]" />
            {people.length} people here
          </span>
        )}
        <span className="max-sm:hidden">
          {page.size === "a4" ? "A4" : "Letter"} · {page.margins} margins
        </span>
      </footer>
    </div>
  );
}
