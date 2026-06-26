# db-setup

Standalone, **idempotent** bootstrapper that ensures the **local** PostgreSQL
databases for both backend projects exist, creating and seeding the schema for
any that are missing.

| Project              | Database                  |
| -------------------- | ------------------------- |
| tiksurfer            | `Tik_Surfer_multi_fix`    |
| insta-surfer (prisma)| `insta_surf_multi_prisma` |

Everything it needs is **self-contained in this folder** — it does not reach
into the sibling project directories:

```
db-setup/
├─ .env                       # connection strings for both databases
├─ .env.example               # template (copy to .env)
├─ create-databases.js
└─ schemas/
   ├─ tiksurfer.schema.sql
   └─ insta-surfer.schema.sql
```

## What it does

For each project, in order:

1. Reads its connection string from this folder's `.env`
   (`TIKSURFER_DATABASE_URL` / `INSTA_DATABASE_URL`). The database **name** at the
   end of the URL is the database that gets created.
2. Connects to the `postgres` maintenance database on the same host.
3. Decides:
   - **Database already exists** → skip, leave it untouched.
   - **Database is missing** → `CREATE DATABASE`, then run the local schema file
     from `schemas/` (psql meta-commands and `OWNER TO` lines stripped so the
     `pg_dump` applies on a fresh DB), then apply any post-schema statements
     (the Prisma backend gets its primary-key constraints).

It is **non-destructive**: it never drops or alters an existing database, and
re-running it only ever creates the ones that are missing. One project failing
does not stop the other; the script exits non-zero if any project failed.

## Requirements

- A running local PostgreSQL with the `devuser` role (must have `CREATEDB`).
- A `.env` in this folder (copy `.env.example`) with both connection strings.

## Usage

```bash
cd db-setup
cp .env.example .env   # then fill in the password
npm install
npm run create         # idempotent: create missing DBs, skip existing ones
```

### Drop & recreate (destructive)

To rebuild a database from scratch — **dropping it and all its data** — use
`--force`:

```bash
npm run recreate       # or: node create-databases.js --force
```

With `--force`, an existing database is `DROP DATABASE ... WITH (FORCE)`'d
(open connections are terminated) and rebuilt from the schema file. Without it,
existing databases are left untouched.

## Configuration

- **Credentials / DB names** → `.env` in this folder.
- **Schemas** → the `.sql` files in `schemas/`. To refresh them from a project,
  copy that project's `schema_latest.sql` over the matching file here.
- **Mapping** → the `PROJECTS` array near the top of
  [`create-databases.js`](create-databases.js) ties each project to its env var,
  schema file, and any post-schema statements.
