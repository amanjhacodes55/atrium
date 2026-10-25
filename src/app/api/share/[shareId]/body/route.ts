import { DriveError, openShare, writeBody } from "@/lib/drive";
import { handleError, HttpError, readJson } from "@/lib/http";
import type { DocBody } from "@/lib/types";

type Ctx = { params: Promise<{ shareId: string }> };

// Saves the document as edited through an edit link, so the owner's drive, exports and previews
// stay current. The live history (src/lib/live.ts) is what keeps editors in step; this is the copy at rest.
export async function PUT(request: Request, { params }: Ctx) {
  try {
    const { ownerId, item } = await openShare((await params).shareId);
    if (item.shareRole !== "edit") throw new DriveError("This link is view only.", 403);
    const body = (await readJson(request, 4.5 * 1024 * 1024)) as DocBody;
    if (!body || typeof body !== "object" || body.type !== "doc") throw new HttpError("Not a document body.");
    const saved = await writeBody(ownerId, item.id, body);
    return Response.json({ item: { id: saved.id, kind: saved.kind, name: saved.name, size: saved.size, updatedAt: saved.updatedAt } });
  } catch (err) {
    return handleError(err);
  }
}
