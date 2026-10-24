# Architecture

```
Browser                                    Server (Next.js route handlers)            Storage
───────                                    ──────────────────────────────             ───────
Docs     ─┐                                /api/auth/*   accounts, sessions     ─┐
Sheets   ─┤  fetch JSON  ───────────────▶  /api/items/*  drive index, bodies    ─┼─▶  KV interface (src/lib/store.ts)
Slides   ─┤  (src/lib/client.ts)           /api/upload   raw file bytes         ─┤      ├─ Netlify Blobs (on Netlify)
Notebook ─┤                                /api/share/*  public read-only links ─┘      └─ files on disk (elsewhere)
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
- Sign-up, sign-in and guest creation are rate limited per IP.
