import { currentUser } from "@/lib/auth";
import { DriveError, openShare, readBody } from "@/lib/drive";
import { handleError } from "@/lib/http";
import { ownerName, rememberShared } from "@/lib/shared";

type Ctx = { params: Promise<{ shareId: string }> };

// Public: anyone with the link can open the file; `role` says whether they may edit it too.
export async function GET(request: Request, { params }: Ctx) {
  try {
    const { shareId } = await params;
    const { ownerId, item } = await openShare(shareId);
    const shown = { id: item.id, kind: item.kind, name: item.name, mime: item.mime, size: item.size, updatedAt: item.updatedAt };
    if (item.kind === "folder") throw new DriveError("Not found.", 404);
    const role = item.shareRole ?? "view";
    const [user, owner] = await Promise.all([currentUser(request), ownerName(ownerId)]);
    // Signed-in visitors get it under "Shared with me", like any shared drive.
    if (user && user.id !== ownerId) await rememberShared(user.id, { shareId, name: item.name, kind: item.kind, role, owner }).catch(() => {});
    const me = user ? { name: user.name, guest: user.guest, owner: user.id === ownerId } : null;
    if (item.kind === "file") return Response.json({ item: shown, role, owner, me });
    return Response.json({ item: shown, role, owner, me, body: (await readBody(ownerId, item.id)).body });
  } catch (err) {
    return handleError(err);
  }
}
