import * as Y from "yjs";
import { randomId } from "./ids";
import { getJSON, store } from "./store";

// Live editing relays Yjs updates through the store, so it works on serverless functions with no
// socket server. Each document has two values:
//
//   live/<itemId>/log    every update since the last compaction (big: it holds the whole document)
//   live/<itemId>/head   the latest sequence number and who is here (small: read on every poll)
//
// Clients poll with the last sequence number they have seen. Yjs updates are idempotent and
// commutative, so sending one twice or out of order is harmless, and compaction can merge the log
// into a single update at any time. `epoch` changes when the content is replaced wholesale (a Word
// import); clients on an older epoch throw their copy away and load the new one.

type Log = { epoch: string; start: number; updates: string[] };
type Peer = { state: string; at: number };
type Head = { epoch: string; seq: number; peers: Record<string, Peer> };

export type LiveRequest = {
  /** Last sequence number this client has applied, and the epoch it belongs to. */
  since: number;
  epoch?: string | null;
  /** A Yjs update made locally (base64). With `seed`, only stored if the document has no history yet. */
  update?: string;
  seed?: boolean;
  /** This client's Yjs awareness update (base64), or null when it is leaving. */
  client: number;
  awareness?: string | null;
};

export type LiveResponse = { epoch: string; seq: number; updates: string[]; peers: { client: number; state: string }[] };

const logKey = (id: string) => `live/${id}/log`;
const headKey = (id: string) => `live/${id}/head`;
/** A peer that has not polled for this long has closed the tab. */
const PEER_TTL = 25_000;
const COMPACT_AT = 64;
const MAX_LOG = 12 * 1024 * 1024;

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const bytes = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

function compact(log: Log): Log {
  if (log.updates.length < 2) return log;
  const merged = b64(Y.mergeUpdates(log.updates.map(bytes)));
  // The sequence number keeps counting: the merged update takes the place of the last one.
  return { epoch: log.epoch, start: log.start + log.updates.length - 1, updates: [merged] };
}

export async function liveSync(itemId: string, req: LiveRequest, canEdit: boolean): Promise<LiveResponse> {
  const kv = await store();
  let log: Log | null = null;
  if (req.update && canEdit) {
    if (req.update.length > MAX_LOG) throw new Error("Update too large");
    log = await kv.update<Log>(logKey(itemId), (current) => {
      const next = current ?? { epoch: randomId(10), start: 0, updates: [] };
      if (req.seed ? next.updates.length > 0 : current && req.epoch !== current.epoch) {
        // A seed lost the race to another client's, or an edit was made on a replaced copy.
        return next;
      }
      next.updates.push(req.update!);
      const size = next.updates.reduce((n, u) => n + u.length, 0);
      return next.updates.length >= COMPACT_AT || size > MAX_LOG / 2 ? compact(next) : next;
    });
  }

  const now = Date.now();
  const touch = log !== null || req.awareness !== undefined;
  // A plain poll only reads: clients re-announce themselves every 10 seconds, which keeps them listed.
  const head = touch
    ? await kv.update<Head>(headKey(itemId), (current) => {
        const next = current ?? { epoch: log?.epoch ?? "", seq: 0, peers: {} };
        if (log && (log.epoch !== next.epoch || log.start + log.updates.length > next.seq)) {
          next.epoch = log.epoch;
          next.seq = log.start + log.updates.length;
        }
        const key = String(req.client);
        if (req.awareness === null) delete next.peers[key];
        else if (req.awareness) next.peers[key] = { state: req.awareness, at: now };
        else if (next.peers[key]) next.peers[key].at = now;
        for (const [k, p] of Object.entries(next.peers)) if (now - p.at > PEER_TTL) delete next.peers[k];
        return next;
      })
    : ((await getJSON<Head>(headKey(itemId))) ?? { epoch: "", seq: 0, peers: {} });

  let updates: string[] = [];
  const stale = req.epoch !== head.epoch;
  if (stale || req.since < head.seq) {
    log ??= await getJSON<Log>(logKey(itemId));
    if (log && log.epoch === head.epoch) {
      // A client further back than the compaction point gets everything; repeats are harmless.
      updates = stale || req.since < log.start ? log.updates : log.updates.slice(req.since - log.start);
    }
  }
  const peers = Object.entries(head.peers)
    .filter(([k, p]) => k !== String(req.client) && now - p.at <= PEER_TTL)
    .map(([k, p]) => ({ client: Number(k), state: p.state }));
  return { epoch: head.epoch, seq: head.seq, updates, peers };
}

/** Replaces the live history with a single update (after a Word import). Open editors reload. */
export async function liveReset(itemId: string, update: string) {
  const epoch = randomId(10);
  const kv = await store();
  await kv.set(logKey(itemId), JSON.stringify({ epoch, start: 0, updates: [update] } satisfies Log));
  await kv.update<Head>(headKey(itemId), (current) => ({ epoch, seq: 1, peers: current?.peers ?? {} }));
}

export async function liveDelete(itemId: string) {
  const kv = await store();
  await Promise.all([kv.delete(logKey(itemId)), kv.delete(headKey(itemId))]);
}
