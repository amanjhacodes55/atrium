"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ChevronRight,
  Copy,
  ExternalLink,
  Folder,
  FilePen,
  FolderInput,
  MoreVertical,
  Pencil,
  RotateCcw,
  Scissors,
  Share2,
  Star,
  Trash2,
  Wand2,
} from "lucide-react";
import { drive, formatBytes, formatWhen } from "@/lib/client";
import { EDITOR_PATH, type Body, type EditableKind, type Item, type Usage } from "@/lib/types";
import { ItemIcon } from "./app-icon";
import { ShareDialog } from "./editor-shell";
import { useSession } from "./shell";
import { Dropdown, Modal, PromptDialog, useToast, type MenuEntry } from "./ui";

export function useItems() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(
    () =>
      drive.list().then(
        (r) => {
          setItems(r.items);
          setUsage(r.usage);
        },
        (e: Error) => setError(e.message),
      ),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  /** Swap in a changed item without refetching. */
  const put = useCallback((item: Item) => setItems((list) => (list ? [...list.filter((i) => i.id !== item.id), item] : list)), []);
  return { items, usage, error, reload, put };
}

export const openHref = (item: Item) =>
  item.kind === "folder" ? `/drive?folder=${item.id}` : item.kind === "file" ? null : `${EDITOR_PATH[item.kind as EditableKind]}/${item.id}`;

// ---- Office files: open an uploaded .docx/.xlsx/.pptx/.csv in Atrium's editors ----

const IMPORTABLE: { test: RegExp; kind: EditableKind }[] = [
  { test: /\.docx$/i, kind: "doc" },
  { test: /\.(xlsx|csv)$/i, kind: "sheet" },
  { test: /\.pptx$/i, kind: "slides" },
];
export const importKind = (name: string) => IMPORTABLE.find((i) => i.test.test(name))?.kind ?? null;

/** Converts a Word, Excel, CSV or PowerPoint file into an Atrium body. */
export async function convertFile(file: File): Promise<{ kind: EditableKind; body: Body }> {
  const kind = importKind(file.name);
  if (kind === "doc") return { kind, body: await (await import("@/lib/convert/docx")).importDocx(file) };
  if (kind === "sheet") {
    const x = await import("@/lib/convert/xlsx");
    if (/\.csv$/i.test(file.name)) {
      const tab = x.importCsv(await file.text());
      return { kind, body: { type: "sheet", sheets: [{ ...tab, name: file.name.replace(/\.csv$/i, "").slice(0, 31) || "Sheet1" }] } };
    }
    return { kind, body: await x.importXlsx(file) };
  }
  if (kind === "slides") return { kind, body: await (await import("@/lib/convert/pptx")).importPptx(file) };
  throw new Error("Atrium can open .docx, .xlsx, .csv and .pptx files.");
}

export const stripExt = (name: string) => name.replace(/\.(docx|xlsx|csv|pptx)$/i, "");

// ---- Dialogs ----

