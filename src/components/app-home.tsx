"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Plus, Search } from "lucide-react";
import { templates as docTemplates } from "@/lib/templates/doc";
import { templates as notebookTemplates } from "@/lib/templates/notebook";
import { templates as sheetTemplates } from "@/lib/templates/sheet";
import { templates as slidesTemplates } from "@/lib/templates/slides";
import type { Template } from "@/lib/templates";
import { drive, pickFile } from "@/lib/client";
import { EDITOR_PATH, type EditableKind } from "@/lib/types";
import { appOf, AppTile } from "./app-icon";
import { convertFile, FileList, stripExt, useItems } from "./files";
import { TopBar, useSession } from "./shell";
import { Spinner, useToast } from "./ui";

const TEMPLATES: Record<EditableKind, Template[]> = { doc: docTemplates, sheet: sheetTemplates, slides: slidesTemplates, notebook: notebookTemplates };

const NOUN: Record<EditableKind, { one: string; many: string; accept?: string; importLabel?: string }> = {
  doc: { one: "document", many: "documents", accept: ".docx", importLabel: "Open a Word file" },
  sheet: { one: "spreadsheet", many: "spreadsheets", accept: ".xlsx,.csv", importLabel: "Open an Excel or CSV file" },
  slides: { one: "presentation", many: "presentations", accept: ".pptx", importLabel: "Open a PowerPoint file" },
  notebook: { one: "notebook", many: "notebooks" },
};

/** Start page for one app: new from blank or a template, import, and that app's files. */
export function AppHome({ kind }: { kind: EditableKind }) {
  const router = useRouter();
  const toast = useToast();
  const { refresh } = useSession();
  const app = appOf(kind);
  const noun = NOUN[kind];
  const { items, error, put, reload } = useItems();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const mine = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter((i) => i.kind === kind && !i.trashedAt && (!q || i.name.toLowerCase().includes(q))).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [items, kind, query]);

  const start = async (fn: () => Promise<{ id: string }>) => {
    if (busy) return;
    setBusy(true);
    try {
      const item = await fn();
      router.push(`${EDITOR_PATH[kind]}/${item.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar title={app.name} color={app.color}>
        <label className="relative w-full max-w-xl">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input !h-10 !rounded-full !bg-surface-2 pl-10" placeholder={`Search ${noun.many}`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={`Search ${noun.many}`} />
        </label>
      </TopBar>
      <section className="border-b border-line bg-surface-2/60">
        <div className="mx-auto max-w-6xl px-4 py-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink-2">Start a new {noun.one}</h2>
            {noun.accept && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={async () => {
                  const file = await pickFile(noun.accept!);
                  if (!file) return;
                  await start(async () => {
                    const { body } = await convertFile(file);
                    return drive.create(kind, { name: stripExt(file.name), body });
                  });
                }}
              >
                <FileUp size={15} /> {noun.importLabel}
              </button>
            )}
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2">
            <button type="button" disabled={busy} onClick={() => start(() => drive.create(kind))} className="group w-36 shrink-0 text-left">
              <div className="flex h-44 items-center justify-center rounded-xl border border-line bg-white transition group-hover:border-accent">
                <Plus size={44} style={{ color: app.color }} />
              </div>
              <div className="mt-2 text-sm font-medium">Blank {noun.one}</div>
            </button>
            {TEMPLATES[kind].map((t) => (
              <button
                key={t.name}
                type="button"
                disabled={busy}
                onClick={() => start(() => drive.create(kind, { name: t.name, body: structuredClone(t.body) }))}
                className="group w-36 shrink-0 text-left"
              >
                <div className="flex h-44 flex-col justify-between overflow-hidden rounded-xl border border-line bg-white p-3 transition group-hover:border-accent">
                  <AppTile kind={kind} size={26} />
                  <p className="text-[11px] leading-snug text-gray-500">{t.description}</p>
                </div>
                <div className="mt-2 truncate text-sm font-medium" title={t.name}>
                  {t.name}
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <h2 className="mb-3 text-sm font-medium text-ink-2">{query ? "Search results" : `Recent ${noun.many}`}</h2>
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : !items ? (
          <Spinner />
        ) : (
          <FileList
            items={mine}
            all={items}
            view="list"
            showLocation
            onChange={(i) => {
              put(i);
              refresh();
            }}
            onRemove={() => void reload()}
            emptyText={query ? "Nothing matches your search." : `No ${noun.many} yet. Start one above.`}
          />
        )}
      </main>
    </div>
  );
}
