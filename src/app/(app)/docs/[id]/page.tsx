"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { FileUp, Ruler } from "lucide-react";
import { LiveDocEditor, type DocContext } from "@/components/docs/doc-surface";
import { docToUpdate, PresenceBar, useLiveDoc } from "@/components/docs/live";
import { PageSetup, saveState } from "@/components/docs/page-setup";
import { downloadIcon, EditorHeader, useAutosave, type SaveState } from "@/components/editor-shell";
import { useSession } from "@/components/shell";
import { Spinner, useToast } from "@/components/ui";
import { api, downloadBlob, drive, pickFile, safeFileName } from "@/lib/client";
import { liveEncode, liveIdentity } from "@/lib/live-client";
import type { DocBody, Item } from "@/lib/types";

export default function DocPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<Item | null>(null);
  const [body, setBody] = useState<DocBody | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    drive
      .body<DocBody>(id)
      .then((r) => {
        setItem(r.item);
        setBody(r.body);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (item) document.title = `${item.name} · Atrium Docs`;
  }, [item]);

  if (error) return <p className="m-auto p-10 text-center text-sm text-danger">{error}</p>;
  if (!item || !body) return <Spinner label="Opening document" />;
  return <DocEditor item={item} setItem={setItem} initial={body} />;
}

function DocEditor({ item, setItem, initial }: { item: Item; setItem: (i: Item) => void; initial: DocBody }) {
  const { user } = useSession();
  const { live, error } = useLiveDoc(`/api/items/${item.id}/live`, initial);
  const { state, changed, flush } = useAutosave(item.id, setItem);
  const identity = useMemo(() => liveIdentity(user && !user.guest ? user.name : null), [user]);
  const toast = useToast();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        live?.flush();
        void flush().then(() => toast("Saved"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush, toast, live]);

  if (error) return <p className="m-auto p-10 text-center text-sm text-danger">{error}</p>;
  if (!live) return <Spinner label="Opening document" />;
  return (
    <LiveDocEditor
      key={live.doc.guid}
      live={live}
      user={identity}
      editable
      onChange={changed}
      header={(ctx) => <Header ctx={ctx} item={item} setItem={setItem} save={saveState(state, ctx.status)} flush={flush} />}
    />
  );
}

function Header({ ctx, item, setItem, save, flush }: { ctx: DocContext; item: Item; setItem: (i: Item) => void; save: SaveState; flush: () => Promise<void> }) {
  const toast = useToast();
  const [setup, setSetup] = useState(false);
  const fileName = safeFileName(item.name);
  const run = (fn: () => Promise<void>) => void fn().catch((e) => toast((e as Error).message, "error"));

  const fileMenu = [
    {
      label: "Download as Word (.docx)",
      icon: downloadIcon,
      onClick: () =>
        run(async () => {
          const { exportDocx } = await import("@/lib/convert/docx");
          downloadBlob(await exportDocx(ctx.snapshot(), item.name), `${fileName}.docx`);
        }),
    },
    { label: "Download as PDF", icon: downloadIcon, hint: "Print → Save as PDF", onClick: () => window.print() },
    {
      label: "Download as web page (.html)",
      icon: downloadIcon,
      onClick: () =>
        run(async () => {
          const { docToHtml } = await import("@/lib/convert/docx");
          downloadBlob(new Blob([await docToHtml(ctx.snapshot().content, item.name)], { type: "text/html" }), `${fileName}.html`);
        }),
    },
    {
      label: "Download as Markdown (.md)",
      icon: downloadIcon,
      onClick: () =>
        run(async () => {
          const { docToMarkdown } = await import("@/lib/convert/docx");
          downloadBlob(new Blob([docToMarkdown(ctx.snapshot().content)], { type: "text/markdown" }), `${fileName}.md`);
        }),
    },
    "sep" as const,
    {
      label: "Import Word file…",
      icon: <FileUp size={16} />,
      onClick: () =>
        run(async () => {
          const file = await pickFile(".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document");
          if (!file) return;
          if (!window.confirm("Replace this document's content with the Word file? Everyone editing it will see the new content.")) return;
          const { importDocx } = await import("@/lib/convert/docx");
          const next: DocBody = { ...(await importDocx(file)), page: ctx.page };
          await flush();
          // Replacing the live history makes every open copy (this one included) reload the new content.
          await api(`/api/items/${item.id}/live`, { method: "PUT", json: { update: liveEncode(docToUpdate(next)) } });
          setItem(await drive.save(item.id, next));
          toast(`Imported ${file.name}`);
        }),
    },
    { label: "Page setup…", icon: <Ruler size={16} />, onClick: () => setSetup(true) },
  ];

  return (
    <>
      <EditorHeader kind="doc" item={item} setItem={setItem} save={save} fileMenu={fileMenu} right={<PresenceBar people={ctx.people} />} />
      {setup && <PageSetup page={ctx.page} onChange={ctx.setPage} onClose={() => setSetup(false)} />}
    </>
  );
}
