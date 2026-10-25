import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createUser } from "@/lib/auth";
import { createItem, openShare, setSharing } from "@/lib/drive";
import { liveReset, liveSync } from "@/lib/live";
import { listShared, rememberShared } from "@/lib/shared";
import { useFileStore } from "@/lib/store";

beforeEach(() => {
  useFileStore(fs.mkdtempSync(path.join(os.tmpdir(), "atrium-live-")));
});

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const bytes = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

/** A Yjs doc that types into a text field, the way an editor would. */
function client(id: number) {
  const doc = new Y.Doc();
  doc.clientID = id;
  const out: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array, origin: unknown) => origin !== "remote" && out.push(u));
  return {
    doc,
    text: () => doc.getText("t").toString(),
    type: (s: string) => doc.getText("t").insert(doc.getText("t").length, s),
    take: () => (out.length ? b64(Y.mergeUpdates(out.splice(0))) : undefined),
    apply: (updates: string[]) => updates.forEach((u) => Y.applyUpdate(doc, bytes(u), "remote")),
  };
}

describe("live editing", () => {
  it("relays edits between two people and converges", async () => {
    const a = client(1);
    const b = client(2);
    a.type("Hello");
    const seeded = await liveSync("doc1", { since: 0, client: 1, update: a.take(), seed: true }, true);
    expect(seeded.seq).toBe(1);

    const joined = await liveSync("doc1", { since: 0, client: 2 }, true);
    b.apply(joined.updates);
    expect(b.text()).toBe("Hello");

    a.type(" world");
    b.type("!");
    const ra = await liveSync("doc1", { since: seeded.seq, epoch: seeded.epoch, client: 1, update: a.take() }, true);
    const rb = await liveSync("doc1", { since: joined.seq, epoch: joined.epoch, client: 2, update: b.take() }, true);
    b.apply(rb.updates);
    const again = await liveSync("doc1", { since: ra.seq, epoch: ra.epoch, client: 1 }, true);
    a.apply(again.updates);
    expect(a.text()).toBe(b.text());
    expect(a.text()).toContain("world");
    expect(a.text()).toContain("!");
  });

  it("keeps only the first seed when two people open a new document at once", async () => {
    const a = client(1);
    const b = client(2);
    a.type("from a");
    b.type("from b");
    await Promise.all([
      liveSync("doc2", { since: 0, client: 1, update: a.take(), seed: true }, true),
      liveSync("doc2", { since: 0, client: 2, update: b.take(), seed: true }, true),
    ]);
    const c = client(3);
    c.apply((await liveSync("doc2", { since: 0, client: 3 }, true)).updates);
    expect(["from a", "from b"]).toContain(c.text());
  });

  it("ignores updates from viewers", async () => {
    const a = client(1);
    a.type("owner text");
    const r = await liveSync("doc3", { since: 0, client: 1, update: a.take(), seed: true }, true);
    const v = client(2);
    v.type("vandalism");
    await liveSync("doc3", { since: r.seq, epoch: r.epoch, client: 2, update: v.take() }, false);
    const c = client(3);
    c.apply((await liveSync("doc3", { since: 0, client: 3 }, true)).updates);
    expect(c.text()).toBe("owner text");
  });

  it("compacts a long history without losing anything", async () => {
    const a = client(1);
    let r = await liveSync("doc4", { since: 0, client: 1, update: (a.type("x"), a.take()), seed: true }, true);
    for (let i = 0; i < 150; i++) {
      a.type(String(i % 10));
      r = await liveSync("doc4", { since: r.seq, epoch: r.epoch, client: 1, update: a.take() }, true);
    }
    const late = client(2);
    const full = await liveSync("doc4", { since: 0, client: 2 }, true);
    expect(full.updates.length).toBeLessThan(64);
    late.apply(full.updates);
    expect(late.text()).toBe(a.text());
    // Someone a few edits behind still catches up from where they were.
    const behind = client(3);
    behind.apply((await liveSync("doc4", { since: 0, client: 3 }, true)).updates);
    a.type("END");
    const r2 = await liveSync("doc4", { since: r.seq, epoch: r.epoch, client: 1, update: a.take() }, true);
    behind.apply((await liveSync("doc4", { since: full.seq, epoch: full.epoch, client: 3 }, true)).updates);
    expect(behind.text()).toBe(a.text());
    expect(r2.seq).toBeGreaterThan(r.seq);
  });

  it("starts a new epoch on reset and drops edits made on the old copy", async () => {
    const a = client(1);
    a.type("old");
    const r = await liveSync("doc5", { since: 0, client: 1, update: a.take(), seed: true }, true);
    const fresh = client(9);
    fresh.type("imported");
    await liveReset("doc5", fresh.take()!);
    a.type(" stale edit");
    const after = await liveSync("doc5", { since: r.seq, epoch: r.epoch, client: 1, update: a.take() }, true);
    expect(after.epoch).not.toBe(r.epoch);
    const c = client(3);
    c.apply(after.updates);
    expect(c.text()).toBe("imported");
  });

  it("tracks who is here and forgets people who leave", async () => {
    await liveSync("doc6", { since: 0, client: 1, awareness: b64(new Uint8Array([1])) }, true);
    const r = await liveSync("doc6", { since: 0, client: 2, awareness: b64(new Uint8Array([2])) }, true);
    expect(r.peers.map((p) => p.client)).toEqual([1]);
    await liveSync("doc6", { since: 0, client: 1, awareness: null }, true);
    expect((await liveSync("doc6", { since: 0, client: 2 }, true)).peers).toEqual([]);
  });
});

describe("share roles", () => {
  it("keeps the link when switching between view and edit", async () => {
    const user = await createUser({ email: "o@example.com", name: "Owner", password: null });
    const doc = await createItem(user.id, { kind: "doc", name: "Plan" });
    const viewing = await setSharing(user.id, doc.id, true);
    expect(viewing.shareRole).toBe("view");
    const editing = await setSharing(user.id, doc.id, true, "edit");
    expect(editing.shareId).toBe(viewing.shareId);
    expect((await openShare(editing.shareId!)).item.shareRole).toBe("edit");
    const off = await setSharing(user.id, doc.id, false);
    expect(off.shareId).toBeNull();
    expect(off.shareRole).toBeUndefined();
  });

  it("only lets documents be edited through a link", async () => {
    const user = await createUser({ email: "s@example.com", name: "Sheets", password: null });
    const sheet = await createItem(user.id, { kind: "sheet" });
    await expect(setSharing(user.id, sheet.id, true, "edit")).rejects.toThrow(/view only/);
  });

  it("remembers links under Shared with me, newest first", async () => {
    await rememberShared("u1", { shareId: "a", name: "A", kind: "doc", role: "edit", owner: "Owner" });
    await rememberShared("u1", { shareId: "b", name: "B", kind: "sheet", role: "view", owner: "Owner" });
    await rememberShared("u1", { shareId: "a", name: "A renamed", kind: "doc", role: "edit", owner: "Owner" });
    expect((await listShared("u1")).map((e) => e.name)).toEqual(["A renamed", "B"]);
  });
});
