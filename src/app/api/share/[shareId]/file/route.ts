import { openShare, readFile } from "@/lib/drive";
import { fileResponse } from "@/lib/file-response";
import { handleError } from "@/lib/http";

type Ctx = { params: Promise<{ shareId: string }> };

export async function GET(request: Request, { params }: Ctx) {
  try {
    const { ownerId, item } = await openShare((await params).shareId);
    const { bytes } = await readFile(ownerId, item.id);
    return fileResponse(request, item.name, item.mime ?? "", bytes);
  } catch (err) {
    return handleError(err);
  }
}
