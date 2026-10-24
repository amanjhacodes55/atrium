import { COOKIE, destroySession, tokenFrom } from "@/lib/auth";

export async function POST(request: Request) {
  await destroySession(tokenFrom(request));
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res;
}
