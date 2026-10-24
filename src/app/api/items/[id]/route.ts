import { z } from "zod";
import { deleteForever, getItem, updateItem } from "@/lib/drive";
import { route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_request, user, { params }) => {
  return Response.json({ item: await getItem(user.id, (await params).id) });
});

const Patch = z.object({
  name: z.string().max(200).optional(),
  parentId: z.string().max(40).nullable().optional(),
  starred: z.boolean().optional(),
  trashed: z.boolean().optional(),
});

export const PATCH = route<Ctx>(async (request, user, { params }) => {
  const item = await updateItem(user.id, (await params).id, Patch.parse(await request.json()));
  return Response.json({ item });
});

export const DELETE = route<Ctx>(async (_request, user, { params }) => {
  return Response.json({ deleted: await deleteForever(user.id, [(await params).id]) });
});
