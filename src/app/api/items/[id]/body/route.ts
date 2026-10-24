import { readBody, writeBody } from "@/lib/drive";
import { HttpError, readJson, route } from "@/lib/http";
import type { Body } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_request, user, { params }) => {
  return Response.json(await readBody(user.id, (await params).id));
});

export const PUT = route<Ctx>(async (request, user, { params }) => {
  const body = (await readJson(request, 4.5 * 1024 * 1024)) as Body;
  if (!body || typeof body !== "object" || !["doc", "sheet", "slides", "notebook"].includes(body.type)) throw new HttpError("Not a document body.");
  return Response.json({ item: await writeBody(user.id, (await params).id, body) });
});
