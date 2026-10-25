"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import { AppTile, ItemIcon, Logo } from "@/components/app-icon";
import { SharedDoc, type ShareViewer } from "@/components/docs/shared-doc";
import { NotebookViewer } from "@/components/notebook/notebook-viewer";
import { ThemeToggle } from "@/components/shell";
import { SheetViewer } from "@/components/sheets/sheet-viewer";
import { SlidesViewer } from "@/components/slides/slides-viewer";
import { Spinner, ToastProvider } from "@/components/ui";
import { formatBytes, formatWhen } from "@/lib/client";
import type { Body, Item, ShareRole } from "@/lib/types";

type Shared = { item: Pick<Item, "id" | "kind" | "name" | "mime" | "size" | "updatedAt">; body?: Body; role: ShareRole; owner: string; me: ShareViewer };

function FileView({ item, src }: { item: Shared["item"]; src: string }) {
  const mime = item.mime ?? "";
  return (
    <div className="mx-auto max-w-4xl p-6">
      {mime.startsWith("image/") ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={item.name} className="mx-auto max-h-[75vh] rounded-lg" />
      ) : mime.startsWith("video/") ? (
        <video src={src} controls className="w-full rounded-lg" />
      ) : mime.startsWith("audio/") ? (
        <audio src={src} controls className="w-full" />
      ) : mime === "application/pdf" ? (
        <iframe src={src} title={item.name} className="h-[80vh] w-full rounded-lg border border-line" />
      ) : (
        <div className="card flex flex-col items-center gap-3 p-12 text-center">
          <ItemIcon item={item} size={48} />
          <div className="font-medium">{item.name}</div>
          <div className="text-sm text-muted">{formatBytes(item.size)}</div>
        </div>
      )}
      <div className="mt-6 text-center">
        <a className="btn btn-primary" href={`${src}?download`}>
          <ArrowDownToLine size={16} /> Download
        </a>
      </div>
    </div>
  );
}

export default function SharedPage() {
  const { shareId } = useParams<{ shareId: string }>();
  const [data, setData] = useState<Shared | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/share/${shareId}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || "This link does not work.");
        setData(json);
        document.title = `${json.item.name} · Atrium`;
      })
      .catch((e) => setError(e.message));
  }, [shareId]);

  const kind = data?.item.kind;
  if (data?.body?.type === "doc") {
    // Documents open live: everyone on the link sees edits land, and edit links can type too.
    return (
      <ToastProvider>
        <SharedDoc shareId={shareId} item={data.item} body={data.body} role={data.role} owner={data.owner} me={data.me} />
      </ToastProvider>
    );
  }
  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col">
        <header className="no-print sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-line bg-surface px-4">
          {kind && kind !== "file" && kind !== "folder" ? <AppTile kind={kind} size={30} /> : <Logo size={28} />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-medium">{data?.item.name ?? "Shared file"}</div>
            {data && <div className="text-xs text-muted">View only · shared by {data.owner} · updated {formatWhen(data.item.updatedAt)}</div>}
          </div>
          <ThemeToggle />
          <Link href="/" className="btn btn-sm">
            <Logo size={16} /> Made with Atrium
          </Link>
        </header>
        {error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
            <p className="font-medium">{error}</p>
            <p className="text-sm text-muted">Ask the owner to share it again.</p>
          </div>
        ) : !data ? (
          <Spinner />
        ) : data.body?.type === "sheet" ? (
          <SheetViewer body={data.body} />
        ) : data.body?.type === "slides" ? (
          <SlidesViewer body={data.body} />
        ) : data.body?.type === "notebook" ? (
          <NotebookViewer body={data.body} />
        ) : (
          <FileView item={data.item} src={`/api/share/${shareId}/file`} />
        )}
      </div>
    </ToastProvider>
  );
}
