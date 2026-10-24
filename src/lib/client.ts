"use client";

import type { Body, Item, Kind, PublicUser, Usage } from "./types";

// Thin fetch wrappers for the browser. Errors carry the server's readable message.

export class ApiError extends Error {
  constructor(message: string, public status: number, public field?: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && !path.startsWith("/api/auth") && typeof window !== "undefined") {
    // A full reload on purpose: the session is gone, so drop all client state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data.field);
  return data as T;
}

export const drive = {
  list: () => api<{ items: Item[]; usage: Usage }>("/api/items"),
  create: (kind: Exclude<Kind, "file">, opts: { name?: string; parentId?: string | null; body?: Body } = {}) =>
    api<{ item: Item }>("/api/items", { method: "POST", json: { kind, ...opts } }).then((r) => r.item),
  update: (id: string, patch: { name?: string; parentId?: string | null; starred?: boolean; trashed?: boolean }) =>
    api<{ item: Item }>(`/api/items/${id}`, { method: "PATCH", json: patch }).then((r) => r.item),
  remove: (id: string) => api(`/api/items/${id}`, { method: "DELETE" }),
  copy: (id: string) => api<{ item: Item }>(`/api/items/${id}/copy`, { method: "POST" }).then((r) => r.item),
  share: (id: string, on: boolean) => api<{ item: Item }>(`/api/items/${id}/share`, { method: "POST", json: { on } }).then((r) => r.item),
  emptyTrash: () => api("/api/trash", { method: "DELETE" }),
  body: <B extends Body>(id: string) => api<{ item: Item; body: B }>(`/api/items/${id}/body`),
  save: (id: string, body: Body) => api<{ item: Item }>(`/api/items/${id}/body`, { method: "PUT", json: body }).then((r) => r.item),
  upload: (file: File, parentId: string | null) => {
    const q = new URLSearchParams({ name: file.name, type: file.type || "application/octet-stream" });
    if (parentId) q.set("parent", parentId);
    return api<{ item: Item }>(`/api/upload?${q}`, { method: "POST", body: file }).then((r) => r.item);
  },
};

export const auth = {
  me: () => api<{ user: PublicUser; usage: Usage }>("/api/auth/me"),
  logout: () => api("/api/auth/logout", { method: "POST" }),
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatWhen(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  const d = new Date(ms);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

/** Saves a Blob as a download. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "Untitled";
}

/** Reads an image file into a data URL, scaled down so it stays small inside a document. */
export function imageToDataUrl(file: File, maxSide = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      // PNG keeps transparency for logos and diagrams; photos become JPEG.
      resolve(file.type === "image/png" || file.type === "image/gif" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be read."));
    };
    img.src = url;
  });
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
