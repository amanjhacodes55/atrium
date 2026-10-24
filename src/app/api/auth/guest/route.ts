import { AuthError, createSession, createUser, sessionCookie, signupAllowed } from "@/lib/auth";
import { clientIp, handleError, rateLimited } from "@/lib/http";
import { randomId } from "@/lib/ids";
import { seedSamples } from "@/lib/samples";

// "Try it without an account": a fresh guest workspace with sample files in every app.
export async function POST(request: Request) {
  try {
    if (rateLimited("guest:" + clientIp(request.headers), 10, 600_000)) throw new AuthError("Too many demo workspaces from this address. Try again later.", 429);
    if (!signupAllowed()) throw new AuthError("Sign-ups are closed on this Atrium instance.", 403);
    const user = await createUser({ email: `guest-${randomId(10)}@guest.atrium`, name: "Guest", password: null, guest: true });
    await seedSamples(user.id);
    const { token, maxAge } = await createSession(user.id);
    const res = Response.json({ user }, { status: 201 });
    res.headers.append("Set-Cookie", sessionCookie(request, token, maxAge));
    return res;
  } catch (err) {
    return handleError(err);
  }
}
