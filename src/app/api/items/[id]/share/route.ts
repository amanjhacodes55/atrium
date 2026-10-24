import { z } from "zod";
import { setSharing } from "@/lib/drive";
import { route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (request, user, { params }) => {
  const { on } = z.object({ on: z.boolean() }).parse(await request.json());
  return Response.json({ item: await setSharing(user.id, (await params).id, on) });
});
