import { blankBody, DEFAULT_NAME } from "./blank";
import { randomId } from "./ids";
import { getJSON, setJSON, store } from "./store";
import type { Body, EditableKind, Item, Kind, Usage } from "./types";

// Each user's drive is one index value (`drive/<userId>`) listing every item's metadata, so a
// folder view is a single read. Bodies live apart: `content/<itemId>` (JSON for Atrium files, raw
// bytes for uploads). Public links map `share/<shareId>` back to the owner and item.

type Index = { items: Record<string, Item>; used: number };
type ShareRef = { ownerId: string; itemId: string };

export class DriveError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const QUOTA = Number(process.env.ATRIUM_QUOTA_MB || 500) * 1024 * 1024;
/** Netlify functions accept request bodies up to 6 MB; leave room for headers. */
export const MAX_UPLOAD = Number(process.env.ATRIUM_MAX_UPLOAD_MB || (process.env.NETLIFY ? 4.5 : 50)) * 1024 * 1024;
const MAX_BODY = 4 * 1024 * 1024;

const indexKey = (userId: string) => `drive/${userId}`;
const contentKey = (itemId: string) => `content/${itemId}`;
const shareKey = (shareId: string) => `share/${shareId}`;

async function readIndex(userId: string): Promise<Index> {
  return (await getJSON<Index>(indexKey(userId))) ?? { items: {}, used: 0 };
}

async function editIndex<T>(userId: string, fn: (index: Index) => T): Promise<T> {
  let out!: T;
  await (await store()).update<Index>(indexKey(userId), (current) => {
    const index = current ?? { items: {}, used: 0 };
    out = fn(index);
    index.used = Object.values(index.items).reduce((n, i) => n + i.size, 0);
    return index;
  });
  return out;
}

export async function listItems(userId: string): Promise<Item[]> {
  return Object.values((await readIndex(userId)).items);
}

export async function usage(userId: string): Promise<Usage> {
  return { used: (await readIndex(userId)).used, quota: QUOTA };
}

export async function getItem(userId: string, id: string): Promise<Item> {
  const item = (await readIndex(userId)).items[id];
  if (!item) throw new DriveError("File not found.", 404);
  return item;
}

function checkParent(index: Index, parentId: string | null) {
  if (parentId === null) return;
  const parent = index.items[parentId];
  if (!parent || parent.kind !== "folder" || parent.trashedAt) throw new DriveError("That folder does not exist.", 404);
}

function checkName(name: string) {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) throw new DriveError("Give it a name.");
  if (clean.length > 200) throw new DriveError("Names can be at most 200 characters.");
  return clean;
}

export async function createItem(
  userId: string,
  input: { kind: Exclude<Kind, "file">; name?: string; parentId?: string | null; body?: Body },
): Promise<Item> {
  const id = randomId();
  const now = Date.now();
  const body = input.kind === "folder" ? null : JSON.stringify(input.body ?? blankBody(input.kind as EditableKind, id));
  if (body && body.length > MAX_BODY) throw new DriveError("That file is too large.", 413);
  const item: Item = {
    id,
    kind: input.kind,
    name: checkName(input.name || DEFAULT_NAME[input.kind]),
    parentId: input.parentId ?? null,
    size: body ? Buffer.byteLength(body) : 0,
    starred: false,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
    shareId: null,
  };
  // Write the body first: an index entry must never point at a missing body.
  if (body) await (await store()).set(contentKey(id), body);
  try {
    await editIndex(userId, (index) => {
      checkParent(index, item.parentId);
      if (index.used + item.size > QUOTA) throw new DriveError("Your drive is full. Delete something to make room.", 413);
      index.items[id] = item;
    });
  } catch (e) {
    if (body) await (await store()).delete(contentKey(id));
    throw e;
  }
  return item;
}

export async function uploadFile(userId: string, input: { name: string; mime: string; bytes: Buffer; parentId: string | null }): Promise<Item> {
  if (input.bytes.length > MAX_UPLOAD) throw new DriveError(`Files can be at most ${Math.floor(MAX_UPLOAD / 1048576)} MB.`, 413);
  const before = await readIndex(userId);
  if (before.used + input.bytes.length > QUOTA) throw new DriveError("Your drive is full. Delete something to make room.", 413);
  const id = randomId();
  const now = Date.now();
  const item: Item = {
    id,
    kind: "file",
    name: checkName(input.name),
    parentId: input.parentId,
    mime: input.mime || "application/octet-stream",
    size: input.bytes.length,
    starred: false,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
    shareId: null,
  };
  await (await store()).set(contentKey(id), input.bytes);
  try {
    await editIndex(userId, (index) => {
      checkParent(index, item.parentId);
      index.items[id] = item;
    });
  } catch (e) {
    await (await store()).delete(contentKey(id));
    throw e;
  }
  return item;
}

function descendants(index: Index, id: string): Item[] {
  const out: Item[] = [];
  const walk = (parent: string) => {
    for (const child of Object.values(index.items)) {
      if (child.parentId === parent) {
        out.push(child);
        walk(child.id);
      }
    }
  };
  walk(id);
  return out;
}

export type Patch = { name?: string; parentId?: string | null; starred?: boolean; trashed?: boolean };

