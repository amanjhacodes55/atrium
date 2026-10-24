import crypto from "node:crypto";
import { promisify } from "node:util";
import { COOKIE } from "./auth-cookie";
import { deleteAllFor } from "./drive";
import { randomId } from "./ids";
import { getJSON, setJSON, store } from "./store";
import type { PublicUser } from "./types";

// Email + password accounts. Passwords are hashed with scrypt; sessions are random tokens kept in
// an HttpOnly cookie, and only their SHA-256 is stored, so leaked storage cannot log anyone in.
// Guests ("Try it without an account") are ordinary users with no password.

export { COOKIE };
export const SESSION_DAYS = 30;
const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };

type UserRecord = PublicUser & { passwordHash: string | null };
type Session = { userId: string; expiresAt: number };

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const userKey = (id: string) => `user/${id}`;
const emailKey = (email: string) => `email/${sha(email)}`;
const sessionKey = (token: string) => `session/${sha(token)}`;

export class AuthError extends Error {
  constructor(message: string, public status = 400, public field?: string) {
    super(message);
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length, SCRYPT);
  return crypto.timingSafeEqual(key, expected);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const toPublic = ({ passwordHash, ...user }: UserRecord): PublicUser => user;

export function signupAllowed(): boolean {
  // Open by default so anyone can try a fresh install; set ATRIUM_ALLOW_SIGNUP=false to close it.
  return process.env.ATRIUM_ALLOW_SIGNUP !== "false";
}

export async function createUser(input: { email: string; name: string; password: string | null; guest?: boolean }): Promise<PublicUser> {
  const email = input.email.trim().toLowerCase();
  const user: UserRecord = {
    id: randomId(),
    email,
    name: input.name.trim(),
    guest: Boolean(input.guest),
    createdAt: Date.now(),
    passwordHash: input.password ? await hashPassword(input.password) : null,
  };
  // Claim the email atomically: two sign-ups racing for one address cannot both win.
  let claimed = false;
  await (await store()).update<{ userId: string }>(emailKey(email), (current) => {
    if (current) return current;
    claimed = true;
    return { userId: user.id };
  });
  if (!claimed) throw new AuthError("An account with this email already exists. Sign in instead.", 409, "email");
  await setJSON(userKey(user.id), user);
  return toPublic(user);
}

// A real hash to compare against when the email is unknown, so response time does not reveal
// which emails have accounts.
let dummyHash: Promise<string> | null = null;

export async function authenticate(email: string, password: string): Promise<PublicUser> {
  const ref = await getJSON<{ userId: string }>(emailKey(email.trim().toLowerCase()));
  const user = ref ? await getJSON<UserRecord>(userKey(ref.userId)) : null;
  dummyHash ??= hashPassword("not-a-real-password");
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !user.passwordHash || !ok) throw new AuthError("Wrong email or password.", 401);
  return toPublic(user);
}

export async function createSession(userId: string): Promise<{ token: string; maxAge: number }> {
  const token = crypto.randomBytes(32).toString("base64url");
  await setJSON(sessionKey(token), { userId, expiresAt: Date.now() + SESSION_DAYS * 86_400_000 } satisfies Session);
  return { token, maxAge: SESSION_DAYS * 86_400 };
}

export async function destroySession(token: string | undefined) {
  if (token) await (await store()).delete(sessionKey(token));
}

export async function userFromToken(token: string | undefined | null): Promise<PublicUser | null> {
  if (!token) return null;
  const session = await getJSON<Session>(sessionKey(token));
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    await destroySession(token);
    return null;
  }
  const user = await getJSON<UserRecord>(userKey(session.userId));
  return user ? toPublic(user) : null;
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function tokenFrom(request: Request): string | undefined {
  return readCookie(request.headers.get("cookie"), COOKIE);
}

export function currentUser(request: Request): Promise<PublicUser | null> {
  return userFromToken(tokenFrom(request));
}

/** Set-Cookie value. Secure only over HTTPS, so plain-HTTP self-hosting on a LAN still works. */
export function sessionCookie(request: Request, token: string, maxAge: number): string {
  const https = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${https ? "; Secure" : ""}`;
}

export async function updateUser(id: string, patch: { name?: string }) {
  await (await store()).update<UserRecord>(userKey(id), (user) => {
    if (!user) throw new AuthError("Account not found.", 404);
    if (patch.name) user.name = patch.name.trim();
    return user;
  });
}

export async function changePassword(id: string, current: string, next: string) {
  const user = await getJSON<UserRecord>(userKey(id));
  if (!user) throw new AuthError("Account not found.", 404);
  if (user.passwordHash && !(await verifyPassword(current, user.passwordHash))) throw new AuthError("Your current password is wrong.", 400, "current");
  user.passwordHash = await hashPassword(next);
  await setJSON(userKey(id), user);
}

/** Turns a guest into a normal account, keeping their files. */
export async function claimGuest(id: string, input: { email: string; name: string; password: string }): Promise<PublicUser> {
  const user = await getJSON<UserRecord>(userKey(id));
  if (!user?.guest) throw new AuthError("Only guest accounts can be claimed.");
  const email = input.email.trim().toLowerCase();
  let claimed = false;
  await (await store()).update<{ userId: string }>(emailKey(email), (current) => {
    if (current && current.userId !== id) return current;
    claimed = true;
    return { userId: id };
  });
  if (!claimed) throw new AuthError("An account with this email already exists.", 409, "email");
  if (user.email !== email) await (await store()).delete(emailKey(user.email));
  const next: UserRecord = { ...user, email, name: input.name.trim(), guest: false, passwordHash: await hashPassword(input.password) };
  await setJSON(userKey(id), next);
  return toPublic(next);
}

export async function deleteAccount(id: string) {
  const user = await getJSON<UserRecord>(userKey(id));
  if (!user) return;
  await deleteAllFor(id);
  const kv = await store();
  await kv.delete(emailKey(user.email));
  await kv.delete(userKey(id));
}
