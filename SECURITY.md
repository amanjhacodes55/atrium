# Security policy

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's private vulnerability reporting
(**Security → Report a vulnerability** on the repository). You will get a reply within a few days.

Include the version or commit, steps to reproduce, and the impact you expect.

## Hardening checklist for self-hosters

- Create your accounts, then set `ATRIUM_ALLOW_SIGNUP=false` unless you want strangers to sign up.
- Serve Atrium over HTTPS; the session cookie is marked `Secure` whenever the request arrives over HTTPS.
- Back up the data folder (see [self-hosting](docs/self-hosting.md#backups)).
- Set `ATRIUM_QUOTA_MB` and `ATRIUM_MAX_UPLOAD_MB` to fit your disk.

How passwords, sessions, uploads and share links are protected is described in
[architecture → security](docs/architecture.md#security).
