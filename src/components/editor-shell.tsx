"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CloudOff, Copy, FileDown, Globe, Link2, Loader2, Lock, Printer, Share2, Star, Trash2 } from "lucide-react";
import { drive } from "@/lib/client";
import { EDITOR_PATH, type Body, type EditableKind, type Item, type ShareRole } from "@/lib/types";
import { AppTile } from "./app-icon";
import { AccountMenu, Launcher, ThemeToggle } from "./shell";
import { Dropdown, Modal, useToast, type MenuEntry } from "./ui";

export type SaveState = "saved" | "saving" | "dirty" | "error";

/**
 * Debounced autosave for an editor body. Call `changed(body)` on every edit; the latest body is
 * saved 800 ms after typing stops, and flushed when the tab is hidden or closed.
 */
export function useAutosave(id: string, onSaved: (item: Item) => void, save: (id: string, body: Body) => Promise<Item> = drive.save) {
  const [state, setState] = useState<SaveState>("saved");
  const pending = useRef<Body | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const savedCb = useRef(onSaved);
  const retry = useRef<() => void>(() => {});
  useEffect(() => {
    savedCb.current = onSaved;
  });

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (inflight.current) await inflight.current;
    const body = pending.current;
    if (!body) return;
    pending.current = null;
    setState("saving");
    inflight.current = save(id, body)
      .then((item) => {
        savedCb.current(item);
        setState(pending.current ? "dirty" : "saved");
      })
      .catch(() => {
        // Keep the unsaved body so the next edit (or a retry) sends it again.
        pending.current ??= body;
        setState("error");
        timer.current = setTimeout(() => retry.current(), 5000);
      })
      .finally(() => {
        inflight.current = null;
      });
    await inflight.current;
  }, [id, save]);
  useEffect(() => {
    retry.current = () => void flush();
  }, [flush]);

  const changed = useCallback(
    (body: Body) => {
      pending.current = body;
      setState("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 800);
    },
    [flush],
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (pending.current || inflight.current) {
        void flush();
        e.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onUnload);
      void flush();
    };
  }, [flush]);

  return { state, changed, flush };
}

function SaveBadge({ state }: { state: SaveState }) {
  const map = {
    saved: { icon: <Check size={14} />, text: "Saved" },
    saving: { icon: <Loader2 size={14} className="animate-spin" />, text: "Saving…" },
    dirty: { icon: <Loader2 size={14} className="opacity-40" />, text: "Editing" },
    error: { icon: <CloudOff size={14} />, text: "Offline, retrying" },
  }[state];
  return (
    <span className={`flex items-center gap-1 text-xs ${state === "error" ? "text-danger" : "text-muted"}`} aria-live="polite">
      {map.icon}
      {map.text}
    </span>
  );
}

