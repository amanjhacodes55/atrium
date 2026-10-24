import { MAX_UPLOAD, uploadFile } from "@/lib/drive";
import { HttpError, route } from "@/lib/http";

// Raw bytes in the body; name, type and folder in the query string. No multipart parsing, and the
// size check happens before the body is read.
export const POST = route(async (request, user) => {
  const url = new URL(request.url);
  const name = url.searchParams.get("name")?.trim();
  if (!name) throw new HttpError("Missing file name.");
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_UPLOAD) throw new HttpError(`Files can be at most ${Math.floor(MAX_UPLOAD / 1048576)} MB.`, 413);
  const bytes = Buffer.from(await request.arrayBuffer());
  const item = await uploadFile(user.id, {
    name,
    mime: (url.searchParams.get("type") || request.headers.get("content-type") || "").slice(0, 120),
    bytes,
    parentId: url.searchParams.get("parent") || null,
  });
  return Response.json({ item }, { status: 201 });
});
