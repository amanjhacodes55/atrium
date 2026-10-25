import { DriveError, openShare } from "@/lib/drive";
import { clientIp, handleError, HttpError, rateLimited, readJson } from "@/lib/http";
import { liveSync } from "@/lib/live";
import { LIVE_MAX_BYTES, liveRequest } from "@/lib/live-schema";

type Ctx = { params: Promise<{ shareId: string }> };

// Live editing through a public link. Viewers poll too, so they watch edits land and see who is here;
// only an edit link accepts updates.
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { item } = await openShare((await params).shareId);
    if (item.kind !== "doc") throw new DriveError("Not found.", 404);
    // Generous: one open tab polls about twice a second.
    if (rateLimited(`live:${clientIp(request.headers)}`, 600, 60_000)) throw new HttpError("Slow down a little.", 429);
    const req = liveRequest.parse(await readJson(request, LIVE_MAX_BYTES));
    return Response.json(await liveSync(item.id, req, item.shareRole === "edit"));
  } catch (err) {
    return handleError(err);
  }
}
