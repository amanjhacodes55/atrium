import { readFile } from "@/lib/drive";
import { fileResponse } from "@/lib/file-response";
import { route } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (request, user, { params }) => {
  const { item, bytes } = await readFile(user.id, (await params).id);
  return fileResponse(request, item.name, item.mime ?? "", bytes);
});
