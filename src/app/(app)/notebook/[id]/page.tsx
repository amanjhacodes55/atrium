"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Palette, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { downloadIcon, EditorHeader, useAutosave } from "@/components/editor-shell";
import { RichContent, useRich } from "@/components/rich/editor";
import { EMPTY_DOC } from "@/components/rich/extensions";
import { RichToolbar } from "@/components/rich/toolbar";
import { Dropdown, PromptDialog, Spinner, useToast } from "@/components/ui";
import { downloadBlob, drive, formatWhen, safeFileName } from "@/lib/client";
import type { Item, NotebookBody, NotePage, NoteSection } from "@/lib/types";

const COLOR_NAMES: Record<string, string> = {
  "#7c3aed": "Purple",
  "#2563eb": "Blue",
  "#0891b2": "Teal",
  "#16a34a": "Green",
  "#ca8a04": "Yellow",
  "#ea580c": "Orange",
  "#dc2626": "Red",
  "#db2777": "Pink",
  "#64748b": "Grey",
};
const SECTION_COLORS = Object.keys(COLOR_NAMES);

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);
const newPage = (): NotePage => ({ id: newId(), title: "Untitled page", content: EMPTY_DOC, updatedAt: Date.now() });

export default function NotebookPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<Item | null>(null);
  const [body, setBody] = useState<NotebookBody | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    drive
      .body<NotebookBody>(id)
      .then((r) => {
        setItem(r.item);
        setBody(r.body);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (item) document.title = `${item.name} · Atrium Notebook`;
  }, [item]);

  if (error) return <p className="m-auto p-10 text-center text-sm text-danger">{error}</p>;
  if (!item || !body) return <Spinner label="Opening notebook" />;
  return <Notebook item={item} setItem={setItem} initial={body} />;
}

