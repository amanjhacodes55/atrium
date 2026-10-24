import { duplicate } from "@/lib/drive";
import { route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (_request, user, { params }) => {
  return Response.json({ item: await duplicate(user.id, (await params).id) }, { status: 201 });
});
