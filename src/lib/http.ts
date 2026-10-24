import { AuthError, currentUser } from "./auth";
import { DriveError } from "./drive";
import { ConflictError } from "./store";
import type { PublicUser } from "./types";

export class HttpError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** One readable message (plus the form field it belongs to, when there is one). */
export function handleError(err: unknown) {
  if (err instanceof AuthError) return Response.json({ error: err.message, field: err.field }, { status: err.status });
  if (err instanceof DriveError || err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
  if (err instanceof ConflictError) return Response.json({ error: "Someone else is saving at the same moment. Try again." }, { status: 409 });
  if (err && typeof err === "object" && "issues" in err) {
    const issue = (err as { issues: { message: string; path: (string | number)[] }[] }).issues[0];
    return Response.json({ error: issue?.message ?? "Check the form and try again", field: issue?.path[0] }, { status: 400 });
  }
  if (err instanceof SyntaxError) return Response.json({ error: "Invalid JSON." }, { status: 400 });
  console.error(err);
  return Response.json({ error: "Something went wrong on our side." }, { status: 500 });
}

export async function requireUser(request: Request): Promise<PublicUser> {
  const user = await currentUser(request);
  if (!user) throw new AuthError("Sign in to continue.", 401);
  return user;
}

/** Wraps a route handler with auth and error handling. */
export function route<C>(fn: (request: Request, user: PublicUser, ctx: C) => Promise<Response>) {
  return async (request: Request, ctx: C) => {
    try {
      return await fn(request, await requireUser(request), ctx);
    } catch (err) {
      return handleError(err);
    }
  };
}

export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > maxBytes) throw new HttpError("That is too large to save.", 413);
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError("That is too large to save.", 413);
  return JSON.parse(text);
}

export function clientIp(headers: Headers): string {
  return headers.get("x-nf-client-connection-ip") || headers.get("x-forwarded-for")?.split(",")[0].trim() || headers.get("x-real-ip") || "local";
}

/** Fixed-window limiter, per key, kept in memory: a speed bump per instance, not a guarantee. */
const windows = new Map<string, { start: number; count: number }>();
export function rateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start > windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 50_000) windows.clear();
    return false;
  }
  w.count++;
  return w.count > limit;
}

/** RFC 5987 Content-Disposition, so non-ASCII names survive downloads. */
export function disposition(kind: "inline" | "attachment", name: string) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
