import { z } from "zod";
import { DriveError, getItem } from "@/lib/drive";
import { readJson, route } from "@/lib/http";
import { liveReset, liveSync } from "@/lib/live";
import { LIVE_MAX_BYTES, liveRequest } from "@/lib/live-schema";

type Ctx = { params: Promise<{ id: string }> };

async function ownDoc(userId: string, id: string) {
  const item = await getItem(userId, id);
  if (item.kind !== "doc") throw new DriveError("Live editing is for documents.");
  return item;
}

// The owner's channel for live editing. Poll it with the last sequence number seen; see src/lib/live.ts.
export const POST = route<Ctx>(async (request, user, { params }) => {
  const item = await ownDoc(user.id, (await params).id);
  const req = liveRequest.parse(await readJson(request, LIVE_MAX_BYTES));
  return Response.json(await liveSync(item.id, req, !item.trashedAt));
});

/** Replaces the live history (after importing a Word file over the document). */
export const PUT = route<Ctx>(async (request, user, { params }) => {
  const item = await ownDoc(user.id, (await params).id);
  const { update } = z.object({ update: z.string() }).parse(await readJson(request, LIVE_MAX_BYTES));
  await liveReset(item.id, update);
  return Response.json({ ok: true });
});
