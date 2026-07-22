# Mega_surfer — Merged Instagram + TikTok Backend

**Date:** 2026-07-22
**Status:** Approved — ready for implementation planning

## Goal

Create a new backend folder `databases/Mega_surfer/` that hosts a **single merged
PostgreSQL database** and **one Express server** serving both the Instagram and
TikTok APIs. Each platform's route logic is preserved byte-for-byte; the two APIs
are exposed under distinct URL prefixes on one port.

## Context

The repo currently has two structurally near-identical backends:

- `databases/instagram/` — Insta Surfer backend, DB `insta_surf_multi_prisma`, port 8442.
- `databases/tiktok/` — Tik Surfer backend, DB `Tik_Surfer_multi_fix`, port 8443.

Both are Express + raw `pg` (Prisma is present but vestigial at runtime — routes use
the `pg` pool; `init-db.js` executes a `.sql` file, not Prisma migrations).

Key finding: **`tiksurferschema.sql` is already the exact superset** of both schemas
(22 `CREATE TABLE` = all 13 Instagram tables + 9 TikTok tables). Its `ig_users` DDL
already includes the extra columns TikTok's `users.js` inserts (`display_name`,
`video_count`, `signature`, `bio_link`, `region`, `avatar_url`), so a fresh DB built
from it supports both platforms immediately.

The shared endpoints (`/api/auth`, `/api/users`, `/api/posts`, `/api/comments`,
`/api/projects`, `/api/scrape`, `/api/admin`, `/api/health`) exist in **both**
backends but with **divergent handlers** (TikTok's are evolved forks — shared
`config/jwt.js` + `utils/ownership.js`, better ownership checks, TikTok field
handling). Two divergent handlers cannot co-mount at the same path, so the merge
keeps both route sets intact and separates them by URL prefix.

## Decisions (confirmed with user)

1. **Deliverable:** merged database **and** a unified running server.
2. **Table model:** shared — one set of common tables (`users`, `projects`,
   `scrape_*`, `ig_users`, `posts`, `comments`) serves both platforms. IG data lives
   in `posts`/`comments`; TikTok in `tiktok_videos`/`tiktok_comments`.
3. **DB target:** new database `mega_surfer` on the existing host
   (`100.115.149.3:5432`, user `devuser`), new port `8444`, env copied from tiktok.
   Existing two DBs left untouched.
4. **Route topology:** path-prefixed — Instagram under `/ig/api/*`, TikTok under
   `/tk/api/*`. No route logic merged (zero regression risk to either extension).
5. **Data:** fresh schema only — no rows migrated from the existing databases.

## Architecture

```
databases/Mega_surfer/
├── .env                   # from tiktok/.env; LOCAL_DATABASE_URL→mega_surfer, PORT=8444, one JWT_SECRET
├── .env.local
├── .env.example
├── .gitignore
├── package.json           # name "mega-surfer-backend"; deps identical to both backends
├── server.js              # single dotenv load, init-db on boot, mounts both route sets
├── init-db.js             # runs mega-surferschema.sql via ../clean-schema.js (create-DB-if-missing logic from tiktok)
├── mega-surferschema.sql  # copy of tiksurferschema.sql (the superset)
├── prisma/
│   └── schema.prisma      # copy of tiktok superset — for Prisma Studio/tooling only, vestigial at runtime
├── ig/                    # Instagram app copied INTACT
│   ├── routes/            # admin, auth, comments, health, posts, projects, scrape, users
│   ├── middleware/auth.js
│   ├── db.js              # reads shared env → merged DB
│   └── public/            # IG admin UI
└── tk/                    # TikTok app copied INTACT
    ├── routes/            # + keywords, tiktok_comments, tiktok_creators, tiktok_videos
    ├── middleware/auth.js
    ├── config/jwt.js
    ├── utils/ownership.js
    ├── db.js              # reads shared env → merged DB
    └── public/            # TikTok admin UI
```

### Route mounting (`server.js`)

- `/ig/api/*` → `ig/routes/*` (auth, users, posts, comments, scrape, projects, admin, health)
- `/tk/api/*` → `tk/routes/*` (all of the above + keywords, tiktok_comments, tiktok_creators, tiktok_videos)
- Preserve each platform's original public/protected split (health/auth/admin public;
  users/posts/comments/scrape/projects behind `authenticateToken`), using each
  subfolder's own `middleware/auth.js`.
- Static admin UIs mounted at `/ig` and `/tk`.
- One `dotenv.config()` at the top; both `ig/db.js` and `tk/db.js` read the same
  `process.env.LOCAL_DATABASE_URL` → the same merged pool target.

### Why route files stay unmodified

Each platform subfolder keeps the relative paths its route files already use
(`require('../db')`, `require('../middleware/auth')`, `require('../config/jwt')`,
`require('../utils/ownership')`). Because we copy each app as a self-contained
subtree, those requires resolve unchanged. Only the **connection target** changes,
and that comes purely from the shared `.env` — no file edits to route logic.

### Database initialization

`init-db.js` adapts tiktok's version: parse `LOCAL_DATABASE_URL`, create the
`mega_surfer` database if it does not exist (connecting to `postgres`), then run
`mega-surferschema.sql` (cleaned via the existing `databases/clean-schema.js`).
Idempotent — re-running skips an already-applied schema.

### JWT / auth

One `JWT_SECRET` in the merged `.env` (the two current backends use different
secrets). Both middlewares read `process.env.JWT_SECRET`, so tokens are consistent
within and across both platforms on the merged server.

## Non-goals

- No merging/rewriting of divergent route handlers.
- No data migration from the existing databases.
- No changes to the existing `instagram/` or `tiktok/` folders.
- No reverse-proxy / subdomain configuration (extensions repoint to the new
  `…:8444/ig/api` and `…:8444/tk/api` base URLs; proxy wiring is out of scope).

## Risks & mitigations

- **Duplicated shared route code** across `ig/` and `tk/` — accepted deliberately as
  the price of zero-regression isolation.
- **Extensions must be repointed** to the new base URLs — unavoidable (new port),
  and required regardless of topology choice.
- **Prisma schema is stale** vs the SQL (e.g. missing `tiktok_users`) — irrelevant to
  runtime since routes use raw `pg`; carried only for Studio. Not reconciled here.

## Success criteria

- `npm install && npm start` in `databases/Mega_surfer/` creates the `mega_surfer`
  database (if missing), applies the full 22-table schema, and listens on 8444.
- `GET /ig/api/health` reports Platform "Instagram"; `GET /tk/api/health` reports
  "TikTok".
- Instagram capture payloads succeed against `/ig/api/*`; TikTok payloads against
  `/tk/api/*`, both writing into the one `mega_surfer` database.
- Existing `instagram/` and `tiktok/` folders and their databases are unchanged.
