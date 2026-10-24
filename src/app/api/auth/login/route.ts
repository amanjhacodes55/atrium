import { z } from "zod";
import { AuthError, authenticate, createSession, sessionCookie } from "@/lib/auth";
import { clientIp, handleError, rateLimited } from "@/lib/http";

const Login = z.object({
  email: z.string().trim().min(1, "Enter your email").max(254),
  password: z.string().min(1, "Enter your password").max(200),
});

export async function POST(request: Request) {
  try {
    if (rateLimited("login:" + clientIp(request.headers), 20, 600_000)) throw new AuthError("Too many attempts. Wait a few minutes and try again.", 429);
    const body = Login.parse(await request.json());
    const user = await authenticate(body.email, body.password);
    const { token, maxAge } = await createSession(user.id);
    const res = Response.json({ user });
    res.headers.append("Set-Cookie", sessionCookie(request, token, maxAge));
    return res;
  } catch (err) {
    return handleError(err);
  }
}
