import crypto from "node:crypto";

const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";

/** URL-safe random id without look-alike characters. */
export function randomId(length = 12): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}