export function ShareDialog({ item, onChange, onClose }: { item: Item; onChange: (item: Item) => void; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const link = item.shareId ? `${location.origin}/s/${item.shareId}` : "";
  const role = item.shareRole ?? "view";
  // Live co-editing through a link is a Docs feature; other files are shared for viewing.
  const editable = item.kind === "doc";
  const apply = async (on: boolean, next: ShareRole = role) => {
    setBusy(true);
    try {
      onChange(await drive.share(item.id, on, next));
    } catch (e) {
      toast((e as Error).message, "error");
    }
    setBusy(false);
  };
  return (
    <Modal title={`Share “${item.name}”`} onClose={onClose} width={500}>
      <div className="text-sm font-medium">General access</div>
      <div className="mt-2 flex items-center gap-3 rounded-xl border border-line p-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${link ? "bg-[#dcfce7] text-[#15803d]" : "bg-surface-2 text-muted"}`}>
          {link ? <Globe size={18} /> : <Lock size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <select
            aria-label="Who can open the link"
            className="-ml-1 rounded-md bg-transparent px-1 py-0.5 text-sm font-medium hover:bg-hover"
            value={link ? "anyone" : "restricted"}
            disabled={busy}
            onChange={(e) => void apply(e.target.value === "anyone")}
          >
            <option value="restricted">Restricted</option>
            <option value="anyone">Anyone with the link</option>
          </select>
          <div className="text-xs text-muted">
            {!link
              ? "Only you can open this file."
              : role === "edit"
                ? "Anyone on the internet with the link can edit, live, without an account."
                : "Anyone on the internet with the link can view."}
          </div>
        </div>
        {link && (
          <select
            aria-label="Link role"
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
            value={role}
            disabled={busy}
            onChange={(e) => void apply(true, e.target.value as ShareRole)}
          >
            <option value="view">Viewer</option>
            <option value="edit" disabled={!editable}>
              Editor{editable ? "" : " (Docs only)"}
            </option>
          </select>
        )}
      </div>
      {link && (
        <div className="mt-3 flex gap-2">
          <input className="input font-mono text-xs" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Link" />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              void navigator.clipboard?.writeText(link).catch(() => {});
              toast("Link copied");
            }}
          >
            <Copy size={15} /> Copy link
          </button>
        </div>
      )}
      {link && editable && (
        <p className="mt-3 text-xs text-muted">
          Everyone with the document open sees each other&apos;s cursors and edits as they happen. Turn the link off at any time and it stops working.
        </p>
      )}
    </Modal>
  );
}

/**
 * Header shared by every editor: app tile, editable file name, star, save status, File menu and
 * Share. `fileMenu` adds the editor's own entries (downloads, imports) above the common ones.
 */
export function EditorHeader({
  kind,
  item,
  setItem,
  save,
  fileMenu,
  right,
  children,
}: {
  kind: EditableKind;
  item: Item;
  setItem: (item: Item) => void;
  save: SaveState;
  fileMenu: MenuEntry[];
  right?: ReactNode;
  children?: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(item.name);
  const [sharing, setSharing] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(item.name);
  }, [item.name]);

  const rename = async () => {
    const next = name.trim();
    if (!next || next === item.name) return setName(item.name);
    try {
      setItem(await drive.update(item.id, { name: next }));
    } catch (e) {
      toast((e as Error).message, "error");
      setName(item.name);
    }
  };

  const common: MenuEntry[] = [
    {
      label: "Make a copy",
      icon: <Copy size={16} />,
      onClick: async () => {
        const copy = await drive.copy(item.id);
        router.push(`${EDITOR_PATH[kind]}/${copy.id}`);
      },
    },
    { label: "Print", icon: <Printer size={16} />, hint: "Ctrl+P", onClick: () => window.print() },
    "sep",
    {
      label: "Move to trash",
      icon: <Trash2 size={16} />,
      danger: true,
      onClick: async () => {
        await drive.update(item.id, { trashed: true });
        router.push("/drive");
      },
    },
  ];

  return (
    <header className="no-print flex flex-col border-b border-line bg-surface">
      <div className="flex h-14 items-center gap-2 px-3">
        <Launcher />
        <Link href={EDITOR_PATH[kind]} aria-label="All files" title="All files">
          <AppTile kind={kind} size={32} />
        </Link>
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-1">
            <input
              aria-label="File name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className="min-w-0 max-w-[40vw] truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[15px] font-medium hover:border-line focus:border-accent focus:outline-none"
              style={{ width: `${Math.max(8, Math.ceil(name.length * 0.85) + 2)}ch` }}
            />
            <button
              type="button"
              className="icon-btn !h-7 !w-7"
              aria-label={item.starred ? "Unstar" : "Star"}
              onClick={async () => setItem(await drive.update(item.id, { starred: !item.starred }))}
            >
              <Star size={16} fill={item.starred ? "#f59e0b" : "none"} color={item.starred ? "#f59e0b" : "currentColor"} />
            </button>
            <SaveBadge state={save} />
          </div>
          <div className="flex items-center">
            <Dropdown
              label="File menu"
              trigger={<span className="rounded px-1.5 py-0.5 text-[13px] text-ink-2 hover:bg-hover">File</span>}
              items={[...fileMenu, "sep", ...common]}
            />
            {children}
          </div>
        </div>
        <div className="flex-1" />
        {right}
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setSharing(true)}>
          {item.shareId ? <Link2 size={15} /> : <Share2 size={15} />} Share
        </button>
        <ThemeToggle />
        <AccountMenu />
      </div>
      {sharing && <ShareDialog item={item} onChange={setItem} onClose={() => setSharing(false)} />}
    </header>
  );
}

export const downloadIcon = <FileDown size={16} />;
