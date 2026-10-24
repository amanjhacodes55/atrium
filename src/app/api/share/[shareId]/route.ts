import { DriveError, openShare, readBody } from "@/lib/drive";
import { handleError } from "@/lib/http";

type Ctx = { params: Promise<{ shareId: string }> };

// Public, read-only: anyone with the link can view the file.
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { ownerId, item } = await openShare((await params).shareId);
    const shown = { id: item.id, kind: item.kind, name: item.name, mime: item.mime, size: item.size, updatedAt: item.updatedAt };
    if (item.kind === "file") return Response.json({ item: shown });
    if (item.kind === "folder") throw new DriveError("Not found.", 404);
    return Response.json({ item: shown, body: (await readBody(ownerId, item.id)).body });
  } catch (err) {
    return handleError(err);
  }
}
