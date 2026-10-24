"use client";

import { Suspense, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Clock, FolderPlus, HardDrive, LayoutGrid, List, Plus, Search, Share2, Star, Trash2, Upload } from "lucide-react";
import { APPS, AppTile } from "@/components/app-icon";
import { FileList, useItems } from "@/components/files";
import { TopBar, useSession } from "@/components/shell";
import { Dropdown, PromptDialog, Spinner, useToast } from "@/components/ui";
import { drive, formatBytes } from "@/lib/client";
import { EDITOR_PATH, type EditableKind, type Item } from "@/lib/types";

const VIEWS = [
  { id: "my", label: "My Drive", Icon: HardDrive },
  { id: "recent", label: "Recent", Icon: Clock },
  { id: "starred", label: "Starred", Icon: Star },
  { id: "shared", label: "Shared by link", Icon: Share2 },
  { id: "trash", label: "Trash", Icon: Trash2 },
] as const;
type View = (typeof VIEWS)[number]["id"];

type Sort = "name" | "updated" | "size";

function sortItems(list: Item[], sort: Sort) {
  return [...list].sort((a, b) => {
    // Folders first, like every file manager.
    if ((a.kind === "folder") !== (b.kind === "folder")) return a.kind === "folder" ? -1 : 1;
    if (sort === "updated") return b.updatedAt - a.updatedAt;
    if (sort === "size") return b.size - a.size;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

function DriveView() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { refresh } = useSession();
  const { items, usage, error, reload, put } = useItems();
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const [sort, setSort] = useState<Sort>("name");
  const [newFolder, setNewFolder] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const view = (params.get("view") as View) || "my";
  const folderId = view === "my" ? params.get("folder") : null;

  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const trail = useMemo(() => {
    const out: Item[] = [];
    for (let id = folderId; id; ) {
      const f = byId.get(id);
      if (!f) break;
      out.unshift(f);
      id = f.parentId;
    }
    return out;
  }, [folderId, byId]);

  const shown = useMemo(() => {
    if (!items) return [];
    const live = items.filter((i) => !i.trashedAt);
    const q = query.trim().toLowerCase();
    // Searching looks through the whole drive, not just the open folder.
    if (q) return sortItems(live.filter((i) => i.name.toLowerCase().includes(q)), sort);
    switch (view) {
      case "recent":
        return live
          .filter((i) => i.kind !== "folder")
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 50);
      case "starred":
        return sortItems(live.filter((i) => i.starred), sort);
      case "shared":
        return sortItems(live.filter((i) => i.shareId), sort);
      case "trash":
        // Show what was trashed, not everything inside trashed folders.
        return items.filter((i) => i.trashedAt && !(i.parentId && byId.get(i.parentId)?.trashedAt === i.trashedAt)).sort((a, b) => b.trashedAt! - a.trashedAt!);
      default:
        return sortItems(live.filter((i) => i.parentId === folderId), sort);
    }
  }, [items, view, folderId, query, sort, byId]);

  const upload = async (files: FileList | File[]) => {
    const list = [...files];
    setUploading((n) => n + list.length);
    for (const file of list) {
      try {
        put(await drive.upload(file, folderId));
      } catch (e) {
        toast(`${file.name}: ${(e as Error).message}`, "error");
      }
      setUploading((n) => n - 1);
    }
    refresh();
    void reload();
  };

  const create = async (kind: EditableKind) => {
    const item = await drive.create(kind, { parentId: folderId });
    router.push(`${EDITOR_PATH[kind]}/${item.id}`);
  };

  const go = (q: Record<string, string | null>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v) next.set(k, v);
    setQuery("");
    router.push(`/drive${next.size ? `?${next}` : ""}`);
  };

  const title = query ? `Results for “${query}”` : (VIEWS.find((v) => v.id === view)?.label ?? "My Drive");
  const pct = usage ? Math.min(100, (usage.used / usage.quota) * 100) : 0;

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar title="Drive" color="var(--app-drive)">
        <label className="relative w-full max-w-xl">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input !h-10 !rounded-full !bg-surface-2 pl-10" placeholder="Search in Drive" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search in Drive" />
        </label>
      </TopBar>
      <div className="flex flex-1">
        <aside className="no-print hidden w-60 shrink-0 flex-col gap-1 p-3 md:flex">
          <Dropdown
            className="btn mb-3 h-12 w-36 justify-start rounded-2xl px-4 shadow-sm"
            trigger={
              <>
                <Plus size={20} /> New
              </>
            }
            items={[
              { label: "New folder", icon: <FolderPlus size={16} />, onClick: () => setNewFolder(true) },
              { label: "Upload files", icon: <Upload size={16} />, onClick: () => fileInput.current?.click() },
              "sep",
              ...APPS.filter((a) => a.kind !== "drive").map((a) => ({
                label: a.kind === "doc" ? "Document" : a.kind === "sheet" ? "Spreadsheet" : a.kind === "slides" ? "Presentation" : "Notebook",
                icon: <AppTile kind={a.kind} size={18} />,
                onClick: () => void create(a.kind as EditableKind),
              })),
            ]}
          />
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => go({ view: v.id === "my" ? null : v.id })}
              className={`flex items-center gap-3 rounded-full px-4 py-2 text-sm ${view === v.id && !query ? "bg-accent-wash font-semibold text-accent" : "hover:bg-hover"}`}
            >
              <v.Icon size={18} /> {v.label}
            </button>
          ))}
          {usage && (
            <div className="mt-4 px-4">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 1)}%`, background: pct > 90 ? "var(--danger)" : "var(--accent)" }} />
              </div>
              <p className="mt-2 text-xs text-muted">
                {formatBytes(usage.used)} of {formatBytes(usage.quota)} used
              </p>
            </div>
          )}
          <div className="mt-auto space-y-1 px-1 pt-6">
            {APPS.filter((a) => a.kind !== "drive").map((a) => (
              <Link key={a.kind} href={a.href} className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm text-ink-2 hover:bg-hover">
                <AppTile kind={a.kind} size={20} /> {a.name}
              </Link>
            ))}
          </div>
        </aside>
        <main
          className={`min-w-0 flex-1 p-4 md:pr-6 ${dropping ? "outline-2 -outline-offset-8 outline-dashed outline-accent" : ""}`}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files") && view === "my") {
              e.preventDefault();
              setDropping(true);
            }
          }}
          onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
          onDrop={(e) => {
            setDropping(false);
            if (e.dataTransfer.files.length && view === "my") {
              e.preventDefault();
              void upload(e.dataTransfer.files);
            }
          }}
        >
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1 text-lg">
              {view === "my" && !query ? (
                <>
                  <button type="button" onClick={() => go({})} className="rounded-lg px-2 py-1 font-medium hover:bg-hover">
                    My Drive
                  </button>
                  {trail.map((f) => (
                    <span key={f.id} className="flex min-w-0 items-center gap-1">
                      <ChevronRight size={18} className="shrink-0 text-muted" />
                      <button type="button" onClick={() => go({ folder: f.id })} className="truncate rounded-lg px-2 py-1 font-medium hover:bg-hover">
                        {f.name}
                      </button>
                    </span>
                  ))}
                </>
              ) : (
                <h1 className="px-2 font-medium">{title}</h1>
              )}
            </div>
            {uploading > 0 && <span className="text-xs text-muted">Uploading {uploading}…</span>}
            {view === "my" && (
              <button type="button" className="btn btn-sm md:hidden" onClick={() => fileInput.current?.click()}>
                <Upload size={15} /> Upload
              </button>
            )}
            {view === "trash" && shown.length > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                style={{ color: "var(--danger)" }}
                onClick={async () => {
                  await drive.emptyTrash();
                  toast("Trash emptied");
                  refresh();
                  void reload();
                }}
              >
                <Trash2 size={15} /> Empty trash
              </button>
            )}
            <select className="input !h-8 !w-auto !text-xs" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by">
              <option value="name">Name</option>
              <option value="updated">Last modified</option>
              <option value="size">Size</option>
            </select>
            <div className="flex rounded-lg border border-line">
              <button type="button" className="icon-btn" data-on={layout === "list"} aria-label="List view" onClick={() => setLayout("list")}>
                <List size={17} />
              </button>
              <button type="button" className="icon-btn" data-on={layout === "grid"} aria-label="Grid view" onClick={() => setLayout("grid")}>
                <LayoutGrid size={17} />
              </button>
            </div>
          </div>
          {view === "trash" && <p className="mb-3 px-2 text-xs text-muted">Items in the trash stay until you delete them or empty the trash.</p>}
          {error ? (
            <p className="p-6 text-sm text-danger">{error}</p>
          ) : !items ? (
            <Spinner />
          ) : (
            <FileList
              items={shown}
              all={items}
              view={layout}
              showLocation={Boolean(query) || view === "starred" || view === "recent" || view === "shared"}
              onChange={(i) => {
                put(i);
                refresh();
              }}
              onRemove={() => void reload()}
              emptyText={
                query
                  ? "Nothing matches your search."
                  : view === "trash"
                    ? "The trash is empty."
                    : view === "starred"
                      ? "Star files to find them here quickly."
                      : view === "shared"
                        ? "Files you share by link show up here."
                        : "Drop files here, or use New to create one."
              }
            />
          )}
        </main>
      </div>
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && void upload(e.target.files).then(() => (e.target.value = ""))} />
      {newFolder && (
        <PromptDialog
          title="New folder"
          initial="Untitled folder"
          confirm="Create"
          onSubmit={async (name) => put(await drive.create("folder", { name, parentId: folderId }))}
          onClose={() => setNewFolder(false)}
        />
      )}
    </div>
  );
}

export default function DrivePage() {
  return (
    <Suspense>
      <DriveView />
    </Suspense>
  );
}