export async function updateItem(userId: string, id: string, patch: Patch): Promise<Item> {
  return editIndex(userId, (index) => {
    const item = index.items[id];
    if (!item) throw new DriveError("File not found.", 404);
    if (patch.name !== undefined) item.name = checkName(patch.name);
    if (patch.starred !== undefined) item.starred = patch.starred;
    if (patch.parentId !== undefined && patch.parentId !== item.parentId) {
      checkParent(index, patch.parentId);
      if (patch.parentId === id || descendants(index, id).some((d) => d.id === patch.parentId)) {
        throw new DriveError("A folder cannot be moved into itself.");
      }
      item.parentId = patch.parentId;
    }
    if (patch.trashed !== undefined) {
      if (patch.trashed && !item.trashedAt) {
        // Children are trashed with the same timestamp so restoring the folder brings back exactly
        // what went with it, not things that were trashed separately before.
        const at = Date.now();
        item.trashedAt = at;
        for (const d of descendants(index, id)) if (!d.trashedAt) d.trashedAt = at;
      } else if (!patch.trashed && item.trashedAt) {
        const at = item.trashedAt;
        item.trashedAt = null;
        for (const d of descendants(index, id)) if (d.trashedAt === at) d.trashedAt = null;
        // Restoring into a folder that is itself in the trash would hide it; put it at the top.
        if (item.parentId && (!index.items[item.parentId] || index.items[item.parentId].trashedAt)) item.parentId = null;
      }
    }
    if (patch.name !== undefined || patch.parentId !== undefined) item.updatedAt = Date.now();
    return { ...item };
  });
}

export async function deleteForever(userId: string, ids: string[]): Promise<number> {
  const removed = await editIndex(userId, (index) => {
    const gone: Item[] = [];
    for (const id of ids) {
      const item = index.items[id];
      if (!item) continue;
      gone.push(item, ...descendants(index, id));
    }
    for (const item of gone) delete index.items[item.id];
    return gone;
  });
  const kv = await store();
  await Promise.all(
    removed.flatMap((item) => [kv.delete(contentKey(item.id)), item.shareId ? kv.delete(shareKey(item.shareId)) : Promise.resolve()]),
  );
  return removed.length;
}

export async function emptyTrash(userId: string): Promise<number> {
  const trashed = (await listItems(userId)).filter((i) => i.trashedAt).map((i) => i.id);
  return deleteForever(userId, trashed);
}

export async function readBody(userId: string, id: string): Promise<{ item: Item; body: Body }> {
  const item = await getItem(userId, id);
  if (item.kind === "folder" || item.kind === "file") throw new DriveError("This item has no editable body.");
  const body = await getJSON<Body>(contentKey(id));
  if (!body) throw new DriveError("File not found.", 404);
  return { item, body };
}

export async function writeBody(userId: string, id: string, body: Body): Promise<Item> {
  const item = await getItem(userId, id);
  if (item.kind !== body.type) throw new DriveError("That body does not match the file type.");
  const json = JSON.stringify(body);
  const size = Buffer.byteLength(json);
  if (size > MAX_BODY) throw new DriveError("This file has grown past 4 MB. Try smaller images.", 413);
  await setJSON(contentKey(id), body);
  return editIndex(userId, (index) => {
    const current = index.items[id];
    if (!current) throw new DriveError("File not found.", 404);
    if (index.used - current.size + size > QUOTA) throw new DriveError("Your drive is full.", 413);
    current.size = size;
    current.updatedAt = Date.now();
    return { ...current };
  });
}

export async function readFile(userId: string, id: string): Promise<{ item: Item; bytes: Buffer }> {
  const item = await getItem(userId, id);
  if (item.kind !== "file") throw new DriveError("Not an uploaded file.");
  const bytes = await (await store()).get(contentKey(id));
  if (!bytes) throw new DriveError("File not found.", 404);
  return { item, bytes };
}

export async function duplicate(userId: string, id: string): Promise<Item> {
  const item = await getItem(userId, id);
  const name = `Copy of ${item.name}`.slice(0, 200);
  if (item.kind === "file") {
    const { bytes } = await readFile(userId, id);
    return uploadFile(userId, { name, mime: item.mime ?? "", bytes, parentId: item.parentId });
  }
  if (item.kind === "folder") throw new DriveError("Folders cannot be copied yet.");
  const { body } = await readBody(userId, id);
  return createItem(userId, { kind: item.kind, name, parentId: item.parentId, body });
}

export async function setSharing(userId: string, id: string, on: boolean): Promise<Item> {
  const item = await getItem(userId, id);
  if (item.kind === "folder") throw new DriveError("Share files one at a time.");
  if (on === Boolean(item.shareId)) return item;
  const shareId = on ? randomId(16) : null;
  if (shareId) await setJSON(shareKey(shareId), { ownerId: userId, itemId: id } satisfies ShareRef);
  else await (await store()).delete(shareKey(item.shareId!));
  return editIndex(userId, (index) => {
    const current = index.items[id];
    if (!current) throw new DriveError("File not found.", 404);
    current.shareId = shareId;
    return { ...current };
  });
}

/** Resolves a public link. Trashed items stop being reachable. */
export async function openShare(shareId: string): Promise<{ ownerId: string; item: Item }> {
  const ref = await getJSON<ShareRef>(shareKey(shareId));
  if (!ref) throw new DriveError("This link has been turned off or never existed.", 404);
  const item = (await readIndex(ref.ownerId)).items[ref.itemId];
  if (!item || item.shareId !== shareId || item.trashedAt) throw new DriveError("This link has been turned off or never existed.", 404);
  return { ownerId: ref.ownerId, item };
}

export async function deleteAllFor(userId: string) {
  const items = await listItems(userId);
  await deleteForever(userId, items.map((i) => i.id));
  await (await store()).delete(indexKey(userId));
}
