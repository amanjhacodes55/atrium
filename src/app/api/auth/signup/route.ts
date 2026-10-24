import { z } from "zod";
import { AuthError, claimGuest, createSession, createUser, currentUser, sessionCookie, signupAllowed } from "@/lib/auth";
import { clientIp, handleError, rateLimited } from "@/lib/http";

const Signup = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80),
  email: z.string().trim().email("Enter a valid email address").max(254),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

export async function POST(request: Request) {
  try {
    if (rateLimited("signup:" + clientIp(request.headers), 10, 600_000)) throw new AuthError("Too many sign-ups from this address. Try again later.", 429);
    if (!signupAllowed()) throw new AuthError("Sign-ups are closed on this Atrium instance. Ask its owner for an account.", 403);
    const body = Signup.parse(await request.json());
    // A guest who signs up keeps everything they made while trying it out.
    const guest = await currentUser(request);
    if (guest?.guest) return Response.json({ user: await claimGuest(guest.id, body) }, { status: 201 });
    const user = await createUser(body);
    const { token, maxAge } = await createSession(user.id);
    const res = Response.json({ user }, { status: 201 });
    res.headers.append("Set-Cookie", sessionCookie(request, token, maxAge));
    return res;
  } catch (err) {
    return handleError(err);
  }
}
