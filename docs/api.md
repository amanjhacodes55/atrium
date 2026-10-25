# HTTP API

Everything the Atrium web app does goes through this JSON API, so you can script it too: back up a drive, bulk-upload
files, or generate documents from another system.

- **Base URL**: your Atrium origin, for example `https://atrium-office.netlify.app`.
- **Auth**: a session cookie (`atrium_session`), set by [sign in](#sign-in), [sign up](#sign-up) or
  [guest](#start-a-guest-workspace). Send it back on every request (`curl -c jar -b jar`).
- **Errors**: a non-2xx status with `{ "error": "Readable message", "field"?: "email" }`. `field` names the form field
  the error belongs to, when there is one.
- **Ids** are 12-character lowercase strings. Timestamps are Unix milliseconds.

```bash
# Quick start with curl
curl -c jar -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"…"}' https://atrium.example.com/api/auth/login
curl -b jar https://atrium.example.com/api/items
```

## Contents

- [Accounts](#accounts): sign up, sign in, sign out, me, guest, account settings
- [Items](#items): list, create, get, rename, star, move, trash, delete
- [Bodies](#bodies): read and save documents, spreadsheets, presentations and notebooks
- [Files](#files): upload and download
- [Sharing](#sharing): public read-only links
- [Data model](#data-model): `Item` and the four body formats

## Accounts

### Sign up

`POST /api/auth/signup`

```json
{ "name": "Ada Lovelace", "email": "ada@example.com", "password": "at least 8 chars" }
```

`201 { "user": User }` and a session cookie. If the request already carries a guest session, the guest account is
upgraded in place and keeps its files. `409` when the email is taken, `403` when the instance has sign-ups closed
(`ATRIUM_ALLOW_SIGNUP=false`), `429` after 10 sign-ups from one IP in 10 minutes.

### Sign in

`POST /api/auth/login` with `{ "email", "password" }` → `200 { "user": User }` and a session cookie. `401` for a wrong
email or password (the response does not say which). `429` after 20 attempts from one IP in 10 minutes.

### Start a guest workspace

`POST /api/auth/guest` → `201 { "user": User }` and a session cookie. Creates a password-less account filled with sample
files in every app. Sign up later to keep it.

### Sign out

`POST /api/auth/logout` → `200 { "ok": true }`. Deletes the session and clears the cookie.

### Current user

`GET /api/auth/me` → `200 { "user": User, "usage": { "used": bytes, "quota": bytes } }`, or `401 { "user": null }`.

### Account settings

`PATCH /api/auth/account` with any of:

```json
{ "name": "New name", "current": "old password", "password": "new password" }
```

`DELETE /api/auth/account` deletes the account and every file in it, then signs out. There is no undo.

`User` is `{ id, email, name, guest, createdAt }`.

## Items

An item is anything in a drive: a folder, a document (`doc`), a spreadsheet (`sheet`), a presentation (`slides`), a
notebook, or an uploaded `file`.

### List

`GET /api/items` → `200 { "items": Item[], "usage": Usage }`

Returns every item in the drive, trashed ones included (check `trashedAt`). Build folder views by filtering on
`parentId` (`null` is the top level).

### Create

`POST /api/items`

```json
{ "kind": "doc", "name": "Launch plan", "parentId": null, "body": { "type": "doc", "content": { … } } }
```

- `kind`: `folder`, `doc`, `sheet`, `slides` or `notebook`. Upload files with [`/api/upload`](#upload).
- `name`: optional, defaults to "Untitled document" and similar. At most 200 characters.
- `parentId`: optional folder id.
- `body`: optional starting content, in the [body format](#data-model) for that kind. Its `type` must equal `kind`.
  Leave it out for a blank file.

`201 { "item": Item }`. `404` if the folder does not exist, `413` if the drive is full or the body is over 4 MB.

### Get one

`GET /api/items/:id` → `200 { "item": Item }`

### Update

`PATCH /api/items/:id` with any of:

| Field      | Effect                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------- |
| `name`     | Rename.                                                                                      |
| `starred`  | `true` / `false`.                                                                            |
| `parentId` | Move into a folder (`null` for the top level). Moving a folder into itself is refused.      |
| `trashed`  | `true` moves the item, and everything inside a folder, to the trash. `false` restores it.   |

`200 { "item": Item }`.

### Copy

`POST /api/items/:id/copy` → `201 { "item": Item }` named "Copy of …", in the same folder. Folders cannot be copied.

### Delete forever

`DELETE /api/items/:id` → `200 { "deleted": n }`, where `n` counts the item plus everything inside it.

`DELETE /api/trash` empties the trash → `200 { "deleted": n }`.

## Bodies

### Read

`GET /api/items/:id/body` → `200 { "item": Item, "body": Body }` for `doc`, `sheet`, `slides` and `notebook` items.

### Save

`PUT /api/items/:id/body` with the whole body as JSON → `200 { "item": Item }` (with the new `size` and `updatedAt`).

The body replaces the stored one; the editors send the full body after each burst of typing. Bodies are limited to
4 MB, which is why images inside documents are scaled down before they are embedded.

## Files

### Upload

`POST /api/upload?name=report.pdf&type=application/pdf&parent=<folderId>` with the raw bytes as the request body
(not multipart):

```bash
curl -b jar --data-binary @report.pdf \
  "https://atrium.example.com/api/upload?name=report.pdf&type=application/pdf"
```

`201 { "item": Item }`. The limit per file is `ATRIUM_MAX_UPLOAD_MB` (50 MB by default, 4.5 MB on Netlify, whose
functions accept at most 6 MB per request).

### Download

`GET /api/items/:id/file` returns the bytes. Images, video, audio, PDF and plain text are served inline so the browser
can preview them; add `?download` to force a download. Every other type (HTML and SVG included) is always sent as a
download with `Content-Type: application/octet-stream`, so an uploaded file can never run script on the Atrium origin.

## Sharing

### Turn a link on or off

`POST /api/items/:id/share` with `{ "on": true, "role": "view" | "edit" }` → `200 { "item": Item }`. `item.shareId` is
the public link id, and the link is `https://<origin>/s/<shareId>`. `role` defaults to `"view"`; `"edit"` is accepted for
documents only and lets anyone with the link edit live. Changing the role keeps the same link. `{ "on": false }`
deletes the link; turning it on again makes a new one.

### Read a shared item (no auth)

`GET /api/share/:shareId` →
`200 { "item": { id, kind, name, mime, size, updatedAt }, "role": "view" | "edit", "owner": string, "me": {…} | null, "body"?: Body }`.
`body` is present for documents, spreadsheets, presentations and notebooks. `owner` is the owner's display name, and
`me` describes the visitor when they are signed in (who then also get the link under *Shared with me*). A link stops
working when it is turned off or when the item is trashed.

`GET /api/share/:shareId/file` downloads a shared upload, with the same inline rules as above.

`PUT /api/share/:shareId/body` with a `doc` body saves a document edited through an edit link (`403` on a view link).

### Shared with me (auth)

`GET /api/shared` → `200 { "shared": [{ shareId, name, kind, role, owner, openedAt }] }`, newest first: links the
signed-in user has opened. `DELETE /api/shared` with `{ "shareId": "…" }` removes one from the list.

## Live editing

Documents are edited live through a small polling protocol over [Yjs](https://yjs.dev) updates, so it works on
serverless hosting with no socket server. The owner uses `POST /api/items/:id/live`; people on a link use
`POST /api/share/:shareId/live` (view links can poll but their updates are ignored).

```json
{ "since": 12, "epoch": "k3j…", "client": 4102, "update": "<base64 Yjs update>", "awareness": "<base64>" }
```

→ `200 { "epoch": "k3j…", "seq": 14, "updates": ["<base64>", …], "peers": [{ "client": 77, "state": "<base64>" }] }`

- `since` is the last `seq` the client applied; `updates` holds everything after it (or the whole history if the client
  is further back than the last compaction). Updates are idempotent, so applying one twice is harmless.
- `seed: true` with an `update` only stores it if the document has no live history yet (the first person to open it).
- `awareness` is the client's Yjs awareness state (cursor, name, colour), `null` when leaving. Peers that have not
  announced themselves for 25 seconds are dropped.
- If `epoch` differs from the client's, the document was replaced (a Word import): discard the local copy and reload.
  `PUT /api/items/:id/live` with `{ "update": "<base64>" }` does that replacement.

The client is [`src/lib/live-client.ts`](../src/lib/live-client.ts) and the server [`src/lib/live.ts`](../src/lib/live.ts).

## Data model

```ts
type Item = {
  id: string;
  kind: "folder" | "doc" | "sheet" | "slides" | "notebook" | "file";
  name: string;
  parentId: string | null; // folder id, null = top level
  mime?: string;           // uploads only
  size: number;            // bytes of the stored body
  starred: boolean;
  trashedAt: number | null;
  createdAt: number;
  updatedAt: number;
  shareId: string | null;  // set while a public link is on
  shareRole?: "view" | "edit"; // what the link allows (absent = view)
};
```

The full TypeScript definitions are in [`src/lib/types.ts`](../src/lib/types.ts).

### `doc`

```json
{ "type": "doc", "page": { "size": "a4", "margins": "normal" }, "content": { "type": "doc", "content": [ … ] } }
```

`content` is a [ProseMirror/TipTap JSON document](https://tiptap.dev/docs/editor/core-concepts/schema). Nodes:
`paragraph`, `heading` (`attrs.level` 1–3), `bulletList`, `orderedList`, `listItem`, `taskList`, `taskItem`
(`attrs.checked`), `blockquote`, `codeBlock`, `horizontalRule`, `image` (`attrs.src`, a data URL), `table`,
`tableRow`, `tableHeader`, `tableCell`. Marks: `bold`, `italic`, `underline`, `strike`, `code`, `link`, `highlight`,
`textStyle` (`color`, `fontFamily`, `fontSize`). Paragraphs and headings take `attrs.textAlign`.

### `sheet`

```json
{
  "type": "sheet",
  "sheets": [
    {
      "name": "Budget",
      "cells": { "A1": "Item", "B1": "Cost", "B2": "120", "B3": "=SUM(B2:B2)" },
      "styles": { "A1": { "b": true, "bg": "#e8f5e9" }, "B3": { "fmt": "currency" } },
      "colWidths": { "0": 160 },
      "frozen": { "rows": 1, "cols": 0 }
    }
  ]
}
```

Cells are sparse and keyed in A1 notation. A value starting with `=` is a formula, evaluated with
[HyperFormula](https://hyperformula.handsontable.com/) (the Excel function set; `Sheet2!A1` references work across
tabs). Styles: `b`, `i`, `u`, `align`, `color`, `bg`, `fmt` (`general`, `number`, `currency`, `percent`, `date`).
`colWidths` maps a zero-based column index to pixels.

### `slides`

```json
{
  "type": "slides",
  "theme": "light",
  "slides": [
    {
      "id": "s1",
      "bg": "#ffffff",
      "notes": "Speaker notes",
      "els": [{ "id": "t1", "type": "text", "x": 80, "y": 180, "w": 800, "h": 100, "text": "Hello", "size": 48, "bold": true }]
    }
  ]
}
```

Slides are a 960 × 540 canvas. Elements are `text`, `rect`, `ellipse` or `image` (with `src` as a data URL) and are
positioned in canvas pixels. Optional element fields: `size`, `bold`, `italic`, `underline`, `align`, `color`, `fill`,
`font` (`sans`, `serif`, `mono`), `stroke`, `strokeWidth`.

### `notebook`

```json
{
  "type": "notebook",
  "color": "#7c3aed",
  "sections": [
    { "id": "s1", "name": "Meetings", "color": "#7c3aed", "pages": [{ "id": "p1", "title": "Weekly sync", "updatedAt": 0, "content": { "type": "doc", "content": [] } }] }
  ]
}
```

Each page's `content` uses the same TipTap JSON as `doc`.

## Example: create a spreadsheet from a script

```bash
curl -b jar -H 'content-type: application/json' https://atrium.example.com/api/items -d '{
  "kind": "sheet",
  "name": "Invoices",
  "body": { "type": "sheet", "sheets": [{ "name": "Sheet1", "colWidths": {}, "styles": {},
    "cells": { "A1": "Client", "B1": "Amount", "A2": "Acme", "B2": "1200", "A3": "Total", "B3": "=SUM(B2:B2)" } }] }
}'
```
