import { z } from "zod";
import { changePassword, COOKIE, deleteAccount, destroySession, tokenFrom, updateUser } from "@/lib/auth";
import { route } from "@/lib/http";

const Patch = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80).optional(),
  current: z.string().max(200).optional(),
  password: z.string().min(8, "Use at least 8 characters").max(200).optional(),
});

export const PATCH = route(async (request, user) => {
  const body = Patch.parse(await request.json());
  if (body.name) await updateUser(user.id, { name: body.name });
  if (body.password) await changePassword(user.id, body.current ?? "", body.password);
  return Response.json({ ok: true });
});

export const DELETE = route(async (request, user) => {
  await deleteAccount(user.id);
  await destroySession(tokenFrom(request));
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res;
});