function Notebook({ item, setItem, initial }: { item: Item; setItem: (i: Item) => void; initial: NotebookBody }) {
  const toast = useToast();
  const [body, setBody] = useState<NotebookBody>(() =>
    initial.sections.length ? initial : { ...initial, sections: [{ id: newId(), name: "Notes", color: SECTION_COLORS[0], pages: [newPage()] }] },
  );
  const [sectionId, setSectionId] = useState(body.sections[0].id);
  const [pageId, setPageId] = useState<string | null>(body.sections[0].pages[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<NoteSection | null>(null);
  const { state, changed } = useAutosave(item.id, setItem);

  const section = body.sections.find((s) => s.id === sectionId) ?? body.sections[0];
  const page = section.pages.find((p) => p.id === pageId) ?? null;

  const commit = (next: NotebookBody) => {
    setBody(next);
    changed(next);
  };
  const editSection = (sid: string, fn: (s: NoteSection) => NoteSection) => commit({ ...body, sections: body.sections.map((s) => (s.id === sid ? fn(s) : s)) });
  const editPage = (pid: string, patch: Partial<NotePage>) =>
    // Functional update: editor keystrokes can arrive faster than renders.
    setBody((b) => {
      const next = {
        ...b,
        sections: b.sections.map((s) => ({ ...s, pages: s.pages.map((p) => (p.id === pid ? { ...p, ...patch, updatedAt: Date.now() } : p)) })),
      };
      changed(next);
      return next;
    });

  const addSection = () => {
    const s: NoteSection = {
      id: newId(),
      name: `Section ${body.sections.length + 1}`,
      color: SECTION_COLORS[body.sections.length % SECTION_COLORS.length],
      pages: [newPage()],
    };
    commit({ ...body, sections: [...body.sections, s] });
    setSectionId(s.id);
    setPageId(s.pages[0].id);
    setRenaming(s);
  };

  const deleteSection = (s: NoteSection) => {
    if (body.sections.length === 1) return toast("A notebook needs at least one section.", "error");
    if (s.pages.length && !window.confirm(`Delete “${s.name}” and its ${s.pages.length} page${s.pages.length === 1 ? "" : "s"}?`)) return;
    const rest = body.sections.filter((x) => x.id !== s.id);
    commit({ ...body, sections: rest });
    if (s.id === section.id) {
      setSectionId(rest[0].id);
      setPageId(rest[0].pages[0]?.id ?? null);
    }
  };

  const addPage = () => {
    const p = newPage();
    editSection(section.id, (s) => ({ ...s, pages: [p, ...s.pages] }));
    setPageId(p.id);
    setQuery("");
  };

  const deletePage = (p: NotePage) => {
    const rest = section.pages.filter((x) => x.id !== p.id);
    editSection(section.id, (s) => ({ ...s, pages: rest }));
    if (p.id === pageId) setPageId(rest[0]?.id ?? null);
  };

  const pages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return section.pages;
    return section.pages.filter((p) => p.title.toLowerCase().includes(q) || JSON.stringify(p.content).toLowerCase().includes(q));
  }, [section.pages, query]);

  const fileMenu = [
    {
      label: "Download page as Word (.docx)",
      icon: downloadIcon,
      onClick: async () => {
        if (!page) return;
        const { exportDocx } = await import("@/lib/convert/docx");
        downloadBlob(await exportDocx({ type: "doc", content: page.content }, page.title), `${safeFileName(page.title)}.docx`);
      },
    },
    {
      label: "Download notebook as Markdown",
      icon: downloadIcon,
      onClick: async () => {
        const { docToMarkdown } = await import("@/lib/convert/docx");
        const md = body.sections.map((s) => `# ${s.name}\n\n` + s.pages.map((p) => `## ${p.title}\n\n${docToMarkdown(p.content)}`).join("\n")).join("\n");
        downloadBlob(new Blob([md], { type: "text/markdown" }), `${safeFileName(item.name)}.md`);
      },
    },
  ];

  return (
    <div className="flex h-dvh flex-col">
      <EditorHeader kind="notebook" item={item} setItem={setItem} save={state} fileMenu={fileMenu} />
      <div className="flex min-h-0 flex-1">
        {/* Sections */}
        <nav aria-label="Sections" className="no-print flex w-52 shrink-0 flex-col border-r border-line bg-surface-2">
          <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Sections</div>
          <div className="flex-1 overflow-y-auto px-2">
            {body.sections.map((s) => (
              <div key={s.id} className={`group mb-0.5 flex items-center rounded-lg pr-1 ${s.id === section.id ? "bg-surface shadow-sm" : "hover:bg-hover"}`}>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-sm"
                  onClick={() => {
                    setSectionId(s.id);
                    setPageId(s.pages[0]?.id ?? null);
                    setQuery("");
                  }}
                >
                  <span className="h-4 w-1.5 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className={`truncate ${s.id === section.id ? "font-semibold" : ""}`}>{s.name}</span>
                  <span className="ml-auto text-xs text-muted">{s.pages.length}</span>
                </button>
                <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <Dropdown
                    label={`${s.name} options`}
                    className="icon-btn !h-7 !w-7"
                    align="right"
                    trigger={<MoreHorizontal size={15} />}
                    items={[
                      { label: "Rename", icon: <Pencil size={15} />, onClick: () => setRenaming(s) },
                      "sep" as const,
                      ...SECTION_COLORS.filter((c) => c !== s.color).map((c) => ({
                        label: COLOR_NAMES[c],
                        icon: <Palette size={15} style={{ color: c }} />,
                        onClick: () => editSection(s.id, (x) => ({ ...x, color: c })),
                      })),
                      "sep" as const,
                      { label: "Delete section", icon: <Trash2 size={15} />, danger: true, onClick: () => deleteSection(s) },
                    ]}
                  />
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="m-2 flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-ink-2 hover:bg-hover" onClick={addSection}>
            <Plus size={16} /> Add section
          </button>
        </nav>

        {/* Pages */}
        <nav aria-label="Pages" className="no-print flex w-64 shrink-0 flex-col border-r border-line bg-surface">
          <div className="flex items-center gap-1 p-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                className="input !h-8 !pl-8 text-sm"
                placeholder="Search pages"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search pages"
              />
            </div>
            <button type="button" className="icon-btn" aria-label="Add page" title="Add page" onClick={addPage} style={{ color: section.color }}>
              <Plus size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {pages.map((p) => (
              <div key={p.id} className="group relative" style={p.id === pageId ? { background: "var(--accent-wash)" } : undefined}>
                <button
                  type="button"
                  className="block w-full border-l-[3px] px-3 py-2.5 text-left hover:bg-hover"
                  style={{ borderColor: p.id === pageId ? section.color : "transparent" }}
                  onClick={() => setPageId(p.id)}
                >
                  <div className="truncate pr-6 text-sm font-medium">{p.title || "Untitled page"}</div>
                  <div className="mt-0.5 truncate text-xs text-muted">{formatWhen(p.updatedAt)}</div>
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${p.title}`}
                  className="icon-btn absolute right-1.5 top-2 !h-7 !w-7 opacity-0 group-hover:opacity-100 focus:opacity-100"
                  onClick={() => deletePage(p)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {!pages.length && <p className="px-4 py-6 text-center text-sm text-muted">{query ? "No pages match." : "No pages yet."}</p>}
          </div>
        </nav>

        {/* Page */}
        <main className="flex min-w-0 flex-1 flex-col bg-[var(--paper)]">
          {page ? (
            <PageEditor key={page.id} page={page} accent={section.color} onChange={(patch) => editPage(page.id, patch)} />
          ) : (
            <div className="m-auto text-center">
              <p className="mb-3 text-sm text-muted">This section is empty.</p>
              <button type="button" className="btn btn-primary" onClick={addPage}>
                <Plus size={16} /> New page
              </button>
            </div>
          )}
        </main>
      </div>
      {renaming && (
        <PromptDialog
          title="Rename section"
          initial={renaming.name}
          onClose={() => setRenaming(null)}
          onSubmit={(name) => editSection(renaming.id, (s) => ({ ...s, name: name.slice(0, 60) }))}
        />
      )}
    </div>
  );
}

function PageEditor({ page, accent, onChange }: { page: NotePage; accent: string; onChange: (patch: Partial<NotePage>) => void }) {
  const [title, setTitle] = useState(page.title);
  const editor = useRich({
    content: page.content,
    placeholder: "Write something, or type [ ] for a checklist…",
    onChange: (json) => onChange({ content: json }),
  });
  return (
    <>
      {editor && <RichToolbar editor={editor} />}
      <div className="flex-1 overflow-y-auto" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus("end")}>
        <div className="mx-auto max-w-3xl px-10 py-8">
          <input
            aria-label="Page title"
            className="w-full bg-transparent text-3xl font-bold text-[#111827] placeholder:text-gray-300 focus:outline-none"
            placeholder="Page title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              onChange({ title: e.target.value.slice(0, 200) });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                editor?.commands.focus("start");
              }
            }}
          />
          <div className="mb-6 mt-2 flex items-center gap-2 text-xs text-gray-400">
            <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
            {new Date(page.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </div>
          <RichContent editor={editor} />
        </div>
      </div>
    </>
  );
}
