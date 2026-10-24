import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { authenticate, claimGuest, createSession, createUser, deleteAccount, destroySession, userFromToken } from "@/lib/auth";
import {
  createItem,
  deleteForever,
  duplicate,
  emptyTrash,
  getItem,
  listItems,
  openShare,
  readBody,
  readFile,
  setSharing,
  updateItem,
  uploadFile,
  usage,
  writeBody,
} from "@/lib/drive";
import { seedSamples } from "@/lib/samples";
import { store, useFileStore } from "@/lib/store";

beforeEach(() => {
  useFileStore(fs.mkdtempSync(path.join(os.tmpdir(), "atrium-test-")));
});

describe("store", () => {
  it("serialises concurrent updates to one key", async () => {
    const kv = await store();
    await Promise.all(Array.from({ length: 25 }, () => kv.update<{ n: number }>("counter", (c) => ({ n: (c?.n ?? 0) + 1 }))));
    expect(JSON.parse((await kv.get("counter"))!.toString()).n).toBe(25);
  });

  it("keeps keys inside the data folder", async () => {
    const kv = await store();
    await kv.set("../../escape", "x");
    expect(await kv.get("../../escape")).not.toBeNull();
    expect(fs.existsSync(path.join(os.tmpdir(), "escape"))).toBe(false);
  });
});

describe("drive", () => {
  it("creates files with a blank body and lists them", async () => {
    const doc = await createItem("u1", { kind: "doc" });
    expect(doc.name).toBe("Untitled document");
    expect((await readBody("u1", doc.id)).body.type).toBe("doc");
    expect((await listItems("u1")).map((i) => i.id)).toEqual([doc.id]);
    // Another user cannot see it.
    await expect(getItem("u2", doc.id)).rejects.toThrow("not found");
  });

  it("refuses to move a folder into its own subfolder", async () => {
    const a = await createItem("u1", { kind: "folder", name: "A" });
    const b = await createItem("u1", { kind: "folder", name: "B", parentId: a.id });
    await expect(updateItem("u1", a.id, { parentId: b.id })).rejects.toThrow("into itself");
    await expect(updateItem("u1", a.id, { parentId: a.id })).rejects.toThrow("into itself");
  });

  it("trashes and restores a folder together with its contents", async () => {
    const folder = await createItem("u1", { kind: "folder", name: "Work" });
    const inside = await createItem("u1", { kind: "sheet", parentId: folder.id });
    const earlier = await createItem("u1", { kind: "doc", parentId: folder.id });
    await updateItem("u1", earlier.id, { trashed: true });
    await updateItem("u1", folder.id, { trashed: true });
    expect((await getItem("u1", inside.id)).trashedAt).not.toBeNull();
    await updateItem("u1", folder.id, { trashed: false });
    expect((await getItem("u1", inside.id)).trashedAt).toBeNull();
    // Trashed separately before the folder, so it stays in the trash.
    expect((await getItem("u1", earlier.id)).trashedAt).not.toBeNull();
    expect(await emptyTrash("u1")).toBe(1);
    expect(await listItems("u1")).toHaveLength(2);
  });

  it("deletes descendants and bodies forever", async () => {
    const folder = await createItem("u1", { kind: "folder" });
    const doc = await createItem("u1", { kind: "doc", parentId: folder.id });
    expect(await deleteForever("u1", [folder.id])).toBe(2);
    expect(await (await store()).get(`content/${doc.id}`)).toBeNull();
  });

  it("tracks storage usage through writes, uploads and deletes", async () => {
    const file = await uploadFile("u1", { name: "a.txt", mime: "text/plain", bytes: Buffer.from("hello"), parentId: null });
    const doc = await createItem("u1", { kind: "doc" });
    const before = (await usage("u1")).used;
    await writeBody("u1", doc.id, { type: "doc", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(1000) }] }] } });
    expect((await usage("u1")).used).toBeGreaterThan(before + 900);
    expect((await readFile("u1", file.id)).bytes.toString()).toBe("hello");
    await deleteForever("u1", [doc.id]);
    expect((await usage("u1")).used).toBe(5);
  });

  it("rejects a body of the wrong type", async () => {
    const doc = await createItem("u1", { kind: "doc" });
    await expect(writeBody("u1", doc.id, { type: "sheet", sheets: [] })).rejects.toThrow("does not match");
  });

  it("shares by link and stops when unshared or trashed", async () => {
    const doc = await createItem("u1", { kind: "doc", name: "Plan" });
    const shared = await setSharing("u1", doc.id, true);
    expect((await openShare(shared.shareId!)).item.name).toBe("Plan");
    await updateItem("u1", doc.id, { trashed: true });
    await expect(openShare(shared.shareId!)).rejects.toThrow();
    await updateItem("u1", doc.id, { trashed: false });
    await setSharing("u1", doc.id, false);
    await expect(openShare(shared.shareId!)).rejects.toThrow();
  });

  it("copies files", async () => {
    const doc = await createItem("u1", { kind: "doc", name: "Notes" });
    const copy = await duplicate("u1", doc.id);
    expect(copy.name).toBe("Copy of Notes");
    expect(copy.id).not.toBe(doc.id);
  });

  it("seeds a guest workspace with one of everything", async () => {
    await seedSamples("g1");
    const kinds = new Set((await listItems("g1")).map((i) => i.kind));
    expect([...kinds].sort()).toEqual(["doc", "file", "folder", "notebook", "sheet", "slides"]);
  });
});

describe("auth", () => {
  it("signs up, signs in and keeps emails unique", async () => {
    const user = await createUser({ email: "Ada@Example.com", name: "Ada", password: "correct horse" });
    expect(user.email).toBe("ada@example.com");
    expect((await authenticate("ada@example.com", "correct horse")).id).toBe(user.id);
    await expect(authenticate("ada@example.com", "wrong password")).rejects.toThrow("Wrong email or password");
    await expect(createUser({ email: "ada@example.com", name: "Other", password: "something else" })).rejects.toThrow("already exists");
  });

  it("issues and revokes sessions", async () => {
    const user = await createUser({ email: "a@b.co", name: "A", password: "password1" });
    const { token } = await createSession(user.id);
    expect((await userFromToken(token))?.id).toBe(user.id);
    await destroySession(token);
    expect(await userFromToken(token)).toBeNull();
  });

  it("lets a guest claim their workspace", async () => {
    const guest = await createUser({ email: "guest-1@guest.atrium", name: "Guest", password: null, guest: true });
    await expect(authenticate("guest-1@guest.atrium", "")).rejects.toThrow();
    const doc = await createItem(guest.id, { kind: "doc" });
    const claimed = await claimGuest(guest.id, { email: "me@x.io", name: "Me", password: "password1" });
    expect(claimed.guest).toBe(false);
    expect((await authenticate("me@x.io", "password1")).id).toBe(guest.id);
    expect((await getItem(guest.id, doc.id)).id).toBe(doc.id);
  });

  it("deletes an account with all its files", async () => {
    const user = await createUser({ email: "d@x.io", name: "D", password: "password1" });
    await createItem(user.id, { kind: "doc" });
    await deleteAccount(user.id);
    expect(await listItems(user.id)).toEqual([]);
    await expect(authenticate("d@x.io", "password1")).rejects.toThrow();
  });
});
