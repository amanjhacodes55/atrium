# Self-hosting

Atrium is one Next.js app with no database server. It stores everything as key/value entries:

- **On Netlify**, in [Netlify Blobs](https://docs.netlify.com/blobs/overview/), which every site gets automatically.
- **Anywhere else**, in a folder on disk (`ATRIUM_DATA_DIR`, default `./.data`).

## Netlify (one click, free tier)

1. Fork [the repository](https://github.com/amanjhacodes55/atrium) on GitHub.
2. In Netlify, choose **Add new project → Import an existing project** and pick your fork. The settings come from
   [`netlify.toml`](../netlify.toml); there is nothing to fill in.
3. Deploy. Accounts and files are stored in the site's Blobs store.

Or from your machine with the Netlify CLI:

```bash
npm install
npx netlify-cli deploy --build --prod
```

Netlify functions accept request bodies up to 6 MB, so single uploads are capped at 4.5 MB there. Self-host with Docker
for bigger files.

## Docker

```bash
docker compose up -d
```

Open <http://localhost:3000>. Data lives in the `atrium-data` volume (`/data` in the container).

Without Compose:

```bash
docker build -t atrium .
docker run -d -p 3000:3000 -v atrium-data:/data --name atrium atrium
```

## Node

Node 20.9 or newer.

```bash
npm ci
npm run build
ATRIUM_DATA_DIR=/var/lib/atrium npm start
```

Run it behind a reverse proxy (Caddy, nginx) that terminates HTTPS. Atrium marks the session cookie `Secure` when the
request arrives over HTTPS (it trusts `X-Forwarded-Proto`).

## Settings

All optional.

| Variable               | Default                       | Meaning                                                                 |
| ---------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `ATRIUM_ALLOW_SIGNUP`  | `true`                        | `false` stops new sign-ups and guest workspaces.                        |
| `ATRIUM_QUOTA_MB`      | `500`                         | Storage per account.                                                    |
| `ATRIUM_MAX_UPLOAD_MB` | `50` (`4.5` on Netlify)       | Largest single upload.                                                  |
| `ATRIUM_DATA_DIR`      | `./.data`                     | Data folder when not on Netlify.                                        |
| `ATRIUM_STORAGE`       | automatic                     | `fs` forces the data folder even on Netlify.                            |

## Backups

**Disk storage:** copy the data folder. Values are written to a temporary file and renamed into place, so a copy taken
while Atrium runs never contains half-written files.

```bash
docker run --rm -v atrium-data:/data -v "$PWD":/backup alpine tar czf /backup/atrium-$(date +%F).tgz -C /data .
```

**Netlify Blobs:** list and download the `atrium` store with the Netlify CLI:

```bash
npx netlify-cli blobs:list atrium
npx netlify-cli blobs:get atrium <key> --output <file>
```

## Layout of the data

| Key                   | Value                                                          |
| --------------------- | -------------------------------------------------------------- |
| `user/<id>`           | Account: name, email, scrypt password hash.                    |
| `email/<sha256>`      | Email → user id (keeps emails unique).                         |
| `session/<sha256>`    | Session: user id and expiry. Only the token's hash is stored.  |
| `drive/<userId>`      | The drive index: metadata of every item, and bytes used.       |
| `content/<itemId>`    | A document body (JSON) or an uploaded file (raw bytes).        |
| `share/<shareId>`     | Public link → owner and item.                                  |

See [architecture](architecture.md) for why it is laid out this way.
