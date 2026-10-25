import { z } from "zod";

// Base64 Yjs updates and awareness states, as sent by src/lib/live-client.ts.
const b64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/);

export const liveRequest = z.object({
  since: z.number().int().min(0),
  epoch: z.string().max(40).nullish(),
  update: b64.optional(),
  seed: z.boolean().optional(),
  client: z.number().int().min(0).max(2 ** 53),
  awareness: b64.max(16_000).nullish(),
});

/** The largest live request: one update can carry a pasted image. */
export const LIVE_MAX_BYTES = 6 * 1024 * 1024;
