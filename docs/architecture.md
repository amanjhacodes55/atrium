# Architecture

```
Browser                                    Server (Next.js route handlers)            Storage
───────                                    ──────────────────────────────             ───────
Docs     ─┐                                /api/auth/*   accounts, sessions     ─┐
Sheets   ─┤  fetch JSON  ───────────────▶  /api/items/*  drive index, bodies    ─┼─▶  KV interface (src/lib/store.ts)
Slides   ─┤  (src/lib/client.ts)           /api/upload   raw file bytes         ─┤      ├─ Netlify Blobs (on Netlify)
Notebook ─┤                                /api/share/*  public links          ─┤      └─ files on disk (elsewhere)
          │  poll Yjs updates  ──────────▶  /api/*/live   live editing (Docs)   ─┘
Drive    ─┘
```

## Principles

- **The editors run in the browser.** Formula evaluation, rich-text editing, slide layout and every import/export
  (Word, Excel, PowerPoint, CSV, PDF) happen client-side. The server only stores JSON and bytes, so it stays small and
  cheap to run on serverless functions.
- **No database server.** Storage is a key/value interface with four operations (`get`, `set`, `delete`, `update`).
  That fits Netlify Blobs with zero configuration and a folder on disk for self-hosting.
- **One index per user.** A drive's metadata lives in one value (`drive/<userId>`), so any folder, search, starred or
  trash view is a single read and filtering happens in memory. Bodies are separate (`content/<itemId>`) and are only
  read when a file is opened.
- **Safe concurrent writes.** `update()` is a compare-and-swap: on Netlify it uses the blob's ETag (`onlyIfMatch` /
  `onlyIfNew`) and retries on conflict; on disk, writes to one key are queued. Two tabs moving files at the same moment
  cannot lose each other's change. Email uniqueness uses the same primitive.
- **Bodies are written before the index.** A new item's body is stored first and the index entry added after, so the
  index never points at a missing body; a failed index write deletes the orphaned body.

## Source map

| Path                               | What it does                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `src/lib/store.ts`                 | KV interface and its Netlify Blobs and filesystem backends.                  |
| `src/lib/drive.ts`                 | Items, folders, trash, quota, bodies, uploads, copies, share links.         |
| `src/lib/auth.ts`                  | Accounts (scrypt), sessions (hashed random tokens), guests.                  |
| `src/lib/samples.ts`               | Sample files for guest workspaces.                                           |
| `src/lib/types.ts`                 | Item and body types shared by server and browser.                           |
| `src/lib/convert/`                 | Word, Excel/CSV and PowerPoint import and export (browser only).             |
| `src/lib/sheets/`                  | Formula engine (HyperFormula), A1 helpers and number formats.               |
| `src/lib/templates/`               | Templates shown on each app's start page.                                    |
| `src/app/api/`                     | Route handlers. See [api.md](api.md).                                        |
| `src/app/(app)/`                   | Signed-in pages: home, drive, account and the four editors.                 |
| `src/app/s/[shareId]`              | Public viewer for shared links.                                              |
| `src/components/editor-shell.tsx`  | Header shared by every editor, autosave hook, share dialog.                 |
| `src/components/files.tsx`         | File list, item actions, move dialog, previews, Office import.               |
| `src/lib/live.ts`, `live-client.ts` | Live editing: the update relay on the server and the polling client.        |
| `src/components/docs/`             | The paged Docs editor, pagination plugin, presence and shared-link view.     |
| `src/lib/shared.ts`                | "Shared with me": links a signed-in user has opened.                         |

## Live editing

Docs are edited together in real time, like Google Docs, without a socket server, so it runs on Netlify's functions:

- The editor's content is a [Yjs](https://yjs.dev) document bound to TipTap by its Collaboration extension. Yjs merges
  concurrent edits without conflicts, so the server never has to understand the document: it only relays updates.
- Each document has a **log** (`live/<id>/log`, every update since the last compaction) and a small **head**
  (`live/<id>/head`, the latest sequence number and who is here). Writes go through the store's compare-and-swap
  `update()`, so two people typing at once never lose an update.
- Clients poll with the last sequence number they applied: every 0.45 s while someone else is in the document, every
  1.5 s when alone, every 5 s in a hidden tab. A local edit is sent within 40 ms. A plain poll only reads the head; the
  log is read only when there is something new. After 64 updates the log is merged into one.
- Presence (names, colours and cursors) is Yjs awareness, relayed through the head. Each client re-announces itself
  every 10 s and is dropped after 25 s of silence, or at once when the tab closes.
- The first person to open a document seeds the log from the saved body; the server keeps only the first seed if two
  arrive together. A view link never seeds: it shows the saved copy until an editor opens the document.
- The JSON body is still saved by autosave (only by the person who made the change), so the drive, downloads and
  previews always have the current text. A Word import replaces the log and bumps its **epoch**; every open copy sees
  the new epoch and reloads.

## Pages

Docs are laid out on real pages. The editor is one continuous ProseMirror view with the paper sheets drawn behind it;
a plugin (`src/components/docs/pagination.ts`) measures the blocks after every change and inserts invisible spacers so
nothing runs into a margin: before a block that has to start on the next page, between the lines of a paragraph, or
between the items of a list. Layout is simulated from each block's natural height, so the spacers already on screen
never feed back into the measurement. When printing, each spacer becomes a page break and `@page` sets the margins.

## Autosave

Each editor calls `changed(body)` on every edit. The hook waits for 800 ms of quiet, then `PUT`s the whole body. Edits
made while a save is in flight are queued and sent after it. If a save fails, the body is kept and retried every
5 seconds, and the header shows "Offline, retrying". Hiding or closing the tab flushes immediately.

## Security

- Passwords: scrypt (N=16384, r=8, p=1) with a random salt. Login compares against a dummy hash for unknown emails so
  timing does not reveal which emails have accounts.
- Sessions: 32 random bytes in an `HttpOnly`, `SameSite=Lax` cookie; only the SHA-256 is stored. 30-day expiry.
- Every API route resolves the user from the session and only reads that user's index, so one user cannot address
  another's items even with a guessed id.
- Uploaded files are served inline only for images, audio, video, PDF and plain text, always with `nosniff` and a
  sandboxing CSP. Everything else is a download, so an uploaded HTML or SVG file cannot run script on the origin.
- Share ids are 16 random characters (about 80 bits). A link stops working when it is turned off or the item is trashed.
  An edit link can only change that one document's content (through the live channel and `PUT /api/share/:id/body`);
  a view link's live updates are ignored by the server.
- Sign-up, sign-in and guest creation are rate limited per IP.
