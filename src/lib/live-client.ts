"use client";

import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import type { LiveResponse } from "./live";

// The browser half of live editing (server half: src/lib/live.ts). Local Yjs updates are batched
// and posted; every response carries what other people changed since our last poll and who is
// here. Polling is quick while someone else is in the document and slows down when you are alone
// or the tab is hidden. A failed post keeps its updates and sends them with the next one.

export type LiveStatus = "connecting" | "live" | "offline";
export type LiveUser = { name: string; color: string };
/** What each person publishes about themselves (the caret extension adds their cursor). */
export type Presence = { clientId: number; user: LiveUser; self: boolean };

const toB64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const FAST = 450;
const ALONE = 1500;
const HIDDEN = 5000;
const RETRY = 3000;
/** Re-announce ourselves well inside the server's 25-second peer timeout. */
const HEARTBEAT = 10_000;

export class LiveDoc {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  status: LiveStatus = "connecting";
  epoch: string | null = null;
  private since = 0;
  private pending: Uint8Array[] = [];
  private presenceDirty = true;
  private presenceAt = 0;
  private busy = false;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private listeners = new Set<() => void>();
  private provisional = false;

  /** Called when the document was replaced wholesale elsewhere: throw this copy away and reopen. */
  onReset: () => void = () => {};

  constructor(private url: string) {
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      this.pending.push(update);
      this.kick(40);
    });
    this.awareness.on("update", (_: unknown, origin: unknown) => {
      if (origin === "local") {
        this.presenceDirty = true;
        this.kick(80);
      }
      this.emit();
    });
  }

  /**
   * Loads the shared copy. If there is none yet, `seed` provides the first one (from the saved body).
   * A viewer can't store a seed, so it shows its own until an editor creates the shared copy, then reloads.
   */
  async start(seed: () => Uint8Array, canEdit = true) {
    let res = await this.post({ since: 0, epoch: null });
    if (!res.updates.length && canEdit) {
      // Two people opening a fresh document at once both seed; the server keeps the first.
      res = await this.post({ since: 0, epoch: null, update: toB64(seed()), seed: true });
    } else if (!res.updates.length) {
      Y.applyUpdate(this.doc, seed(), this);
      this.provisional = true;
    }
    this.apply(res);
    this.setStatus("live");
    document.addEventListener("visibilitychange", this.onVisible);
    window.addEventListener("pagehide", this.leave);
    this.kick(FAST);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("pagehide", this.leave);
    this.leave();
    this.awareness.destroy();
    this.doc.destroy();
  }

  /** People in the document, you first. */
  people(): Presence[] {
    const out: Presence[] = [];
    this.awareness.getStates().forEach((state, clientId) => {
      const user = state.user as LiveUser | undefined;
      if (user?.name) out.push({ clientId, user, self: clientId === this.doc.clientID });
    });
    return out.sort((a, b) => Number(b.self) - Number(a.self) || a.clientId - b.clientId);
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** Sends anything waiting now. */
  flush() {
    this.kick(0);
  }

  get unsent() {
    return this.pending.length > 0;
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private setStatus(s: LiveStatus) {
    if (this.status === s) return;
    this.status = s;
    this.emit();
  }

  private onVisible = () => {
    if (document.visibilityState === "visible") this.kick(0);
  };

  /** Tells the others we left, even while the page is unloading. */
  private leave = () => {
    const body = JSON.stringify({ since: this.since, epoch: this.epoch, client: this.doc.clientID, awareness: null });
    navigator.sendBeacon?.(this.url, new Blob([body], { type: "application/json" }));
  };

  private kick(ms: number) {
    if (this.stopped) return;
    if (this.busy) {
      if (ms < FAST) this.again = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async post(body: object): Promise<LiveResponse> {
    const res = await fetch(this.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: this.doc.clientID, ...body }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Live sync failed (${res.status})`), { status: res.status });
    return data as LiveResponse;
  }

  private apply(res: LiveResponse) {
    if ((this.epoch && res.epoch && res.epoch !== this.epoch) || (this.provisional && res.updates.length)) {
      this.stopped = true;
      this.onReset();
      return;
    }
    this.epoch = res.epoch || this.epoch;
    if (res.updates.length) {
      Y.transact(this.doc, () => res.updates.forEach((u) => Y.applyUpdate(this.doc, fromB64(u), this)), this);
    }
    this.since = Math.max(this.since, res.seq);
    const here = new Set(res.peers.map((p) => p.client));
    for (const p of res.peers) applyAwarenessUpdate(this.awareness, fromB64(p.state), "remote");
    const gone = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID && !here.has(id));
    if (gone.length) removeAwarenessStates(this.awareness, gone, "remote");
  }

  private async tick() {
    this.timer = null;
    if (this.stopped) return;
    this.busy = true;
    const sending = this.pending;
    this.pending = [];
    const now = Date.now();
    const announce = this.presenceDirty || now - this.presenceAt > HEARTBEAT;
    let wait = FAST;
    try {
      const res = await this.post({
        since: this.since,
        epoch: this.epoch,
        update: sending.length ? toB64(Y.mergeUpdates(sending)) : undefined,
        awareness: announce ? toB64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])) : undefined,
      });
      if (announce) {
        this.presenceDirty = false;
        this.presenceAt = now;
      }
      this.apply(res);
      this.setStatus("live");
      wait = document.visibilityState === "hidden" ? HIDDEN : res.peers.length ? FAST : ALONE;
    } catch {
      this.pending = [...sending, ...this.pending];
      this.setStatus("offline");
      wait = RETRY;
    }
    this.busy = false;
    if (this.again || this.pending.length) {
      this.again = false;
      wait = Math.min(wait, 40);
    }
    this.kick(wait);
  }
}

// ---- Who you are to everyone else ----

export const LIVE_COLORS = ["#e11d48", "#2563eb", "#16a34a", "#ea580c", "#7c3aed", "#0891b2", "#c026d3", "#ca8a04", "#4f46e5", "#059669"];
const ANIMALS = ["Otter", "Fox", "Heron", "Lynx", "Panda", "Koala", "Falcon", "Badger", "Dolphin", "Owl", "Hedgehog", "Moose", "Puffin", "Tiger"];

const NAME_KEY = "atrium-live-name";

/** The name someone without an account chose for themselves on a shared link. */
export function setGuestName(name: string) {
  try {
    if (name.trim()) localStorage.setItem(NAME_KEY, name.trim().slice(0, 40));
    else localStorage.removeItem(NAME_KEY);
  } catch {}
}

/** A stable colour (and, for people without an account, an animal name) per browser. */
export function liveIdentity(name: string | null): LiveUser {
  try {
    name ||= localStorage.getItem(NAME_KEY);
  } catch {}
  let seed = 0;
  try {
    seed = Number(localStorage.getItem("atrium-live-seed"));
    if (!seed) {
      seed = 1 + Math.floor(Math.random() * 1e9);
      localStorage.setItem("atrium-live-seed", String(seed));
    }
  } catch {
    seed = 1 + Math.floor(Math.random() * 1e9);
  }
  return {
    name: name || `Anonymous ${ANIMALS[seed % ANIMALS.length]}`,
    color: LIVE_COLORS[Math.floor(seed / 7) % LIVE_COLORS.length],
  };
}

export { toB64 as liveEncode };
