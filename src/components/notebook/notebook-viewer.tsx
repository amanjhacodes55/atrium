"use client";

import { useState } from "react";
import { RichContent, useRich } from "@/components/rich/editor";
import type { NotebookBody, NotePage } from "@/lib/types";

/** Read-only notebook with section and page navigation, for public share links. */
export function NotebookViewer({ body }: { body: NotebookBody }) {
  const [sectionId, setSectionId] = useState(body.sections[0]?.id);
  const section = body.sections.find((s) => s.id === sectionId) ?? body.sections[0];
  const [pageId, setPageId] = useState(section?.pages[0]?.id);
  const page = section?.pages.find((p) => p.id === pageId) ?? section?.pages[0];
  if (!section) return <p className="p-10 text-center text-sm text-muted">This notebook is empty.</p>;
  return (
    <div className="flex min-h-[70vh] flex-col md:flex-row">
      <nav aria-label="Sections and pages" className="flex shrink-0 flex-col border-line bg-surface-2 md:w-64 md:border-r">
        <div className="flex gap-1 overflow-x-auto p-2 md:flex-col">
          {body.sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setSectionId(s.id);
                setPageId(s.pages[0]?.id);
              }}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${s.id === section.id ? "bg-surface font-semibold shadow-sm" : "hover:bg-hover"}`}
            >
              <span className="h-3.5 w-1.5 rounded-full" style={{ background: s.color }} />
              {s.name}
            </button>
          ))}
        </div>
        <div className="border-t border-line p-2">
          {section.pages.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPageId(p.id)}
              className="block w-full truncate rounded-md border-l-[3px] px-2.5 py-1.5 text-left text-sm hover:bg-hover"
              style={{ borderColor: p.id === page?.id ? section.color : "transparent" }}
            >
              {p.title || "Untitled page"}
            </button>
          ))}
        </div>
      </nav>
      <main className="min-w-0 flex-1 bg-[var(--paper)]">
        {page ? <PageView key={page.id} page={page} /> : <p className="p-10 text-sm text-gray-400">No pages.</p>}
      </main>
    </div>
  );
}

function PageView({ page }: { page: NotePage }) {
  const editor = useRich({ content: page.content, editable: false });
  return (
    <article className="mx-auto max-w-3xl px-6 py-8 md:px-10">
      <h1 className="text-3xl font-bold text-[#111827]">{page.title}</h1>
      <p className="mb-6 mt-2 text-xs text-gray-400">{new Date(page.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</p>
      <RichContent editor={editor} />
    </article>
  );
}
