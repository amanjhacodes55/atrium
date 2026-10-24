import { emptyTrash } from "@/lib/drive";
import { route } from "@/lib/http";

export const DELETE = route(async (_request, user) => {
  return Response.json({ deleted: await emptyTrash(user.id) });
});
