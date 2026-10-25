"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import * as Y from "yjs";
import { getSchema } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { EMPTY_DOC, richExtensions } from "@/components/rich/extensions";
import { LiveDoc, type LiveStatus, type Presence } from "@/lib/live-client";
import type { DocBody } from "@/lib/types";
import { DEFAULT_PAGE, type PageSettings } from "./paged";

/** The Yjs field Tiptap's Collaboration extension binds to, and where page settings live. */
const FIELD = "default";
const SETTINGS = "settings";

/** A document body as a single Yjs update: the first copy of a live document. */
export function docToUpdate(body: DocBody): Uint8Array {
  const schema = getSchema(richExtensions({ editable: true, live: true }));
  const ydoc = prosemirrorJSONToYDoc(schema, body.content ?? EMPTY_DOC, FIELD);
  ydoc.getMap(SETTINGS).set("page", body.page ?? DEFAULT_PAGE);
  return Y.encodeStateAsUpdate(ydoc);
}

/**
 * Opens the live copy of a document at `url` (seeding it from `body` the first time anyone opens it).
 * Returns null until it has loaded. If the document is replaced elsewhere, a fresh copy is opened.
 */
export function useLiveDoc(url: string, body: DocBody, canEdit = true) {
  const [live, setLive] = useState<LiveDoc | null>(null);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let alive = true;
    const doc = new LiveDoc(url);
    doc.onReset = () => alive && setGeneration((g) => g + 1);
    doc
      .start(() => docToUpdate(body), canEdit)
      .then(() => alive && setLive(doc))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
      setLive(null);
      doc.stop();
    };
    // The body only seeds a brand-new live copy; later edits arrive through the live copy itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, generation, canEdit]);
  return { live, error };
}

/** Page size and margins, shared live so everyone sees the same pages. */
export function useLivePage(live: LiveDoc): [PageSettings, (p: PageSettings) => void] {
  const map = live.doc.getMap<PageSettings>(SETTINGS);
  const page = useSyncExternalStore(
    (fn) => {
      map.observe(fn);
      return () => map.unobserve(fn);
    },
    () => map.get("page") ?? DEFAULT_PAGE,
    () => DEFAULT_PAGE,
  );
  return [page, (p) => map.set("page", p)];
}

/** Who is in the document and whether we are connected, kept in React state. */
export function usePresence(live: LiveDoc | null): { people: Presence[]; status: LiveStatus } {
  const [state, setState] = useState<{ people: Presence[]; status: LiveStatus }>({ people: [], status: "connecting" });
  useEffect(() => {
    if (!live) return;
    const read = () => setState({ people: live.people(), status: live.status });
    read();
    return live.subscribe(read);
  }, [live]);
  return state;
}

const initials = (name: string) =>
  name
    .replace(/^Anonymous /, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

/** Avatars of everyone in the document, like the row at the top of Google Docs. */
export function PresenceBar({ people, max = 5 }: { people: Presence[]; max?: number }) {
  if (people.length < 2) return null;
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <div className="flex items-center" aria-label={`${people.length} people in this document`}>
      {shown.map((p) => (
        <span
          key={p.clientId}
          title={p.self ? `${p.user.name} (you)` : p.user.name}
          className="-ml-1.5 flex h-8 w-8 items-center justify-center rounded-full border-2 border-surface text-[11px] font-semibold text-white first:ml-0"
          style={{ background: p.user.color }}
        >
          {initials(p.user.name)}
        </span>
      ))}
      {rest > 0 && <span className="-ml-1.5 flex h-8 w-8 items-center justify-center rounded-full border-2 border-surface bg-surface-2 text-[11px] font-semibold">+{rest}</span>}
    </div>
  );
}
