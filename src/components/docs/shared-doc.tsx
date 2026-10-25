"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Eye, PencilLine, Printer, UserRound } from "lucide-react";
import { AppTile, Logo } from "@/components/app-icon";
import { useAutosave } from "@/components/editor-shell";
import { ThemeToggle } from "@/components/shell";
import { PromptDialog, Spinner } from "@/components/ui";
import { api } from "@/lib/client";
import { liveIdentity, setGuestName } from "@/lib/live-client";
import type { Body, DocBody, Item, ShareRole } from "@/lib/types";
import { LiveDocEditor, type DocContext } from "./doc-surface";
import { PresenceBar, useLiveDoc } from "./live";
import { PageSetup, saveState } from "./page-setup";
import type { SaveState } from "../editor-shell";

export type ShareViewer = { name: string; guest: boolean; owner: boolean } | null;

/**
 * A document opened from a public link. Everyone on the link sees edits land live and who else is
 * here; with an edit link they can type too, and their changes are saved to the owner's drive.
 */
export function SharedDoc({ shareId, item, body, role, owner, me }: { shareId: string; item: Pick<Item, "id" | "name">; body: DocBody; role: ShareRole; owner: string; me: ShareViewer }) {
  const canEdit = role === "edit";
  const { live, error } = useLiveDoc(`/api/share/${shareId}/live`, body, canEdit);
  const [name, setName] = useState(() => (me && !me.guest ? me.name : null));
  const identity = useMemo(() => liveIdentity(name), [name]);
  const save = useCallback(
    (_id: string, b: Body) => api<{ item: Item }>(`/api/share/${shareId}/body`, { method: "PUT", json: b }).then((r) => r.item),
    [shareId],
  );
  const { state, changed } = useAutosave(item.id, () => {}, save);

  if (error) return <p className="m-auto p-10 text-center text-sm text-danger">{error}</p>;
  if (!live) return <Spinner label="Opening document" />;
  return (
    <LiveDocEditor
      key={live.doc.guid}
      live={live}
      user={identity}
      editable={canEdit}
      onChange={changed}
      header={(ctx) => (
        <SharedHeader ctx={ctx} item={item} owner={owner} me={me} canEdit={canEdit} save={saveState(state, ctx.status)} you={identity.name} onRename={(n) => {
          setGuestName(n);
          setName(n || null);
        }} />
      )}
    />
  );
}

function SharedHeader({ ctx, item, owner, me, canEdit, save, you, onRename }: {
  ctx: DocContext; item: Pick<Item, "id" | "name">; owner: string; me: ShareViewer; canEdit: boolean; save: SaveState; you: string; onRename: (name: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [setup, setSetup] = useState(false);
  const status = ctx.status === "offline" ? "Offline, retrying" : save === "saving" || save === "dirty" ? "Saving…" : canEdit ? "All changes saved" : "Live";
  return (
    <header className="no-print flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      <AppTile kind="doc" size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{item.name}</div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px font-medium ${canEdit ? "bg-accent-wash text-accent" : "bg-surface-2"}`}>
            {canEdit ? <PencilLine size={11} /> : <Eye size={11} />} {canEdit ? "Anyone with the link can edit" : "View only"}
          </span>
          <span className="truncate max-sm:hidden">Shared by {owner}</span>
          <span className={save === "error" ? "text-danger" : ""} aria-live="polite">
            · {status}
          </span>
        </div>
      </div>
      <PresenceBar people={ctx.people} />
      {canEdit && (
        <button type="button" className="btn btn-sm max-md:hidden" onClick={() => setSetup(true)}>
          Page setup
        </button>
      )}
      <button type="button" className="icon-btn" aria-label="Print or save as PDF" title="Print or save as PDF" onClick={() => window.print()}>
        <Printer size={17} />
      </button>
      {(!me || me.guest) && (
        <button type="button" className="btn btn-sm" onClick={() => setRenaming(true)} title="The name others see next to your cursor">
          <UserRound size={14} /> <span className="max-w-32 truncate">{you}</span>
        </button>
      )}
      <ThemeToggle />
      {me?.owner ? (
        <Link href={`/docs/${item.id}`} className="btn btn-sm btn-primary">
          Open in Docs
        </Link>
      ) : (
        <Link href="/" className="btn btn-sm max-sm:hidden">
          <Logo size={16} /> Made with Atrium
        </Link>
      )}
      {renaming && (
        <PromptDialog title="Your name" initial={me ? "" : you.startsWith("Anonymous ") ? "" : you} confirm="Save" onSubmit={async (n) => onRename(n)} onClose={() => setRenaming(false)} />
      )}
      {setup && <PageSetup page={ctx.page} onChange={ctx.setPage} onClose={() => setSetup(false)} />}
    </header>
  );
}
