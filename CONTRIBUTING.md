# Contributing to Atrium

Thanks for helping. Bug reports, fixes, docs, templates and new features are all welcome.

## Setup

```bash
npm install
npm run dev
```

Open <http://localhost:3000> and click **Try it without an account** for a workspace with sample files, or create an
account. Data is stored in `./.data`; delete that folder for a clean start.

## Before you open a pull request

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

CI runs the same commands plus a Docker build.

## Guidelines

- **Editors work in the browser; the server stores.** Keep conversion, formula and layout code client-side (lazy-load
  heavy libraries with `await import(...)`), and keep route handlers thin.
- **Body formats are a public API.** They are documented in [docs/api.md](docs/api.md#data-model) and people script
  against them. Add optional fields rather than renaming or removing existing ones, and update the docs.
- **Every route checks the session** with `route()` from `src/lib/http.ts` and reads only the caller's drive.
- **Storage goes through `src/lib/store.ts`**, so the app keeps working on both Netlify Blobs and disk. Use `update()`
  for any read-modify-write.
- **Tests** live in `tests/`. Pure logic (drive rules, formulas, converters) should come with a test.
- Use the colour tokens in `globals.css` so both themes keep working.

## Commit messages

Write in the imperative and describe what changes for a user: "Add frozen columns to Sheets", not "update grid.tsx".

## Licence

By contributing you agree that your contribution is licensed under the
[GNU AGPL-3.0-or-later](LICENSE), like the rest of Atrium.
