"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Users } from "lucide-react";
import { APPS, AppTile, ItemIcon } from "@/components/app-icon";
import { openHref, useItems } from "@/components/files";
import { TopBar, useSession } from "@/components/shell";
import { Spinner, useToast } from "@/components/ui";
import { drive, formatWhen } from "@/lib/client";
import type { SharedEntry } from "@/lib/shared";
import { templates as docTemplates } from "@/lib/templates/doc";
import { templates as sheetTemplates } from "@/lib/templates/sheet";
import { templates as slidesTemplates } from "@/lib/templates/slides";
import { EDITOR_PATH, type Body, type EditableKind } from "@/lib/types";

/** "Start something new": a blank file per app, then a few popular templates. */
const STARTERS: { kind: EditableKind; name: string; label: string; body?: Body }[] = [
  { kind: "doc", name: "", label: "Blank document" },
  { kind: "sheet", name: "", label: "Blank spreadsheet" },
  { kind: "slides", name: "", label: "Blank presentation" },
  ...[docTemplates[0], docTemplates[1], sheetTemplates[0], slidesTemplates[0]]
    .filter(Boolean)
    .map((t) => ({ kind: t.body.type as EditableKind, name: t.name, label: t.name, body: t.body })),
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function HomePage() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useSession();
  const { items } = useItems();
  const [query, setQuery] = useState("");
  const [shared, setShared] = useState<SharedEntry[]>([]);
  useEffect(() => {
    drive
      .shared()
      .then(setShared)
      .catch(() => {});
  }, []);
  const recent = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? [])
      .filter((i) => !i.trashedAt && i.kind !== "folder" && (!q || i.name.toLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, q ? 40 : 8);
  }, [items, query]);
  const starred = useMemo(() => (items ?? []).filter((i) => i.starred && !i.trashedAt), [items]);

  const create = async (kind: EditableKind, opts: { name?: string; body?: Body } = {}) => {
    try {
      const item = await drive.create(kind, { name: opts.name || undefined, body: opts.body ? structuredClone(opts.body) : undefined });
      router.push(`${EDITOR_PATH[kind]}/${item.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar title="Atrium">
        <label className="relative w-full max-w-xl">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input !h-10 !rounded-full !bg-surface-2 pl-10" placeholder="Search all your files" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search all your files" />
        </label>
      </TopBar>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <h1 className="text-2xl font-semibold" suppressHydrationWarning>
          {greeting()}
          {user && !user.guest ? `, ${user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted">Everything you need to get work done, in one place.</p>

        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {APPS.map((a) => (
            <div key={a.kind} className="card group relative flex flex-col gap-3 p-5 transition hover:-translate-y-0.5 hover:shadow-md">
              <Link href={a.href} className="absolute inset-0" aria-label={a.name} />
              <AppTile kind={a.kind} size={44} />
              <div>
                <div className="font-semibold">{a.name}</div>
                <div className="text-xs text-muted">{a.blurb}</div>
              </div>
              {a.kind !== "drive" && a.kind !== "pdf" && (
                <button
                  type="button"
                  onClick={() => void create(a.kind as EditableKind)}
                  className="relative z-10 mt-auto flex w-fit items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-hover"
                  style={{ color: a.color }}
                >
                  <Plus size={14} /> New
                </button>
              )}
            </div>
          ))}
        </div>

        <h2 className="mb-3 mt-10 text-sm font-medium text-ink-2">Start something new</h2>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {STARTERS.map((t) => (
            <button key={t.label} type="button" onClick={() => void create(t.kind, t)} className="group w-32 shrink-0 text-left">
              <div className="relative flex h-40 items-center justify-center overflow-hidden rounded-xl border border-line bg-white transition group-hover:-translate-y-0.5 group-hover:border-accent group-hover:shadow-md">
                {t.body ? <TemplateSketch kind={t.kind} /> : <Plus size={40} style={{ color: APPS.find((a) => a.kind === t.kind)?.color }} />}
                <span className="absolute bottom-2 left-2">
                  <AppTile kind={t.kind} size={20} />
                </span>
              </div>
              <div className="mt-2 truncate text-[13px] font-medium" title={t.label}>
                {t.label}
              </div>
            </button>
          ))}
        </div>

        <h2 className="mb-3 mt-10 text-sm font-medium text-ink-2">{query ? `Files matching “${query}”` : "Recent files"}</h2>
        {!items ? (
          <Spinner />
        ) : recent.length === 0 ? (
          <p className="text-sm text-muted">{query ? "Nothing matches your search." : "Nothing here yet. Create something above."}</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {recent.map((i) => (
              <Link key={i.id} href={openHref(i) ?? `/drive${i.parentId ? `?folder=${i.parentId}` : ""}`} className="card flex items-center gap-3 p-3.5 hover:border-accent">
                <ItemIcon item={i} size={26} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{i.name}</div>
                  <div className="text-xs text-muted">Edited {formatWhen(i.updatedAt)}</div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {shared.length > 0 && !query && (
          <>
            <div className="mb-3 mt-10 flex items-center gap-2">
              <h2 className="text-sm font-medium text-ink-2">Shared with you</h2>
              <Link href="/drive?view=with-me" className="text-xs text-accent hover:underline">
                See all
              </Link>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {shared.slice(0, 4).map((e) => (
                <Link key={e.shareId} href={`/s/${e.shareId}`} className="card flex items-center gap-3 p-3.5 hover:border-accent">
                  <Users size={22} className="shrink-0 text-muted" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{e.name}</div>
                    <div className="truncate text-xs text-muted">
                      {e.owner} · {e.role === "edit" ? "can edit" : "can view"}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}

        {starred.length > 0 && !query && (
          <>
            <h2 className="mb-3 mt-10 text-sm font-medium text-ink-2">Starred</h2>
            <div className="flex flex-wrap gap-2">
              {starred.map((i) => (
                <Link key={i.id} href={openHref(i) ?? "/drive?view=starred"} className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:border-accent">
                  <ItemIcon item={i} size={16} /> {i.name}
                </Link>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/** A tiny drawing of a page, deck or grid, so templates look like what they make. */
function TemplateSketch({ kind }: { kind: EditableKind }) {
  if (kind === "sheet")
    return (
      <div className="grid h-full w-full grid-cols-4 gap-px bg-gray-200 p-px pt-4">
        {Array.from({ length: 28 }, (_, i) => (
          <div key={i} className={i < 4 ? "bg-green-50" : "bg-white"} />
        ))}
      </div>
    );
  if (kind === "slides")
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-50 p-2">
        <div className="flex aspect-video w-full flex-col justify-center gap-1.5 rounded bg-gradient-to-br from-orange-500 to-rose-500 p-2">
          <div className="h-2 w-3/4 rounded bg-white/90" />
          <div className="h-1.5 w-1/2 rounded bg-white/60" />
        </div>
      </div>
    );
  return (
    <div className="flex h-full w-full flex-col gap-1.5 p-3 pt-4">
      <div className="h-2.5 w-3/4 rounded bg-gray-800" />
      {[90, 100, 80, 95, 60].map((w, i) => (
        <div key={i} className="h-1 rounded bg-gray-300" style={{ width: `${w}%` }} />
      ))}
      <div className="mt-1 h-1.5 w-1/2 rounded bg-gray-500" />
      {[100, 85, 92].map((w, i) => (
        <div key={i} className="h-1 rounded bg-gray-300" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}
