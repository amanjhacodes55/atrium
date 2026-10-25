import { getJSON, store } from "./store";
import type { Kind, ShareRole } from "./types";

// "Shared with me": links a signed-in person has opened, remembered so they can find them again.
// One small list per user (`shared/<userId>`), newest first.

export type SharedEntry = { shareId: string; name: string; kind: Kind; role: ShareRole; owner: string; openedAt: number };

const key = (userId: string) => `shared/${userId}`;
const MAX = 200;

export async function rememberShared(userId: string, entry: Omit<SharedEntry, "openedAt">) {
  await (await store()).update<SharedEntry[]>(key(userId), (list) => [
    { ...entry, openedAt: Date.now() },
    ...(list ?? []).filter((e) => e.shareId !== entry.shareId).slice(0, MAX - 1),
  ]);
}

export async function listShared(userId: string): Promise<SharedEntry[]> {
  return (await getJSON<SharedEntry[]>(key(userId))) ?? [];
}

export async function forgetShared(userId: string, shareId: string) {
  await (await store()).update<SharedEntry[]>(key(userId), (list) => (list ?? []).filter((e) => e.shareId !== shareId));
}

export async function deleteSharedFor(userId: string) {
  await (await store()).delete(key(userId));
}

/** The display name of a link's owner, shown as "Shared by …". */
export async function ownerName(userId: string): Promise<string> {
  const user = await getJSON<{ name: string; guest: boolean }>(`user/${userId}`);
  return user && !user.guest ? user.name : "An Atrium user";
}