export function MoveDialog({ item, items, onMoved, onClose }: { item: Item; items: Item[]; onMoved: (i: Item) => void; onClose: () => void }) {
  const toast = useToast();
  const [at, setAt] = useState<string | null>(item.parentId);
  const folders = items.filter((i) => i.kind === "folder" && !i.trashedAt && i.id !== item.id);
  const children = folders.filter((f) => f.parentId === at);
  const trail: Item[] = [];
  for (let id = at; id; ) {
    const f = folders.find((x) => x.id === id);
    if (!f) break;
    trail.unshift(f);
    id = f.parentId;
  }
  return (
    <Modal title={`Move “${item.name}”`} onClose={onClose}>
      <div className="mb-2 flex flex-wrap items-center gap-1 text-sm">
        <button type="button" className="rounded px-1.5 py-0.5 hover:bg-hover" onClick={() => setAt(null)}>
          My Drive
        </button>
        {trail.map((f) => (
          <span key={f.id} className="flex items-center gap-1">
            <ChevronRight size={14} className="text-muted" />
            <button type="button" className="rounded px-1.5 py-0.5 hover:bg-hover" onClick={() => setAt(f.id)}>
              {f.name}
            </button>
          </span>
        ))}
      </div>
      <div className="h-56 overflow-y-auto rounded-lg border border-line">
        {children.length === 0 && <p className="p-4 text-sm text-muted">No folders here.</p>}
        {children.map((f) => (
          <button key={f.id} type="button" onClick={() => setAt(f.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-hover">
            <Folder size={16} style={{ color: "var(--app-drive)" }} />
            {f.name}
          </button>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={at === item.parentId}
          onClick={async () => {
            try {
              onMoved(await drive.update(item.id, { parentId: at }));
              toast("Moved");
              onClose();
            } catch (e) {
              toast((e as Error).message, "error");
            }
          }}
        >
          Move here
        </button>
      </div>
    </Modal>
  );
}

export function PreviewModal({ item, onClose, src = `/api/items/${item.id}/file` }: { item: Item; onClose: () => void; src?: string }) {
  const mime = item.mime ?? "";
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (mime === "text/plain" || /\.(txt|md|json|csv|log)$/i.test(item.name))
      fetch(src)
        .then((r) => r.text())
        .then((t) => setText(t.slice(0, 200_000)));
  }, [mime, item.name, src]);
  let body;
  // eslint-disable-next-line @next/next/no-img-element
  if (mime.startsWith("image/")) body = <img src={src} alt={item.name} className="mx-auto max-h-[70vh] rounded" />;
  else if (mime.startsWith("video/")) body = <video src={src} controls className="mx-auto max-h-[70vh] w-full rounded" />;
  else if (mime.startsWith("audio/")) body = <audio src={src} controls className="w-full" />;
  else if (mime === "application/pdf") body = <iframe src={src} title={item.name} className="h-[70vh] w-full rounded border border-line" />;
  else if (text !== null) body = <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-4 font-mono text-xs">{text}</pre>;
  else body = <p className="py-10 text-center text-sm text-muted">No preview for this type of file.</p>;
  return (
    <Modal title={item.name} onClose={onClose} width={960}>
      {body}
      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        <span>
          {formatBytes(item.size)} · {mime || "unknown type"}
        </span>
        <a className="btn btn-sm" href={`${src}?download`}>
          <ArrowDownToLine size={15} /> Download
        </a>
      </div>
    </Modal>
  );
}

// ---- Rows and actions ----

type Dialog = { type: "rename" | "move" | "share" | "preview"; item: Item } | null;

/**
 * File list with every action wired: open, rename, star, share, copy, move, download, trash,
 * restore, delete forever, and "open in Atrium" for Office files.
 */
export function FileList({
  items,
  all,
  view,
  onChange,
  onRemove,
  emptyText,
  showLocation,
}: {
  items: Item[];
  all: Item[];
  view: "list" | "grid";
  onChange: (item: Item) => void;
  onRemove: (id: string) => void;
  emptyText: string;
  showLocation?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const { refresh } = useSession();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const byId = useMemo(() => new Map(all.map((i) => [i.id, i])), [all]);

  const open = (item: Item) => {
    const href = openHref(item);
    if (href) router.push(href);
    else setDialog({ type: "preview", item });
  };

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast(done);
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const actions = (item: Item): MenuEntry[] => {
    if (item.trashedAt)
      return [
        { label: "Restore", icon: <RotateCcw size={16} />, onClick: () => run(async () => onChange(await drive.update(item.id, { trashed: false })), "Restored") },
        {
          label: "Delete forever",
          icon: <Trash2 size={16} />,
          danger: true,
          onClick: () =>
            run(async () => {
              await drive.remove(item.id);
              onRemove(item.id);
            }, "Deleted forever"),
        },
      ];
    const entries: MenuEntry[] = [{ label: "Open", icon: <ExternalLink size={16} />, onClick: () => open(item) }];
    const convert = item.kind === "file" ? importKind(item.name) : null;
    if (convert)
      entries.push({
        label: "Open with Atrium",
        icon: <Wand2 size={16} />,
        onClick: () =>
          run(async () => {
            const blob = await (await fetch(`/api/items/${item.id}/file?download`)).blob();
            const { kind, body } = await convertFile(new File([blob], item.name));
            const created = await drive.create(kind, { name: stripExt(item.name), parentId: item.parentId, body });
            router.push(`${EDITOR_PATH[kind]}/${created.id}`);
          }),
      });
    if (item.kind === "file" && (item.mime === "application/pdf" || /\.pdf$/i.test(item.name)))
      entries.push(
        { label: "Edit PDF", icon: <FilePen size={16} />, onClick: () => router.push(`/pdf/edit?item=${item.id}`) },
        { label: "Split PDF", icon: <Scissors size={16} />, onClick: () => router.push(`/pdf/split?item=${item.id}`) },
      );
    if (item.kind === "file") entries.push({ label: "Download", icon: <ArrowDownToLine size={16} />, onClick: () => window.open(`/api/items/${item.id}/file?download`, "_self") });
    entries.push(
      "sep",
      { label: "Rename", icon: <Pencil size={16} />, onClick: () => setDialog({ type: "rename", item }) },
      { label: item.starred ? "Remove star" : "Star", icon: <Star size={16} />, onClick: () => run(async () => onChange(await drive.update(item.id, { starred: !item.starred }))) },
    );
    if (item.kind !== "folder") {
      entries.push(
        { label: "Share", icon: <Share2 size={16} />, onClick: () => setDialog({ type: "share", item }) },
        { label: "Make a copy", icon: <Copy size={16} />, onClick: () => run(async () => onChange(await drive.copy(item.id)), "Copy created") },
      );
    }
    entries.push(
      { label: "Move to…", icon: <FolderInput size={16} />, onClick: () => setDialog({ type: "move", item }) },
      "sep",
      { label: "Move to trash", icon: <Trash2 size={16} />, danger: true, onClick: () => run(async () => onChange(await drive.update(item.id, { trashed: true })), "Moved to trash") },
    );
    return entries;
  };

  // Drag a row onto a folder to move it there.
  const dragProps = (item: Item) => ({
    draggable: !item.trashedAt,
    onDragStart: (e: React.DragEvent) => e.dataTransfer.setData("application/x-atrium-item", item.id),
    ...(item.kind === "folder" && !item.trashedAt
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (e.dataTransfer.types.includes("application/x-atrium-item")) {
              e.preventDefault();
              setDragOver(item.id);
            }
          },
          onDragLeave: () => setDragOver(null),
          onDrop: (e: React.DragEvent) => {
            const id = e.dataTransfer.getData("application/x-atrium-item");
            setDragOver(null);
            if (!id || id === item.id) return;
            e.preventDefault();
            e.stopPropagation();
            void run(async () => onChange(await drive.update(id, { parentId: item.id })), `Moved to ${item.name}`);
          },
        }
      : {}),
  });

  const where = (item: Item) => (item.parentId ? (byId.get(item.parentId)?.name ?? "—") : "My Drive");

  const dialogs = (
    <>
      {dialog?.type === "rename" && (
        <PromptDialog
          title="Rename"
          initial={dialog.item.name}
          onSubmit={async (name) => onChange(await drive.update(dialog.item.id, { name }))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "move" && <MoveDialog item={dialog.item} items={all} onMoved={onChange} onClose={() => setDialog(null)} />}
      {dialog?.type === "share" && (
        <ShareDialog
          item={dialog.item}
          onChange={(i) => {
            onChange(i);
            setDialog({ type: "share", item: i });
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "preview" && <PreviewModal item={dialog.item} onClose={() => setDialog(null)} />}
    </>
  );

  if (items.length === 0)
    return (
      <>
        <div className="flex flex-col items-center justify-center py-20 text-center text-sm text-muted">
          <Folder size={44} className="mb-3 opacity-30" />
          {emptyText}
        </div>
        {dialogs}
      </>
    );

  if (view === "grid")
    return (
      <>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          {items.map((item) => (
            <div
              key={item.id}
              {...dragProps(item)}
              onDoubleClick={() => open(item)}
              className={`card group relative cursor-pointer overflow-hidden transition hover:border-accent ${dragOver === item.id ? "ring-2 ring-accent" : ""}`}
            >
              <button type="button" onClick={() => open(item)} className="flex h-28 w-full items-center justify-center bg-surface-2">
                {item.kind === "file" && item.mime?.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/items/${item.id}/file`} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <ItemIcon item={item} size={44} />
                )}
              </button>
              <div className="flex items-center gap-2 px-3 py-2.5">
                <ItemIcon item={item} size={16} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium" title={item.name}>
                  {item.name}
                </span>
                {item.starred && <Star size={13} fill="#f59e0b" color="#f59e0b" />}
                <Dropdown label={`Actions for ${item.name}`} className="icon-btn !h-7 !w-7" align="right" trigger={<MoreVertical size={16} />} items={actions(item)} />
              </div>
            </div>
          ))}
        </div>
        {dialogs}
      </>
    );

  return (
    <>
      <div className="card overflow-visible">
        <div className="grid grid-cols-[minmax(0,1fr)_140px_90px_40px] items-center gap-3 border-b border-line px-4 py-2 text-xs font-medium text-muted max-md:grid-cols-[minmax(0,1fr)_40px]">
          <span>Name</span>
          <span className="max-md:hidden">{showLocation ? "Location" : "Modified"}</span>
          <span className="text-right max-md:hidden">Size</span>
          <span />
        </div>
        {items.map((item) => (
          <div
            key={item.id}
            {...dragProps(item)}
            onDoubleClick={() => open(item)}
            className={`grid grid-cols-[minmax(0,1fr)_140px_90px_40px] items-center gap-3 border-b border-line px-4 py-1.5 last:border-b-0 hover:bg-hover max-md:grid-cols-[minmax(0,1fr)_40px] ${dragOver === item.id ? "bg-accent-wash" : ""}`}
          >
            <button type="button" onClick={() => open(item)} className="flex min-w-0 items-center gap-3 py-1 text-left">
              <ItemIcon item={item} />
              <span className="truncate text-sm font-medium" title={item.name}>
                {item.name}
              </span>
              {item.starred && <Star size={13} className="shrink-0" fill="#f59e0b" color="#f59e0b" />}
              {item.shareId && <Share2 size={13} className="shrink-0 text-muted" aria-label="Shared" />}
            </button>
            <span className="truncate text-xs text-muted max-md:hidden">{showLocation ? where(item) : formatWhen(item.updatedAt)}</span>
            <span className="text-right text-xs text-muted max-md:hidden">{item.kind === "folder" ? "—" : formatBytes(item.size)}</span>
            <Dropdown label={`Actions for ${item.name}`} className="icon-btn" align="right" trigger={<MoreVertical size={16} />} items={actions(item)} />
          </div>
        ))}
      </div>
      {dialogs}
    </>
  );
}
