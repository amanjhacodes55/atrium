import { z } from "zod";
import { route } from "@/lib/http";
import { forgetShared, listShared } from "@/lib/shared";

export const GET = route(async (_request, user) => Response.json({ shared: await listShared(user.id) }));

/** Removes a link from "Shared with me". The file itself is untouched. */
export const DELETE = route(async (request, user) => {
  const { shareId } = z.object({ shareId: z.string().max(40) }).parse(await request.json());
  await forgetShared(user.id, shareId);
  return Response.json({ ok: true });
});
