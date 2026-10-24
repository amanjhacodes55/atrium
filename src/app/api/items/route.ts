import { z } from "zod";
import { createItem, listItems, usage } from "@/lib/drive";
import { readJson, route } from "@/lib/http";
import type { Body } from "@/lib/types";

export const GET = route(async (_request, user) => {
  const [items, use] = await Promise.all([listItems(user.id), usage(user.id)]);
  return Response.json({ items, usage: use });
});

const Create = z
  .object({
    kind: z.enum(["folder", "doc", "sheet", "slides", "notebook"]),
    name: z.string().max(200).optional(),
    parentId: z.string().max(40).nullable().optional(),
    // Imported files (Word, Excel, PowerPoint) arrive already converted to a body.
    body: z.looseObject({ type: z.enum(["doc", "sheet", "slides", "notebook"]) }).optional(),
  })
  .refine((v) => !v.body || v.body.type === v.kind, { message: "Body type does not match.", path: ["body"] });

export const POST = route(async (request, user) => {
  const input = Create.parse(await readJson(request, 4.5 * 1024 * 1024));
  const item = await createItem(user.id, { ...input, body: input.body as Body | undefined });
  return Response.json({ item }, { status: 201 });
});
