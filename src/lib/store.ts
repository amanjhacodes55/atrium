import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// Everything Atrium keeps (accounts, sessions, drive indexes, document bodies, uploaded files) is a
// value under a string key. On Netlify that is Netlify Blobs, which needs no setup or secrets; when
// self-hosting it is a folder on disk (ATRIUM_DATA_DIR, default ./.data).
//
// `update` is the only read-modify-write primitive: it retries on a concurrent change, so two
// requests editing the same drive index cannot silently drop each other's write.

export interface KV {
  get(key: string): Promise<Buffer | null>;
  set(key: string, value: Buffer | string): Promise<void>;
  delete(key: string): Promise<void>;
  update<T>(key: string, fn: (current: T | null) => T): Promise<T>;
}

export class ConflictError extends Error {}

class FileKV implements KV {
  private locks = new Map<string, Promise<unknown>>();
  constructor(private dir: string) {}

  private file(key: string) {
    // Keys are app-generated, but keep them inside the data folder regardless.
    const safe = key
      .split("/")
      .map((p) => encodeURIComponent(p).replace(/^\.+/, (m) => "%2E".repeat(m.length)))
      .join(path.sep);
    return path.join(this.dir, safe);
  }

  async get(key: string) {
    try {
      return await fs.readFile(this.file(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async set(key: string, value: Buffer | string) {
    const file = this.file(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Write then rename, so a crash never leaves a half-written value behind.
    const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    await fs.writeFile(tmp, value);
    await fs.rename(tmp, file);
  }

  async delete(key: string) {
    await fs.rm(this.file(key), { force: true });
  }

  async update<T>(key: string, fn: (current: T | null) => T): Promise<T> {
    // One process owns the folder, so a per-key queue is enough.
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.then(async () => {
      const raw = await this.get(key);
      const value = fn(raw ? (JSON.parse(raw.toString("utf8")) as T) : null);
      await this.set(key, JSON.stringify(value));
      return value;
    });
    this.locks.set(key, next.catch(() => {}));
    return next;
  }
}

type BlobStore = import("@netlify/blobs").Store;

class NetlifyKV implements KV {
  constructor(private store: BlobStore) {}

  async get(key: string) {
    const data = await this.store.get(key, { type: "arrayBuffer", consistency: "strong" });
    return data ? Buffer.from(data) : null;
  }

  async set(key: string, value: Buffer | string) {
    await this.store.set(key, typeof value === "string" ? value : new Uint8Array(value).buffer);
  }

  async delete(key: string) {
    await this.store.delete(key);
  }

  async update<T>(key: string, fn: (current: T | null) => T): Promise<T> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.store.getWithMetadata(key, { type: "json", consistency: "strong" });
      const value = fn((current?.data as T) ?? null);
      const body = JSON.stringify(value);
      const res = current?.etag
        ? await this.store.set(key, body, { onlyIfMatch: current.etag })
        : await this.store.set(key, body, { onlyIfNew: true });
      if (res.modified) return value;
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 60 * (attempt + 1)));
    }
    throw new ConflictError(`Too many concurrent writes to ${key}`);
  }
}

/**
 * The Blobs client cancels the body of every 404 (`res.body.cancel()`), and under Next.js's patched
 * fetch on Netlify that promise never settles, so reading a missing key hung until the function
 * timed out. Reading the body up front gives the client a Response whose cancel returns at once.
 */
const bufferedFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, { ...init, cache: "no-store" });
  const body = res.status === 204 || res.status === 304 ? null : await res.arrayBuffer();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
};

let kv: Promise<KV> | null = null;

export function store(): Promise<KV> {
  kv ??= (async () => {
    // Netlify sets NETLIFY_BLOBS_CONTEXT (or NETLIFY) inside its functions; anywhere else, use disk.
    if (process.env.ATRIUM_STORAGE !== "fs" && (process.env.NETLIFY_BLOBS_CONTEXT || process.env.NETLIFY)) {
      const { getStore } = await import("@netlify/blobs");
      return new NetlifyKV(getStore({ name: "atrium", consistency: "strong", fetch: bufferedFetch }));
    }
    return new FileKV(path.resolve(process.env.ATRIUM_DATA_DIR || ".data"));
  })();
  return kv;
}

export async function getJSON<T>(key: string): Promise<T | null> {
  const raw = await (await store()).get(key);
  return raw ? (JSON.parse(raw.toString("utf8")) as T) : null;
}

export async function setJSON(key: string, value: unknown) {
  await (await store()).set(key, JSON.stringify(value));
}

/** Test hook: point the store at a fresh folder. */
export function useFileStore(dir: string) {
  kv = Promise.resolve(new FileKV(dir));
}
