"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Plus } from "lucide-react";
import { APPS, AppTile, ItemIcon } from "@/components/app-icon";
import { openHref, useItems } from "@/components/files";
import { TopBar, useSession } from "@/components/shell";
import { Spinner } from "@/components/ui";
import { drive, formatWhen } from "@/lib/client";
import { EDITOR_PATH, type EditableKind } from "@/lib/types";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function HomePage() {
  const router = useRouter();
  const { user } = useSession();
  const { items } = useItems();
  const recent = useMemo(
    () =>
      (items ?? [])
        .filter((i) => !i.trashedAt && i.kind !== "folder")
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 8),
    [items],
  );
  const starred = useMemo(() => (items ?? []).filter((i) => i.starred && !i.trashedAt), [items]);

  const create = async (kind: EditableKind) => {
    const item = await drive.create(kind);
    router.push(`${EDITOR_PATH[kind]}/${item.id}`);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar title="Atrium" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <h1 className="text-2xl font-semibold" suppressHydrationWarning>
          {greeting()}
          {user && !user.guest ? `, ${user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted">Everything you need to get work done, in one place.</p>

        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {APPS.map((a) => (
            <div key={a.kind} className="card group relative flex flex-col gap-3 p-5 transition hover:-translate-y-0.5 hover:shadow-md">
              <Link href={a.href} className="absolute inset-0" aria-label={a.name} />
              <AppTile kind={a.kind} size={44} />
              <div>
                <div className="font-semibold">{a.name}</div>
                <div className="text-xs text-muted">{a.blurb}</div>
              </div>
              {a.kind !== "drive" && (
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

        <h2 className="mb-3 mt-12 text-sm font-medium text-ink-2">Recent files</h2>
        {!items ? (
          <Spinner />
        ) : recent.length === 0 ? (
          <p className="text-sm text-muted">Nothing here yet. Create something above.</p>
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

        {starred.length > 0 && (
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
